import type { Recall, RevisionState, SolvedProblem } from './types.ts';

export const DAY_MS = 86_400_000;

const MIN_EASE = 0.6;
const MAX_EASE = 1.8;

/**
 * How each recall rating moves the schedule.
 *
 * `stage` walks the interval ladder (1d, 3d, 7d, ...); `ease` is a per-problem
 * multiplier on top of it, so a problem you keep struggling with tightens its
 * own spacing even at the same stage.
 */
const RECALL_EFFECT: Record<Recall, { stage: number | 'reset'; ease: number }> = {
  forgot: { stage: 'reset', ease: -0.15 },
  hard: { stage: -1, ease: -0.1 },
  good: { stage: +1, ease: 0 },
  easy: { stage: +2, ease: +0.1 },
};

function clampEase(ease: number): number {
  return Math.min(MAX_EASE, Math.max(MIN_EASE, Number(ease.toFixed(2))));
}

function intervalDays(intervals: number[], stage: number, ease: number): number {
  if (intervals.length === 0) return 1;
  const index = Math.min(Math.max(stage, 0), intervals.length - 1);
  const base = intervals[index] ?? 1;
  // Never collapse below a day — a same-day repeat is not spaced repetition.
  return Math.max(1, Math.round(base * ease));
}

/**
 * Schedule a freshly solved problem for its first revision.
 *
 * `struggle` (0–1) is what the attempt journal said the problem cost. It sets
 * the starting ease, so a problem that took six submits comes back sooner and
 * keeps coming back sooner at every stage, and it raises the number of clean
 * reviews the problem is expected to earn before it is settled.
 */
export function initialRevision(intervals: number[], now: number, struggle = 0): RevisionState {
  const bounded = Math.min(1, Math.max(0, struggle));
  // 0 struggle leaves the ladder as configured; full struggle compresses it to
  // 60%, the same floor a run of `forgot` ratings would reach.
  const ease = clampEase(1 - 0.4 * bounded);

  return {
    stage: 0,
    ease,
    dueAt: now + intervalDays(intervals, 0, ease) * DAY_MS,
    reviewCount: 0,
    lapses: 0,
    hintsUsed: 0,
    struggle: bounded,
    targetReviews: targetReviewsFor(bounded, intervals),
  };
}

/**
 * How many clean reviews a problem should earn before it is settled.
 *
 * The ladder is the floor; a problem that fought back gets up to three extra
 * passes on top of it.
 */
export function targetReviewsFor(struggle: number, intervals: number[]): number {
  const base = Math.max(1, intervals.length);
  return base + Math.round(3 * Math.min(1, Math.max(0, struggle)));
}

/** True once the problem has had the reviews its difficulty asked for. */
export function isSettled(state: RevisionState, intervals: number[]): boolean {
  const target = state.targetReviews ?? Math.max(1, intervals.length);
  return state.reviewCount >= target && state.stage >= Math.max(0, intervals.length - 1);
}

/** Apply a recall rating and return the next schedule for the problem. */
export function applyRecall(
  state: RevisionState,
  recall: Recall,
  intervals: number[],
  now: number,
): RevisionState {
  const effect = RECALL_EFFECT[recall];
  const maxStage = Math.max(0, intervals.length - 1);
  const nextStage =
    effect.stage === 'reset'
      ? 0
      : Math.min(maxStage, Math.max(0, state.stage + effect.stage));
  const nextEase = clampEase(state.ease + effect.ease);

  return {
    stage: nextStage,
    ease: nextEase,
    dueAt: now + intervalDays(intervals, nextStage, nextEase) * DAY_MS,
    lastReviewedAt: now,
    reviewCount: state.reviewCount + 1,
    lapses: state.lapses + (recall === 'forgot' ? 1 : 0),
    hintsUsed: state.hintsUsed ?? 0,
    struggle: state.struggle,
    // Forgetting it once means the original estimate of what it costs was too
    // low, so the problem earns another pass.
    targetReviews:
      state.targetReviews === undefined
        ? undefined
        : state.targetReviews + (recall === 'forgot' ? 1 : 0),
  };
}

export function isDue(state: RevisionState, now: number): boolean {
  return state.dueAt <= now;
}

/** Problems ready for review, most overdue first. */
export function dueProblems(problems: SolvedProblem[], now: number): SolvedProblem[] {
  return problems
    .filter((problem) => isDue(problem.revision, now))
    .sort((a, b) => a.revision.dueAt - b.revision.dueAt);
}

/** Next problems on the horizon, soonest first — used for the "upcoming" list. */
export function upcomingProblems(
  problems: SolvedProblem[],
  now: number,
  limit = 5,
): SolvedProblem[] {
  return problems
    .filter((problem) => !isDue(problem.revision, now))
    .sort((a, b) => a.revision.dueAt - b.revision.dueAt)
    .slice(0, limit);
}

/** Human-friendly "due in" text, e.g. `3d`, `5h`, `overdue 2d`. */
export function formatDueIn(dueAt: number, now: number): string {
  const delta = dueAt - now;
  const overdue = delta <= 0;
  const abs = Math.abs(delta);
  const days = Math.floor(abs / DAY_MS);
  const hours = Math.floor((abs % DAY_MS) / 3_600_000);

  if (days === 0 && hours === 0) return overdue ? 'due now' : 'under 1h';
  const text = days > 0 ? `${days}d` : `${hours}h`;
  return overdue ? `overdue ${text}` : `in ${text}`;
}

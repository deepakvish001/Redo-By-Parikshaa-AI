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

/** Schedule a freshly solved problem for its first revision. */
export function initialRevision(intervals: number[], now: number): RevisionState {
  return {
    stage: 0,
    ease: 1,
    dueAt: now + intervalDays(intervals, 0, 1) * DAY_MS,
    reviewCount: 0,
    lapses: 0,
  };
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

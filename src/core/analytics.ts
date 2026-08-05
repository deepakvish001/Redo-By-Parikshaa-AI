import { DAY_MS, isDue } from './srs.ts';
import {
  PLATFORMS,
  type Difficulty,
  type Platform,
  type SolvedProblem,
  type Stats,
  type TopicStat,
} from './types.ts';

/** Local-timezone `YYYY-MM-DD`, used as the key for streak accounting. */
export function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Consecutive days of activity ending today (or yesterday — a streak is only
 * broken once a full day passes with nothing done).
 */
export function computeStreak(problems: SolvedProblem[], now: number): number {
  const activeDays = new Set<string>();
  for (const problem of problems) {
    activeDays.add(dayKey(problem.solvedAt));
    if (problem.revision.lastReviewedAt) {
      activeDays.add(dayKey(problem.revision.lastReviewedAt));
    }
  }
  if (activeDays.size === 0) return 0;

  let cursor = now;
  if (!activeDays.has(dayKey(cursor))) {
    cursor -= DAY_MS;
    if (!activeDays.has(dayKey(cursor))) return 0;
  }

  let streak = 0;
  while (activeDays.has(dayKey(cursor))) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

/**
 * Roughly how long a problem of each difficulty should take before the time
 * spent starts to say something about how well the topic is known.
 */
const TIME_BUDGET_MS: Record<string, number> = {
  easy: 15 * 60_000,
  medium: 30 * 60_000,
  hard: 60 * 60_000,
  unknown: 30 * 60_000,
};

/** Median, so one marathon session does not define a whole topic. */
function medianOf(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2)
    : (sorted[middle] as number);
}

/** 0 when solved within budget, rising to 1 at three times the budget. */
function timeOverrun(problem: SolvedProblem): number | undefined {
  if (!problem.solveTimeMs) return undefined;
  const budget = TIME_BUDGET_MS[problem.difficulty] ?? TIME_BUDGET_MS.unknown!;
  return Math.min(1, Math.max(0, problem.solveTimeMs / budget - 1) / 2);
}

/**
 * Per-tag mastery on a 0–100 scale.
 *
 * The score rewards problems that have climbed the interval ladder, and
 * penalises the four signals that actually predict a shaky topic: forgetting a
 * problem on review, needing many attempts before it was accepted, reaching for
 * hints, and taking far longer than the problem should take.
 *
 * Time and hints only count for the problems that have them, so a collection
 * recorded before those were tracked is scored on what it does have rather
 * than being penalised for the gap.
 */
export function computeTopicStats(problems: SolvedProblem[], maxStage: number): TopicStat[] {
  const buckets = new Map<string, SolvedProblem[]>();
  for (const problem of problems) {
    for (const tag of problem.tags) {
      const key = tag.trim().toLowerCase();
      if (!key) continue;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(problem);
      else buckets.set(key, [problem]);
    }
  }

  const stageCeiling = Math.max(1, maxStage);
  const stats: TopicStat[] = [];

  for (const [tag, bucket] of buckets) {
    const solved = bucket.length;
    const lapses = bucket.reduce((sum, p) => sum + p.revision.lapses, 0);
    const reviews = bucket.reduce((sum, p) => sum + p.revision.reviewCount, 0);
    const totalAttempts = bucket.reduce((sum, p) => sum + p.attempts, 0);

    const stageScore =
      bucket.reduce((sum, p) => sum + Math.min(p.revision.stage, stageCeiling), 0) /
      (solved * stageCeiling);
    const lapseRate = reviews === 0 ? 0 : lapses / reviews;
    // Attempts beyond the first cost something, saturating at 5 attempts.
    const attemptPenalty =
      bucket.reduce((sum, p) => sum + Math.min(Math.max(p.attempts - 1, 0), 4), 0) /
      (solved * 4);
    // Three revealed hints on a problem is as much help as we count.
    const hintsUsed = bucket.reduce((sum, p) => sum + (p.revision.hintsUsed ?? 0), 0);
    const hintPenalty =
      bucket.reduce((sum, p) => sum + Math.min(p.revision.hintsUsed ?? 0, 3), 0) / (solved * 3);

    const overruns = bucket
      .map(timeOverrun)
      .filter((value): value is number => value !== undefined);
    const timePenalty =
      overruns.length === 0 ? 0 : overruns.reduce((sum, value) => sum + value, 0) / overruns.length;

    const raw =
      0.55 * stageScore +
      0.45 * (1 - lapseRate) -
      (0.2 * attemptPenalty + 0.15 * hintPenalty + 0.1 * timePenalty);

    stats.push({
      tag,
      solved,
      lapses,
      totalAttempts,
      hintsUsed,
      medianSolveMs: medianOf(
        bucket.map((p) => p.solveTimeMs).filter((value): value is number => Boolean(value)),
      ),
      mastery: Math.round(Math.min(1, Math.max(0, raw)) * 100),
    });
  }

  return stats.sort((a, b) => a.mastery - b.mastery || b.solved - a.solved);
}

/** Tags with enough data to rank, falling back to everything when data is thin. */
function rankable(stats: TopicStat[]): TopicStat[] {
  const confident = stats.filter((stat) => stat.solved >= 2);
  return confident.length > 0 ? confident : stats;
}

export function computeStats(
  problems: SolvedProblem[],
  intervals: number[],
  now: number,
): Stats {
  const byDifficulty: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0, unknown: 0 };
  const byPlatform = Object.fromEntries(
    PLATFORMS.map((platform) => [platform, 0]),
  ) as Record<Platform, number>;
  let reviewsCompleted = 0;

  for (const problem of problems) {
    byDifficulty[problem.difficulty] += 1;
    // A record stored by an older version may name a platform we no longer
    // list; counting it would create a key nothing else expects.
    if (problem.platform in byPlatform) byPlatform[problem.platform] += 1;
    reviewsCompleted += problem.revision.reviewCount;
  }

  const topics = computeTopicStats(problems, Math.max(1, intervals.length - 1));
  const ranked = rankable(topics);
  const weakestTopics = ranked.slice(0, 5);
  // With only a handful of tags the two lists would otherwise show the same
  // topics twice, which reads as a bug rather than a ranking.
  const weakestTags = new Set(weakestTopics.map((topic) => topic.tag));
  const strongestTopics = [...ranked]
    .reverse()
    .filter((topic) => !weakestTags.has(topic.tag))
    .slice(0, 5);

  return {
    total: problems.length,
    byDifficulty,
    byPlatform,
    dueToday: problems.filter((problem) => isDue(problem.revision, now)).length,
    reviewsCompleted,
    currentStreak: computeStreak(problems, now),
    weakestTopics,
    strongestTopics,
  };
}

import { DAY_MS, isDue } from './srs.ts';
import type { Difficulty, Platform, SolvedProblem, Stats, TopicStat } from './types.ts';

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
 * Per-tag mastery on a 0–100 scale.
 *
 * The score rewards problems that have climbed the interval ladder and
 * penalises the two signals that actually predict a shaky topic: forgetting a
 * problem on review, and needing many attempts before it was accepted.
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

    const raw = 0.6 * stageScore + 0.4 * (1 - lapseRate) - 0.25 * attemptPenalty;
    stats.push({
      tag,
      solved,
      lapses,
      totalAttempts,
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
  const byPlatform: Record<Platform, number> = { leetcode: 0, codeforces: 0 };
  let reviewsCompleted = 0;

  for (const problem of problems) {
    byDifficulty[problem.difficulty] += 1;
    byPlatform[problem.platform] += 1;
    reviewsCompleted += problem.revision.reviewCount;
  }

  const topics = computeTopicStats(problems, Math.max(1, intervals.length - 1));
  const ranked = rankable(topics);

  return {
    total: problems.length,
    byDifficulty,
    byPlatform,
    dueToday: problems.filter((problem) => isDue(problem.revision, now)).length,
    reviewsCompleted,
    currentStreak: computeStreak(problems, now),
    weakestTopics: ranked.slice(0, 5),
    strongestTopics: [...ranked].reverse().slice(0, 5),
  };
}

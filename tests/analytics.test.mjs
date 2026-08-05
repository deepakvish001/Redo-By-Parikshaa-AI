import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, computeStreak, computeTopicStats, dayKey } from '../src/core/analytics.ts';
import { DAY_MS } from '../src/core/srs.ts';
import { buildIndexReadme, buildProblemReadme } from '../src/core/markdown.ts';

const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();
const INTERVALS = [1, 3, 7, 21, 45, 90];

function makeProblem(overrides = {}) {
  const { revision, ...rest } = overrides;
  return {
    id: `leetcode:${rest.slug ?? 'two-sum'}`,
    platform: 'leetcode',
    problemId: '1',
    slug: 'two-sum',
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'easy',
    tags: ['array'],
    language: 'Python3',
    code: 'print(1)',
    solvedAt: NOW,
    attempts: 1,
    github: { status: 'synced', path: 'leetcode/easy/0001-two-sum/solution.py' },
    ...rest,
    revision: { stage: 0, ease: 1, dueAt: NOW + DAY_MS, reviewCount: 0, lapses: 0, ...revision },
  };
}

test('a topic that is forgotten repeatedly scores below one that is not', () => {
  const problems = [
    makeProblem({
      slug: 'dp-1',
      tags: ['dynamic programming'],
      attempts: 4,
      revision: { stage: 0, reviewCount: 3, lapses: 3 },
    }),
    makeProblem({
      slug: 'dp-2',
      tags: ['dynamic programming'],
      attempts: 3,
      revision: { stage: 0, reviewCount: 2, lapses: 2 },
    }),
    makeProblem({
      slug: 'arr-1',
      tags: ['array'],
      attempts: 1,
      revision: { stage: 4, reviewCount: 4, lapses: 0 },
    }),
    makeProblem({
      slug: 'arr-2',
      tags: ['array'],
      attempts: 1,
      revision: { stage: 5, reviewCount: 5, lapses: 0 },
    }),
  ];

  const stats = computeTopicStats(problems, INTERVALS.length - 1);
  const dp = stats.find((stat) => stat.tag === 'dynamic programming');
  const array = stats.find((stat) => stat.tag === 'array');

  assert.ok(dp.mastery < array.mastery, `${dp.mastery} should be below ${array.mastery}`);
  assert.equal(dp.lapses, 5);
  assert.equal(array.lapses, 0);
  // Weakest first, so the sorted list leads with the shaky topic.
  assert.equal(stats[0].tag, 'dynamic programming');
});

test('tags are normalised so casing does not split a topic', () => {
  const stats = computeTopicStats(
    [makeProblem({ slug: 'a', tags: ['Binary Search'] }), makeProblem({ slug: 'b', tags: ['binary search'] })],
    5,
  );
  assert.equal(stats.length, 1);
  assert.equal(stats[0].solved, 2);
});

test('mastery stays within 0 and 100 at the extremes', () => {
  const worst = computeTopicStats(
    [
      makeProblem({
        slug: 'worst',
        tags: ['greedy'],
        attempts: 9,
        revision: { stage: 0, reviewCount: 5, lapses: 5 },
      }),
    ],
    5,
  );
  assert.ok(worst[0].mastery >= 0 && worst[0].mastery <= 100);
  assert.equal(worst[0].mastery, 0);

  const best = computeTopicStats(
    [
      makeProblem({
        slug: 'best',
        tags: ['greedy'],
        attempts: 1,
        revision: { stage: 5, reviewCount: 5, lapses: 0 },
      }),
    ],
    5,
  );
  assert.equal(best[0].mastery, 100);
});

test('streaks count consecutive days and survive a same-day gap', () => {
  const problems = [
    makeProblem({ slug: 'a', solvedAt: NOW }),
    makeProblem({ slug: 'b', solvedAt: NOW - DAY_MS }),
    makeProblem({ slug: 'c', solvedAt: NOW - 2 * DAY_MS }),
  ];
  assert.equal(computeStreak(problems, NOW), 3);

  // A review counts as activity even when nothing new was solved.
  const withReview = [
    makeProblem({ slug: 'a', solvedAt: NOW - DAY_MS, revision: { lastReviewedAt: NOW } }),
  ];
  assert.equal(computeStreak(withReview, NOW), 2);
});

test('a missed day ends the streak', () => {
  const problems = [makeProblem({ slug: 'a', solvedAt: NOW - 3 * DAY_MS })];
  assert.equal(computeStreak(problems, NOW), 0);
  assert.equal(computeStreak([], NOW), 0);
});

test('yesterday-only activity still counts as a live streak', () => {
  const problems = [makeProblem({ slug: 'a', solvedAt: NOW - DAY_MS })];
  assert.equal(computeStreak(problems, NOW), 1);
});

test('dashboard stats summarise the collection', () => {
  const problems = [
    makeProblem({ slug: 'a', difficulty: 'easy', revision: { dueAt: NOW - DAY_MS } }),
    makeProblem({ slug: 'b', difficulty: 'hard', revision: { dueAt: NOW + DAY_MS, reviewCount: 2 } }),
    makeProblem({ slug: 'c', platform: 'codeforces', difficulty: 'medium' }),
  ];

  const stats = computeStats(problems, INTERVALS, NOW);
  assert.equal(stats.total, 3);
  assert.equal(stats.dueToday, 1);
  assert.equal(stats.byDifficulty.easy, 1);
  assert.equal(stats.byDifficulty.hard, 1);
  assert.equal(stats.byPlatform.codeforces, 1);
  assert.equal(stats.reviewsCompleted, 2);
});

test('the strong list never repeats what the weak list already showed', () => {
  const problems = [
    makeProblem({ slug: 'a', tags: ['dp'], attempts: 5, revision: { stage: 0, reviewCount: 3, lapses: 3 } }),
    makeProblem({ slug: 'b', tags: ['dp'], attempts: 5, revision: { stage: 0, reviewCount: 3, lapses: 3 } }),
    makeProblem({ slug: 'c', tags: ['array'], revision: { stage: 5, reviewCount: 3, lapses: 0 } }),
    makeProblem({ slug: 'd', tags: ['array'], revision: { stage: 5, reviewCount: 3, lapses: 0 } }),
  ];

  const stats = computeStats(problems, INTERVALS, NOW);
  const weak = stats.weakestTopics.map((topic) => topic.tag);
  const strong = stats.strongestTopics.map((topic) => topic.tag);

  assert.deepEqual(weak, ['dp', 'array']);
  // Only two topics exist and both are already listed as needing work, so the
  // "solid" list stays empty rather than echoing them back.
  assert.deepEqual(strong, []);
  assert.equal(strong.some((tag) => weak.includes(tag)), false);
});

test('day keys are stable within a local day', () => {
  const morning = new Date(2026, 0, 15, 1, 0, 0).getTime();
  const evening = new Date(2026, 0, 15, 23, 0, 0).getTime();
  assert.equal(dayKey(morning), dayKey(evening));
  assert.equal(dayKey(morning), '2026-01-15');
});

test('the problem README carries the metadata needed to revise later', () => {
  const readme = buildProblemReadme(
    makeProblem({ tags: ['array', 'hash table'], note: 'Use a seen-map.' }),
  );
  assert.match(readme, /# 0001\. Two Sum/);
  assert.match(readme, /\*\*Difficulty:\*\* easy/);
  assert.match(readme, /`array`, `hash table`/);
  assert.match(readme, /Use a seen-map\./);
  assert.match(readme, /https:\/\/leetcode\.com\/problems\/two-sum\//);
});

test('the index lists only problems that reached the repository', () => {
  const readme = buildIndexReadme(
    [
      makeProblem({ slug: 'a', title: 'Two Sum' }),
      makeProblem({ slug: 'b', title: 'Not Synced', github: { status: 'pending' } }),
    ],
    NOW,
  );
  assert.match(readme, /Two Sum/);
  assert.doesNotMatch(readme, /Not Synced/);
  assert.match(readme, /1 solved/);
});

test('pipes in a title cannot break the index table', () => {
  const readme = buildIndexReadme([makeProblem({ title: 'A | B' })], NOW);
  assert.match(readme, /A \\\| B/);
});

/* ------------------------------------------- hints and time as signals */

test('reaching for hints lowers a topic below one solved unaided', () => {
  const problems = [
    makeProblem({ slug: 'a', tags: ['greedy'], revision: { stage: 3, reviewCount: 3, hintsUsed: 3 } }),
    makeProblem({ slug: 'b', tags: ['greedy'], revision: { stage: 3, reviewCount: 3, hintsUsed: 3 } }),
    makeProblem({ slug: 'c', tags: ['trie'], revision: { stage: 3, reviewCount: 3, hintsUsed: 0 } }),
    makeProblem({ slug: 'd', tags: ['trie'], revision: { stage: 3, reviewCount: 3, hintsUsed: 0 } }),
  ];

  const stats = computeTopicStats(problems, INTERVALS.length - 1);
  const greedy = stats.find((stat) => stat.tag === 'greedy');
  const trie = stats.find((stat) => stat.tag === 'trie');

  assert.ok(greedy.mastery < trie.mastery, `${greedy.mastery} should be below ${trie.mastery}`);
  assert.equal(greedy.hintsUsed, 6);
  assert.equal(trie.hintsUsed, 0);
});

test('taking far longer than the difficulty warrants lowers the score', () => {
  const quick = makeProblem({ slug: 'a', tags: ['stack'], difficulty: 'easy', solveTimeMs: 5 * 60_000 });
  const slow = makeProblem({ slug: 'b', tags: ['heap'], difficulty: 'easy', solveTimeMs: 90 * 60_000 });

  const stats = computeTopicStats([quick, slow], INTERVALS.length - 1);
  const fast = stats.find((stat) => stat.tag === 'stack');
  const dragged = stats.find((stat) => stat.tag === 'heap');

  assert.ok(dragged.mastery < fast.mastery);
  assert.equal(fast.medianSolveMs, 5 * 60_000);
});

test('the time budget scales with difficulty', () => {
  // The same 45 minutes is over budget for an easy problem, fine for a hard one.
  const easy = makeProblem({ slug: 'a', tags: ['bfs'], difficulty: 'easy', solveTimeMs: 45 * 60_000 });
  const hard = makeProblem({ slug: 'b', tags: ['dfs'], difficulty: 'hard', solveTimeMs: 45 * 60_000 });

  const stats = computeTopicStats([easy, hard], INTERVALS.length - 1);
  assert.ok(
    stats.find((s) => s.tag === 'bfs').mastery < stats.find((s) => s.tag === 'dfs').mastery,
  );
});

test('problems recorded before timing existed are not penalised for it', () => {
  const untimed = [
    makeProblem({ slug: 'a', tags: ['queue'], revision: { stage: 3, reviewCount: 2 } }),
    makeProblem({ slug: 'b', tags: ['queue'], revision: { stage: 3, reviewCount: 2 } }),
  ];
  const timed = [
    makeProblem({ slug: 'c', tags: ['recursion'], solveTimeMs: 60_000, revision: { stage: 3, reviewCount: 2 } }),
    makeProblem({ slug: 'd', tags: ['recursion'], solveTimeMs: 60_000, revision: { stage: 3, reviewCount: 2 } }),
  ];

  const stats = computeTopicStats([...untimed, ...timed], INTERVALS.length - 1);
  // A well-within-budget time scores the same as no time at all.
  assert.equal(
    stats.find((s) => s.tag === 'queue').mastery,
    stats.find((s) => s.tag === 'recursion').mastery,
  );
  assert.equal(stats.find((s) => s.tag === 'queue').medianSolveMs, undefined);
});

test('the median ignores a single marathon session', () => {
  const problems = [
    makeProblem({ slug: 'a', tags: ['dp'], solveTimeMs: 10 * 60_000 }),
    makeProblem({ slug: 'b', tags: ['dp'], solveTimeMs: 12 * 60_000 }),
    makeProblem({ slug: 'c', tags: ['dp'], solveTimeMs: 300 * 60_000 }),
  ];
  const dp = computeTopicStats(problems, INTERVALS.length - 1).find((s) => s.tag === 'dp');
  assert.equal(dp.medianSolveMs, 12 * 60_000);
});

test('the README carries your own complexity, separate from the judge figures', () => {
  const readme = buildProblemReadme(
    makeProblem({
      note: 'Seen-map in one pass.',
      complexity: { time: 'O(n)', space: 'O(n)' },
      solveTimeMs: 12 * 60_000,
      runtimeNote: 'Runtime 52 ms',
    }),
  );

  assert.match(readme, /## Complexity/);
  assert.match(readme, /\*\*Time:\*\* O\(n\)/);
  assert.match(readme, /\*\*Space:\*\* O\(n\)/);
  assert.match(readme, /\*\*Time to solve:\*\* 12 min/);
  // The judge's measurement stays its own thing.
  assert.match(readme, /\*\*Judge:\*\* Runtime 52 ms/);
});

test('a problem with no complexity recorded omits the section entirely', () => {
  const readme = buildProblemReadme(makeProblem());
  assert.doesNotMatch(readme, /## Complexity/);
  assert.doesNotMatch(readme, /Time to solve/);
});

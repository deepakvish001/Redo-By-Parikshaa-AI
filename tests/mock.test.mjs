import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeResult,
  finishMock,
  formatClock,
  mockCandidates,
  mockState,
  pickMock,
  startMock,
} from '../src/core/mock.ts';

const DAY = 86_400_000;
const MINUTE = 60_000;
const now = Date.UTC(2026, 0, 15, 12, 0, 0);

const problem = (slug, lastReviewedAt, solvedAt = now - 60 * DAY) => ({
  id: `leetcode:${slug}`,
  platform: 'leetcode',
  problemId: '1',
  slug,
  title: slug,
  url: `https://leetcode.com/problems/${slug}/`,
  difficulty: 'medium',
  tags: [],
  language: 'Python3',
  code: 'x',
  attempts: 1,
  solvedAt,
  github: { status: 'disabled' },
  parikshaa: { status: 'disabled' },
  revision: { stage: 1, ease: 1, dueAt: now, reviewCount: 1, lapses: 0, hintsUsed: 0, lastReviewedAt },
});

/* -------------------------------------------------------------- the pool */

test('only problems you have not touched recently are asked about', () => {
  // A problem revised yesterday would measure nothing; the interesting
  // measurement is whether something stale still comes back under a clock.
  const candidates = mockCandidates(
    [problem('fresh', now - DAY), problem('stale', now - 40 * DAY)],
    now,
  );
  assert.deepEqual(candidates.map((entry) => entry.slug), ['stale']);
});

test('the least recently revised comes first', () => {
  const candidates = mockCandidates(
    [problem('a', now - 10 * DAY), problem('b', now - 90 * DAY), problem('c', now - 30 * DAY)],
    now,
  );
  assert.deepEqual(candidates.map((entry) => entry.slug), ['b', 'c', 'a']);
});

test('a problem never revised falls back to when it was solved', () => {
  const candidates = mockCandidates([problem('never', undefined, now - 100 * DAY)], now);
  assert.deepEqual(candidates.map((entry) => entry.slug), ['never']);
});

test('nothing old enough means nothing to ask', () => {
  assert.deepEqual(mockCandidates([problem('fresh', now - DAY)], now), []);
});

/* -------------------------------------------------------------- the pick */

test('the same seed picks the same problem', () => {
  // A round that changed under you every re-render would be unusable, and one
  // that could not be reproduced would be untestable.
  const pool = mockCandidates(
    ['a', 'b', 'c', 'd'].map((slug, i) => problem(slug, now - (90 - i * 10) * DAY)),
    now,
  );
  assert.equal(pickMock(pool, 'seed-1').slug, pickMock(pool, 'seed-1').slug);
});

test('rerolling with a different seed can land somewhere else', () => {
  const pool = mockCandidates(
    Array.from({ length: 10 }, (_, i) => problem(`p${i}`, now - (100 - i) * DAY)),
    now,
  );
  const picks = new Set(['s1', 's2', 's3', 's4', 's5'].map((seed) => pickMock(pool, seed).slug));
  assert.ok(picks.size > 1, 'every seed picked the same problem');
});

test('the pick comes from the stale end, not the whole list', () => {
  const pool = mockCandidates(
    Array.from({ length: 50 }, (_, i) => problem(`p${i}`, now - (100 - i) * DAY)),
    now,
  );
  // Window of ten: only the ten stalest are eligible however many there are.
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const index = pool.indexOf(pickMock(pool, seed, 10));
    assert.ok(index < 10, `picked #${index}, outside the window`);
  }
});

test('an empty pool picks nothing rather than throwing', () => {
  assert.equal(pickMock([], 'seed'), undefined);
});

/* ------------------------------------------------------------- the clock */

test('a round runs for the length it was given', () => {
  const session = startMock(problem('x', now - 40 * DAY), 35, now);
  assert.equal(session.endsAt - session.startedAt, 35 * MINUTE);
  assert.equal(session.minutes, 35);
  assert.equal(session.problem.slug, 'x');
});

test('hints stay sealed while the clock runs, and open when it stops', () => {
  const session = startMock(problem('x', now - 40 * DAY), 30, now);

  const midway = mockState(session, now + 10 * MINUTE);
  assert.equal(midway.running, true);
  assert.equal(midway.hintsLocked, true);
  assert.equal(midway.remainingMs, 20 * MINUTE);

  // Time running out unlocks everything: a round that stayed sealed afterwards
  // would be a round you cannot review, and reviewing it is the useful part.
  const after = mockState(session, now + 31 * MINUTE);
  assert.equal(after.running, false);
  assert.equal(after.hintsLocked, false);
  assert.equal(after.remainingMs, 0);
});

test('with no round in progress nothing is locked', () => {
  const state = mockState(undefined, now);
  assert.equal(state.running, false);
  assert.equal(state.hintsLocked, false);
});

test('a finished round is not still running', () => {
  const session = { ...startMock(problem('x', now - 40 * DAY), 30, now), finishedAt: now + MINUTE, outcome: 'solved' };
  assert.equal(mockState(session, now + 2 * MINUTE).running, false);
});

/* ------------------------------------------------------------ the result */

test('finishing early records how long it took', () => {
  const session = startMock(problem('x', now - 40 * DAY), 35, now);
  const result = finishMock(session, 'solved', now + 22 * MINUTE);

  assert.equal(result.session.outcome, 'solved');
  assert.equal(result.tookMs, 22 * MINUTE);
  assert.equal(result.inTime, true);
});

test('claiming a solve after the clock ran out is recorded as time-up', () => {
  // Otherwise every round is a solve eventually, and the number stops meaning
  // anything.
  const session = startMock(problem('x', now - 40 * DAY), 30, now);
  const result = finishMock(session, 'solved', now + 45 * MINUTE);

  assert.equal(result.session.outcome, 'time-up');
  assert.equal(result.inTime, false);
  assert.equal(result.tookMs, 30 * MINUTE, 'the time taken exceeded the round');
});

test('giving up is recorded as giving up', () => {
  const session = startMock(problem('x', now - 40 * DAY), 30, now);
  const result = finishMock(session, 'gave-up', now + 12 * MINUTE);
  assert.equal(result.session.outcome, 'gave-up');
  assert.equal(result.inTime, false);
});

/* ---------------------------------------------------------------- saying it */

test('the clock reads as a clock', () => {
  assert.equal(formatClock(8 * MINUTE + 42_000), '08:42');
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(-5000), '00:00');
  assert.equal(formatClock(60 * MINUTE), '60:00');
});

test('the result is stated plainly, without congratulating anyone', () => {
  const session = startMock(problem('x', now - 40 * DAY), 35, now);
  assert.equal(
    describeResult(finishMock(session, 'solved', now + 22 * MINUTE)),
    'Solved in 22 of 35 minutes.',
  );
  assert.equal(
    describeResult(finishMock(session, 'solved', now + 40 * MINUTE)),
    'Time ran out after 35 minutes.',
  );
  assert.equal(
    describeResult(finishMock(session, 'gave-up', now + 9 * MINUTE)),
    'Stopped after 9 minutes.',
  );
});

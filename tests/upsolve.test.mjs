import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildUpsolveList,
  mergeUpsolve,
  reconcile,
  summariseUpsolve,
} from '../src/core/upsolve.ts';
import { nextBand, projectGoal, bandFloor } from '../src/core/rating.ts';

const CONTEST = { id: 2248, name: 'Codeforces Round 999 (Div. 2)' };
const PROBLEMS = [
  { index: 'A', name: 'You Delete, I Delete' },
  { index: 'B', name: 'Zero Sum' },
  { index: 'C', name: 'Threshold Movement' },
  { index: 'D', name: 'Hard One' },
];

test('solved problems never enter the queue', () => {
  const items = buildUpsolveList(
    CONTEST,
    PROBLEMS,
    [
      { points: 500, rejectedAttemptCount: 0 },
      { points: 0, rejectedAttemptCount: 3 },
      { points: 0, rejectedAttemptCount: 0 },
      { points: 0, rejectedAttemptCount: 0 },
    ],
    100,
  );

  assert.deepEqual(
    items.map((item) => item.index),
    ['B', 'C', 'D'],
  );
});

test('fought-and-lost is distinguished from never-opened', () => {
  // The distinction is the point: one is a gap in technique, the other in time.
  const items = buildUpsolveList(
    CONTEST,
    PROBLEMS.slice(0, 2),
    [
      { points: 0, rejectedAttemptCount: 4 },
      { points: 0, rejectedAttemptCount: 0 },
    ],
    100,
  );

  assert.equal(items[0].state, 'failed');
  assert.equal(items[0].attempts, 4);
  assert.equal(items[1].state, 'untouched');
});

test('the key matches what the Codeforces adapter stores', () => {
  const [item] = buildUpsolveList(CONTEST, [{ index: 'a', name: 'x' }], [{ points: 0, rejectedAttemptCount: 0 }], 1);
  assert.equal(item.id, '2248A');
  assert.equal(item.url, 'https://codeforces.com/contest/2248/problem/a');
});

test('a missing result row is treated as untouched, not as solved', () => {
  const items = buildUpsolveList(CONTEST, PROBLEMS, [], 1);
  assert.equal(items.length, 4);
  assert.ok(items.every((item) => item.state === 'untouched'));
});

test('solving a problem later marks the queue entry done', () => {
  const items = buildUpsolveList(CONTEST, PROBLEMS.slice(0, 1), [{ points: 0, rejectedAttemptCount: 2 }], 1);
  const done = reconcile(items, new Set(['codeforces:2248A']), 5_000);

  assert.equal(done[0].state, 'done');
  assert.equal(done[0].solvedAt, 5_000);
});

test('reconciling leaves untouched entries alone', () => {
  const items = buildUpsolveList(CONTEST, PROBLEMS.slice(0, 1), [{ points: 0, rejectedAttemptCount: 0 }], 1);
  assert.deepEqual(reconcile(items, new Set(['codeforces:9999Z']), 5_000), items);
});

test('re-reading a contest cannot un-do an upsolve', () => {
  const fresh = buildUpsolveList(CONTEST, PROBLEMS.slice(0, 1), [{ points: 0, rejectedAttemptCount: 1 }], 900);
  const done = reconcile(fresh, new Set(['codeforces:2248A']), 1_000);

  const merged = mergeUpsolve(done, fresh);
  assert.equal(merged[0].state, 'done');
  assert.equal(merged[0].solvedAt, 1_000);
});

test('merging keeps when a problem first appeared', () => {
  const first = buildUpsolveList(CONTEST, PROBLEMS.slice(0, 1), [{ points: 0, rejectedAttemptCount: 1 }], 100);
  const later = buildUpsolveList(CONTEST, PROBLEMS.slice(0, 1), [{ points: 0, rejectedAttemptCount: 1 }], 900);
  assert.equal(mergeUpsolve(first, later)[0].addedAt, 100);
});

test('merging sorts newest contest first, then by problem letter', () => {
  const old = buildUpsolveList({ id: 100, name: 'Old' }, PROBLEMS.slice(0, 2), [], 1);
  const recent = buildUpsolveList({ id: 200, name: 'New' }, PROBLEMS.slice(0, 2), [], 1);

  assert.deepEqual(
    mergeUpsolve(old, recent).map((item) => item.id),
    ['200A', '200B', '100A', '100B'],
  );
});

test('the summary counts each state once', () => {
  const items = [
    { state: 'failed' },
    { state: 'failed' },
    { state: 'untouched' },
    { state: 'done' },
  ];
  assert.deepEqual(summariseUpsolve(items), { pending: 3, failed: 2, untouched: 1, done: 1 });
});

/* ------------------------------------------------------------ rating goals */

test('the next band up is the goal, not the one you are in', () => {
  assert.deepEqual(nextBand(1450), { from: 1600, title: 'Expert' });
  assert.deepEqual(nextBand(1600), { from: 1900, title: 'Candidate Master' });
  assert.equal(nextBand(3500), undefined);
});

test('a progress bar starts at the bottom of the band you are in', () => {
  // Scaled from zero, a bar at 1450 would barely move after a good round.
  assert.equal(bandFloor(1450), 1400);
  assert.equal(bandFloor(1200), 1200);
  assert.equal(bandFloor(0), 0);
});

test('a rising trend gives a contest count and an ETA', () => {
  const day = 86_400;
  const history = [
    { at: day * 0, delta: 40 },
    { at: day * 7, delta: 60 },
    { at: day * 14, delta: 50 },
  ];
  const goal = projectGoal(1450, history);

  assert.equal(goal.target, 1600);
  assert.equal(goal.gap, 150);
  assert.equal(goal.perContest, 50);
  assert.equal(goal.contests, 3);
  assert.equal(goal.daysPerContest, 7);
  assert.equal(goal.etaDays, 21);
});

test('a flat or falling trend gives no estimate rather than infinity', () => {
  const falling = projectGoal(1450, [{ at: 0, delta: -20 }, { at: 100, delta: -5 }]);
  assert.equal(falling.contests, undefined);
  assert.ok(falling.perContest < 0);

  assert.equal(projectGoal(1450, []).contests, undefined);
});

test('the projection uses the recent window, not a two-year-old self', () => {
  const ancient = Array.from({ length: 20 }, (_, index) => ({ at: index * 86_400, delta: 200 }));
  const recent = Array.from({ length: 8 }, (_, index) => ({ at: (20 + index) * 86_400, delta: 10 }));
  const goal = projectGoal(1450, [...ancient, ...recent]);

  assert.equal(goal.perContest, 10);
});

test('an explicit target overrides the next band', () => {
  const goal = projectGoal(1450, [{ at: 0, delta: 50 }], 8, 2100);
  assert.equal(goal.target, 2100);
  assert.equal(goal.title, 'Master');
  assert.equal(goal.gap, 650);
});

test('a target already passed reports no work left', () => {
  const goal = projectGoal(1700, [{ at: 0, delta: 50 }], 8, 1600);
  assert.ok(goal.gap < 0);
  assert.equal(goal.contests, undefined);
});

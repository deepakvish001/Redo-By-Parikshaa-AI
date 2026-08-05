import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS,
  applyRecall,
  dueProblems,
  formatDueIn,
  initialRevision,
  isDue,
  upcomingProblems,
} from '../src/core/srs.ts';

const INTERVALS = [1, 3, 7, 21, 45, 90];
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

const daysOut = (state) => Math.round((state.dueAt - NOW) / DAY_MS);

function problem(id, dueAt) {
  return {
    id,
    revision: { stage: 0, ease: 1, dueAt, reviewCount: 0, lapses: 0 },
  };
}

test('a newly solved problem is scheduled for the first interval', () => {
  const state = initialRevision(INTERVALS, NOW);
  assert.equal(state.stage, 0);
  assert.equal(state.ease, 1);
  assert.equal(state.reviewCount, 0);
  assert.equal(daysOut(state), 1);
});

test('good recall walks up the ladder one stage at a time', () => {
  let state = initialRevision(INTERVALS, NOW);
  state = applyRecall(state, 'good', INTERVALS, NOW);
  assert.equal(state.stage, 1);
  assert.equal(daysOut(state), 3);

  state = applyRecall(state, 'good', INTERVALS, NOW);
  assert.equal(state.stage, 2);
  assert.equal(daysOut(state), 7);
});

test('easy recall skips a stage and stretches the interval', () => {
  const state = applyRecall(initialRevision(INTERVALS, NOW), 'easy', INTERVALS, NOW);
  assert.equal(state.stage, 2);
  assert.equal(state.ease, 1.1);
  // 7 days at stage 2, stretched by the raised ease.
  assert.equal(daysOut(state), 8);
});

test('forgetting resets to the first stage and tightens the interval', () => {
  let state = initialRevision(INTERVALS, NOW);
  state = applyRecall(state, 'good', INTERVALS, NOW);
  state = applyRecall(state, 'good', INTERVALS, NOW);
  assert.equal(state.stage, 2);

  state = applyRecall(state, 'forgot', INTERVALS, NOW);
  assert.equal(state.stage, 0);
  assert.equal(state.lapses, 1);
  assert.equal(state.ease, 0.85);
  // Never schedules sooner than a day, even with a reduced ease.
  assert.equal(daysOut(state), 1);
});

test('hard recall steps back one stage without counting as a lapse', () => {
  let state = initialRevision(INTERVALS, NOW);
  state = applyRecall(state, 'good', INTERVALS, NOW);
  state = applyRecall(state, 'good', INTERVALS, NOW);
  state = applyRecall(state, 'hard', INTERVALS, NOW);

  assert.equal(state.stage, 1);
  assert.equal(state.lapses, 0);
  assert.equal(state.reviewCount, 3);
});

test('ease stays inside its bounds however the user rates', () => {
  let state = initialRevision(INTERVALS, NOW);
  for (let i = 0; i < 20; i++) state = applyRecall(state, 'easy', INTERVALS, NOW);
  assert.equal(state.ease, 1.8);

  for (let i = 0; i < 40; i++) state = applyRecall(state, 'forgot', INTERVALS, NOW);
  assert.equal(state.ease, 0.6);
});

test('the stage never runs past the end of the ladder', () => {
  let state = initialRevision(INTERVALS, NOW);
  for (let i = 0; i < 20; i++) state = applyRecall(state, 'good', INTERVALS, NOW);
  assert.equal(state.stage, INTERVALS.length - 1);
});

test('a single-entry ladder keeps rescheduling at that interval', () => {
  let state = initialRevision([2], NOW);
  assert.equal(daysOut(state), 2);
  state = applyRecall(state, 'good', [2], NOW);
  assert.equal(state.stage, 0);
  assert.equal(daysOut(state), 2);
});

test('due and upcoming split on the current time', () => {
  const problems = [
    problem('overdue', NOW - 2 * DAY_MS),
    problem('due-now', NOW),
    problem('soon', NOW + DAY_MS),
    problem('later', NOW + 10 * DAY_MS),
  ];

  assert.deepEqual(
    dueProblems(problems, NOW).map((p) => p.id),
    ['overdue', 'due-now'],
  );
  assert.deepEqual(
    upcomingProblems(problems, NOW, 5).map((p) => p.id),
    ['soon', 'later'],
  );
  assert.equal(upcomingProblems(problems, NOW, 1).length, 1);
  assert.equal(isDue(problems[0].revision, NOW), true);
  assert.equal(isDue(problems[3].revision, NOW), false);
});

test('due text reads naturally on both sides of the deadline', () => {
  assert.equal(formatDueIn(NOW + 3 * DAY_MS, NOW), 'in 3d');
  assert.equal(formatDueIn(NOW + 5 * 3_600_000, NOW), 'in 5h');
  assert.equal(formatDueIn(NOW - 2 * DAY_MS, NOW), 'overdue 2d');
  assert.equal(formatDueIn(NOW, NOW), 'due now');
});

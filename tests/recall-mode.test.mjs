import assert from 'node:assert/strict';
import test from 'node:test';

import { RECALL_CEILING, applyReview, describeMode, needsFullResolve } from '../src/core/recall-mode.ts';
import { applyRecall } from '../src/core/srs.ts';

const INTERVALS = [1, 3, 7, 21, 45, 90];
const NOW = Date.UTC(2026, 8, 2);
const DAY = 86_400_000;

const at = (stage) => ({
  stage,
  ease: 2.5,
  dueAt: NOW,
  reviewCount: stage,
  lapses: 0,
  hintsUsed: 0,
});

/* -------------------------------------------------------- what each is worth */

test('a full re-solve moves the ladder exactly as it always did', () => {
  // The existing behaviour is the baseline and must not have changed: a recall
  // check is a new, cheaper option beside it, not a redefinition of reviewing.
  for (const stage of [0, 1, 2, 3, 4]) {
    const direct = applyRecall(at(stage), 'good', INTERVALS, NOW);
    const through = applyReview(at(stage), 'good', 'resolve', INTERVALS, NOW);
    assert.deepEqual(through.revision, direct, `stage ${stage}`);
    assert.equal(through.held, false);
  }
});

test('a recall advances freely below the ceiling', () => {
  const outcome = applyReview(at(0), 'good', 'recall', INTERVALS, NOW);
  assert.equal(outcome.revision.stage, 1);
  assert.equal(outcome.held, false);
});

test('a recall cannot carry a problem past the ceiling on its own', () => {
  // Holding "sort it, then two pointers" is not evidence you can produce the
  // loop. If both tiers moved the ladder identically the schedule would drift
  // optimistic — and an optimistic schedule stops showing you what you are
  // about to lose, which is the one thing it exists to do.
  const outcome = applyReview(at(RECALL_CEILING), 'good', 'recall', INTERVALS, NOW);

  assert.equal(outcome.revision.stage, RECALL_CEILING, 'held where it was');
  assert.equal(outcome.held, true);
  assert.equal(
    applyReview(at(RECALL_CEILING), 'good', 'resolve', INTERVALS, NOW).revision.stage,
    RECALL_CEILING + 1,
    'a re-solve does move it',
  );
});

test('a held recall still reschedules — the check was worth doing', () => {
  // Checking and finding you still know it is real information, so the problem
  // must not come back tomorrow as though nothing happened.
  const outcome = applyReview(at(RECALL_CEILING), 'good', 'recall', INTERVALS, NOW);
  assert.ok(outcome.revision.dueAt > NOW + 7 * DAY, 'weeks out, not days');
  assert.equal(outcome.revision.reviewCount, at(RECALL_CEILING).reviewCount + 1);
});

test('a held recall is scheduled at the stage it was held at, not the one it wanted', () => {
  // Clamping the stage after the fact is not enough. `applyRecall` computes the
  // due date *from* the stage it just worked out, so a review held at stage 3
  // was still being scheduled at stage 4's spacing — 45 days instead of 21.
  // The stage said one thing and the schedule did another, which is the cap
  // not working at all.
  const held = applyReview(at(RECALL_CEILING), 'good', 'recall', INTERVALS, NOW);
  const wanted = applyReview(at(RECALL_CEILING), 'good', 'resolve', INTERVALS, NOW);

  assert.ok(
    held.revision.dueAt < wanted.revision.dueAt,
    `held ${Math.round((held.revision.dueAt - NOW) / DAY)}d must be sooner than ` +
      `${Math.round((wanted.revision.dueAt - NOW) / DAY)}d`,
  );

  // Exactly what an unheld review that landed on this stage would have given.
  const equivalent = applyReview(at(RECALL_CEILING - 1), 'good', 'recall', INTERVALS, NOW);
  assert.equal(held.revision.stage, equivalent.revision.stage);
  assert.equal(held.revision.dueAt, equivalent.revision.dueAt);
});

test('a bigger rating still only reaches the cap, at the cap’s spacing', () => {
  // "Easy" moves two rungs. Held, it must land on the ceiling like any other —
  // not overshoot it, and not be scheduled as though it had.
  const easy = applyReview(at(RECALL_CEILING), 'easy', 'recall', INTERVALS, NOW);
  assert.equal(easy.revision.stage, RECALL_CEILING);
  assert.equal(easy.held, true);
  assert.ok(easy.revision.dueAt < applyReview(at(RECALL_CEILING), 'easy', 'resolve', INTERVALS, NOW).revision.dueAt);
});

test('a problem already above the ceiling is not dragged back down', () => {
  // Somebody who re-solved their way to stage 5 and then does a recall check
  // should not be punished for checking.
  const outcome = applyReview(at(5), 'good', 'recall', INTERVALS, NOW);
  assert.ok(outcome.revision.stage >= 5, `expected to hold at 5+, got ${outcome.revision.stage}`);
});

/* ------------------------------------------------------------ forgetting it */

test('forgetting is never capped, however you found out', () => {
  // Discovering you have lost something is exactly as good evidence whether it
  // came from a re-solve or a thirty-second check, and the schedule should act
  // on it immediately either way.
  const recall = applyReview(at(5), 'forgot', 'recall', INTERVALS, NOW);
  const resolve = applyReview(at(5), 'forgot', 'resolve', INTERVALS, NOW);

  assert.equal(recall.revision.stage, 0);
  assert.equal(recall.held, false, 'nothing was withheld — it went to the bottom');
  assert.deepEqual(recall.revision, resolve.revision);
});

test('a lapse is counted the same either way', () => {
  assert.equal(applyReview(at(2), 'forgot', 'recall', INTERVALS, NOW).revision.lapses, 1);
});

test('stepping back on Hard is not capped either', () => {
  const outcome = applyReview(at(4), 'hard', 'recall', INTERVALS, NOW);
  assert.ok(outcome.revision.stage <= 4);
  assert.equal(outcome.held, false);
});

/* ------------------------------------------------------------- what it says */

test('the card says what the check is worth', () => {
  assert.match(describeMode('resolve', false), /counts in full/);
  assert.match(describeMode('recall', false), /worth less/);
  assert.match(describeMode('recall', true), /re-solve it/);
});

test('a problem at the ceiling is flagged before you start', () => {
  assert.equal(needsFullResolve(at(RECALL_CEILING - 1)), false);
  assert.equal(needsFullResolve(at(RECALL_CEILING)), true);
});

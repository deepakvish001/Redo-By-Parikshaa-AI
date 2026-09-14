import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRounds,
  describeRun,
  roundProblems,
  summarise,
} from '../src/core/history.ts';

const change = (id, rank, oldRating, newRating, day) => ({
  contestId: id,
  contestName: `Round ${id}`,
  rank,
  oldRating,
  newRating,
  ratingUpdateTimeSeconds: day * 86_400,
});

/* ---------------------------------------------------------------- rounds */

test('rounds come back newest first, with the delta worked out', () => {
  const rounds = buildRounds([change(1, 500, 1200, 1250, 1), change(2, 900, 1250, 1210, 5)]);
  assert.deepEqual(rounds.map((round) => round.contestId), [2, 1]);
  assert.equal(rounds[0].delta, -40);
  assert.equal(rounds[1].delta, 50);
});

test('the time is milliseconds, like everything else the panel draws', () => {
  // Codeforces answers in seconds, and a panel that mixes the two shows dates
  // in 1970.
  assert.equal(buildRounds([change(1, 1, 1000, 1000, 2)])[0].at, 2 * 86_400_000);
});

test('no rounds is not an error', () => {
  assert.deepEqual(buildRounds([]), []);
});

/* -------------------------------------------------------------- problems */

test('points decide whether it was solved, not the attempt count', () => {
  // A problem you submitted to four times and passed is solved; one you
  // submitted to four times and did not is the interesting case.
  const problems = roundProblems(
    [
      { index: 'a', name: 'Easy', rating: 800 },
      { index: 'B', name: 'Hard', rating: 1600 },
      { index: 'C', name: 'Unopened' },
    ],
    [
      { points: 500, rejectedAttemptCount: 4 },
      { points: 0, rejectedAttemptCount: 3 },
      { points: 0, rejectedAttemptCount: 0 },
    ],
  );

  assert.deepEqual(problems[0], { index: 'A', name: 'Easy', rating: 800, solved: true, attempts: 4 });
  assert.equal(problems[1].solved, false);
  assert.equal(problems[1].attempts, 3);
  assert.equal(problems[2].attempts, 0, 'never opened');
});

test('ICPC-rules rounds award one point, which still counts as solved', () => {
  const [problem] = roundProblems([{ index: 'A', name: 'x' }], [{ points: 1, rejectedAttemptCount: 0 }]);
  assert.equal(problem.solved, true);
});

test('a missing result row does not throw', () => {
  const [problem] = roundProblems([{ index: 'A', name: 'x' }], []);
  assert.equal(problem.solved, false);
  assert.equal(problem.attempts, 0);
});

/* --------------------------------------------------------------- summary */

test('the summary adds up the run', () => {
  const rounds = buildRounds([
    change(1, 500, 1200, 1250, 1),
    change(2, 900, 1250, 1210, 2),
    change(3, 120, 1210, 1300, 3),
  ]);

  const summary = summarise(rounds);
  assert.equal(summary.rounds, 3);
  assert.equal(summary.net, 100);
  assert.equal(summary.positive, 2);
  assert.equal(summary.best.contestId, 3);
  assert.equal(summary.worst.contestId, 2);
  assert.equal(summary.bestRank, 120, 'the best rank is the smallest number');
});

test('an empty history summarises to zero rather than to NaN', () => {
  const summary = summarise([]);
  assert.equal(summary.net, 0);
  assert.equal(summary.bestRank, undefined);
  assert.equal(summary.best, undefined);
});

/* ------------------------------------------------------------- the reading */

test('two rounds are not a trend', () => {
  // Codeforces deltas swing fifty points on luck. "You are trending down"
  // after two contests is confident nonsense.
  assert.equal(describeRun(buildRounds([change(1, 1, 1200, 1150, 1)])), undefined);
  assert.equal(
    describeRun(buildRounds([change(1, 1, 1200, 1150, 1), change(2, 1, 1150, 1100, 2)])),
    undefined,
  );
});

test('three rounds get a reading, in the right direction', () => {
  const up = describeRun(
    buildRounds([change(1, 1, 1200, 1250, 1), change(2, 1, 1250, 1300, 2), change(3, 1, 1300, 1330, 3)]),
  );
  assert.match(up, /Up 130 over your last 3 rounds/);

  const down = describeRun(
    buildRounds([change(1, 1, 1300, 1250, 1), change(2, 1, 1250, 1200, 2), change(3, 1, 1200, 1180, 3)]),
  );
  assert.match(down, /Down 120/);
});

test('a flat run says so rather than picking a direction', () => {
  const flat = describeRun(
    buildRounds([change(1, 1, 1200, 1250, 1), change(2, 1, 1250, 1200, 2), change(3, 1, 1200, 1200, 3)]),
  );
  assert.match(flat, /Level/);
});

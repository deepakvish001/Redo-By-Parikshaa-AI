import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STARTING_RATING,
  buildContests,
  describeForm,
  estimateDelta,
  fitDelta,
  pendingContest,
  summarise,
} from '../src/core/lc-contests.ts';

const row = (title, startTime, ranking, rating, extra = {}) => ({
  attended: true,
  ranking,
  rating,
  contest: { title, titleSlug: title.toLowerCase().replaceAll(' ', '-'), startTime },
  ...extra,
});

/* ------------------------------------------------------------- the history */

test('a contest’s delta is the move from the one before it', () => {
  const contests = buildContests([
    row('Weekly 1', 1000, 5000, 1520),
    row('Weekly 2', 2000, 3000, 1580),
    row('Weekly 3', 3000, 8000, 1550),
  ]);

  assert.deepEqual(contests.map((contest) => contest.delta), [20, 60, -30]);
  assert.equal(contests[0].ratingBefore, STARTING_RATING, 'the first is measured from 1500');
});

test('history is read oldest first however LeetCode ordered it', () => {
  // The deltas are differences, so an out-of-order list would compute the
  // arithmetic against the wrong neighbour and get every sign wrong.
  const contests = buildContests([
    row('Weekly 3', 3000, 8000, 1550),
    row('Weekly 1', 1000, 5000, 1520),
    row('Weekly 2', 2000, 3000, 1580),
  ]);

  assert.deepEqual(contests.map((contest) => contest.title), ['Weekly 1', 'Weekly 2', 'Weekly 3']);
  assert.deepEqual(contests.map((contest) => contest.delta), [20, 60, -30]);
});

test('contests you registered for but did not enter are left out', () => {
  const contests = buildContests([
    row('Weekly 1', 1000, 5000, 1520),
    { ...row('Weekly 2', 2000, 0, 1520), attended: false },
  ]);

  assert.equal(contests.length, 1);
});

test('the per-contest detail is carried when LeetCode sends it', () => {
  const [contest] = buildContests([
    row('Weekly 1', 1000, 5000, 1520, { problemsSolved: 3, totalProblems: 4, finishTimeInSeconds: 3900 }),
  ]);

  assert.equal(contest.solved, 3);
  assert.equal(contest.total, 4);
  assert.equal(contest.finishSeconds, 3900);
  assert.equal(contest.slug, 'weekly-1');
});

/* --------------------------------------------------- ranked, but not rated */

test('a contest whose rating has not moved yet is pending, not a zero', () => {
  // LeetCode publishes the rank the moment a contest ends and applies the
  // rating a day or so later; until then the entry repeats the old number.
  // Calling that a genuine 0 delta would put a fake flat result in the history.
  const contests = buildContests([
    row('Weekly 1', 1000, 5000, 1520),
    row('Weekly 2', 2000, 2500, 1520),
  ]);

  assert.equal(contests[1].pending, true);
  assert.equal(contests[1].delta, 0);
  assert.equal(pendingContest(contests).title, 'Weekly 2');
});

test('a settled history has nothing pending', () => {
  const contests = buildContests([row('Weekly 1', 1000, 5000, 1520), row('Weekly 2', 2000, 2500, 1560)]);
  assert.equal(pendingContest(contests), undefined);
});

test('a pending contest is left out of the summary’s arithmetic', () => {
  const contests = buildContests([
    row('Weekly 1', 1000, 5000, 1520),
    row('Weekly 2', 2000, 3000, 1580),
    row('Weekly 3', 3000, 900, 1580),
  ]);

  const summary = summarise(contests);
  assert.equal(summary.contests, 2, 'the unrated one is not counted as a contest yet');
  assert.equal(summary.net, 80);
  assert.equal(summary.bestRank, 3000, 'and its rank is not the best rank yet either');
});

/* ------------------------------------------------------------ the estimate */

// A plausible run: better ranks pay more, and the relationship is in log(rank).
const RUN = [
  row('W1', 1000, 12000, 1520),
  row('W2', 2000, 9000, 1548),
  row('W3', 3000, 6000, 1590),
  row('W4', 4000, 11000, 1600),
  row('W5', 5000, 4000, 1655),
  row('W6', 6000, 7000, 1690),
];

test('a better rank estimates a bigger gain than a worse one', () => {
  const contests = buildContests(RUN);
  const fit = fitDelta(contests, 1690);

  const good = estimateDelta(fit, 2000);
  const bad = estimateDelta(fit, 20000);
  assert.ok(good.delta > bad.delta, `${good.delta} should beat ${bad.delta}`);
});

test('the estimate carries the spread it was fitted against', () => {
  // "+18 ± 30" is an honest way of saying "this is barely a signal", and a
  // number shown without it would read as a prediction.
  const estimate = estimateDelta(fitDelta(buildContests(RUN), 1690), 5000);
  assert.ok(estimate.spread >= 1);
  assert.ok(estimate.n >= 4, 'and how many of your contests it rests on');
});

test('too little history is no estimate rather than a confident one', () => {
  // Three results is a mood, not a trend. Two parameters fitted to three points
  // is a shape drawn through noise.
  const thin = buildContests([row('W1', 1000, 5000, 1520), row('W2', 2000, 4000, 1560)]);
  assert.equal(fitDelta(thin, 1560), undefined);
  assert.equal(estimateDelta(undefined, 3000), undefined);
});

test('every contest at the same rank yields no fit', () => {
  const flat = buildContests([
    row('W1', 1000, 5000, 1520),
    row('W2', 2000, 5000, 1540),
    row('W3', 3000, 5000, 1560),
    row('W4', 4000, 5000, 1580),
  ]);

  assert.equal(fitDelta(flat, 1580), undefined, 'there is no line through one x');
});

test('contests near your current rating are preferred', () => {
  // The same rank is worth a very different delta at 1500 and at 2100, which is
  // the whole point of Elo — so a run from long ago is a poor guide to now.
  const fit = fitDelta(buildContests(RUN), 1690);
  assert.equal(fit.nearby, true);
  assert.equal(fit.n, 4, 'only the four contests inside the window are used');
});

test('the window is dropped rather than refusing when it leaves too few', () => {
  // Somebody who has climbed 400 points has no four contests near where they
  // are now. A weaker fit clearly labelled beats no answer at all.
  const climb = buildContests([
    row('W1', 1000, 20000, 1450),
    row('W2', 2000, 15000, 1520),
    row('W3', 3000, 9000, 1640),
    row('W4', 4000, 6000, 1780),
    row('W5', 5000, 4000, 1900),
  ]);

  const fit = fitDelta(climb, 1900);
  assert.equal(fit.nearby, false, 'and it says so, so the caller can hedge');
  assert.equal(fit.n, 5);
});

/* ----------------------------------------------------------------- the run */

test('form is described only once there is enough to describe', () => {
  assert.equal(describeForm(buildContests(RUN.slice(0, 3))), undefined);
  assert.match(describeForm(buildContests(RUN)), /last 5/);
});

test('a losing run is not dressed up as a good one', () => {
  // Six contests, so the window of five excludes the opening jump from 1500 —
  // which is real, but is not part of "how has it been going lately".
  const falling = buildContests([
    row('W1', 1000, 2000, 1700),
    row('W2', 2000, 9000, 1660),
    row('W3', 3000, 12000, 1610),
    row('W4', 4000, 15000, 1560),
    row('W5', 5000, 16000, 1520),
    row('W6', 6000, 14000, 1490),
  ]);

  assert.equal(describeForm(falling), '-210 over your last 5, none of them went up.');
});

test('the very first contest is measured from 1500, and that is real', () => {
  // Somebody whose first contest put them at 1700 genuinely gained 200 points.
  const [first] = buildContests([row('W1', 1000, 2000, 1700)]);
  assert.equal(first.delta, 200);
});

test('the spread accounts for the parameters the fit already spent', () => {
  // Two parameters fitted from the same points means two fewer left to test
  // them with, so the residuals are divided by n - 2. Dividing by n would make
  // every estimate look more certain than the data supports.
  const contests = buildContests(RUN);
  const fit = fitDelta(contests, 1690);
  const residuals = contests
    .filter((contest) => Math.abs(contest.ratingBefore - 1690) <= 150)
    .map((contest) => contest.delta - (fit.intercept + fit.slope * Math.log(contest.rank)));

  const naive = Math.sqrt(residuals.reduce((t, r) => t + r * r, 0) / residuals.length);
  assert.ok(fit.spread > naive, `${fit.spread} should exceed the n-divided ${naive}`);
});

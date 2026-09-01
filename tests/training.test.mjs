import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_DURATION_MS,
  buildContest,
  drawAt,
  isRunning,
  remainingMs,
  reroll,
  score,
  slotStates,
  suggestedLadder,
  unfilled,
} from '../src/core/training.ts';
import { readiness, recommend } from '../src/core/recommend.ts';
import { tagCounts } from '../src/core/insights.ts';

const POOL = [];
for (const rating of [800, 1000, 1200, 1400, 1600, 1800]) {
  for (let i = 0; i < 6; i += 1) {
    POOL.push({
      key: `${rating * 10 + i}A`,
      name: `P${rating}-${i}`,
      rating,
      tags: i % 2 === 0 ? ['dp'] : ['greedy'],
    });
  }
}

const NOW = Date.parse('2026-03-01T10:00:00Z');

/* --------------------------------------------------------------- drawing */

test('a draw lands at the rating asked for', () => {
  assert.equal(drawAt(POOL, 1400, new Set(), 'seed').rating, 1400);
});

test('a draw never repeats what is already taken', () => {
  const band = POOL.filter((p) => p.rating === 1400);
  const taken = new Set(band.slice(1).map((p) => p.key));
  assert.equal(drawAt(POOL, 1400, taken, 'seed').key, band[0].key);
});

test('an exhausted band draws nothing', () => {
  const taken = new Set(POOL.filter((p) => p.rating === 1400).map((p) => p.key));
  assert.equal(drawAt(POOL, 1400, taken, 'seed'), undefined);
});

/* ------------------------------------------------------------- the round */

test('a round has one problem per rating asked for', () => {
  const contest = buildContest(POOL, [800, 1200, 1400, 1600, 1800], new Set(), 120, NOW);
  assert.deepEqual(
    contest.problems.map((problem) => problem.rating),
    [800, 1200, 1400, 1600, 1800],
  );
});

test('a round never picks the same problem twice', () => {
  const contest = buildContest(POOL, [1400, 1400, 1400], new Set(), 90, NOW);
  assert.equal(new Set(contest.problems.map((p) => p.key)).size, 3);
});

test('a round never picks something already solved', () => {
  const solved = new Set(POOL.filter((p) => p.rating === 1400).slice(0, 5).map((p) => p.key));
  const contest = buildContest(POOL, [1400], solved, 60, NOW);
  assert.ok(!solved.has(contest.problems[0].key));
});

test('a slot with nothing left is dropped, not quietly refilled', () => {
  // You asked for a 1600 because you wanted a 1600; handing you a 1400 would
  // make the round train something else.
  const solved = new Set(POOL.filter((p) => p.rating === 1600).map((p) => p.key));
  const contest = buildContest(POOL, [1400, 1600, 1800], solved, 90, NOW);

  assert.deepEqual(
    contest.problems.map((p) => p.rating),
    [1400, 1800],
  );
});

test('the duration is capped at something that is still a round', () => {
  assert.equal(buildContest(POOL, [800], new Set(), 100_000, NOW).durationMs, MAX_DURATION_MS);
  assert.equal(buildContest(POOL, [800], new Set(), 0, NOW).durationMs, 60_000);
});

/* -------------------------------------------------------------- rerolling */

test('a reroll swaps one slot and leaves the others alone', () => {
  const contest = buildContest(POOL, [1200, 1400, 1600], new Set(), 90, NOW);
  const next = reroll(contest, 1, POOL, new Set());

  assert.notEqual(next.problems[1].key, contest.problems[1].key);
  assert.equal(next.problems[0].key, contest.problems[0].key);
  assert.equal(next.problems[2].key, contest.problems[2].key);
});

test('a reroll stays at the slot’s rating', () => {
  const contest = buildContest(POOL, [1400], new Set(), 60, NOW);
  assert.equal(reroll(contest, 0, POOL, new Set()).problems[0].rating, 1400);
});

test('rerolling twice gives two different problems, not a flip-flop', () => {
  const first = buildContest(POOL, [1400], new Set(), 60, NOW);
  const second = reroll(first, 0, POOL, new Set());
  const third = reroll(second, 0, POOL, new Set());

  assert.notEqual(second.problems[0].key, first.problems[0].key);
  assert.notEqual(third.problems[0].key, second.problems[0].key);
});

test('a reroll with nothing left keeps what is there', () => {
  const contest = buildContest(POOL, [1400], new Set(), 60, NOW);
  const solved = new Set(POOL.filter((p) => p.rating === 1400).map((p) => p.key));
  assert.equal(reroll(contest, 0, POOL, solved).problems[0].key, contest.problems[0].key);
});

/* --------------------------------------------------------------- running */

test('the clock counts down and then stops', () => {
  const contest = buildContest(POOL, [800], new Set(), 60, NOW);
  assert.equal(remainingMs(contest, NOW), 3_600_000);
  assert.equal(remainingMs(contest, NOW + 1_800_000), 1_800_000);
  assert.equal(remainingMs(contest, NOW + 7_200_000), 0, 'never negative');
});

test('a round is over when the clock runs out or it is filed', () => {
  const contest = buildContest(POOL, [800], new Set(), 60, NOW);
  assert.equal(isRunning(contest, NOW + 60_000), true);
  assert.equal(isRunning(contest, NOW + 3_600_001), false);
  assert.equal(isRunning({ ...contest, finishedAt: NOW + 100 }, NOW + 200), false);
});

/* --------------------------------------------------------------- scoring */

test('each slot reports solved, attempted or todo', () => {
  const contest = buildContest(POOL, [1200, 1400, 1600], new Set(), 90, NOW);
  const [a, b] = contest.problems;
  const states = slotStates(contest, new Set([a.key]), new Set([b.key]));
  assert.deepEqual(states, ['solved', 'attempted', 'todo']);
});

test('the score counts what happened, and how long it took', () => {
  const contest = buildContest(POOL, [1200, 1400], new Set(), 60, NOW);
  const states = ['solved', 'todo'];
  assert.deepEqual(score(contest, states, NOW + 1_500_000), {
    solved: 1,
    attempted: 0,
    total: 2,
    elapsedMinutes: 25,
  });
});

test('elapsed time stops at the end of the round, not at now', () => {
  const contest = buildContest(POOL, [800], new Set(), 60, NOW);
  // Two hours later, on a one-hour round.
  assert.equal(score(contest, ['todo'], NOW + 7_200_000).elapsedMinutes, 60);
});

test('the suggested ladder is shaped like a real round', () => {
  assert.deepEqual(suggestedLadder(1400), [1200, 1300, 1400, 1500, 1600]);
  // Clamped rather than asking for a rating that cannot exist.
  assert.deepEqual(suggestedLadder(800), [800, 800, 800, 900, 1000]);
});

/* ----------------------------------------------------------- recommending */

test('suggestions come from your band and exclude what you have solved', () => {
  const solved = new Set([POOL.find((p) => p.rating === 1400).key]);
  const picks = recommend(POOL, solved, [], { rating: 1400, limit: 5 });

  assert.ok(picks.length > 0);
  assert.ok(picks.every((pick) => pick.rating === 1400));
  assert.ok(picks.every((pick) => !solved.has(pick.key)));
});

test('a tag you abandon is weighted above one you do not', () => {
  // The thing no leaderboard-based recommender can do.
  const many = {};
  for (let i = 0; i < 6; i += 1) many[`d${i}`] = { name: 'x', rating: 1400, tags: ['dp'] };
  for (let i = 0; i < 6; i += 1) many[`g${i}`] = { name: 'x', rating: 1400, tags: ['greedy'] };

  const tags = tagCounts(
    ['d0', 'g0', 'g1', 'g2', 'g3'],
    ['d1', 'd2', 'd3', 'd4', 'g4'],
    many,
  );
  const pool = Object.entries(many).map(([key, meta]) => ({ key, ...meta }));
  const picks = recommend(pool, new Set(['d0', 'g0', 'g1', 'g2', 'g3']), tags, {
    rating: 1400,
    limit: 2,
  });

  assert.equal(picks[0].tags[0], 'dp', 'the abandoned tag comes first');
  assert.match(picks[0].because, /dp/);
  assert.match(picks[0].because, /unfinished/);
});

test('a list of suggestions is not ten problems about one topic', () => {
  const picks = recommend(POOL, new Set(), [], { rating: 1400, limit: 5 });
  const signatures = picks.map((pick) => pick.tags.join('|'));
  assert.equal(new Set(signatures).size, signatures.length);
});

test('an excluded tag does not appear', () => {
  const picks = recommend(POOL, new Set(), [], {
    rating: 1400,
    limit: 5,
    exclude: new Set(['dp']),
  });
  assert.ok(picks.every((pick) => !pick.tags.includes('dp')));
});

/* -------------------------------------------------------------- readiness */

test('readiness is your finish rate, not your solved count', () => {
  // Forty solved at 1400 means nothing if you abandoned sixty.
  const ratings = {};
  for (let i = 0; i < 10; i += 1) ratings[`a${i}`] = 1500;

  const report = readiness(
    1600,
    new Set(['a0', 'a1', 'a2']),
    new Set(['a3', 'a4', 'a5', 'a6', 'a7']),
    (key) => ratings[key],
  );

  assert.deepEqual(report.gaps, [1500]);
  assert.match(report.verdict, /gap to close/);
});

test('finishing most of what you start reads as ready', () => {
  const ratings = {};
  for (let i = 0; i < 10; i += 1) ratings[`a${i}`] = 1500;

  const report = readiness(
    1600,
    new Set(['a0', 'a1', 'a2', 'a3', 'a4']),
    new Set(['a5']),
    (key) => ratings[key],
  );

  assert.deepEqual(report.gaps, []);
  assert.match(report.verdict, /worth attempting/);
});

test('too little history says so rather than guessing', () => {
  const report = readiness(1600, new Set(['a']), new Set(), () => 1500);
  assert.match(report.verdict, /Not enough/);
});

test('bands above the target are not part of readiness for it', () => {
  const report = readiness(1400, new Set(['high']), new Set(), () => 2000);
  assert.deepEqual(report.bands, []);
});

test('a problem you failed long ago does not start the round marked "Tried"', () => {
  // Otherwise the live status says nothing about the round you are in.
  const old = POOL.find((p) => p.rating === 1400);
  const contest = buildContest(POOL, [1400], new Set(), 60, NOW, '', new Set([old.key]));

  // Force the round onto that problem so the case is actually exercised.
  const pinned = { ...contest, problems: [{ ...old, url: '', slot: 1400 }], attemptedBefore: [old.key] };
  assert.deepEqual(slotStates(pinned, new Set(), new Set([old.key])), ['todo']);
});

test('an attempt made during the round does count', () => {
  const contest = buildContest(POOL, [1400], new Set(), 60, NOW);
  const key = contest.problems[0].key;
  assert.deepEqual(slotStates(contest, new Set(), new Set([key])), ['attempted']);
});

test('a round says which ratings it could not fill', () => {
  const solved = new Set(POOL.filter((p) => p.rating === 1600).map((p) => p.key));
  const contest = buildContest(POOL, [1400, 1600, 1800], solved, 90, NOW);
  assert.deepEqual(unfilled(contest), [1600]);
});

test('a fully filled round reports nothing missing', () => {
  assert.deepEqual(unfilled(buildContest(POOL, [1200, 1400], new Set(), 60, NOW)), []);
});

test('a problem you already abandoned says so, and is still offered', () => {
  // Going back to one you lost to is a perfectly good choice — and for a
  // "finish what you start" step it is the best one. Silently mixing it in
  // with fresh problems is what would be wrong.
  const pool = [
    { key: '1A', name: 'Old', rating: 1200, tags: ['dp'] },
    { key: '2B', name: 'New', rating: 1200, tags: ['greedy'] },
  ];
  const out = recommend(pool, new Set(), [], { rating: 1200, attempted: new Set(['1A']) });

  assert.match(out.find((entry) => entry.key === '1A').because, /left this one unfinished/);
  assert.doesNotMatch(out.find((entry) => entry.key === '2B').because, /unfinished/);
});

test('asking for a tag returns several problems, not one per tag signature', () => {
  // Deduplicating on the tag signature is right for a mixed list and wrong for
  // a drill: every match shares the requested tag by definition.
  const pool = Array.from({ length: 5 }, (_, i) => ({
    key: `${i}A`,
    name: `P${i}`,
    rating: 1200,
    tags: ['dp'],
  }));

  assert.equal(recommend(pool, new Set(), [], { rating: 1200, only: ['dp'], limit: 4 }).length, 4);
  assert.equal(recommend(pool, new Set(), [], { rating: 1200, limit: 4 }).length, 1);
});

test('a tag drill never returns a problem without that tag', () => {
  const pool = [
    { key: '1A', name: 'dp one', rating: 1200, tags: ['dp'] },
    { key: '2B', name: 'geometry', rating: 1200, tags: ['geometry'] },
  ];
  const out = recommend(pool, new Set(), [], { rating: 1200, only: ['dp'] });
  assert.deepEqual(out.map((entry) => entry.key), ['1A']);
});

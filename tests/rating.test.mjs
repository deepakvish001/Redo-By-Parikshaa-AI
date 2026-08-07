import assert from 'node:assert/strict';
import test from 'node:test';

import {
  codeforcesRank,
  predictDeltas,
  predictFor,
  reassignRanks,
  winProbability,
} from '../src/core/rating.ts';

/** A field of `n` participants with ratings spread across a realistic range. */
function field(n, { seed = 1 } = {}) {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };

  return Array.from({ length: n }, (_, i) => ({
    handle: `user${i}`,
    rank: i + 1,
    points: n - i,
    // Roughly the shape of a Div. 2 field: a hump around 1400.
    rating: Math.round(800 + random() * 1600),
  }));
}

test('the Elo probability is symmetric and equal ratings are a coin flip', () => {
  assert.equal(winProbability(1500, 1500), 0.5);
  assert.ok(Math.abs(winProbability(1900, 1500) + winProbability(1500, 1900) - 1) < 1e-12);
  // 400 points is the classic 10:1 odds.
  assert.ok(Math.abs(winProbability(1900, 1500) - 10 / 11) < 1e-12);
});

test('tied participants all take the worst rank in their group', () => {
  // Codeforces does this, and getting it backwards inflates every prediction
  // in a contest with ties — which is every contest.
  const ranked = reassignRanks([
    { handle: 'a', rank: 1, points: 100, rating: 1500 },
    { handle: 'b', rank: 2, points: 100, rating: 1500 },
    { handle: 'c', rank: 3, points: 100, rating: 1500 },
    { handle: 'd', rank: 4, points: 50, rating: 1500 },
    { handle: 'e', rank: 5, points: 10, rating: 1500 },
  ]);

  assert.deepEqual(
    ranked.map((entry) => [entry.handle, entry.rank]),
    [
      ['a', 3],
      ['b', 3],
      ['c', 3],
      ['d', 4],
      ['e', 5],
    ],
  );
});

test('an identical field splits into a symmetric ladder around zero', () => {
  // Everyone at the same rating: the winner must gain what the loser drops,
  // and the middle must barely move.
  const participants = Array.from({ length: 21 }, (_, i) => ({
    handle: `p${i}`,
    rank: i + 1,
    points: 21 - i,
    rating: 1500,
  }));

  const deltas = predictDeltas(participants);
  const first = deltas.find((d) => d.handle === 'p0');
  const middle = deltas.find((d) => d.handle === 'p10');
  const last = deltas.find((d) => d.handle === 'p20');

  assert.ok(first.delta > 0, `winner should gain, got ${first.delta}`);
  assert.ok(last.delta < 0, `last should lose, got ${last.delta}`);
  assert.ok(first.delta > middle.delta && middle.delta > last.delta);

  // Deliberately *not* symmetric. Winning outright against twenty equals is
  // eleven times better than the seed expects; coming last is under twice
  // worse. The geometric mean carries that asymmetry through, and Codeforces
  // behaves the same way — an earlier version of this test asserted symmetry
  // and was simply wrong about the algorithm.
  assert.ok(
    first.delta > Math.abs(last.delta),
    `the winner should gain more than the loser drops, got ${first.delta} and ${last.delta}`,
  );
});

test('among equal ratings, a better rank always earns at least as much', () => {
  // The one ordering guarantee that survives the two corrections: they shift
  // every delta by the same amount, so they cannot reorder participants who
  // differ only in rank.
  const participants = Array.from({ length: 60 }, (_, i) => ({
    handle: `p${i}`,
    rank: i + 1,
    points: 60 - i,
    rating: 1500,
  }));

  const deltas = predictDeltas(participants).sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < deltas.length; i += 1) {
    assert.ok(
      deltas[i - 1].delta >= deltas[i].delta,
      `rank ${deltas[i - 1].rank} (${deltas[i - 1].delta}) must not earn less than rank ${deltas[i].rank} (${deltas[i].delta})`,
    );
  }
});

test('a field that finishes in rating order barely moves, in the middle', () => {
  // "Everyone performs to form" is not the same as "nobody moves". A seed is a
  // fractional expectation — the strongest entrant in a tightly packed field
  // may be seeded 30th, so finishing first is a genuine surprise and is paid
  // for. What must hold is that the bulk of the field sits still.
  const participants = field(400, { seed: 7 });
  const toForm = [...participants]
    .sort((a, b) => b.rating - a.rating)
    .map((participant, index) => ({
      ...participant,
      rank: index + 1,
      points: participants.length - index,
    }));

  const magnitudes = predictDeltas(toForm)
    .map((entry) => Math.abs(entry.delta))
    .sort((a, b) => a - b);
  const median = magnitudes[Math.floor(magnitudes.length / 2)];

  assert.ok(median <= 25, `the median participant should barely move, got ${median}`);
});

test('the field as a whole never gains rating', () => {
  // The first correction exists precisely to guarantee this; without it the
  // system inflates every contest.
  for (const seed of [1, 2, 3]) {
    const deltas = predictDeltas(field(300, { seed }));
    const total = deltas.reduce((sum, entry) => sum + entry.delta, 0);
    assert.ok(total <= 0, `sum of deltas must not be positive, got ${total} (seed ${seed})`);
  }
});

test('the strongest 4√n do not gain either', () => {
  // The second correction. This is what stops the top of the leaderboard
  // drifting upwards contest after contest.
  const deltas = predictDeltas(field(500, { seed: 11 }));
  const byRating = [...deltas].sort((a, b) => b.rating - a.rating);
  const top = Math.min(byRating.length, Math.floor(4 * Math.round(Math.sqrt(byRating.length))));
  const topSum = byRating.slice(0, top).reduce((sum, entry) => sum + entry.delta, 0);

  assert.ok(topSum <= 0, `the top ${top} must not gain as a group, got ${topSum}`);
});

test('beating the field lifts you, and being beaten by it does not', () => {
  const participants = field(300, { seed: 5 });
  // Plant a low-rated participant at the very top and a high-rated one at the
  // very bottom.
  participants.push({ handle: 'underdog', rank: 0, points: 10_000, rating: 900 });
  participants.push({ handle: 'favourite', rank: 0, points: -1, rating: 2300 });

  const underdog = predictFor(participants, 'underdog');
  const favourite = predictFor(participants, 'favourite');

  assert.ok(underdog.delta > 100, `winning from 900 should be a big gain, got ${underdog.delta}`);
  assert.ok(favourite.delta < -50, `losing from 2300 should hurt, got ${favourite.delta}`);
  assert.equal(underdog.newRating, underdog.rating + underdog.delta);
});

test('a large overperformance gains and a large underperformance loses', () => {
  // The corrections shift the whole field, so "beat your seed by one place"
  // guarantees nothing. Beating it several times over does.
  const deltas = predictDeltas(field(2000, { seed: 13 }));
  for (const entry of deltas) {
    if (entry.rank * 3 < entry.seed) {
      assert.ok(
        entry.delta > 0,
        `${entry.handle}: rank ${entry.rank} against seed ${entry.seed.toFixed(1)} should gain, got ${entry.delta}`,
      );
    }
    if (entry.rank > entry.seed * 3) {
      assert.ok(
        entry.delta < 0,
        `${entry.handle}: rank ${entry.rank} against seed ${entry.seed.toFixed(1)} should lose, got ${entry.delta}`,
      );
    }
  }
});

test('a handle that did not compete has no prediction', () => {
  assert.equal(predictFor(field(50), 'nobody'), undefined);
  // Handles are matched case-insensitively, as Codeforces treats them.
  assert.ok(predictFor(field(50), 'USER3'));
});

test('an empty field produces nothing rather than dividing by zero', () => {
  assert.deepEqual(predictDeltas([]), []);
});

test('a field of thousands finishes quickly enough to run in a panel', () => {
  // The direct O(n²) definition would be 900 million probability calculations
  // here; bucketing by rating is what makes this feasible at all.
  const started = Date.now();
  const deltas = predictDeltas(field(30_000, { seed: 3 }));
  const elapsed = Date.now() - started;

  assert.equal(deltas.length, 30_000);
  assert.ok(elapsed < 5000, `30k participants took ${elapsed}ms`);
});

test('rank names line up with the Codeforces bands', () => {
  assert.equal(codeforcesRank(1199).title, 'Newbie');
  assert.equal(codeforcesRank(1200).title, 'Pupil');
  assert.equal(codeforcesRank(1400).title, 'Specialist');
  assert.equal(codeforcesRank(1600).title, 'Expert');
  assert.equal(codeforcesRank(2400).title, 'Grandmaster');
  assert.equal(codeforcesRank(3500).title, 'Legendary Grandmaster');
});

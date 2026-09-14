import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bandFor,
  calendar,
  chooseDaily,
  dailyStreak,
  dayKey,
  hashString,
  pickFromBand,
  pickNear,
  previousDay,
  problemUrl,
  pickGlobal,
} from '../src/core/daily.ts';

// Keys must be unique across bands — an earlier version reused them, which
// made "solve every 1200" silently solve every 800 and 1600 as well.
const BAND = (rating, count) =>
  Array.from({ length: count }, (_, i) => ({
    key: `${rating * 10 + i}A`,
    name: `Problem ${rating}-${i}`,
    rating,
    tags: ['math'],
  }));

const POOL = [...BAND(800, 5), ...BAND(1200, 5), ...BAND(1400, 5), ...BAND(1600, 5)];

/* ------------------------------------------------------------------- days */

test('the day is the UTC day, so two devices agree', () => {
  assert.equal(dayKey(Date.parse('2026-03-01T23:30:00Z')), '2026-03-01');
  assert.equal(dayKey(Date.parse('2026-03-02T00:30:00Z')), '2026-03-02');
});

test('the previous day crosses a month and a leap day correctly', () => {
  assert.equal(previousDay('2026-03-01'), '2026-02-28');
  assert.equal(previousDay('2024-03-01'), '2024-02-29');
  assert.equal(previousDay('2026-01-01'), '2025-12-31');
});

/* ------------------------------------------------------------- the picking */

test('the same day gives the same problem, every time', () => {
  // The whole feature rests on this: a pick that slides when you reopen the
  // panel is not a daily problem, it is a shuffle button.
  const solved = new Set();
  const a = pickFromBand(POOL, 1200, solved, '2026-03-01');
  const b = pickFromBand(POOL, 1200, solved, '2026-03-01');
  assert.deepEqual(a, b);
});

test('a different day gives a different problem', () => {
  const solved = new Set();
  const days = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04'];
  const picks = days.map((day) => pickFromBand(POOL, 1200, solved, day)?.key);
  assert.ok(new Set(picks).size > 1, 'the rotation must actually rotate');
});

test('the pick is always at the rating asked for', () => {
  const pick = pickFromBand(POOL, 1400, new Set(), '2026-03-01');
  assert.equal(pick.rating, 1400);
});

test('an already solved problem is never today\'s problem', () => {
  const band = POOL.filter((p) => p.rating === 1200);
  // Everything at this band solved except one.
  const solved = new Set(band.slice(1).map((p) => p.key));
  const pick = pickFromBand(POOL, 1200, solved, '2026-03-01');
  assert.equal(pick.key, band[0].key);
});

test('a fully solved band yields nothing rather than a repeat', () => {
  const solved = new Set(POOL.filter((p) => p.rating === 1200).map((p) => p.key));
  assert.equal(pickFromBand(POOL, 1200, solved, '2026-03-01'), undefined);
});

test('a band with no problems yields nothing', () => {
  assert.equal(pickFromBand(POOL, 2900, new Set(), '2026-03-01'), undefined);
});

test('the pick does not depend on the order the API returned problems in', () => {
  const shuffled = [...POOL].reverse();
  assert.deepEqual(
    pickFromBand(POOL, 1200, new Set(), '2026-03-01'),
    pickFromBand(shuffled, 1200, new Set(), '2026-03-01'),
  );
});

test('the seed separates two people on the same day', () => {
  const one = pickFromBand(POOL, 1200, new Set(), '2026-03-01', 'alice');
  const two = pickFromBand(POOL, 1200, new Set(), '2026-03-01', 'bob');
  assert.ok(one && two);
  // Not guaranteed different for any one day, but the hash must at least use it.
  assert.notEqual(hashString('2026-03-01:alice:1200'), hashString('2026-03-01:bob:1200'));
});

test('a pick carries a link that opens the problem', () => {
  assert.equal(problemUrl('1980C'), 'https://codeforces.com/contest/1980/problem/C');
  assert.equal(problemUrl('1918E2'), 'https://codeforces.com/contest/1918/problem/E2');
  // Anything unparseable falls back to a search rather than a broken link.
  assert.match(problemUrl('weird'), /problemset\?search=weird/);
});

/* -------------------------------------------------------------- the bands */

test('the band rounds to how Codeforces actually rates problems', () => {
  assert.equal(bandFor(1449), 1400);
  assert.equal(bandFor(1450), 1500);
  assert.equal(bandFor(undefined), 800);
  assert.equal(bandFor(0), 800);
  assert.equal(bandFor(9000), 3500);
});

test('the trio is spaced around your band, not around absolute difficulty', () => {
  // At 1600, "easy" means 1400 — not 800.
  const set = chooseDaily(POOL, 1600, new Set(), '2026-03-01');
  assert.equal(set.easy.rating, 1400);
  assert.equal(set.medium.rating, 1600);
  assert.equal(set.main.rating, 1600);
});

test('the trio clamps rather than asking for a rating that cannot exist', () => {
  const set = chooseDaily(POOL, 800, new Set(), '2026-03-01');
  // 800 - 200 would be 600; there are no 600s, so easy lands at the floor.
  assert.equal(set.easy?.rating ?? 800, 800);
});

/* ------------------------------------------------------------- the streak */

const log = (entries) =>
  Object.fromEntries(entries.map(([day, key, skipped]) => [day, { key, pickedAt: 0, skipped }]));

test('a run of solved days counts', () => {
  const l = log([
    ['2026-03-01', 'a'],
    ['2026-03-02', 'b'],
    ['2026-03-03', 'c'],
  ]);
  const streak = dailyStreak(l, new Set(['a', 'b', 'c']), '2026-03-03');
  assert.equal(streak.current, 3);
  assert.equal(streak.todayPending, false);
});

test('today being undone does not break the streak, it leaves it pending', () => {
  // A streak that reads zero at nine in the morning is the opposite of
  // motivating.
  const l = log([
    ['2026-03-01', 'a'],
    ['2026-03-02', 'b'],
    ['2026-03-03', 'c'],
  ]);
  const streak = dailyStreak(l, new Set(['a', 'b']), '2026-03-03');
  assert.equal(streak.current, 2);
  assert.equal(streak.todayPending, true);
});

test('a missed day ends the run', () => {
  const l = log([
    ['2026-03-01', 'a'],
    ['2026-03-02', 'b'],
    ['2026-03-03', 'c'],
  ]);
  assert.equal(dailyStreak(l, new Set(['a', 'c']), '2026-03-03').current, 1);
});

test('skipping today ends the run — that is what a skip means', () => {
  const l = log([
    ['2026-03-01', 'a'],
    ['2026-03-02', 'b', true],
  ]);
  const streak = dailyStreak(l, new Set(['a', 'b']), '2026-03-02');
  assert.equal(streak.current, 0);
  assert.equal(streak.todayPending, false);
  // Yesterday's run is still on the record.
  assert.equal(streak.longest, 1);
});

test('not having got to it yet is pending, not a skip', () => {
  // The distinction the backlog exists for: a busy day should cost nothing
  // until midnight, while pressing Skip is a decision.
  const l = log([
    ['2026-03-01', 'a'],
    ['2026-03-02', 'b'],
  ]);
  const streak = dailyStreak(l, new Set(['a']), '2026-03-02');
  assert.equal(streak.current, 1);
  assert.equal(streak.todayPending, true);
});

test('a skipped day in the past breaks the run through it', () => {
  const l = log([
    ['2026-03-01', 'a'],
    ['2026-03-02', 'b', true],
    ['2026-03-03', 'c'],
  ]);
  assert.equal(dailyStreak(l, new Set(['a', 'b', 'c']), '2026-03-03').current, 1);
});

test('the longest run survives a broken one', () => {
  const l = log([
    ['2026-03-01', 'a'],
    ['2026-03-02', 'b'],
    ['2026-03-03', 'c'],
    ['2026-03-04', 'd'],
    ['2026-03-06', 'f'],
  ]);
  const streak = dailyStreak(l, new Set(['a', 'b', 'c', 'd', 'f']), '2026-03-06');
  assert.equal(streak.current, 1);
  assert.equal(streak.longest, 4);
});

test('a day with no record at all is not a streak day', () => {
  assert.equal(dailyStreak({}, new Set(), '2026-03-03').current, 0);
});

/* ------------------------------------------------------------ the calendar */

test('the calendar tells the four states apart', () => {
  const l = log([
    ['2026-03-01', 'a'],
    ['2026-03-02', 'b', true],
    ['2026-03-03', 'c'],
    ['2026-03-04', 'd'],
  ]);
  const cells = calendar(l, new Set(['a']), '2026-03-04', 4);

  assert.deepEqual(
    cells.map((cell) => cell.state),
    ['done', 'skipped', 'missed', 'future'],
  );
});

test('the calendar runs oldest to newest, ending today', () => {
  const cells = calendar({}, new Set(), '2026-03-10', 3);
  assert.deepEqual(
    cells.map((cell) => cell.day),
    ['2026-03-08', '2026-03-09', '2026-03-10'],
  );
});

test('a band you have finished steps outward rather than offering nothing', () => {
  // The most likely user of a daily problem is someone who has cleared their
  // own level, so handing them nothing is the worst possible answer.
  const solved = new Set(POOL.filter((p) => p.rating === 1200).map((p) => p.key));
  const pick = pickNear(POOL, 1200, solved, '2026-03-01');

  assert.ok(pick, 'something should still be offered');
  assert.notEqual(pick.rating, 1200);
});

test('stepping outward goes up before it goes down', () => {
  // Running out at your level means the level is behind you.
  const solved = new Set(POOL.filter((p) => p.rating === 1200).map((p) => p.key));
  assert.equal(pickNear(POOL, 1200, solved, '2026-03-01').rating, 1400);
});

test('an entirely solved problemset still yields nothing, honestly', () => {
  const solved = new Set(POOL.map((p) => p.key));
  assert.equal(pickNear(POOL, 1200, solved, '2026-03-01'), undefined);
});

test('the trio still lands near your level when a band is exhausted', () => {
  const solved = new Set(POOL.filter((p) => p.rating === 1400).map((p) => p.key));
  const set = chooseDaily(POOL, 1400, solved, '2026-03-01');
  assert.ok(set.main);
  assert.notEqual(set.main.rating, 1400);
});

test('the trio is three different problems', () => {
  // Somebody who has cleared everything below their level used to get the same
  // problem three times: all three searches walk upward and land together.
  const solved = new Set(POOL.filter((p) => p.rating <= 1400).map((p) => p.key));
  const set = chooseDaily(POOL, 1400, solved, '2026-03-01');

  const keys = [set.easy, set.medium, set.hard].filter(Boolean).map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('today’s problem is the one at your level, not a fourth pick', () => {
  const set = chooseDaily(POOL, 1400, new Set(), '2026-03-01');
  assert.equal(set.main.key, set.medium.key);
});

test('the set reports the band it aimed at, so a pick can be labelled honestly', () => {
  const set = chooseDaily(POOL, 1437, new Set(), '2026-03-01');
  assert.equal(set.band, 1400);
});

/* ---------------------------------------------------- the global problem */

test('the global problem is the same for everybody on a given day', () => {
  // No server picks it: the day seeds a rotation over the whole problemset and
  // every copy of the extension walks to the same entry. Two people comparing
  // notes agree because the arithmetic agrees, not because they were told.
  const pool = [
    { key: '1000A', name: 'A', rating: 800, tags: [] },
    { key: '1000B', name: 'B', rating: 1200, tags: [] },
    { key: '1000C', name: 'C', rating: 1600, tags: [] },
    { key: '1000D', name: 'D', rating: 2000, tags: [] },
  ];

  const mine = pickGlobal(pool, '2026-09-02');
  const yours = pickGlobal([...pool].reverse(), '2026-09-02');
  assert.equal(mine.key, yours.key, 'and not on the order the API happened to return');
});

test('the global problem changes with the day', () => {
  const pool = Array.from({ length: 40 }, (_, index) => ({
    key: `10${String(index).padStart(2, '0')}A`,
    name: `P${index}`,
    rating: 1200,
    tags: [],
  }));

  const days = new Set(
    ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'].map((day) => pickGlobal(pool, day).key),
  );
  assert.ok(days.size >= 3, `expected mostly different picks, got ${days.size}`);
});

test('the global problem ignores what you have solved', () => {
  // That is the point of a global one — it is the same problem whether or not
  // you have done it, and the row says "solved" rather than quietly moving on.
  const pool = [{ key: '1000A', name: 'A', rating: 800, tags: [] }];
  assert.equal(pickGlobal(pool, '2026-09-02').key, '1000A');
});

test('unrated problems are never the global pick', () => {
  // An unrated entry is usually an April Fools' problem or a gym leftover, and
  // "today's problem" landing on one is a bad day for everybody at once.
  const pool = [
    { key: '1000A', name: 'April Fools', rating: 0, tags: [] },
    { key: '1000B', name: 'Real', rating: 1400, tags: [] },
  ];
  assert.equal(pickGlobal(pool, '2026-09-02').key, '1000B');
  assert.equal(pickGlobal([pool[0]], '2026-09-02'), undefined);
});

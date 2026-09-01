import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bandOutcomes,
  heatmap,
  heatmapGrid,
  heatmapYears,
  ratingHistogram,
  tagCounts,
  worstBands,
  worstTags,
} from '../src/core/insights.ts';

const PROBLEMSET = {
  '1A': { name: 'Theatre Square', rating: 1000, tags: ['math'] },
  '4A': { name: 'Watermelon', rating: 800, tags: ['brute force', 'math'] },
  '158A': { name: 'Next Round', rating: 800, tags: ['implementation'] },
  '1980C': { name: 'Sofia', rating: 1400, tags: ['greedy', 'sortings'] },
  '2000C': { name: 'Template', rating: 1200, tags: ['strings', 'greedy'] },
  '1918E': { name: 'Hard One', rating: 2400, tags: ['dp'] },
  'UNRATED': { name: 'Gym thing', tags: ['math'] },
};

/* ------------------------------------------------------------- histogram */

test('solved problems bin by rating, low to high', () => {
  const bins = ratingHistogram(['4A', '158A', '1A', '1980C'], PROBLEMSET);
  assert.deepEqual(
    bins.map((bin) => [bin.rating, bin.count]),
    [[800, 2], [1000, 1], [1400, 1]],
  );
});

test('a bar carries the problems in it, so it can be opened', () => {
  const bins = ratingHistogram(['4A', '158A'], PROBLEMSET);
  assert.deepEqual(bins[0].keys, ['158A', '4A']);
});

test('an unrated problem gets no bar rather than a made-up one', () => {
  const bins = ratingHistogram(['UNRATED', '4A'], PROBLEMSET);
  assert.equal(bins.length, 1);
  assert.equal(bins[0].rating, 800);
});

test('a problem the problemset has never heard of is skipped', () => {
  assert.deepEqual(ratingHistogram(['9999Z'], PROBLEMSET), []);
});

/* ------------------------------------------------------------------ tags */

test('a problem contributes to every tag it carries', () => {
  const counts = tagCounts(['4A'], [], PROBLEMSET);
  assert.deepEqual(
    counts.map((entry) => [entry.tag, entry.solved]).sort(),
    [['brute force', 1], ['math', 1]],
  );
});

test('tags are ordered by how much you have touched them', () => {
  const counts = tagCounts(['4A', '1A'], ['2000C'], PROBLEMSET);
  assert.equal(counts[0].tag, 'math', 'math is on two solved problems');
});

test('a fail rate needs enough attempts to mean anything', () => {
  // One abandoned problem is not "100% of dynamic programming".
  const counts = tagCounts([], ['1918E'], PROBLEMSET);
  assert.equal(counts.find((entry) => entry.tag === 'dp').failRate, undefined);
});

test('a fail rate appears once a tag has been touched enough', () => {
  const many = {};
  for (let i = 0; i < 6; i += 1) many[`g${i}`] = { name: 'x', rating: 1200, tags: ['graphs'] };
  const counts = tagCounts(['g0', 'g1', 'g2'], ['g3', 'g4', 'g5'], many);
  assert.equal(counts[0].failRate, 0.5);
});

test('worst tags are the ones you give up on, worst first', () => {
  const many = {};
  for (let i = 0; i < 5; i += 1) many[`a${i}`] = { name: 'x', rating: 1200, tags: ['easy-tag'] };
  for (let i = 0; i < 5; i += 1) many[`b${i}`] = { name: 'x', rating: 1200, tags: ['hard-tag'] };

  const counts = tagCounts(
    ['a0', 'a1', 'a2', 'a3', 'b0'],
    ['a4', 'b1', 'b2', 'b3', 'b4'],
    many,
  );
  const worst = worstTags(counts);
  assert.equal(worst[0].tag, 'hard-tag');
  assert.equal(worst[0].failRate, 0.8);
});

test('a tag you have never failed is not a worst tag', () => {
  const many = {};
  for (let i = 0; i < 5; i += 1) many[`a${i}`] = { name: 'x', rating: 1200, tags: ['fine'] };
  const counts = tagCounts(['a0', 'a1', 'a2', 'a3', 'a4'], [], many);
  assert.deepEqual(worstTags(counts), []);
});

/* ----------------------------------------------------------------- bands */

test('bands report solved against abandoned', () => {
  const outcomes = bandOutcomes(['4A'], ['158A'], PROBLEMSET);
  assert.deepEqual(outcomes, [{ rating: 800, solved: 1, unsolved: 1, failRate: 0.5 }]);
});

test('worst bands need enough problems to be a rate', () => {
  assert.deepEqual(worstBands(bandOutcomes(['4A'], ['158A'], PROBLEMSET)), []);
});

/* --------------------------------------------------------------- heatmap */

const AT = (day) => Date.parse(`${day}T12:00:00Z`) / 1000;

test('a day is coloured by the hardest problem on it, not the count', () => {
  // The one genuinely better idea in the reference set: Codeforces' own heatmap
  // counts problems, so ten 800s outshine one 2400 — backwards as progress.
  const days = heatmap(
    [['4A', AT('2026-03-01')], ['158A', AT('2026-03-01')], ['1918E', AT('2026-03-02')]],
    PROBLEMSET,
  );

  assert.equal(days.get('2026-03-01').count, 2);
  assert.equal(days.get('2026-03-01').peak, 800);
  assert.equal(days.get('2026-03-02').count, 1);
  assert.equal(days.get('2026-03-02').peak, 2400);
});

test('an unrated solve does not raise the peak', () => {
  const days = heatmap([['UNRATED', AT('2026-03-01')]], PROBLEMSET);
  assert.equal(days.get('2026-03-01').peak, 0);
  assert.equal(days.get('2026-03-01').count, 1);
});

test('a day keeps what was solved on it', () => {
  const days = heatmap([['4A', AT('2026-03-01')]], PROBLEMSET);
  assert.deepEqual(days.get('2026-03-01').keys, ['4A']);
});

test('the years present come out newest first', () => {
  assert.deepEqual(
    heatmapYears([['a', AT('2024-05-01')], ['b', AT('2026-01-01')], ['c', AT('2024-11-01')]]),
    [2026, 2024],
  );
});

/* ------------------------------------------------------------- the grid */

test('the grid is weeks of seven, every day of the year present once', () => {
  const grid = heatmapGrid(2025);
  const days = grid.flat().filter(Boolean);
  assert.equal(days.length, 365);
  assert.equal(new Set(days).size, 365);
  assert.ok(grid.every((column) => column.length === 7));
});

test('a leap year has its extra day', () => {
  assert.equal(heatmapGrid(2024).flat().filter(Boolean).length, 366);
});

test('every row is the same weekday', () => {
  // Without leading blanks, January the first lands wherever it likes and the
  // rows stop meaning anything.
  const grid = heatmapGrid(2025);
  for (let row = 0; row < 7; row += 1) {
    const weekdays = new Set(
      grid
        .map((column) => column[row])
        .filter(Boolean)
        .map((day) => new Date(`${day}T00:00:00Z`).getUTCDay()),
    );
    assert.equal(weekdays.size, 1, `row ${row} must be one weekday`);
  }
});

test('the grid starts on a Monday row', () => {
  const grid = heatmapGrid(2025);
  const first = grid.flat().find(Boolean);
  const row = grid[0].indexOf(first);
  assert.equal(new Date(`${first}T00:00:00Z`).getUTCDay(), (row + 1) % 7);
});

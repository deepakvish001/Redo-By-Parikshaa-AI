import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRoadmap, solvesNeeded, weakBands, weakTags } from '../src/core/roadmap.ts';

const band = (rating, solved, touched) => ({
  rating,
  solved,
  touched,
  rate: solved / touched,
});

const tag = (name, failRate) => ({ tag: name, solved: 5, unsolved: 5, failRate });

const pick = (rating, tags, limit) =>
  Array.from({ length: limit }, (_, i) => ({
    key: `${rating}-${tags.join('') || 'any'}-${i}`,
    name: `Problem ${i}`,
    rating,
    tags: tags.length > 0 ? tags : ['math'],
    url: 'https://codeforces.com/x',
    because: 'because',
    score: 1,
  }));

const input = (over = {}) => ({
  target: 1600,
  band: 1300,
  bands: [],
  tags: [],
  upsolve: [],
  pick,
  ...over,
});

/* -------------------------------------------------------- how many more */

test('the number of extra solves is the number that crosses the rate', () => {
  // 4 of 10 is 40%. Solving 5 more makes 9 of 15 — 60%.
  assert.equal(solvesNeeded(4, 10, 0.6), 5);
});

test('a band already over the line needs none', () => {
  assert.equal(solvesNeeded(9, 10, 0.6), 0);
  assert.equal(solvesNeeded(6, 10, 0.6), 0);
});

test('the count is always a whole number of problems', () => {
  const needed = solvesNeeded(3, 10, 0.6);
  assert.equal(needed, Math.ceil(needed));
  assert.ok((3 + needed) / (10 + needed) >= 0.6, 'and it really does cross the line');
});

/* ------------------------------------------------------------ what is weak */

test('only bands below the target, and only ones with enough evidence', () => {
  const weak = weakBands(
    [
      band(1200, 2, 10), // weak
      band(1400, 1, 3), // too few touched to mean anything
      band(1500, 4, 10), // weak
      band(1700, 1, 10), // above the target
      band(1300, 9, 10), // fine
    ],
    1600,
  );

  assert.deepEqual(weak.map((entry) => entry.rating), [1200, 1500]);
});

test('the lowest weak band comes first, not the hardest', () => {
  // Weakness compounds upward: fixing 1200 is what makes 1400 possible.
  const weak = weakBands([band(1500, 2, 10), band(1200, 2, 10)], 1600);
  assert.equal(weak[0].rating, 1200);
});

test('a tag has to be genuinely bad to be drilled', () => {
  const tags = weakTags([tag('dp', 0.7), tag('math', 0.1), tag('graphs', 0.5), tag('geo', undefined)]);
  assert.deepEqual(tags.map((entry) => entry.tag), ['dp', 'graphs']);
});

/* ------------------------------------------------------------- the order */

test('the plan is bands, then tags, then upsolve, then the target', () => {
  const plan = buildRoadmap(
    input({
      bands: [band(1200, 2, 10)],
      tags: [tag('dp', 0.7)],
      upsolve: [{ id: '1A', name: 'A', url: 'u', index: 'A', contestName: 'Round 900' }],
    }),
  );

  assert.deepEqual(plan.steps.map((step) => step.kind), ['band', 'tag', 'upsolve', 'target']);
});

test('a step carries the evidence it was built from', () => {
  const plan = buildRoadmap(input({ bands: [band(1200, 2, 10)] }));
  const step = plan.steps[0];

  assert.match(step.why, /20%/, 'the finish rate');
  assert.match(step.why, /2 of 10/, 'and the raw counts');
  assert.equal(step.count, solvesNeeded(2, 10));
});

test('techniques are drilled below your level, not at it', () => {
  // Learning a new technique at your ceiling means failing for two reasons at
  // once and not knowing which.
  const plan = buildRoadmap(input({ band: 1300, tags: [tag('dp', 0.7)] }));
  const drill = plan.steps.find((step) => step.kind === 'tag');
  assert.equal(drill.rating, 1200);
  assert.deepEqual(drill.tags, ['dp']);
  assert.ok(drill.problems.every((problem) => problem.tags.includes('dp')));
});

test('the drill never goes below the lowest band that exists', () => {
  const plan = buildRoadmap(input({ band: 800, tags: [tag('dp', 0.7)] }));
  assert.equal(plan.steps.find((step) => step.kind === 'tag').rating, 800);
});

test('nothing weak still produces a plan — the target itself', () => {
  const plan = buildRoadmap(input());
  assert.deepEqual(plan.steps.map((step) => step.kind), ['target']);
  assert.match(plan.steps[0].why, /Nothing below 1600 is holding you back/);
});

test('a band that needs no more solves is not a step', () => {
  const plan = buildRoadmap(input({ bands: [band(9, 10, 1200 && 10)] }));
  assert.deepEqual(plan.steps.map((step) => step.kind), ['target']);
});

test('upsolve problems keep their contest as the reason', () => {
  const plan = buildRoadmap(
    input({ upsolve: [{ id: '1A', name: 'Alpha', url: 'u', index: 'A', contestName: 'Round 900' }] }),
  );
  const step = plan.steps.find((entry) => entry.kind === 'upsolve');
  assert.equal(step.problems[0].because, 'Round 900');
  assert.match(step.why, /already read them/);
});

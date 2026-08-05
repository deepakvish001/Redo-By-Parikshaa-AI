import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHintLadder, previewCode } from '../src/core/hints.ts';

const NOW = Date.now();

function makeProblem(overrides = {}) {
  return {
    id: 'leetcode:two-sum',
    platform: 'leetcode',
    problemId: '1',
    slug: 'two-sum',
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'easy',
    tags: ['Array', 'Hash Table'],
    language: 'Python3',
    code: 'class Solution:\n    def twoSum(self, nums, target):\n        pass',
    solvedAt: NOW,
    attempts: 1,
    github: { status: 'synced' },
    parikshaa: { status: 'synced' },
    revision: { stage: 1, ease: 1, dueAt: NOW, reviewCount: 1, lapses: 0, hintsUsed: 0 },
    ...overrides,
  };
}

test('the ladder always has three rungs, ending in your own solution', () => {
  const ladder = buildHintLadder(makeProblem());

  assert.equal(ladder.length, 3);
  assert.deepEqual(
    ladder.map((hint) => hint.level),
    [1, 2, 3],
  );
  assert.match(ladder[2].title, /Python3/);
  assert.equal(ladder[2].body.includes('def twoSum'), true);
});

test('the nudge points at the shape of the problem without naming the technique', () => {
  const nudge = buildHintLadder(makeProblem()).find((hint) => hint.level === 1).body;

  assert.match(nudge, /Array, Hash Table/);
  // The tag library's nudge for hash table asks the question, not the answer.
  assert.match(nudge, /look up instantly/);
  assert.equal(/map|dictionary/i.test(nudge), false);
});

test('the nudge recalls how the first solve actually went', () => {
  const nudge = buildHintLadder(
    makeProblem({ attempts: 4, solveTimeMs: 42 * 60_000 }),
  ).find((hint) => hint.level === 1).body;

  assert.match(nudge, /4 attempts/);
  assert.match(nudge, /42 min/);
});

test('your own note outranks the generic approach hint', () => {
  const approach = buildHintLadder(
    makeProblem({ note: 'Keep a seen-map from value to index.' }),
  ).find((hint) => hint.level === 2).body;

  assert.match(approach, /seen-map from value to index/);
  // The library line is dropped once there is something of your own to show.
  assert.equal(approach.includes('Store what you have already seen'), false);
});

test('complexity you recorded is shown alongside the approach', () => {
  const approach = buildHintLadder(
    makeProblem({ note: 'Single pass.', complexity: { time: 'O(n)', space: 'O(n)' } }),
  ).find((hint) => hint.level === 2).body;

  assert.match(approach, /Single pass\./);
  assert.match(approach, /Time O\(n\), Space O\(n\)/);
});

test('with no notes the tag library carries the approach rung', () => {
  const approach = buildHintLadder(makeProblem({ tags: ['Dynamic Programming'] })).find(
    (hint) => hint.level === 2,
  ).body;
  assert.match(approach, /Define the state/);
});

test('an untagged problem with no notes still produces a usable ladder', () => {
  const ladder = buildHintLadder(makeProblem({ tags: [], note: undefined }));

  assert.equal(ladder.length, 3);
  assert.match(ladder[0].body, /smallest input/);
  assert.match(ladder[1].body, /No notes were saved/);
  assert.equal(ladder[2].body.length > 0, true);
});

test('a technique tag is preferred over a structural one', () => {
  // Almost everything is tagged "array"; the technique tag is the real hint.
  const nudge = buildHintLadder(
    makeProblem({ tags: ['Unknown Tag', 'Array', 'Binary Search'] }),
  ).find((hint) => hint.level === 1).body;
  assert.match(nudge, /monotonic/);
});

test('a structural tag is still used when it is all there is', () => {
  const nudge = buildHintLadder(makeProblem({ tags: ['Array'] })).find(
    (hint) => hint.level === 1,
  ).body;
  assert.match(nudge, /order of the elements/);
});

test('long solutions are trimmed rather than dumped', () => {
  const long = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n');
  const preview = previewCode(long, 30);

  assert.equal(preview.split('\n').length, 31);
  assert.match(preview, /70 more lines/);
  // Short code is returned untouched.
  assert.equal(previewCode('a\nb', 30), 'a\nb');
});

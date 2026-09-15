import test from 'node:test';
import assert from 'node:assert/strict';

import { describeFields, findInCode, parseQuery, searchSolutions } from '../src/core/search.ts';

const DAY = 86_400_000;
const now = Date.UTC(2026, 0, 15);

const problem = (over) => ({
  id: `leetcode:${over.slug}`,
  platform: 'leetcode',
  problemId: '1',
  title: 'Untitled',
  url: 'https://leetcode.com/problems/x/',
  difficulty: 'medium',
  tags: [],
  labels: [],
  language: 'Python3',
  code: '',
  attempts: 1,
  solvedAt: now,
  github: { status: 'disabled' },
  parikshaa: { status: 'disabled' },
  revision: { stage: 0, ease: 1, dueAt: now, reviewCount: 0, lapses: 0, hintsUsed: 0 },
  ...over,
});

const stack = problem({
  slug: 'daily-temperatures',
  title: 'Daily Temperatures',
  tags: ['Stack', 'Array'],
  code: 'def solve(t):\n    stack = []\n    # monotonic stack, decreasing\n    for i, x in enumerate(t):\n        pass\n',
});

const twoSum = problem({
  slug: 'two-sum',
  title: 'Two Sum',
  tags: ['Hash Table'],
  note: 'Keep the complement in a dict.',
  code: 'def two_sum(nums):\n    seen = {}\n',
  solvedAt: now - 10 * DAY,
});

const rain = problem({
  slug: 'trapping-rain-water',
  title: 'Trapping Rain Water',
  tags: ['Two Pointers', 'Stack'],
  labels: ['revisit'],
  code: 'int trap(vector<int>& h){ /* monotonic stack */ }',
  solvedAt: now - 2 * DAY,
});

const all = [stack, twoSum, rain];

/* ---------------------------------------------------------------- queries */

test('every word has to appear somewhere', () => {
  // ANDed rather than ORed: "monotonic stack" should not also return every
  // problem that merely mentions a stack.
  assert.deepEqual(
    searchSolutions(all, 'monotonic stack').map((hit) => hit.problem.slug).sort(),
    ['daily-temperatures', 'trapping-rain-water'],
  );
  assert.deepEqual(searchSolutions(all, 'monotonic dict'), []);
});

test('an empty query finds nothing rather than everything', () => {
  assert.deepEqual(searchSolutions(all, ''), []);
  assert.deepEqual(searchSolutions(all, '   '), []);
  assert.deepEqual(parseQuery('  '), []);
});

test('a repeated word is one term', () => {
  assert.deepEqual(parseQuery('stack STACK stack'), ['stack']);
});

test('searching is case-insensitive', () => {
  assert.equal(searchSolutions(all, 'MONOTONIC').length, 2);
});

/* ------------------------------------------------------------ where it hit */

test('the place a match landed is reported', () => {
  const [hit] = searchSolutions([stack], 'stack');
  // Title does not contain it; the tag and the code do.
  assert.deepEqual(hit.fields, ['tag', 'code']);
});

test('a title match outranks a match buried in the code', () => {
  // `max` appears in half of everything; the useful hit must not be buried
  // under thirty coincidences.
  const titled = problem({ slug: 'maximum-subarray', title: 'Maximum Subarray', code: 'x = 1' });
  const incidental = problem({ slug: 'other', title: 'Other', code: 'm = maximum(a, b)' });

  const hits = searchSolutions([incidental, titled], 'maximum');
  assert.equal(hits[0].problem.slug, 'maximum-subarray');
});

test('a note is searched, and so are your own labels', () => {
  assert.deepEqual(searchSolutions(all, 'complement').map((h) => h.problem.slug), ['two-sum']);
  assert.deepEqual(searchSolutions(all, 'revisit').map((h) => h.problem.slug), ['trapping-rain-water']);
});

test('the slug is searched as well as the title', () => {
  assert.deepEqual(searchSolutions(all, 'temperatures').map((h) => h.problem.slug), ['daily-temperatures']);
});

/* --------------------------------------------------------------- snippets */

test('a code match comes back with the line and its number', () => {
  const [hit] = searchSolutions([stack], 'monotonic');
  assert.ok(hit.snippet, 'no snippet for a code match');
  assert.equal(hit.snippet.line, 3, 'the line number is off');
  assert.match(hit.snippet.text, /monotonic stack, decreasing/);
});

test('the snippet is trimmed, not the whole file', () => {
  const long = problem({ slug: 'long', code: `x = "${'a'.repeat(500)}needle"` });
  const [hit] = searchSolutions([long], 'needle');
  assert.ok(hit.snippet.text.length <= 161, `snippet is ${hit.snippet.text.length} characters`);
});

test('a title-only match has no snippet to show', () => {
  const titleOnly = problem({ slug: 'palindrome-partitioning', title: 'Palindrome Partitioning', code: 'x = 1' });
  const [hit] = searchSolutions([titleOnly], 'palindrome');
  assert.deepEqual(hit.fields, ['title']);
  assert.equal(hit.snippet, undefined);
});

test('findInCode finds the first occurrence, one-based', () => {
  assert.deepEqual(findInCode('a\nb\nneedle\n', 'needle'), { line: 3, text: 'needle' });
  assert.equal(findInCode('nothing here', 'needle'), undefined);
});

/* ------------------------------------------------------- every solution */

test('a second language on the same problem is searched too', () => {
  // Re-solving in C++ keeps the Python file beside it; searching only the most
  // recent would quietly miss half of what is committed.
  const both = problem({
    slug: 'both',
    code: 'def f(): pass',
    solutions: {
      py: { language: 'Python3', code: 'def f(): pass', solvedAt: now },
      cpp: { language: 'C++', code: 'priority_queue<int> pq;', solvedAt: now },
    },
  });
  assert.equal(searchSolutions([both], 'priority_queue').length, 1);
});

/* ----------------------------------------------------------------- order */

test('equally relevant hits put the most recent solve first', () => {
  const older = problem({ slug: 'older', title: 'Binary Search', solvedAt: now - 30 * DAY });
  const newer = problem({ slug: 'newer', title: 'Binary Search', solvedAt: now });
  assert.deepEqual(
    searchSolutions([older, newer], 'binary search').map((hit) => hit.problem.slug),
    ['newer', 'older'],
  );
});

test('the result count is capped', () => {
  const many = Array.from({ length: 80 }, (_, i) => problem({ slug: `p${i}`, title: `Stack ${i}` }));
  assert.equal(searchSolutions(many, 'stack', 10).length, 10);
});

/* ---------------------------------------------------------------- phrasing */

test('where it matched reads as a sentence', () => {
  assert.equal(describeFields(['title']), 'title');
  assert.equal(describeFields(['tag', 'code']), 'tag and code');
  assert.equal(describeFields(['title', 'note', 'code']), 'title, note and code');
  assert.equal(describeFields([]), '');
});

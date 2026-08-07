import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_LABELS,
  addLabels,
  countLabels,
  normalise,
  parseLabels,
  removeLabel,
  suggestionsFor,
  withLabel,
} from '../src/core/labels.ts';

function problem(id, labels, dueAt = 0) {
  return {
    id,
    platform: 'leetcode',
    problemId: id,
    slug: id,
    title: id,
    url: `https://leetcode.com/problems/${id}/`,
    difficulty: 'medium',
    tags: [],
    language: 'python',
    code: '',
    solvedAt: 0,
    attempts: 1,
    labels,
    github: { status: 'disabled' },
    parikshaa: { status: 'disabled' },
    revision: { stage: 0, ease: 1, dueAt, reviewCount: 0, lapses: 0, hintsUsed: 0 },
  };
}

test('the same word is always the same label', () => {
  // The whole feature falls apart if these end up as three separate groups.
  assert.equal(normalise('Dynamic Programming'), 'dynamic-programming');
  assert.equal(normalise('  dynamic programming '), 'dynamic-programming');
  assert.equal(normalise('DYNAMIC_PROGRAMMING'), 'dynamic-programming');
});

test('normalising strips punctuation and stray hyphens', () => {
  assert.equal(normalise('Google (OA)!'), 'google-oa');
  assert.equal(normalise('--revisit--'), 'revisit');
  assert.equal(normalise('%%%'), '');
});

test('a label cannot grow past the chip width', () => {
  assert.equal(normalise('a'.repeat(60)).length, 24);
});

test('a comma-separated paste becomes several labels', () => {
  assert.deepEqual(parseLabels('revisit, Google OA,, revisit'), ['revisit', 'google-oa']);
});

test('adding is idempotent and sorted', () => {
  const once = addLabels([], 'revisit, tricky');
  assert.deepEqual(once, ['revisit', 'tricky']);
  assert.deepEqual(addLabels(once, 'Tricky'), ['revisit', 'tricky']);
});

test('a problem cannot carry more labels than the card can show', () => {
  const many = Array.from({ length: 20 }, (_, index) => `label-${index}`).join(',');
  assert.equal(addLabels([], many).length, MAX_LABELS);
});

test('removing takes the normalised form, not the typed one', () => {
  assert.deepEqual(removeLabel(['google-oa', 'revisit'], 'Google OA'), ['revisit']);
});

test('counts rank by use, and count what is due', () => {
  const problems = [
    problem('a', ['revisit'], 0),
    problem('b', ['revisit'], Number.MAX_SAFE_INTEGER),
    problem('c', ['tricky'], 0),
  ];
  const counts = countLabels(problems, 1_000);

  assert.deepEqual(
    counts.map((entry) => [entry.label, entry.count, entry.due]),
    [
      ['revisit', 2, 1],
      ['tricky', 1, 1],
    ],
  );
});

test('filtering by label matches however the label was typed', () => {
  const problems = [problem('a', ['blind-75']), problem('b', ['revisit'])];
  assert.deepEqual(
    withLabel(problems, 'Blind 75').map((entry) => entry.id),
    ['a'],
  );
});

test('suggestions offer your own labels first and never one already applied', () => {
  const mine = countLabels([problem('a', ['contest-only']), problem('b', ['contest-only'])], 0);
  const suggestions = suggestionsFor(['revisit'], mine);

  assert.equal(suggestions[0], 'contest-only');
  assert.ok(!suggestions.includes('revisit'));
});

test('a problem with no labels is untouched by the counters', () => {
  assert.deepEqual(countLabels([problem('a', undefined)], 0), []);
  assert.deepEqual(withLabel([problem('a', undefined)], 'x'), []);
});

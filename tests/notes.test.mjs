import assert from 'node:assert/strict';
import test from 'node:test';

import { collectNotes, excerpt, hasNote, noteMatches } from '../src/core/notes.ts';

const problem = (over = {}) => ({
  id: 'codeforces:1A',
  platform: 'codeforces',
  slug: '1A',
  title: 'Theatre Square',
  url: 'https://codeforces.com/problemset/problem/1/A',
  tags: ['math'],
  labels: [],
  solvedAt: 1_000,
  note: 'ceil division, watch the overflow',
  complexity: {},
  ...over,
});

test('only problems with a note become notes', () => {
  assert.equal(hasNote(problem()), true);
  assert.equal(hasNote(problem({ note: '   \n ' })), false, 'whitespace is not a note');
  assert.equal(hasNote(problem({ note: undefined })), false);
  assert.equal(collectNotes([problem(), problem({ id: 'b', note: '' })]).length, 1);
});

test('notes come back newest first', () => {
  const notes = collectNotes([
    problem({ id: 'old', solvedAt: 1 }),
    problem({ id: 'new', solvedAt: 9 }),
  ]);
  assert.deepEqual(notes.map((note) => note.id), ['new', 'old']);
});

test('the search reads the note itself', () => {
  // The whole point: the judge never tagged this problem "overflow", you did.
  const [note] = collectNotes([problem()]);
  assert.equal(noteMatches(note, 'overflow'), true);
  assert.equal(noteMatches(note, 'OVERFLOW'), true, 'case does not matter');
  assert.equal(noteMatches(note, 'segment tree'), false);
});

test('the search still reads titles, tags and labels', () => {
  const [note] = collectNotes([problem({ labels: ['blind-75'] })]);
  assert.equal(noteMatches(note, 'theatre'), true);
  assert.equal(noteMatches(note, 'math'), true);
  assert.equal(noteMatches(note, 'blind-75'), true);
});

test('an empty search matches everything', () => {
  const [note] = collectNotes([problem()]);
  assert.equal(noteMatches(note, '   '), true);
});

test('complexity travels only when there is some', () => {
  assert.equal(collectNotes([problem()])[0].complexity, undefined);
  assert.deepEqual(
    collectNotes([problem({ complexity: { time: 'O(n)' } })])[0].complexity,
    { time: 'O(n)' },
  );
});

test('the excerpt is the first line that says something', () => {
  assert.equal(excerpt('\n\nsort by right end\nthen greedy'), 'sort by right end');
  assert.equal(excerpt(''), '');
});

test('a long first line is cut, not wrapped into the list', () => {
  const long = 'x'.repeat(200);
  const cut = excerpt(long, 20);
  assert.equal(cut.length, 20);
  assert.ok(cut.endsWith('…'));
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { collapse, describe, diffLines, summarise } from '../src/core/resolve-diff.ts';

const ops = (before, after) => diffLines(before, after).map((line) => `${line.op[0]}${line.text}`);

/* ------------------------------------------------------------------- diff */

test('an unchanged file has nothing added or removed', () => {
  assert.deepEqual(ops('a\nb\nc', 'a\nb\nc'), ['sa', 'sb', 'sc']);
});

test('an inserted line is an insertion, not a rewrite of everything after it', () => {
  // A naive line-by-line comparison marks every line after an insertion as
  // changed, which turns "I added a guard clause" into "I rewrote the function".
  assert.deepEqual(ops('a\nb\nc', 'a\nx\nb\nc'), ['sa', 'ax', 'sb', 'sc']);
});

test('a deleted line is a deletion', () => {
  assert.deepEqual(ops('a\nb\nc', 'a\nc'), ['sa', 'rb', 'sc']);
});

test('a replaced line reads as one out and one in', () => {
  assert.deepEqual(ops('a\nb\nc', 'a\nB\nc'), ['sa', 'rb', 'aB', 'sc']);
});

test('trailing whitespace is not a change', () => {
  // Editors add and strip it constantly and nobody means anything by it.
  assert.deepEqual(ops('a\nb\n\n', 'a\nb'), ['sa', 'sb']);
});

test('two enormous files are reported by size rather than diffed', () => {
  // The table is O(n·m). A thousand lines each is a million cells for a panel
  // nobody is going to read line by line anyway.
  const big = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
  const diff = diffLines(big, `${big}\nextra`, 100);
  assert.equal(diff.length, 2);
  assert.match(diff[0].text, /^\d+ lines$/);
});

/* --------------------------------------------------------------- collapse */

test('long unchanged stretches are collapsed, with context kept', () => {
  const lines = diffLines(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n'),
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'Z'].join('\n'),
  );
  const shown = collapse(lines, 1);

  assert.equal(shown[0].op, 'gap', 'the untouched run at the top is folded away');
  assert.ok(shown.some((line) => line.op === 'added' && line.text === 'Z'));
  assert.ok(shown.some((line) => line.op === 'same' && line.text === 'g'), 'one line of context');
});

/* ---------------------------------------------------------------- summary */

const version = (code, at, extra = {}) => ({ code, language: 'python', solvedAt: at, ...extra });
const DAY = 86_400_000;

test('a shorter second attempt says so, in both directions', () => {
  const summary = summarise(
    version('a\nb\nc\nd', 0),
    version('a\nd', 90 * DAY),
  );

  assert.equal(summary.linesBefore, 4);
  assert.equal(summary.linesAfter, 2);
  assert.equal(summary.daysApart, 90);
  assert.match(describe(summary), /4 lines down to 2/);
});

test('a solution with nothing in common is called a rewrite', () => {
  // Which is the interesting case — editing your old answer and writing a new
  // one from memory are very different things to have done.
  const summary = summarise(
    version('def solve():\n    return brute_force()', 0),
    version('import heapq\n\nclass Solver:\n    pass', 60 * DAY),
  );

  assert.equal(summary.rewritten, true);
  assert.match(describe(summary), /^Written again from scratch/);
});

test('an edited solution is not called a rewrite', () => {
  const before = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
  const after = before.replace('line 5', 'line five');
  assert.equal(summarise(version(before, 0), version(after, DAY)).rewritten, false);
});

test('an identical re-solve after two days says nothing at all', () => {
  // It is a copy-paste, not a finding, and inventing a sentence about it is
  // how a feature becomes noise.
  assert.equal(describe(summarise(version('same', 0), version('same', 2 * DAY))), undefined);
});

test('an identical re-solve months later is worth mentioning', () => {
  const sentence = describe(summarise(version('same', 0), version('same', 100 * DAY)));
  assert.match(sentence, /Character for character/);
});

test('a quicker second attempt is reported, a slower one too', () => {
  const faster = summarise(
    version('a', 0, { solveTimeMs: 30 * 60_000 }),
    version('b', DAY, { solveTimeMs: 10 * 60_000 }),
  );
  assert.equal(faster.fasterBy, 20 * 60_000);
  assert.match(describe(faster), /20 min quicker/);

  const slower = summarise(
    version('a', 0, { solveTimeMs: 10 * 60_000 }),
    version('b', DAY, { solveTimeMs: 25 * 60_000 }),
  );
  assert.match(describe(slower), /15 min slower/);
});

test('timing is left out when only one of the two was measured', () => {
  const summary = summarise(version('a', 0), version('b', DAY, { solveTimeMs: 60_000 }));
  assert.equal(summary.fasterBy, undefined);
  assert.equal(summary.slowerBy, undefined);
});

test('your own complexity note is quoted, and only when it changed', () => {
  // The code has no way to know whether your algorithm actually improved, and
  // a confident wrong claim about that is worse than saying nothing. What it
  // can do is repeat back the two notes you wrote yourself.
  const changed = summarise(version('a', 0), version('b', DAY), {
    before: 'O(n^2)',
    after: 'O(n log n)',
  });
  assert.match(describe(changed), /O\(n\^2\) to O\(n log n\)/);

  const same = summarise(version('a', 0), version('b', DAY), { before: 'O(n)', after: 'O(n)' });
  assert.doesNotMatch(describe(same), /complexity/);

  const missing = summarise(version('a', 0), version('b', DAY), { after: 'O(n)' });
  assert.doesNotMatch(describe(missing), /complexity/);
});

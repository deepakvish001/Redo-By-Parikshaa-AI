import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPrompt,
  cacheKey,
  freeze,
  isFaithful,
  isFresh,
  labelFor,
  parseNumbered,
  placeholder,
  thaw,
} from '../src/core/translate.ts';

/* ------------------------------------------------------------- freezing */

test('inline maths is frozen, not translated', () => {
  // Codeforces writes inline maths as $$$…$$$. A translator handed "a_i" will
  // happily turn it into a word, and the problem stops meaning what it meant.
  const segment = freeze('Find the largest $$$a_i$$$ such that $$$i \\le n$$$.');
  assert.equal(segment.frozen.length, 2);
  assert.equal(segment.text, `Find the largest ${placeholder(0)} such that ${placeholder(1)}.`);
  assert.equal(segment.frozen[0], '$$$a_i$$$');
});

test('backticked code is frozen too', () => {
  const segment = freeze('Print `YES` or `NO`.');
  assert.deepEqual(segment.frozen, ['`YES`', '`NO`']);
});

test('prose with no maths is left whole', () => {
  const segment = freeze('Alice and Bob play a game.');
  assert.deepEqual(segment.frozen, []);
  assert.equal(segment.text, 'Alice and Bob play a game.');
});

test('what was frozen comes back exactly', () => {
  const source = 'The answer is $$$n^2$$$ for `n > 0`.';
  const segment = freeze(source);
  assert.equal(thaw(segment.text, segment.frozen), source);
});

test('a translated sentence gets its formulas back in their new positions', () => {
  const segment = freeze('Print $$$x$$$ then $$$y$$$.');
  // Word order differs in the target language; the markers move with it.
  const translated = `${placeholder(1)} फिर ${placeholder(0)} छापें।`;
  assert.equal(thaw(translated, segment.frozen), '$$$y$$$ फिर $$$x$$$ छापें।');
});

/* ---------------------------------------------------------- faithfulness */

test('a translation that kept every marker once is faithful', () => {
  assert.equal(isFaithful(`${placeholder(0)} और ${placeholder(1)}`, ['a', 'b']), true);
});

test('a dropped marker is rejected', () => {
  // A formula silently missing from the middle of a sentence changes what the
  // problem is asking. Refusing is the only safe answer.
  assert.equal(isFaithful(`${placeholder(0)} और`, ['a', 'b']), false);
});

test('a duplicated marker is rejected', () => {
  assert.equal(
    isFaithful(`${placeholder(0)} ${placeholder(0)} ${placeholder(1)}`, ['a', 'b']),
    false,
  );
});

test('an invented marker is rejected', () => {
  assert.equal(isFaithful(`${placeholder(0)} ${placeholder(7)}`, ['a']), false);
});

test('prose with no markers at all is faithful', () => {
  assert.equal(isFaithful('कोई सूत्र नहीं', []), true);
});

/* ------------------------------------------------------------- the batch */

test('the prompt names the language and numbers the lines', () => {
  const prompt = buildPrompt('hi', ['one', 'two']);
  assert.match(prompt, /into Hindi/);
  assert.match(prompt, /^1\. one$/m);
  assert.match(prompt, /^2\. two$/m);
  assert.match(prompt, /Never translate, renumber, drop or duplicate one/);
});

test('numbered lines are read back in order', () => {
  assert.deepEqual(parseNumbered('1. एक\n2. दो', 2), ['एक', 'दो']);
});

test('a wrapped line stays with the line it belongs to', () => {
  const parsed = parseNumbered('1. पहली पंक्ति\nजारी है\n2. दूसरी', 2);
  assert.equal(parsed[0], 'पहली पंक्ति\nजारी है');
  assert.equal(parsed[1], 'दूसरी');
});

test('the wrong number of lines is refused rather than paired up by position', () => {
  // A model that merged two sentences would otherwise put the wrong
  // translation under the wrong paragraph, silently.
  assert.equal(parseNumbered('1. only one', 2), undefined);
  assert.equal(parseNumbered('1. a\n2. b\n3. c', 2), undefined);
});

/* -------------------------------------------------------------- the cache */

test('the cache is keyed by problem and language together', () => {
  assert.equal(cacheKey('1352A', 'hi'), '1352A:hi');
  assert.notEqual(cacheKey('1352A', 'hi'), cacheKey('1352A', 'es'));
});

test('a translation older than a day is not reused', () => {
  const now = Date.UTC(2026, 0, 2);
  assert.equal(isFresh({ key: 'k', strings: {}, at: now - 1000 }, now), true);
  assert.equal(isFresh({ key: 'k', strings: {}, at: now - 25 * 3600_000 }, now), false);
  assert.equal(isFresh(undefined, now), false);
});

test('every offered language has a readable name', () => {
  assert.equal(labelFor('hi'), 'Hindi');
  assert.equal(labelFor('xx'), 'xx', 'an unknown code is shown as itself rather than blank');
});

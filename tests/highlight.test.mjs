import test from 'node:test';
import assert from 'node:assert/strict';
import { isTitleLink, slugFromHref } from '../src/content/parikshaa-highlight.ts';

test('problem slugs are read out of Parikshaa links', () => {
  assert.equal(slugFromHref('/library/problems/two-sum'), 'two-sum');
  assert.equal(slugFromHref('https://parikshaa.org/library/problems/word-break'), 'word-break');
  assert.equal(slugFromHref('/library/problems/two-sum?tab=notes'), 'two-sum');
  assert.equal(slugFromHref('/library/problems/two-sum#discussion'), 'two-sum');
});

test('links that are not problem links are ignored', () => {
  assert.equal(slugFromHref('/library'), null);
  assert.equal(slugFromHref('/library/problems/weekly/../x'), 'weekly');
  assert.equal(slugFromHref('/sheets/dsa'), null);
  assert.equal(slugFromHref(''), null);
});

test('only the title link in a problem card gets badged', () => {
  assert.equal(isTitleLink('Two Sum'), true);
  assert.equal(isTitleLink('Longest Palindromic Substring'), true);
  // A card repeats the same href on its action button and icon links.
  assert.equal(isTitleLink('Solve →'), false);
  assert.equal(isTitleLink('  Continue  '), false);
  assert.equal(isTitleLink('View'), false);
  assert.equal(isTitleLink(''), false);
  assert.equal(isTitleLink('   '), false);
});

test('a title that merely starts with an action word is still a title', () => {
  // "Solved" and "Starting" are not the bare action labels we filter on.
  assert.equal(isTitleLink('Solved Sudoku'), true);
  assert.equal(isTitleLink('Viewing Angles'), true);
});

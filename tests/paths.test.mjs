import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extensionForLanguage,
  normalizeProblemId,
  notesPath,
  problemKey,
  slugify,
  solutionPath,
} from '../src/core/paths.ts';

function makeProblem(overrides = {}) {
  return {
    id: 'leetcode:two-sum',
    platform: 'leetcode',
    problemId: '1',
    slug: 'two-sum',
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'easy',
    tags: ['array', 'hash table'],
    language: 'Python3',
    code: 'print(1)',
    solvedAt: 0,
    attempts: 1,
    github: { status: 'pending' },
    revision: { stage: 0, ease: 1, dueAt: 0, reviewCount: 0, lapses: 0 },
    ...overrides,
  };
}

test('LeetCode language slugs map to file extensions', () => {
  assert.equal(extensionForLanguage('python3'), 'py');
  assert.equal(extensionForLanguage('cpp'), 'cpp');
  assert.equal(extensionForLanguage('golang'), 'go');
  assert.equal(extensionForLanguage('csharp'), 'cs');
  assert.equal(extensionForLanguage('typescript'), 'ts');
});

test('Codeforces language labels fall back to keyword matching', () => {
  // The longest keyword has to win, or "GNU C++17" would match plain "c".
  assert.equal(extensionForLanguage('GNU C++17 (64)'), 'cpp');
  assert.equal(extensionForLanguage('GNU G++20 13.2 (64 bit, winlibs)'), 'cpp');
  assert.equal(extensionForLanguage('Clang++20 Diagnostics'), 'cpp');
  assert.equal(extensionForLanguage('GNU C11'), 'c');
  assert.equal(extensionForLanguage('Node.js 15.8.0 (64bit)'), 'js');
  assert.equal(extensionForLanguage('Delphi 7 Win32'), 'pas');
  assert.equal(extensionForLanguage('PyPy 3-64 (7.3.15)'), 'py');
  assert.equal(extensionForLanguage('Java 21 64bit'), 'java');
  assert.equal(extensionForLanguage('Kotlin 1.9.21'), 'kt');
});

test('an unknown language still produces a committable file', () => {
  assert.equal(extensionForLanguage('Whitespace'), 'txt');
  assert.equal(extensionForLanguage(''), 'txt');
});

test('slugify strips punctuation and collapses separators', () => {
  assert.equal(slugify('Two Sum'), 'two-sum');
  assert.equal(slugify('Best Time to Buy & Sell Stock II'), 'best-time-to-buy-sell-stock-ii');
  assert.equal(slugify('  --Trim--  '), 'trim');
  assert.equal(slugify('A'.repeat(200)).length, 80);
});

test('numeric ids are padded so directories sort naturally', () => {
  assert.equal(normalizeProblemId('1'), '0001');
  assert.equal(normalizeProblemId('1768'), '1768');
  assert.equal(normalizeProblemId('12345'), '12345');
  assert.equal(normalizeProblemId('1352a'), '1352A');
});

test('paths group by platform and difficulty', () => {
  const problem = makeProblem();
  assert.equal(solutionPath(problem), 'leetcode/easy/0001-two-sum/solution.py');
  assert.equal(notesPath(problem), 'leetcode/easy/0001-two-sum/README.md');
});

test('unrated problems skip the difficulty directory', () => {
  const problem = makeProblem({
    platform: 'codeforces',
    problemId: '1352A',
    slug: '1352A',
    title: 'Sum of Round Numbers',
    difficulty: 'unknown',
    language: 'GNU C++17',
  });
  assert.equal(solutionPath(problem), 'codeforces/1352A-sum-of-round-numbers/solution.cpp');
});

test('problem keys namespace the slug by platform', () => {
  assert.equal(problemKey('leetcode', 'two-sum'), 'leetcode:two-sum');
  assert.notEqual(problemKey('leetcode', '1A'), problemKey('codeforces', '1A'));
});

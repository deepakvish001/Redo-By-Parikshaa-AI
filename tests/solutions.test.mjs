import assert from 'node:assert/strict';
import test from 'node:test';

import { solutionFile, solutionFiles, solutionPath } from '../src/core/paths.ts';
import { buildIndexReadme, buildProblemReadme } from '../src/core/markdown.ts';

function problem(extra = {}) {
  return {
    id: 'codeforces:2000C',
    platform: 'codeforces',
    problemId: '2000C',
    slug: '2000C',
    title: 'Numeric String Template',
    url: 'https://codeforces.com/contest/2000/problem/C',
    difficulty: 'medium',
    tags: ['strings', 'greedy'],
    language: 'GNU C++20 (64)',
    code: 'int main(){}',
    solvedAt: Date.parse('2026-03-01T10:00:00Z'),
    attempts: 2,
    github: { status: 'synced', path: 'codeforces/medium/2000C-numeric/solution.cpp' },
    parikshaa: { status: 'disabled' },
    revision: { stage: 1, ease: 1, dueAt: 0, reviewCount: 0, lapses: 0, hintsUsed: 0 },
    ...extra,
  };
}

test('a record with no per-language history still has its one file', () => {
  // Everything solved before this existed only has the flat `code` field.
  const files = solutionFiles(problem());
  assert.equal(files.length, 1);
  assert.equal(files[0].path, solutionPath(problem()));
  assert.equal(files[0].content, 'int main(){}');
});

test('two languages are two files, side by side', () => {
  // The bug: solving in C++ and then Python overwrote the C++ file.
  const files = solutionFiles(
    problem({
      solutions: {
        cpp: { language: 'GNU C++20 (64)', code: 'int main(){}', solvedAt: 1 },
        py: { language: 'Python 3.8.10', code: 'print(1)', solvedAt: 2 },
      },
    }),
  );

  assert.equal(files.length, 2);
  assert.deepEqual(
    files.map((file) => file.path.split('/').pop()).sort(),
    ['solution.cpp', 'solution.py'],
  );
});

test('re-solving in a newer dialect replaces the file rather than adding one', () => {
  // GNU C++17 and GNU C++20 are the same file; keying by extension is what
  // makes that true without a special case.
  const files = solutionFiles(
    problem({
      solutions: {
        cpp: { language: 'GNU C++20 (64)', code: 'newer', solvedAt: 2 },
      },
    }),
  );

  assert.equal(files.length, 1);
  assert.equal(files[0].content, 'newer');
  assert.equal(files[0].language, 'GNU C++20 (64)');
});

test('the newest language comes first', () => {
  const files = solutionFiles(
    problem({
      solutions: {
        cpp: { language: 'C++', code: 'a', solvedAt: 1 },
        py: { language: 'Python', code: 'b', solvedAt: 5 },
        java: { language: 'Java', code: 'c', solvedAt: 3 },
      },
    }),
  );
  assert.deepEqual(files.map((file) => file.language), ['Python', 'Java', 'C++']);
});

test('every file lands in the problem’s own folder', () => {
  const one = problem();
  assert.equal(solutionFile(one, 'py'), `${solutionPath(one).replace(/[^/]+$/, '')}solution.py`);
});

test('the README names every language, newest first', () => {
  const readme = buildProblemReadme(
    problem({
      solutions: {
        cpp: { language: 'GNU C++20 (64)', code: 'a', solvedAt: 1 },
        py: { language: 'Python 3.8.10', code: 'b', solvedAt: 5 },
      },
    }),
  );

  assert.match(readme, /\*\*Language:\*\* Python 3\.8\.10, GNU C\+\+20 \(64\)/);
  assert.match(readme, /## Solutions/);
  assert.match(readme, /solution\.py/);
  assert.match(readme, /solution\.cpp/);
});

test('one language gets no Solutions section — the folder already says it', () => {
  assert.ok(!buildProblemReadme(problem()).includes('## Solutions'));
});

test('the index groups problems by topic as well as listing them', () => {
  const index = buildIndexReadme(
    [problem(), problem({ id: 'x', problemId: '1A', title: 'Theatre Square', tags: ['math'] })],
    Date.now(),
  );

  assert.match(index, /## By topic/);
  assert.match(index, /<summary><b>strings<\/b> — 1<\/summary>/);
  assert.match(index, /<summary><b>math<\/b> — 1<\/summary>/);
});

test('an untagged repository gets no empty topic section', () => {
  const index = buildIndexReadme([problem({ tags: [] })], Date.now());
  assert.ok(!index.includes('## By topic'));
});

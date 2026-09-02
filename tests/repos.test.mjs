import assert from 'node:assert/strict';
import test from 'node:test';

import { readRepos } from '../src/core/github.ts';

const ROWS = [
  {
    full_name: 'deepak/old-notes',
    default_branch: 'master',
    private: false,
    permissions: { push: true },
    pushed_at: '2024-01-01T00:00:00Z',
  },
  {
    full_name: 'deepak/dsa-solutions',
    default_branch: 'main',
    private: true,
    permissions: { push: true },
    pushed_at: '2026-08-30T00:00:00Z',
  },
  {
    full_name: 'someorg/shared-repo',
    default_branch: 'develop',
    private: false,
    permissions: { push: false },
    pushed_at: '2026-05-01T00:00:00Z',
  },
];

test('the repository you last pushed to is first', () => {
  // The picker's whole point is not having to hunt, and the repository somebody
  // is actually working in is the one they touched most recently.
  assert.deepEqual(
    readRepos(ROWS).map((repo) => repo.fullName),
    ['deepak/dsa-solutions', 'someorg/shared-repo', 'deepak/old-notes'],
  );
});

test('the owner and name are split out, and the default branch kept', () => {
  const repo = readRepos(ROWS).find((row) => row.name === 'dsa-solutions');
  assert.equal(repo.owner, 'deepak');
  assert.equal(repo.defaultBranch, 'main');
  assert.equal(repo.private, true);
});

test('a repository you cannot write to is listed and marked, not hidden', () => {
  // "My repository is missing" is a worse puzzle than "it is there, greyed out".
  const shared = readRepos(ROWS).find((row) => row.fullName === 'someorg/shared-repo');
  assert.equal(shared.canPush, false);
});

test('a row missing its full name is skipped rather than half-read', () => {
  assert.deepEqual(readRepos([{ default_branch: 'main' }, { full_name: 'nope' }]), []);
});

test('a body that is not a list is no repositories, not a crash', () => {
  // GitHub answers an error as an object, and the picker must not explode on it.
  assert.deepEqual(readRepos({ message: 'Bad credentials' }), []);
  assert.deepEqual(readRepos(undefined), []);
});

test('a repository with no default branch is assumed to be on main', () => {
  const [repo] = readRepos([{ full_name: 'a/b', permissions: { push: true } }]);
  assert.equal(repo.defaultBranch, 'main');
  assert.equal(repo.pushedAt, 0, 'an unparseable date sorts last rather than to now');
});

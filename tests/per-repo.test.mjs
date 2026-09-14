import assert from 'node:assert/strict';
import test from 'node:test';

import { configFor, hasOverride, repoKey } from '../src/core/github.ts';
import { DEFAULT_SETTINGS } from '../src/core/storage.ts';

const base = (perPlatform = {}) => ({
  ...DEFAULT_SETTINGS.github,
  token: 'tok',
  owner: 'deepak',
  repo: 'dsa',
  branch: 'main',
  perPlatform,
});

test('a judge with no entry goes to the default repository', () => {
  // One repository for everything is what most people want and what everybody
  // starts with, so it must need no setup at all.
  const config = configFor(base(), 'leetcode');
  assert.equal(config.owner, 'deepak');
  assert.equal(config.repo, 'dsa');
  assert.equal(hasOverride(base(), 'leetcode'), false);
});

test('a judge with its own repository goes there instead', () => {
  const github = base({ leetcode: { owner: 'deepak', repo: 'leetcode-solutions', branch: 'main' } });
  const config = configFor(github, 'leetcode');

  assert.equal(config.repo, 'leetcode-solutions');
  assert.equal(hasOverride(github, 'leetcode'), true);
  assert.equal(configFor(github, 'codeforces').repo, 'dsa', 'the others are untouched');
});

test('the token is shared; only the destination changes', () => {
  // One token, several repositories. Asking for a token per judge would be
  // three tokens to leak instead of one.
  const github = base({ atcoder: { owner: 'me', repo: 'atc', branch: 'main' } });
  assert.equal(configFor(github, 'atcoder').token, 'tok');
  assert.equal(configFor(github, 'atcoder').commitMessage, github.commitMessage);
});

test('a half-filled override is ignored rather than committed to', () => {
  // An override missing its repository would otherwise address
  // `deepak/undefined` and fail every sync with a 404 — a long way to travel to
  // learn that a field was left blank.
  assert.equal(configFor(base({ cses: { owner: 'me', repo: '', branch: 'main' } }), 'cses').repo, 'dsa');
  assert.equal(configFor(base({ cses: { owner: '  ', repo: 'x', branch: '' } }), 'cses').repo, 'dsa');
});

test('an override with no branch inherits the default’s', () => {
  const github = { ...base({ hackerrank: { owner: 'me', repo: 'hr', branch: '' } }), branch: 'trunk' };
  assert.equal(configFor(github, 'hackerrank').branch, 'trunk');
});

test('two judges pointed at one repository share it', () => {
  // Which is what decides whether their problems land in the same index.
  const github = base({
    leetcode: { owner: 'me', repo: 'shared', branch: 'main' },
    atcoder: { owner: 'me', repo: 'shared', branch: 'main' },
  });

  assert.equal(repoKey(configFor(github, 'leetcode')), repoKey(configFor(github, 'atcoder')));
  assert.notEqual(repoKey(configFor(github, 'leetcode')), repoKey(configFor(github, 'cses')));
});

test('the same repository on a different branch is a different destination', () => {
  const github = base({ leetcode: { owner: 'deepak', repo: 'dsa', branch: 'solutions' } });
  assert.notEqual(repoKey(configFor(github, 'leetcode')), repoKey(github));
});

test('an index is built from the problems that repository actually holds', () => {
  // The rule sync.ts applies. A repository holding your LeetCode solves that
  // lists Codeforces problems it does not contain would be lying about itself.
  const github = base({ leetcode: { owner: 'me', repo: 'lc', branch: 'main' } });
  const problems = [
    { id: '1', platform: 'leetcode' },
    { id: '2', platform: 'codeforces' },
    { id: '3', platform: 'leetcode' },
    { id: '4', platform: 'atcoder' },
  ];

  const inRepo = (platform) =>
    problems.filter(
      (problem) =>
        repoKey(configFor(github, problem.platform)) === repoKey(configFor(github, platform)),
    );

  assert.deepEqual(inRepo('leetcode').map((p) => p.id), ['1', '3']);
  assert.deepEqual(inRepo('codeforces').map((p) => p.id), ['2', '4'], 'both still on the default');
});

test('with no overrides every problem is still in the one index', () => {
  const github = base();
  const problems = [{ platform: 'leetcode' }, { platform: 'codeforces' }, { platform: 'cses' }];
  const keys = new Set(problems.map((p) => repoKey(configFor(github, p.platform))));
  assert.equal(keys.size, 1, 'nothing changes for somebody who never opens this setting');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { bridgeOrigin, bridgeUrl, buildPayload, isValidPort } from '../src/core/bridge.ts';

const problem = (over = {}) => ({
  id: 'codeforces:1352A',
  platform: 'codeforces',
  problemId: '1352A',
  slug: '1352A',
  title: 'Sum of Round Numbers',
  url: 'https://codeforces.com/problemset/problem/1352/A',
  difficulty: 'easy',
  tags: ['math'],
  language: 'GNU G++20 13.2',
  code: 'int main(){}',
  note: '  split the digits  ',
  attempts: 2,
  solvedAt: 1_700_000_000_000,
  ...over,
});

test('the payload is versioned from the first release', () => {
  // A listener written today has to be able to tell a payload it understands
  // from one it does not, rather than guessing.
  assert.equal(buildPayload(problem()).redo, 1);
});

test('the payload carries the extension so a listener need not map languages', () => {
  const payload = buildPayload(problem());
  assert.equal(payload.extension, 'cpp');
  assert.equal(payload.path, 'codeforces/easy/1352A-sum-of-round-numbers/solution.cpp');
});

test('a blank note is absent rather than empty', () => {
  assert.equal(buildPayload(problem({ note: '   ' })).note, undefined);
  assert.equal(buildPayload(problem()).note, 'split the digits');
});

test('the address is 127.0.0.1, not localhost', () => {
  // "localhost" can resolve to ::1, a listener bound to IPv4 is then
  // unreachable, and the failure reads as "the bridge is broken".
  assert.equal(bridgeUrl(7777), 'http://127.0.0.1:7777/redo');
  assert.equal(bridgeOrigin(7777), 'http://127.0.0.1:7777/*');
});

test('privileged and impossible ports are refused', () => {
  assert.equal(isValidPort(7777), true);
  assert.equal(isValidPort(80), false, 'a privileged port is not somewhere a user process listens');
  assert.equal(isValidPort(0), false);
  assert.equal(isValidPort(70000), false);
  assert.equal(isValidPort(7777.5), false);
});

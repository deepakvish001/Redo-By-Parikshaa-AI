import assert from 'node:assert/strict';
import test from 'node:test';

import { isAnyHost, isHost } from '../src/core/hosts.ts';

test('a domain owns itself and its subdomains', () => {
  assert.equal(isHost('codeforces.com', 'codeforces.com'), true);
  assert.equal(isHost('m2.codeforces.com', 'codeforces.com'), true);
  assert.equal(isHost('a.b.codeforces.com', 'codeforces.com'), true);
});

test('a domain does not own a name that merely ends with it', () => {
  // `hostname.endsWith('leetcode.com')` is the obvious way to write this check
  // and it is wrong — which is what this whole module exists to stop.
  assert.equal(isHost('notleetcode.com', 'leetcode.com'), false);
  assert.equal(isHost('myleetcode.com', 'leetcode.com'), false);
  assert.equal(isHost('fakecodeforces.com', 'codeforces.com'), false);
  assert.equal(isHost('codeforces.com.evil.test', 'codeforces.com'), false);
});

test('the comparison ignores case, because hostnames do', () => {
  assert.equal(isHost('LeetCode.COM', 'leetcode.com'), true);
  assert.equal(isHost('M2.Codeforces.com', 'CODEFORCES.COM'), true);
});

test('several domains can be asked about at once', () => {
  const judges = ['leetcode.com', 'leetcode.cn'];
  assert.equal(isAnyHost('leetcode.cn', judges), true);
  assert.equal(isAnyHost('www.leetcode.com', judges), true);
  assert.equal(isAnyHost('notleetcode.cn', judges), false);
  assert.equal(isAnyHost('codeforces.com', judges), false);
});

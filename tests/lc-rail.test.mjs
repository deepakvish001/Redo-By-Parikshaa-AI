import assert from 'node:assert/strict';
import test from 'node:test';

import { leetcodeRail, parseSlug } from '../src/content/mounts/lc-rail.ts';

const at = (href) => new URL(href);

test('the slug is read from a problem URL and its tabs', () => {
  // LeetCode hangs the description, submissions, editorial and solutions off
  // the same path, and the card belongs on all of them.
  assert.equal(parseSlug('/problems/two-sum/'), 'two-sum');
  assert.equal(parseSlug('/problems/two-sum'), 'two-sum');
  assert.equal(parseSlug('/problems/two-sum/submissions/'), 'two-sum');
  assert.equal(parseSlug('/problems/two-sum/description/'), 'two-sum');
});

test('pages that are not a problem yield no slug', () => {
  assert.equal(parseSlug('/problemset/all/'), undefined);
  assert.equal(parseSlug('/contest/weekly-contest-400/'), undefined);
  assert.equal(parseSlug('/'), undefined);
});

test('the rail matches leetcode problem pages on both domains', () => {
  assert.equal(leetcodeRail.matches(at('https://leetcode.com/problems/two-sum/')), true);
  assert.equal(leetcodeRail.matches(at('https://leetcode.cn/problems/two-sum/')), true);
});

test('the rail stays off everywhere else', () => {
  // Including Codeforces, which has a rail of its own — two cards on one page
  // would be the obvious way to get this wrong.
  assert.equal(leetcodeRail.matches(at('https://leetcode.com/problemset/all/')), false);
  assert.equal(leetcodeRail.matches(at('https://codeforces.com/contest/1/problem/A')), false);
  assert.equal(leetcodeRail.matches(at('https://notleetcode.com/problems/two-sum/')), false);
});

test('the rail follows the same switch as the Codeforces one', () => {
  // One "sidebar card on problem pages" setting, not one per judge — the two
  // are the same feature on two sites.
  const page = (rail) => ({ page: { rail } });
  assert.equal(leetcodeRail.enabled(page(true)), true);
  assert.equal(leetcodeRail.enabled(page(false)), false);
});

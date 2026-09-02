import assert from 'node:assert/strict';
import test from 'node:test';

import { findEditorial, readMaterials, similarProblems } from '../src/core/cf-materials.ts';

/* ---------------------------------------------------------- the editorial */

const CONTEST_PAGE = `
<html><body>
<div id="content">
  <a href="/blog/entry/99999">Someone's unrelated blog post</a>
  <table class="problems">
    <tr><td><a href="/contest/1900/problem/A">A</a></td></tr>
  </table>
  <div id="sidebar">
    <div class="roundbox sidebox">
      <div class="caption titled">→ Contest materials</div>
      <ul>
        <li><span class="rtl"><a href="/blog/entry/123400">Announcement (Codeforces Round 900)</a></span></li>
        <li><span class="rtl"><a href="/blog/entry/123456">Codeforces Round 900 Editorial</a></span></li>
      </ul>
    </div>
    <div class="roundbox">→ Top rated<ul><li><a href="/blog/entry/1">Something else</a></li></ul></div>
  </div>
</div>
</body></html>`;

test('materials are read from the contest materials box and nowhere else', () => {
  // A contest page is full of blog links — announcements, comments, the top
  // rated list. Taking them all would hand back a reading list.
  const materials = readMaterials(CONTEST_PAGE);
  assert.deepEqual(materials.map((m) => m.title), [
    'Announcement (Codeforces Round 900)',
    'Codeforces Round 900 Editorial',
  ]);
  assert.equal(materials[1].url, 'https://codeforces.com/blog/entry/123456');
});

test('the announcement is not offered as the editorial', () => {
  // It is posted before the round and gives nothing away — sending somebody who
  // is stuck to a page about the start time is worse than sending them nowhere.
  assert.match(findEditorial(readMaterials(CONTEST_PAGE)).title, /Editorial$/);
});

test('a tutorial and a Russian разбор both count', () => {
  const page = (label) =>
    `<div>Contest materials<ul><li><a href="/blog/entry/1">${label}</a></li></ul></div>`;

  assert.ok(findEditorial(readMaterials(page('Tutorial (en)'))));
  assert.ok(findEditorial(readMaterials(page('Разбор задач'))));
});

test('a contest with no editorial yet yields nothing, not a wrong link', () => {
  const page = `<div>Contest materials<ul>
    <li><a href="/blog/entry/1">Announcement</a></li>
  </ul></div>`;
  assert.equal(findEditorial(readMaterials(page)), undefined);
});

test('a page with no materials box at all is no materials', () => {
  assert.deepEqual(readMaterials('<html><a href="/blog/entry/5">Blog</a></html>'), []);
  assert.deepEqual(readMaterials(''), []);
});

/* ------------------------------------------------------ something similar */

const POOL = [
  { key: '1900A', name: 'Exact match', rating: 1500, tags: ['dp', 'greedy'] },
  { key: '1900B', name: 'One tag, same rating', rating: 1500, tags: ['dp', 'trees'] },
  { key: '1900C', name: 'Two tags, further away', rating: 1700, tags: ['dp', 'greedy'] },
  { key: '1900D', name: 'No tags in common', rating: 1500, tags: ['strings'] },
  { key: '1900E', name: 'Way out of range', rating: 2600, tags: ['dp', 'greedy'] },
  { key: '1900F', name: 'Already solved', rating: 1500, tags: ['dp', 'greedy'] },
];

const current = { key: '1900Z', rating: 1500, tags: ['dp', 'greedy'] };

test('more shared tags beats a closer rating', () => {
  // The point is more practice at the *idea*; the rating only has to be close
  // enough to be worth attempting.
  const similar = similarProblems(current, POOL, new Set(['1900F']));
  assert.deepEqual(similar.map((p) => p.key), ['1900A', '1900C', '1900B']);
});

test('solved problems and the problem itself are left out', () => {
  const similar = similarProblems(current, POOL, new Set(['1900F']));
  assert.ok(!similar.some((p) => p.key === '1900F'));
  assert.ok(!similar.some((p) => p.key === '1900Z'));
});

test('nothing in common and nothing in range is left out', () => {
  const keys = similarProblems(current, POOL, new Set()).map((p) => p.key);
  assert.ok(!keys.includes('1900D'), 'no shared tags');
  assert.ok(!keys.includes('1900E'), '1100 points away');
});

test('why each one is offered comes with it', () => {
  const [first] = similarProblems(current, POOL, new Set());
  assert.deepEqual(first.shared, ['dp', 'greedy']);
  assert.equal(first.url, 'https://codeforces.com/contest/1900/problem/A');
});

test('the same problem always offers the same three', () => {
  // Ties break on the key, so opening a problem twice does not reshuffle it.
  const once = similarProblems(current, POOL, new Set()).map((p) => p.key);
  const twice = similarProblems(current, [...POOL].reverse(), new Set()).map((p) => p.key);
  assert.deepEqual(once, twice);
});

test('an untagged or unrated problem gets no suggestions rather than random ones', () => {
  assert.deepEqual(similarProblems({ key: 'x', rating: 1500, tags: [] }, POOL, new Set()), []);
  assert.deepEqual(similarProblems({ key: 'x', tags: ['dp'] }, POOL, new Set()), []);
});

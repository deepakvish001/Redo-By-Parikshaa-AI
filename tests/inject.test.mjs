import assert from 'node:assert/strict';
import test from 'node:test';

import { clock } from '../src/content/inject/dom.ts';
import { parseProblem, ratingColour } from '../src/content/mounts/cf-rail.ts';
import { keyFromHref } from '../src/content/mounts/cf-listing.ts';
import { claimSubmissions } from '../src/core/watermark.ts';

/* ------------------------------------------------------- problem matching */

test('every Codeforces problem URL shape yields the same key', () => {
  // The rail has to appear on all of them, and they all mean 1352A.
  assert.deepEqual(parseProblem('/contest/1352/problem/A'), { contestId: '1352', index: 'A' });
  assert.deepEqual(parseProblem('/problemset/problem/1352/A'), { contestId: '1352', index: 'A' });
  assert.deepEqual(parseProblem('/gym/102253/problem/A'), { contestId: '102253', index: 'A' });
});

test('a lower-case index is normalised, as the rest of the extension keys it', () => {
  assert.deepEqual(parseProblem('/contest/2000/problem/c'), { contestId: '2000', index: 'C' });
});

test('multi-character indices survive', () => {
  // Div. 1 + Div. 2 rounds really do have problems E1 and E2.
  assert.deepEqual(parseProblem('/contest/1918/problem/E2'), { contestId: '1918', index: 'E2' });
});

test('pages that are not a problem get no rail', () => {
  assert.equal(parseProblem('/problemset'), null);
  assert.equal(parseProblem('/contest/1352/standings'), null);
  assert.equal(parseProblem('/profile/tourist'), null);
  assert.equal(parseProblem('/'), null);
});

test('a listing link resolves to the same key the rail uses', () => {
  assert.equal(keyFromHref('/contest/2000/problem/C'), '2000C');
  assert.equal(keyFromHref('/problemset/problem/4/A'), '4A');
  assert.equal(keyFromHref('https://codeforces.com/contest/1918/problem/e2'), '1918E2');
  assert.equal(keyFromHref('/contest/2000/standings'), null);
});

/* ------------------------------------------------------------- rank colour */

test('ratings take Codeforces own rank colour', () => {
  // Same ladder the site uses, so a chip means to a reader what it always has.
  const bands = [800, 1200, 1400, 1600, 1900, 2100, 2400].map(ratingColour);
  assert.equal(new Set(bands).size, bands.length, 'each band must be visually distinct');
});

test('a band boundary belongs to the band it opens', () => {
  assert.equal(ratingColour(1200), ratingColour(1350));
  assert.notEqual(ratingColour(1199), ratingColour(1200));
});

test('an unrated problem is coloured as unknown, not as newbie', () => {
  assert.equal(ratingColour(undefined), 'var(--text-faint)');
  assert.notEqual(ratingColour(undefined), ratingColour(800));
});

/* ---------------------------------------------------------------- the clock */

test('the solve clock reads as a clock', () => {
  assert.equal(clock(0), '00:00');
  assert.equal(clock(4_000), '00:04');
  assert.equal(clock(272_000), '04:32');
  assert.equal(clock(3_600_000), '1:00:00');
  assert.equal(clock(7_384_000), '2:03:04');
});

test('a clock never runs backwards', () => {
  // A clock skew between the page and the worker must not print "-00:03".
  assert.equal(clock(-5_000), '00:00');
});

/* -------------------------------------------------- the watermark, on rails */

test('opening a problem page does not re-claim old submissions', () => {
  // The rail and the listing both wake on a page the adapter also scans; the
  // watermark is what keeps that from being three chances to backfill.
  const claim = claimSubmissions('342234879', ['341000001', '342234879']);
  assert.deepEqual(claim.actionable, []);
});

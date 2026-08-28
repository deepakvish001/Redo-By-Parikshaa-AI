import assert from 'node:assert/strict';
import test from 'node:test';

import { claimSubmissions, compareIds, newestId } from '../src/core/watermark.ts';

const HISTORY = ['341000001', '341000002', '342234870', '342234871'];

test('ids compare as numbers, not as strings', () => {
  // A plain string compare puts "9" after "10", which would make every id
  // beginning with a 9 look older than everything else.
  assert.ok(compareIds('9', '10') < 0);
  assert.ok(compareIds('342234880', '342234879') > 0);
  assert.equal(compareIds('100', '100'), 0);
});

test('the newest id is found whatever order they arrive in', () => {
  assert.equal(newestId(['5', '300', '42']), '300');
  assert.equal(newestId([]), undefined);
});

test('the first sight of a judge adopts its history instead of pushing it', () => {
  // This is the bug: opening /problemset/status?my=on committed a year of
  // solved problems in one go.
  const claim = claimSubmissions(undefined, HISTORY);

  assert.deepEqual(claim.actionable, []);
  assert.equal(claim.adopted, true);
  assert.equal(claim.next, '342234871');
});

test('a submission watched being judged is acted on even on that first sight', () => {
  // Otherwise installing the extension and immediately solving something does
  // nothing at all, which reads as broken.
  const claim = claimSubmissions(undefined, [...HISTORY, '342234879'], new Set(['342234879']));

  assert.deepEqual(claim.actionable, ['342234879']);
  assert.equal(claim.next, '342234879');
});

test('only submissions newer than the mark are acted on', () => {
  const claim = claimSubmissions('342234870', [...HISTORY, '342234879']);

  assert.deepEqual(claim.actionable, ['342234871', '342234879']);
  assert.equal(claim.adopted, false);
});

test('everything solved since the last look is acted on, oldest first', () => {
  // Three problems solved before opening the status page is a real case, and
  // all three should be committed — in the order they happened.
  const claim = claimSubmissions('342234870', ['342234875', '342234873', '342234879']);
  assert.deepEqual(claim.actionable, ['342234873', '342234875', '342234879']);
});

test('re-reading the same page a second time acts on nothing', () => {
  const first = claimSubmissions('342234870', [...HISTORY, '342234879']);
  const second = claimSubmissions(first.next, [...HISTORY, '342234879']);

  assert.deepEqual(second.actionable, []);
  assert.equal(second.next, first.next);
});

test('the mark never moves backwards', () => {
  // Paging back through older submissions must not un-see the newest one.
  const claim = claimSubmissions('342234879', ['341000001', '341000002']);
  assert.equal(claim.next, '342234879');
  assert.deepEqual(claim.actionable, []);
});

test('a page with nothing on it leaves the mark alone', () => {
  assert.deepEqual(claimSubmissions('342234879', []), {
    actionable: [],
    next: '342234879',
    adopted: false,
  });
});

test('an empty first sight is not an adoption', () => {
  // Nothing was adopted, so the next page load should still be free to adopt.
  const claim = claimSubmissions(undefined, []);
  assert.equal(claim.adopted, false);
  assert.equal(claim.next, undefined);
});

test('the same id appearing twice is claimed once', () => {
  const claim = claimSubmissions('1', ['5', '5', '7']);
  assert.deepEqual(claim.actionable, ['5', '7']);
});

test('a watched id below the mark is still acted on', () => {
  // Ids come from the judge, not from us; if we watched it being judged, it
  // happened now whatever its number says.
  const claim = claimSubmissions('999', ['5'], new Set(['5']));
  assert.deepEqual(claim.actionable, ['5']);
  assert.equal(claim.next, '999');
});

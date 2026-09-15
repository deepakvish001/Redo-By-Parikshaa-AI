import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLIND_75,
  buildSheet,
  entryKey,
  nextFromSheet,
  normaliseSlug,
  parseSheet,
  parseSheetLine,
  sheetEntryUrl,
  sheetId,
  sheetProgress,
  titleFromSlug,
} from '../src/core/sheets.ts';

const solved = (...keys) =>
  Object.fromEntries(keys.map((key) => [key, { id: key, solvedAt: 1 }]));

const sheet = (entries, over = {}) => ({
  id: 'test', name: 'Test', builtIn: false, addedAt: 0, entries, ...over,
});

const entry = (slug, group, premium) => ({
  platform: 'leetcode', slug, title: titleFromSlug(slug), group, ...(premium ? { premium: true } : {}),
});

/* ---------------------------------------------------------------- parsing */

test('a LeetCode URL is read, whatever else is on the line', () => {
  for (const line of [
    'https://leetcode.com/problems/two-sum/',
    '  https://leetcode.com/problems/two-sum  ',
    '1. https://leetcode.com/problems/two-sum/ — easy',
    '- [Two Sum](https://leetcode.com/problems/two-sum/)',
  ]) {
    const parsed = parseSheetLine(line);
    assert.equal(parsed?.platform, 'leetcode', line);
    assert.equal(parsed?.slug, 'two-sum', line);
  }
});

test('a markdown link keeps the title it was given', () => {
  const parsed = parseSheetLine('- [Best Time to Buy and Sell Stock](https://leetcode.com/problems/best-time-to-buy-and-sell-stock/)');
  assert.equal(parsed.title, 'Best Time to Buy and Sell Stock');
});

test('leetcode.cn counts as LeetCode', () => {
  assert.equal(parseSheetLine('https://leetcode.cn/problems/two-sum/')?.slug, 'two-sum');
});

test('both Codeforces problem URL shapes are read', () => {
  // The problemset copy and the in-contest copy are the same problem, and the
  // rest of the extension keys it as 1899A either way.
  for (const line of [
    'https://codeforces.com/problemset/problem/1899/A',
    'https://codeforces.com/contest/1899/problem/A',
  ]) {
    const parsed = parseSheetLine(line);
    assert.equal(parsed?.platform, 'codeforces', line);
    assert.equal(parsed?.slug, '1899A', line);
  }
});

test('a bare slug is taken as LeetCode and given a readable title', () => {
  const parsed = parseSheetLine('longest-common-subsequence');
  assert.equal(parsed.slug, 'longest-common-subsequence');
  assert.equal(parsed.title, 'Longest Common Subsequence');
});

test('a "Title | slug" row keeps both halves', () => {
  const parsed = parseSheetLine('Course Schedule | course-schedule');
  assert.equal(parsed.slug, 'course-schedule');
  assert.equal(parsed.title, 'Course Schedule');
});

test('a plain title becomes the slug LeetCode would use', () => {
  const parsed = parseSheetLine('Number of Islands');
  assert.equal(parsed.slug, 'number-of-islands');
  assert.equal(parsed.title, 'Number of Islands');
});

test('comments, blanks and one-word lines are not problems', () => {
  for (const line of ['', '   ', '# Arrays', 'Arrays']) {
    assert.equal(parseSheetLine(line), undefined, JSON.stringify(line));
  }
});

test('prose in a pasted README is not turned into problems', () => {
  // Without a guard here every sentence in a pasted file becomes an entry
  // nobody has ever solved, and the sheet fills with rows that can never be
  // ticked off — which looks exactly like a sheet you are failing at.
  for (const line of [
    '{not json',
    'Solve these in order, and do not skip the hard ones.',
    'See https://example.com/notes for why',
    'What should I do next?',
    '???',
  ]) {
    assert.equal(parseSheetLine(line), undefined, JSON.stringify(line));
  }
});

test('a single-word slug with no hyphen is still a problem', () => {
  // `3sum` and `subsets` are real slugs; requiring a hyphen would drop them.
  assert.equal(parseSheetLine('3sum')?.slug, '3sum');
  assert.equal(parseSheetLine('subsets')?.slug, 'subsets');
});

test('a Codeforces slug keeps the case the rest of the extension keys it by', () => {
  // `codeforces:1899A`, not `1899a` — a sheet storing the lower-case form would
  // never match a solve however many times you solved it.
  assert.equal(normaliseSlug('codeforces', '1899a'), '1899A');
  assert.equal(normaliseSlug('codeforces', '1899A'), '1899A');
  assert.equal(normaliseSlug('leetcode', 'Two-Sum'), 'two-sum');

  const { entries } = parseSheet(JSON.stringify([{ platform: 'codeforces', slug: '1899a', title: 'x' }]));
  assert.equal(entries[0].slug, '1899A');
});

/* -------------------------------------------------------------- importing */

test('a markdown heading becomes the section its rows belong to', () => {
  const { entries } = parseSheet(`
# Arrays
- [Two Sum](https://leetcode.com/problems/two-sum/)
- [3Sum](https://leetcode.com/problems/3sum/)

# Trees
- [Same Tree](https://leetcode.com/problems/same-tree/)
`);

  assert.deepEqual(entries.map((e) => e.group), ['Arrays', 'Arrays', 'Trees']);
});

test('the same problem listed twice is counted once and reported', () => {
  const { entries, duplicates } = parseSheet('two-sum\ntwo-sum\nhttps://leetcode.com/problems/two-sum/');
  assert.equal(entries.length, 1);
  assert.equal(duplicates, 2);
});

test('a line that cannot be read is skipped and counted, not thrown', () => {
  // One bad row must not cost the other ninety-nine.
  const { entries, skipped } = parseSheet('two-sum\n???\n3sum');
  assert.equal(entries.length, 2);
  assert.equal(skipped, 1);
});

test('a JSON export round-trips, keeping the sections and the premium marks', () => {
  const original = {
    name: 'Mine',
    entries: [
      { platform: 'leetcode', slug: 'two-sum', title: 'Two Sum', group: 'Arrays' },
      { platform: 'leetcode', slug: 'meeting-rooms', title: 'Meeting Rooms', premium: true },
      { platform: 'codeforces', slug: '1899A', title: 'Game with Integers' },
    ],
  };
  const { entries } = parseSheet(JSON.stringify(original));
  assert.deepEqual(entries, original.entries);
});

test('a bare JSON array of URLs is a sheet too', () => {
  const { entries } = parseSheet('["https://leetcode.com/problems/two-sum/", "3sum"]');
  assert.deepEqual(entries.map((e) => e.slug), ['two-sum', '3sum']);
});

test('malformed JSON falls back to reading it as lines', () => {
  const { entries } = parseSheet('{not json\ntwo-sum');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].slug, 'two-sum');
});

test('a built sheet takes a stable id from its name', () => {
  assert.equal(sheetId('Striver A2Z Sheet'), 'striver-a2z-sheet');
  // Importing the same sheet again should replace it rather than stack up.
  assert.equal(sheetId('Striver A2Z Sheet'), sheetId('  striver a2z sheet  '));
});

test('an unnamed import still gets a name and an id', () => {
  const { sheet: built } = buildSheet('', 'two-sum', 1000);
  assert.ok(built.name.length > 0);
  assert.ok(built.id.length > 0);
  assert.equal(built.builtIn, false);
});

/* --------------------------------------------------------------- progress */

test('progress counts what is already solved, including from before the import', () => {
  // The whole point: importing a sheet tells you where you are, it does not
  // reset you to zero.
  const progress = sheetProgress(
    sheet([entry('two-sum', 'Array'), entry('3sum', 'Array'), entry('same-tree', 'Tree')]),
    solved('leetcode:two-sum', 'leetcode:same-tree'),
  );

  assert.equal(progress.solved, 2);
  assert.equal(progress.total, 3);
  assert.equal(progress.percent, 67);
  assert.deepEqual(progress.remaining.map((e) => e.slug), ['3sum']);
});

test('sections are counted separately', () => {
  const progress = sheetProgress(
    sheet([entry('two-sum', 'Array'), entry('3sum', 'Array'), entry('same-tree', 'Tree')]),
    solved('leetcode:two-sum'),
  );

  assert.deepEqual(
    progress.groups,
    [{ name: 'Array', solved: 1, total: 2 }, { name: 'Tree', solved: 0, total: 1 }],
  );
});

test('an entry with no section lands in Other rather than vanishing', () => {
  const progress = sheetProgress(sheet([entry('two-sum')]), {});
  assert.deepEqual(progress.groups, [{ name: 'Other', solved: 0, total: 1 }]);
});

test('premium entries are counted as locked but stay in the total', () => {
  // A sheet that silently drops six of its seventy-five is a sheet you cannot
  // trust; the bar stopping short needs a visible reason.
  const progress = sheetProgress(
    sheet([entry('two-sum'), entry('meeting-rooms', undefined, true)]),
    solved('leetcode:two-sum'),
  );
  assert.equal(progress.total, 2);
  assert.equal(progress.locked, 1);
  assert.equal(progress.percent, 50);
});

test('a premium problem you have solved anyway is not counted as locked', () => {
  const progress = sheetProgress(
    sheet([entry('meeting-rooms', undefined, true)]),
    solved('leetcode:meeting-rooms'),
  );
  assert.equal(progress.locked, 0);
  assert.equal(progress.solved, 1);
});

test('an empty sheet is 0%, not a division by zero', () => {
  const progress = sheetProgress(sheet([]), {});
  assert.equal(progress.percent, 0);
  assert.equal(progress.total, 0);
});

test('Codeforces entries match on the key the rest of the extension uses', () => {
  const cf = { platform: 'codeforces', slug: '1899A', title: 'Game with Integers' };
  assert.equal(entryKey(cf), 'codeforces:1899A');
  assert.equal(sheetProgress(sheet([cf]), solved('codeforces:1899A')).solved, 1);
});

/* ------------------------------------------------------------- what next */

test('what to do next comes from the section closest to finished', () => {
  // Finishing a section beats starting a fourth one — the problems inside a
  // section rhyme, and that is when the pattern lands.
  const progress = sheetProgress(
    sheet([
      entry('a1', 'Nearly done'), entry('a2', 'Nearly done'), entry('a3', 'Nearly done'),
      entry('b1', 'Just started'), entry('b2', 'Just started'), entry('b3', 'Just started'),
      entry('c1', 'Untouched'),
    ]),
    solved('leetcode:a1', 'leetcode:a2', 'leetcode:b1'),
  );

  const next = nextFromSheet(progress, 2);
  assert.equal(next[0].group, 'Nearly done', 'the nearly-finished section did not come first');
});

test('a problem you can open outranks one behind the paywall', () => {
  const progress = sheetProgress(
    sheet([entry('locked', 'Graph', true), entry('open', 'Graph')]),
    {},
  );
  assert.equal(nextFromSheet(progress, 1)[0].slug, 'open');
});

test('nothing left means nothing suggested', () => {
  const progress = sheetProgress(sheet([entry('two-sum')]), solved('leetcode:two-sum'));
  assert.deepEqual(nextFromSheet(progress), []);
});

/* --------------------------------------------------------------- the URLs */

test('a sheet entry links to the problem it names', () => {
  assert.equal(sheetEntryUrl(entry('two-sum')), 'https://leetcode.com/problems/two-sum/');
  assert.equal(
    sheetEntryUrl({ platform: 'codeforces', slug: '1899A', title: 'x' }),
    'https://codeforces.com/problemset/problem/1899/A',
  );
});

/* ------------------------------------------------------------- Blind 75 */

test('Blind 75 has seventy-five problems and no duplicates', () => {
  assert.equal(BLIND_75.entries.length, 75);
  assert.equal(new Set(BLIND_75.entries.map(entryKey)).size, 75, 'a problem is listed twice');
});

test('every Blind 75 entry is usable: a slug, a title and a section', () => {
  for (const item of BLIND_75.entries) {
    assert.equal(item.platform, 'leetcode', item.slug);
    assert.match(item.slug, /^[a-z0-9-]+$/, `${item.slug} is not a slug`);
    assert.ok(item.title.trim().length > 0, `${item.slug} has no title`);
    assert.ok(item.group, `${item.slug} has no section`);
  }
});

test('the six premium problems are marked rather than dropped', () => {
  const locked = BLIND_75.entries.filter((item) => item.premium).map((item) => item.slug);
  assert.deepEqual(locked.sort(), [
    'alien-dictionary',
    'encode-and-decode-strings',
    'graph-valid-tree',
    'meeting-rooms',
    'meeting-rooms-ii',
    'number-of-connected-components-in-an-undirected-graph',
  ]);
});

test('Blind 75 progress reads like a sheet, not a special case', () => {
  const progress = sheetProgress(BLIND_75, solved('leetcode:two-sum', 'leetcode:3sum'));
  assert.equal(progress.solved, 2);
  assert.equal(progress.total, 75);
  assert.ok(progress.groups.length >= 9, 'the sections were lost');
});

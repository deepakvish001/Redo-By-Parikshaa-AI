import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPost,
  fenceLanguage,
  keyFromTitle,
  readPost,
  readThread,
  searchQuery,
  threadTitle,
} from '../src/core/community.ts';

/* ---------------------------------------------------------------- titles */

test('a thread title carries the problem key', () => {
  assert.equal(
    threadTitle('codeforces:1352A', 'Sum of Round Numbers'),
    '[redo] codeforces:1352A — Sum of Round Numbers',
  );
});

test('the key is read back out of a title', () => {
  assert.equal(keyFromTitle('[redo] codeforces:1352A — Sum of Round Numbers'), 'codeforces:1352A');
  assert.equal(keyFromTitle('[redo] leetcode:two-sum — Two Sum'), 'leetcode:two-sum');
});

test('a renamed thread is still that problem’s thread', () => {
  // People edit titles. Matching on the key rather than the words survives it.
  assert.equal(keyFromTitle('[redo] codeforces:1352A — my own title'), 'codeforces:1352A');
});

test('an unrelated issue is not a thread', () => {
  assert.equal(keyFromTitle('Bug: the button is broken'), undefined);
  assert.equal(keyFromTitle('[redo] no key here'), undefined);
});

test('a very long problem title cannot overflow GitHub’s limit', () => {
  assert.ok(threadTitle('codeforces:1A', 'x'.repeat(500)).length <= 240);
});

test('the search is scoped to one repository and one problem', () => {
  const query = searchQuery('octocat', 'threads', 'codeforces:1352A');
  assert.match(query, /repo:octocat\/threads/);
  assert.match(query, /is:issue/);
  assert.match(query, /in:title/);
  assert.match(query, /codeforces:1352A/);
});

/* ----------------------------------------------------------------- posts */

test('a comment becomes a post', () => {
  const post = readPost({
    id: 7,
    user: { login: 'someone', html_url: 'https://github.com/someone' },
    body: '  my approach  ',
    created_at: '2026-09-01T10:00:00Z',
    html_url: 'https://github.com/o/r/issues/1#issuecomment-7',
  });

  assert.equal(post.author, 'someone');
  assert.equal(post.body, 'my approach');
  assert.equal(post.at, Date.parse('2026-09-01T10:00:00Z'));
});

test('an empty comment is not a post', () => {
  assert.equal(readPost({ id: 1, body: '   ' }), undefined);
  assert.equal(readPost({ id: 1 }), undefined);
});

test('a deleted author does not break the row', () => {
  // GitHub returns a null user for a deleted account.
  assert.equal(readPost({ id: 1, body: 'x' }).author, 'unknown');
});

/* --------------------------------------------------------------- threads */

test('an issue becomes a thread, and its body is the first post', () => {
  const thread = readThread({
    number: 12,
    title: '[redo] codeforces:1352A — Sum',
    html_url: 'https://github.com/o/r/issues/12',
    user: { login: 'me' },
    comments: 3,
    body: 'first idea',
    created_at: '2026-09-01T10:00:00Z',
  });

  assert.equal(thread.number, 12);
  assert.equal(thread.problemKey, 'codeforces:1352A');
  assert.equal(thread.posts.length, 1, 'a thread of one is still a thread');
  assert.equal(thread.posts[0].body, 'first idea');
});

test('an issue that is not one of ours is skipped', () => {
  assert.equal(readThread({ number: 3, title: 'Something else' }), undefined);
});

test('an issue with an empty body still opens a thread', () => {
  const thread = readThread({ number: 4, title: '[redo] cses:1068 — Weird', body: '' });
  assert.deepEqual(thread.posts, []);
});

/* ------------------------------------------------------------ the writing */

test('a post has the approach above the code, not just code', () => {
  const body = buildPost({
    language: 'GNU G++20',
    code: 'int main(){}',
    note: 'sort, then two pointers',
    complexity: { time: 'O(n log n)' },
  });

  assert.match(body, /^sort, then two pointers/);
  assert.match(body, /\*\*Time O\(n log n\)\*\*/);
  assert.match(body, /````cpp\nint main\(\)\{\}\n````/);
  assert.match(body, /Posted with Redo/);
});

test('the fence is long enough to hold a solution containing a fence', () => {
  // A three-backtick fence around code that itself contains ``` ends early and
  // spills the rest of the solution into the page as prose.
  const body = buildPost({ language: 'python', code: '# ```\nprint(1)' });
  assert.match(body, /````python/);
});

test('a solution with no note is still postable', () => {
  const body = buildPost({ language: 'python', code: 'print(1)' });
  assert.match(body, /````python\nprint\(1\)\n````/);
});

test('the fence language is the highlighter name, not the judge’s label', () => {
  assert.equal(fenceLanguage('GNU G++20 13.2 (64 bit, winlibs)'), 'cpp');
  assert.equal(fenceLanguage('Python 3.8.10'), 'python');
  assert.equal(fenceLanguage('Java 21 64bit'), 'java');
  assert.equal(fenceLanguage('GNU C11'), 'c');
  assert.equal(fenceLanguage('Befunge'), '', 'unknown means no highlighting, not a wrong guess');
});

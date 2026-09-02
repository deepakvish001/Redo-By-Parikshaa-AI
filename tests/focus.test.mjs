import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_FOCUS,
  canPause,
  dayKey,
  decide,
  isAllowed,
  isPaused,
  resolveTarget,
  solvedToday,
  utcDayKey,
} from '../src/core/focus.ts';

const ON = { ...DEFAULT_FOCUS, enabled: true };
const NOW = new Date('2026-08-05T14:00:00Z').getTime();

function problem(solvedAt, overrides = {}) {
  return {
    id: 'leetcode:two-sum',
    platform: 'leetcode',
    problemId: '1',
    slug: 'two-sum',
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'easy',
    tags: [],
    language: 'Java',
    code: 'x',
    solvedAt,
    attempts: 1,
    github: { status: 'synced' },
    parikshaa: { status: 'synced' },
    revision: { stage: 0, ease: 1, dueAt: NOW, reviewCount: 0, lapses: 0, hintsUsed: 0 },
    ...overrides,
  };
}

test('the judges, Parikshaa and GitHub are never gated', () => {
  for (const url of [
    'https://leetcode.com/problems/two-sum/',
    'https://codeforces.com/problemset',
    'https://parikshaa.org/library',
    'https://github.com/someone/solutions',
    'https://mail.google.com/mail/u/0/',
  ]) {
    assert.equal(isAllowed(url), true, url);
  }
});

test('an ordinary site is gated', () => {
  assert.equal(isAllowed('https://www.youtube.com/'), false);
  assert.equal(isAllowed('https://news.ycombinator.com/'), false);
});

test('an allowlist entry covers its subdomains but not a lookalike host', () => {
  const list = ['stackoverflow.com'];
  assert.equal(isAllowed('https://stackoverflow.com/questions/1', list), true);
  assert.equal(isAllowed('https://meta.stackoverflow.com/', list), true);
  // The trap: `endsWith('stackoverflow.com')` alone would let this through.
  assert.equal(isAllowed('https://notstackoverflow.com/', list), false);
});

test('anything that is not an ordinary web page is left alone', () => {
  // Redirecting these is either impossible or actively hostile.
  for (const url of [
    'chrome://extensions',
    'chrome-extension://abc/panel/index.html',
    'about:blank',
    'file:///home/user/notes.txt',
    'not a url at all',
  ]) {
    assert.equal(isAllowed(url), true, url);
  }
});

test('the gate opens once the day’s goal is met', () => {
  const url = 'https://www.youtube.com/';

  assert.equal(decide(url, ON, [], {}, NOW).gate, true);

  const solved = [problem(NOW - 3_600_000)];
  const open = decide(url, ON, solved, {}, NOW);
  assert.equal(open.gate, false);
  assert.equal(open.reason, 'goal-met');
  assert.equal(open.solved, 1);
});

test('yesterday’s solve does not count for today', () => {
  const yesterday = [problem(NOW - 26 * 3_600_000)];
  assert.equal(solvedToday(yesterday, NOW), 0);
  assert.equal(decide('https://www.youtube.com/', ON, yesterday, {}, NOW).gate, true);
});

test('a goal above one needs that many solves', () => {
  const settings = { ...ON, dailyGoal: 3 };
  const two = [problem(NOW - 1000), problem(NOW - 2000, { id: 'b' })];
  assert.equal(decide('https://www.youtube.com/', settings, two, {}, NOW).gate, true);

  const three = [...two, problem(NOW - 3000, { id: 'c' })];
  assert.equal(decide('https://www.youtube.com/', settings, three, {}, NOW).gate, false);
});

test('a live pause opens the gate, an expired one does not', () => {
  const url = 'https://www.youtube.com/';
  assert.equal(decide(url, ON, [], { until: NOW + 3_600_000 }, NOW).reason, 'paused');
  assert.equal(decide(url, ON, [], { until: NOW - 1000 }, NOW).gate, true);
});

test('only one pause a day is granted', () => {
  const today = { until: NOW - 1000, day: '2026-08-05' };
  assert.equal(canPause(today, NOW), false);
  // Tomorrow it is available again.
  assert.equal(canPause(today, NOW + 86_400_000), true);
  assert.equal(isPaused(today, NOW), false);
});

test('focus mode off means the gate never fires', () => {
  assert.equal(decide('https://www.youtube.com/', DEFAULT_FOCUS, [], {}, NOW).reason, 'off');
});

test('the due mode points at the problem you are about to forget', () => {
  const due = problem(NOW - 86_400_000, { title: 'Trapping Rain Water' });
  const target = resolveTarget({ ...ON, mode: 'due' }, due, undefined);
  assert.equal(target.title, 'Trapping Rain Water');
  assert.match(target.note, /Due for revision/);
});

test('each mode falls back to something rather than to nothing', () => {
  // Nothing due.
  const noDue = resolveTarget({ ...ON, mode: 'due' }, undefined, undefined);
  assert.match(noDue.url, /parikshaa\.org/);

  // The daily lookup failed.
  const noDaily = resolveTarget({ ...ON, mode: 'daily' }, undefined, undefined);
  assert.match(noDaily.url, /leetcode\.com\/problemset/);
  assert.match(noDaily.note, /Could not reach/);

  const any = resolveTarget({ ...ON, mode: 'any' }, undefined, undefined);
  assert.match(any.url, /leetcode\.com\/problemset/);
});

test('the daily rolls over at UTC midnight, not local midnight', () => {
  // 23:30 UTC and 00:30 UTC are different LeetCode days even though a user in
  // UTC+5:30 experiences both as the same evening.
  assert.equal(utcDayKey(new Date('2026-08-05T23:30:00Z').getTime()), '2026-08-05');
  assert.equal(utcDayKey(new Date('2026-08-06T00:30:00Z').getTime()), '2026-08-06');
});

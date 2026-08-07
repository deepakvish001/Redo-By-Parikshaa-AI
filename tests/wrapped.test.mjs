import assert from 'node:assert/strict';
import test from 'node:test';
import { XMLValidator } from 'fast-xml-parser';

import { buildWrappedSvg, summariseWeek, weekRange, wrappedCaption } from '../src/core/wrapped.ts';

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;

function problem(overrides = {}) {
  return {
    id: 'leetcode:two-sum',
    platform: 'leetcode',
    problemId: '1',
    slug: 'two-sum',
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'easy',
    tags: ['Array'],
    language: 'Java',
    code: 'x',
    solvedAt: NOW - DAY,
    attempts: 1,
    github: { status: 'synced' },
    parikshaa: { status: 'synced' },
    revision: { stage: 0, ease: 1, dueAt: NOW, reviewCount: 0, lapses: 0, hintsUsed: 0 },
    ...overrides,
  };
}

test('only the last seven days count', () => {
  const recap = summariseWeek(
    [
      problem({ id: 'a', slug: 'a', solvedAt: NOW - 2 * DAY }),
      problem({ id: 'b', slug: 'b', solvedAt: NOW - 6 * DAY }),
      // Just outside the window.
      problem({ id: 'c', slug: 'c', solvedAt: NOW - 8 * DAY }),
    ],
    NOW,
  );

  assert.equal(recap.solved, 2);
  assert.equal(recap.range.end, NOW);
  assert.equal(recap.range.start, NOW - 7 * DAY);
});

test('reviews and hints are counted from the week, not from lifetime totals', () => {
  const recap = summariseWeek(
    [
      problem({
        // Solved long ago, so it contributes nothing to `solved` — but it was
        // revised this week, which is exactly the case lifetime counters get
        // wrong.
        solvedAt: NOW - 40 * DAY,
        history: [
          { at: NOW - 50 * DAY, kind: 'review', outcome: 'good' },
          { at: NOW - 2 * DAY, kind: 'review', outcome: 'good' },
          { at: NOW - 1 * DAY, kind: 'review', outcome: 'forgot' },
          { at: NOW - 1 * DAY, kind: 'hint', outcome: 'level 1' },
        ],
      }),
    ],
    NOW,
  );

  assert.equal(recap.solved, 0);
  assert.equal(recap.reviews, 2);
  assert.equal(recap.hints, 1);
});

test('the biggest fight is the costliest problem solved this week', () => {
  const recap = summariseWeek(
    [
      problem({
        id: 'easy',
        slug: 'easy',
        title: 'Walked It',
        revision: { stage: 0, ease: 1, dueAt: NOW, reviewCount: 0, lapses: 0, hintsUsed: 0, struggle: 0.1 },
      }),
      problem({
        id: 'hard',
        slug: 'hard',
        title: 'Median of Two Sorted Arrays',
        solveTimeMs: 95 * 60_000,
        revision: { stage: 0, ease: 0.6, dueAt: NOW, reviewCount: 0, lapses: 0, hintsUsed: 0, struggle: 0.86 },
        events: [
          { at: NOW - DAY, kind: 'run', verdict: 'Wrong Answer', accepted: false },
          { at: NOW - DAY, kind: 'submit', verdict: 'Wrong Answer', accepted: false },
          { at: NOW - DAY, kind: 'submit', verdict: 'Accepted', accepted: true },
        ],
      }),
    ],
    NOW,
  );

  assert.equal(recap.hardest?.title, 'Median of Two Sorted Arrays');
  assert.equal(recap.hardest?.submits, 2);
  assert.equal(recap.hardest?.runs, 1);
});

test('a topic seen for the first time this week is flagged as new', () => {
  const recap = summariseWeek(
    [
      problem({ id: 'old', slug: 'old', solvedAt: NOW - 20 * DAY, tags: ['Array'] }),
      problem({ id: 'new', slug: 'new', solvedAt: NOW - DAY, tags: ['Array', 'Segment Tree'] }),
    ],
    NOW,
  );

  assert.deepEqual(recap.newTopics, ['Segment Tree']);
});

test('the card is well-formed XML, and survives titles with XML characters', () => {
  const recap = summariseWeek(
    [problem({ title: 'A & B < C', tags: ['Two "Pointers" & <Sliding>'] })],
    NOW,
    5,
  );
  const svg = buildWrappedSvg(recap);

  const valid = XMLValidator.validate(svg);
  assert.equal(valid, true, typeof valid === 'object' ? JSON.stringify(valid.err) : '');
  assert.ok(svg.includes('&amp;'));
});

test('the export variant carries no animation', () => {
  const recap = summariseWeek([problem()], NOW, 3);

  // A rasteriser catches the first frame, and an element mid-`translateY` with
  // `opacity: 0` renders as nothing at all.
  assert.match(buildWrappedSvg(recap, { animate: true }), /@keyframes rise/);
  assert.doesNotMatch(buildWrappedSvg(recap, { animate: false }), /@keyframes/);
  assert.equal(XMLValidator.validate(buildWrappedSvg(recap, { animate: false })), true);
});

test('an empty week produces a card rather than a crash', () => {
  const recap = summariseWeek([], NOW);
  assert.equal(recap.solved, 0);
  assert.equal(recap.hardest, undefined);

  const svg = buildWrappedSvg(recap);
  assert.equal(XMLValidator.validate(svg), true);
  assert.match(svg, /Nothing solved this week/);
});

test('the caption reads like something a person would post', () => {
  const recap = summariseWeek(
    [
      problem({
        title: 'Trapping Rain Water',
        revision: { stage: 0, ease: 0.7, dueAt: NOW, reviewCount: 0, lapses: 0, hintsUsed: 0, struggle: 0.7 },
        events: [
          { at: NOW - DAY, kind: 'submit', verdict: 'Wrong Answer', accepted: false },
          { at: NOW - DAY, kind: 'submit', verdict: 'Wrong Answer', accepted: false },
          { at: NOW - DAY, kind: 'submit', verdict: 'Accepted', accepted: true },
        ],
      }),
    ],
    NOW,
    4,
  );

  const caption = wrappedCaption(recap);
  assert.match(caption, /1 problem solved/);
  assert.match(caption, /4-day streak/);
  assert.match(caption, /Trapping Rain Water — 3 submits before it went green/);
});

test('the range label names both ends', () => {
  const range = weekRange(NOW);
  assert.match(range.label, /–/);
  assert.notEqual(range.label.split('–')[0].trim(), range.label.split('–')[1].trim());
});

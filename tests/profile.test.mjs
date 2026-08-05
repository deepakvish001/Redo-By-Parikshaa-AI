import assert from 'node:assert/strict';
import test from 'node:test';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

import { computeStats } from '../src/core/analytics.ts';
import { buildProfileReadme, buildProfileSvg } from '../src/core/profile.ts';
import { buildProblemReadme } from '../src/core/markdown.ts';

const INTERVALS = [1, 3, 7, 21];
const NOW = 1_760_000_000_000;

function problem(overrides = {}) {
  return {
    id: 'leetcode:two-sum',
    platform: 'leetcode',
    problemId: '1',
    slug: 'two-sum',
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'easy',
    tags: ['Array', 'Hash Table'],
    language: 'Java',
    code: 'class Solution {}',
    solvedAt: NOW,
    attempts: 1,
    github: { status: 'synced', path: 'leetcode/easy/0001-two-sum/solution.java' },
    parikshaa: { status: 'synced' },
    revision: { stage: 0, ease: 1, dueAt: NOW + 86_400_000, reviewCount: 0, lapses: 0, hintsUsed: 0 },
    ...overrides,
  };
}

test('the profile card is well-formed XML', () => {
  const problems = [problem()];
  const svg = buildProfileSvg(problems, computeStats(problems, INTERVALS, NOW), NOW);

  const valid = XMLValidator.validate(svg);
  assert.equal(valid, true, typeof valid === 'object' ? JSON.stringify(valid.err) : '');
});

test('a title with XML characters does not break the card', () => {
  // "A & B < C" in a tag or a title would otherwise produce an unparseable
  // file, and GitHub renders a broken image rather than reporting it.
  const problems = [
    problem({ title: 'A & B < C', tags: ['Two "Pointers" & <Sliding>'], difficulty: 'hard' }),
  ];
  const svg = buildProfileSvg(problems, computeStats(problems, INTERVALS, NOW), NOW);

  assert.equal(XMLValidator.validate(svg), true);
  assert.ok(!svg.includes('& B'), 'the raw ampersand must not survive into the markup');
  assert.ok(svg.includes('&amp;'));
});

test('the card animates and respects reduced motion', () => {
  const problems = [problem()];
  const svg = buildProfileSvg(problems, computeStats(problems, INTERVALS, NOW), NOW);

  assert.match(svg, /@keyframes grow/);
  assert.match(svg, /prefers-reduced-motion: reduce/);
  // Referenced as a file from markdown, so the dimensions have to be intrinsic.
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(svg);
  assert.ok(Number(parsed.svg['@_width']) > 0);
  assert.ok(Number(parsed.svg['@_height']) > 0);
});

test('the profile page reports the attempt totals and the hardest problems', () => {
  const problems = [
    problem({
      solveTimeMs: 95 * 60_000,
      revision: {
        stage: 0,
        ease: 0.6,
        dueAt: NOW + 86_400_000,
        reviewCount: 1,
        lapses: 0,
        hintsUsed: 0,
        struggle: 0.82,
        targetReviews: 7,
      },
      events: [
        { at: NOW - 5000, kind: 'run', verdict: 'Wrong Answer', accepted: false },
        { at: NOW - 4000, kind: 'submit', verdict: 'Wrong Answer', accepted: false },
        { at: NOW, kind: 'submit', verdict: 'Accepted', accepted: true },
      ],
    }),
  ];

  const page = buildProfileReadme(problems, computeStats(problems, INTERVALS, NOW), NOW);

  assert.match(page, /<img src="assets\/profile\.svg"/);
  assert.match(page, /Submissions recorded \| 2 \(1 rejected\)/);
  assert.match(page, /Runs recorded \| 1/);
  assert.match(page, /Fought hardest for these/);
  assert.match(page, /82\/100/);
  assert.match(page, /1\/7/, 'the revision queue shows progress against the target');
});

test('the problem README carries the attempt timeline', () => {
  const readme = buildProblemReadme(
    problem({
      solveTimeMs: 8 * 60_000,
      revision: {
        stage: 0,
        ease: 0.9,
        dueAt: NOW,
        reviewCount: 0,
        lapses: 0,
        hintsUsed: 0,
        struggle: 0.4,
        targetReviews: 5,
      },
      events: [
        {
          at: NOW - 60_000,
          kind: 'submit',
          verdict: 'Wrong Answer',
          accepted: false,
          testsPassed: 41,
          testsTotal: 987,
          failedInput: '"abcabcbb"',
          expectedOutput: '3',
          actualOutput: '2',
        },
        {
          at: NOW,
          kind: 'submit',
          verdict: 'Accepted',
          accepted: true,
          runtime: '79 ms',
          memory: '47.6 MB',
        },
      ],
    }),
  );

  assert.match(readme, /## How it went/);
  assert.match(readme, /2 submits/);
  assert.match(readme, /41\/987 tests/);
  assert.match(readme, /\*\*Accepted\*\*/);
  assert.match(readme, /First failing case/);
  assert.match(readme, /some resistance \(40\/100\)/);
  assert.match(readme, /\*\*Revisions planned:\*\* 5/);
});

test('a problem with no journal keeps the old README shape', () => {
  const readme = buildProblemReadme(problem());
  assert.doesNotMatch(readme, /## How it went/);
  assert.match(readme, /## Approach/);
});

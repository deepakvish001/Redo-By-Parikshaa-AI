import test from 'node:test';
import assert from 'node:assert/strict';

import { completeProblem, completeProblems } from '../src/core/record.ts';
import { buildProblemReadme } from '../src/core/markdown.ts';

/**
 * Two fixes that a unit test would not have found on its own, kept here so they
 * cannot come back: a record missing the fields its type promises, and a README
 * that changes every time it is committed.
 */

const DAY = 86_400_000;
const now = Date.UTC(2026, 0, 15, 12, 0, 0);

const full = (over = {}) => ({
  id: 'leetcode:two-sum',
  platform: 'leetcode',
  problemId: '1',
  slug: 'two-sum',
  title: 'Two Sum',
  url: 'https://leetcode.com/problems/two-sum/',
  difficulty: 'easy',
  tags: ['Array'],
  language: 'Python3',
  code: 'x = 1',
  attempts: 1,
  solvedAt: now - DAY,
  github: { status: 'synced', path: 'leetcode/easy/0001-two-sum/solution.py' },
  parikshaa: { status: 'disabled' },
  revision: { stage: 1, ease: 1, dueAt: now + DAY, reviewCount: 1, lapses: 0, hintsUsed: 0 },
  ...over,
});

/* ------------------------------------------- records from somewhere else */

test('a record with no sync state is given one rather than left broken', () => {
  // This is what a backup written by an older build looks like, and the panel
  // reads `problem.github.status` directly — so the whole panel went blank
  // rather than one row looking odd.
  const { github, parikshaa } = full();
  void github;
  void parikshaa;
  const bare = full();
  delete bare.github;
  delete bare.parikshaa;

  const fixed = completeProblem(bare);
  assert.equal(fixed.github.status, 'disabled');
  assert.equal(fixed.parikshaa.status, 'disabled');
});

test('a record with no revision is due now, not never', () => {
  const bare = full();
  delete bare.revision;

  const fixed = completeProblem(bare);
  assert.equal(fixed.revision.stage, 0);
  assert.equal(fixed.revision.reviewCount, 0);
  // A problem that silently stops coming back is the one failure mode a
  // revision tool cannot have.
  assert.ok(fixed.revision.dueAt <= fixed.solvedAt, 'a record with no schedule was not made due');
});

test('a half-written revision keeps the parts it has', () => {
  const fixed = completeProblem(full({ revision: { stage: 3, dueAt: now + 21 * DAY } }));
  assert.equal(fixed.revision.stage, 3, 'the stage it had was thrown away');
  assert.equal(fixed.revision.dueAt, now + 21 * DAY, 'the due date it had was thrown away');
  assert.equal(fixed.revision.lapses, 0, 'the missing field was not filled in');
  assert.equal(fixed.revision.ease, 1);
});

test('a complete record is handed back untouched', () => {
  // Every read of the store runs through this, so the common path must not copy
  // every problem for nothing.
  const problem = full();
  assert.equal(completeProblem(problem), problem);
});

test('a null entry is dropped rather than crashing the store', () => {
  const problems = completeProblems({ 'leetcode:ok': full(), 'leetcode:junk': null });
  assert.deepEqual(Object.keys(problems), ['leetcode:ok']);
});

/* ------------------------------------------------- the README must settle */

test('the committed README does not record its own commit', () => {
  // Committing the README *is* a GitHub sync, so it appends a `github` event,
  // which changes the README, which gives the next sync something to commit.
  // The content never converges and the repository collects a commit every
  // time anything asks for a re-sync.
  const readme = buildProblemReadme(
    full({
      history: [
        { at: now - DAY, kind: 'solved', outcome: 'first time', reason: 'Python3, 1 attempt(s)' },
        { at: now - DAY, kind: 'github', outcome: 'synced', reason: 'leetcode/easy/0001-two-sum/solution.py' },
        { at: now - DAY, kind: 'parikshaa', outcome: 'disabled' },
      ],
    }),
  );

  assert.doesNotMatch(readme, /GitHub sync/, 'the README records its own sync');
  assert.doesNotMatch(readme, /Parikshaa sync/, 'the README records its own Parikshaa sync');
  assert.match(readme, /Solved/, 'the record of the problem itself went with it');
});

test('two syncs of an unchanged problem produce an identical README', () => {
  const history = [
    { at: now - DAY, kind: 'solved', outcome: 'first time', reason: 'Python3, 1 attempt(s)' },
  ];
  const first = buildProblemReadme(full({ history }));

  // What the store looks like after that first sync recorded itself.
  const second = buildProblemReadme(
    full({
      history: [
        ...history,
        { at: now, kind: 'github', outcome: 'synced', reason: 'leetcode/easy/0001-two-sum/solution.py' },
      ],
    }),
  );

  assert.equal(second, first, 'a sync changed the file it was committing');
});

test('what the user actually did is still recorded', () => {
  const readme = buildProblemReadme(
    full({
      history: [
        { at: now - 2 * DAY, kind: 'opened', outcome: 'visited' },
        { at: now - DAY, kind: 'solved', outcome: 'first time', reason: 'Python3' },
        { at: now, kind: 'review', outcome: 'good', reason: 'recall' },
        { at: now, kind: 'hint', outcome: 'level 1' },
        { at: now, kind: 'note', outcome: 'edited' },
      ],
    }),
  );

  for (const label of ['Opened', 'Solved', 'Revised', 'Hint taken', 'Notes edited']) {
    assert.match(readme, new RegExp(label), `${label} is missing from the record`);
  }
});

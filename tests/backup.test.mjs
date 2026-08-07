import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BACKUP_VERSION,
  BackupError,
  backupFilename,
  buildBackup,
  mergeJournals,
  mergeProblems,
  readBackup,
  redactSettings,
} from '../src/core/backup.ts';
import { DEFAULT_SETTINGS } from '../src/core/storage.ts';

function problem(id, solvedAt, extra = {}) {
  return {
    id,
    platform: 'leetcode',
    problemId: id,
    slug: id,
    title: id,
    url: `https://leetcode.com/problems/${id}/`,
    difficulty: 'medium',
    tags: [],
    language: 'python',
    code: 'print(1)',
    solvedAt,
    attempts: 1,
    github: { status: 'disabled' },
    parikshaa: { status: 'disabled' },
    revision: { stage: 0, ease: 1, dueAt: solvedAt, reviewCount: 0, lapses: 0, hintsUsed: 0 },
    ...extra,
  };
}

const STATE = {
  settings: { ...DEFAULT_SETTINGS, github: { ...DEFAULT_SETTINGS.github, token: 'ghp_secret' } },
  problems: { 'leetcode:a': problem('a', 100) },
  journal: {},
  meta: { reviewsCompleted: 3 },
  now: 1_700_000_000_000,
};

test('the GitHub token never leaves in a backup', () => {
  // Backups get committed to repositories, some of them public.
  const backup = buildBackup(STATE);
  assert.equal(backup.settings.github.token, '');
  assert.ok(!JSON.stringify(backup).includes('ghp_secret'));
});

test('redacting keeps every other setting intact', () => {
  const redacted = redactSettings(STATE.settings);
  assert.equal(redacted.github.owner, STATE.settings.github.owner);
  assert.equal(redacted.revision.intervals.length, STATE.settings.revision.intervals.length);
});

test('a backup round-trips', () => {
  const plan = readBackup(JSON.stringify(buildBackup(STATE)));
  assert.equal(plan.problems, 1);
  assert.equal(plan.exportedAt, STATE.now);
  assert.equal(plan.backup.version, BACKUP_VERSION);
});

test('anything that is not a backup is refused, not half-applied', () => {
  assert.throws(() => readBackup('not json'), BackupError);
  assert.throws(() => readBackup('null'), BackupError);
  assert.throws(() => readBackup('{"hello":"world"}'), BackupError);
  assert.throws(() => readBackup(JSON.stringify({ version: 1 })), BackupError);
});

test('a backup from a newer version is refused rather than guessed at', () => {
  const future = JSON.stringify({ ...buildBackup(STATE), version: BACKUP_VERSION + 1 });
  assert.throws(() => readBackup(future), /newer version/);
});

test('problems missing required fields are dropped, not restored broken', () => {
  const backup = buildBackup(STATE);
  backup.problems['leetcode:broken'] = { id: 'leetcode:broken', title: 'no slug' };
  const plan = readBackup(JSON.stringify(backup));
  assert.equal(plan.problems, 1);
  assert.ok(!plan.backup.problems['leetcode:broken']);
});

test('restoring an old backup cannot undo newer work', () => {
  // The case that matters: a second machine that has been used since the export.
  const current = { 'leetcode:a': problem('a', 500, { note: 'newer' }) };
  const incoming = { 'leetcode:a': problem('a', 100, { note: 'older' }) };

  assert.equal(mergeProblems(current, incoming)['leetcode:a'].note, 'newer');
  assert.equal(mergeProblems(incoming, current)['leetcode:a'].note, 'newer');
});

test('restoring adds problems the machine has never seen', () => {
  const merged = mergeProblems({ 'leetcode:a': problem('a', 1) }, { 'leetcode:b': problem('b', 2) });
  assert.deepEqual(Object.keys(merged).sort(), ['leetcode:a', 'leetcode:b']);
});

test('journals merge without duplicating the same attempt', () => {
  const event = { at: 10, kind: 'submit', verdict: 'Accepted', accepted: true };
  const merged = mergeJournals({ 'leetcode:a': [event] }, { 'leetcode:a': [event] });
  assert.equal(merged['leetcode:a'].length, 1);
});

test('journals merge in time order', () => {
  const merged = mergeJournals(
    { 'leetcode:a': [{ at: 30, kind: 'submit', verdict: 'Accepted', accepted: true }] },
    { 'leetcode:a': [{ at: 10, kind: 'run', verdict: 'Accepted', accepted: true }] },
  );
  assert.deepEqual(
    merged['leetcode:a'].map((entry) => entry.at),
    [10, 30],
  );
});

test('the filename carries the date so several backups can coexist', () => {
  assert.equal(backupFilename(Date.UTC(2026, 0, 15)), 'redo-backup-2026-01-15.json');
});

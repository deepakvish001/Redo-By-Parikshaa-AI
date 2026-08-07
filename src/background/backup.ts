import {
  BACKUP_PATH,
  BackupError,
  buildBackup,
  mergeJournals,
  mergeProblems,
  readBackup,
  type RestorePlan,
} from '../core/backup.ts';
import { commitFiles, getFileContent, isConfigured } from '../core/github.ts';
import type { RestoreResult } from '../core/messages.ts';
import { readEverything, writeRestored } from '../core/storage.ts';
import { mergeUpsolve, type UpsolveItem } from '../core/upsolve.ts';
import { enqueue } from './sync.ts';

/**
 * The backup, to and from the repository the extension already syncs to.
 *
 * The file goes in the same repo rather than somewhere new because that repo is
 * already the thing the user trusts with this data, already private or public
 * by their choice, and already backed up by GitHub. A second destination would
 * be a second thing to configure and a second thing to get wrong.
 */

export async function currentBackup(now = Date.now()): Promise<string> {
  const state = await readEverything();
  return `${JSON.stringify(buildBackup({ ...state, now }), null, 2)}\n`;
}

export async function pushBackup(): Promise<{ path: string; commitUrl?: string }> {
  const { settings } = await readEverything();
  if (!isConfigured(settings.github)) {
    throw new Error('Connect a GitHub repository in Settings first.');
  }

  const content = await currentBackup();

  // Behind the same queue as solve commits: two trees built on the same parent
  // is exactly the conflict the single-commit rewrite was meant to end.
  const commit = await enqueue(() =>
    commitFiles(
      settings.github,
      [{ path: BACKUP_PATH, content }],
      'chore: back up revision history',
    ),
  );

  return { path: BACKUP_PATH, commitUrl: commit.commitUrl };
}

/**
 * Applies a backup on top of what is already stored.
 *
 * Always a merge, never a replace. Somebody restoring after a browser reset has
 * nothing to lose; somebody restoring on a second machine has a week of solves
 * on it, and silently discarding those would be the worst thing this feature
 * could do.
 */
export async function applyBackup(plan: RestorePlan): Promise<RestoreResult> {
  const current = await readEverything();

  const problems = mergeProblems(current.problems, plan.backup.problems);
  const journal = mergeJournals(current.journal, plan.backup.journal);
  const upsolve = Array.isArray(plan.backup.upsolve)
    ? mergeUpsolve(current.upsolve, plan.backup.upsolve as UpsolveItem[])
    : current.upsolve;

  // Counters are maxima rather than sums: the same reviews are very likely
  // represented on both sides, and adding them would invent a streak.
  const incomingMeta = (plan.backup.meta ?? {}) as Partial<typeof current.meta>;
  const meta = {
    reviewsCompleted: Math.max(current.meta.reviewsCompleted, incomingMeta.reviewsCompleted ?? 0),
    longestStreak: Math.max(current.meta.longestStreak, incomingMeta.longestStreak ?? 0),
    currentStreak: Math.max(current.meta.currentStreak, incomingMeta.currentStreak ?? 0),
    lastReviewDay:
      (current.meta.lastReviewDay ?? '') >= (incomingMeta.lastReviewDay ?? '')
        ? current.meta.lastReviewDay
        : incomingMeta.lastReviewDay ?? null,
  };

  // Settings are deliberately not restored. The GitHub token is redacted out of
  // every backup, so writing settings back would blank a working connection.
  await writeRestored({ problems, journal, meta, upsolve });

  return {
    problems: Object.keys(problems).length,
    added: Object.keys(problems).length - Object.keys(current.problems).length,
    journals: Object.keys(journal).length,
    exportedAt: plan.exportedAt,
  };
}

export async function pullBackup(): Promise<RestoreResult> {
  const { settings } = await readEverything();
  if (!isConfigured(settings.github)) {
    throw new Error('Connect a GitHub repository in Settings first.');
  }

  const content = await getFileContent(settings.github, BACKUP_PATH);
  if (content === undefined) {
    throw new BackupError(
      `No backup in that repository yet — use "Back up now" from the machine that has your history.`,
    );
  }

  return applyBackup(readBackup(content));
}

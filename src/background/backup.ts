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

/* ------------------------------------------------------------ keeping in step */

const STATE_KEY = 'syncState';

export interface SyncState {
  at?: number;
  /** Problems and journal entries the last sync brought in. */
  pulled?: number;
  error?: string;
}

export async function getSyncState(): Promise<SyncState> {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return (stored[STATE_KEY] as SyncState | undefined) ?? {};
}

/**
 * One round of keeping this browser in step with the repository.
 *
 * Pull, merge, push. All three, in that order, and the order is the feature:
 * pulling alone means the other machine never learns what this one did, and
 * pushing alone means this one overwrites it. Merging in between is what makes
 * two machines converge rather than take turns winning.
 *
 * Nothing is committed when the merged state matches what is already in the
 * repository — `commitFiles` builds the tree first and stops when it is
 * identical to the branch's, so a quiet machine adds no commits at all.
 *
 * A failure is recorded rather than thrown at whatever triggered it: this runs
 * on a timer and on startup, and a network blip is not something to interrupt
 * somebody's morning about.
 */
export async function syncNow(): Promise<SyncState> {
  const { settings } = await readEverything();
  if (!settings.github.sync || !isConfigured(settings.github)) {
    return getSyncState();
  }

  try {
    let pulled = 0;

    const content = await getFileContent(settings.github, BACKUP_PATH);
    if (content !== undefined) {
      // A repository whose backup is unreadable must not stop this machine
      // from pushing a good one — that is how a bad file becomes permanent.
      try {
        const result = await applyBackup(readBackup(content));
        pulled = result.problems + result.journals;
      } catch (error) {
        if (!(error instanceof BackupError)) throw error;
      }
    }

    await pushBackup();

    const state: SyncState = { at: Date.now(), pulled };
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  } catch (error) {
    const state: SyncState = {
      ...(await getSyncState()),
      error: error instanceof Error ? error.message : String(error),
    };
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }
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

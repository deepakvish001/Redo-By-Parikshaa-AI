import { PRODUCT } from './brand.ts';
import type { AttemptEvent, Settings, SolvedProblem } from './types.ts';

/**
 * Everything the extension knows, in one file.
 *
 * All of it lives in `chrome.storage.local`, which a browser reset, a profile
 * wipe or one mis-clicked "Remove extension" takes with it. The solutions are
 * safe — those are committed — but the journal, the revision schedule, the
 * streak and the mastery figures are not, and those are what the extension is
 * actually for. So they get written out too.
 */

export const BACKUP_VERSION = 1;

export interface Backup {
  version: number;
  product: string;
  exportedAt: number;
  settings: Settings;
  problems: Record<string, SolvedProblem>;
  journal: Record<string, AttemptEvent[]>;
  meta: unknown;
  upsolve?: unknown;
}

/**
 * The GitHub token is deliberately not in the backup.
 *
 * A backup is a file people mail themselves, drop in cloud storage and commit
 * to a public repository — this one is committed to theirs by default. A
 * repository-scoped write token sitting in it would be a credential leak with
 * a very long tail, and re-pasting a token takes ten seconds.
 */
export function redactSettings(settings: Settings): Settings {
  return { ...settings, github: { ...settings.github, token: '' } };
}

export function buildBackup(state: {
  settings: Settings;
  problems: Record<string, SolvedProblem>;
  journal: Record<string, AttemptEvent[]>;
  meta: unknown;
  upsolve?: unknown;
  now: number;
}): Backup {
  return {
    version: BACKUP_VERSION,
    product: PRODUCT,
    exportedAt: state.now,
    settings: redactSettings(state.settings),
    problems: state.problems,
    journal: state.journal,
    meta: state.meta,
    upsolve: state.upsolve,
  };
}

export interface RestorePlan {
  backup: Backup;
  problems: number;
  journals: number;
  exportedAt: number;
}

export class BackupError extends Error {}

/**
 * Reads a backup file, refusing anything that is not one.
 *
 * Restoring replaces months of history, so a malformed or foreign file has to
 * fail loudly here rather than half-apply and leave the store in a state
 * nobody can reason about.
 */
export function readBackup(text: string): RestorePlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError('That file is not JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new BackupError('That file does not contain a backup.');
  }

  const backup = parsed as Partial<Backup>;
  if (typeof backup.version !== 'number') {
    throw new BackupError(`That file is not a ${PRODUCT} backup — it has no version.`);
  }
  if (backup.version > BACKUP_VERSION) {
    throw new BackupError(
      `This backup was written by a newer version (${backup.version}); update the extension first.`,
    );
  }
  if (typeof backup.problems !== 'object' || backup.problems === null) {
    throw new BackupError('That backup has no problems in it.');
  }

  // A problem without an id or a slug cannot be keyed, and one without a
  // revision cannot be scheduled — both would break the panel after restoring.
  const problems: Record<string, SolvedProblem> = {};
  for (const [id, problem] of Object.entries(backup.problems)) {
    const candidate = problem as Partial<SolvedProblem>;
    if (!candidate?.id || !candidate.slug || !candidate.platform || !candidate.revision) continue;
    problems[id] = candidate as SolvedProblem;
  }

  if (Object.keys(problems).length === 0 && Object.keys(backup.problems).length > 0) {
    throw new BackupError('Every problem in that backup is missing required fields.');
  }

  const journal = (backup.journal ?? {}) as Record<string, AttemptEvent[]>;

  return {
    backup: { ...(backup as Backup), problems, journal },
    problems: Object.keys(problems).length,
    journals: Object.keys(journal).length,
    exportedAt: backup.exportedAt ?? 0,
  };
}

/**
 * Merges a backup into what is already here.
 *
 * Restoring onto a fresh install is the easy case. Restoring onto a machine
 * that has been used since the export is the one worth getting right: the
 * newer record of each problem wins, so importing an old backup cannot undo
 * work done after it.
 */
export function mergeProblems(
  current: Record<string, SolvedProblem>,
  incoming: Record<string, SolvedProblem>,
): Record<string, SolvedProblem> {
  const merged: Record<string, SolvedProblem> = { ...current };

  for (const [id, problem] of Object.entries(incoming)) {
    const existing = merged[id];
    if (!existing) {
      merged[id] = problem;
      continue;
    }

    // `solvedAt` is the only timestamp every record has carried since the
    // first version, which makes it the one safe thing to compare on.
    merged[id] = problem.solvedAt > existing.solvedAt ? problem : existing;
  }

  return merged;
}

export function mergeJournals(
  current: Record<string, AttemptEvent[]>,
  incoming: Record<string, AttemptEvent[]>,
): Record<string, AttemptEvent[]> {
  const merged: Record<string, AttemptEvent[]> = { ...current };

  for (const [id, events] of Object.entries(incoming)) {
    const existing = merged[id] ?? [];
    const seen = new Set(existing.map((event) => `${event.at}:${event.kind}:${event.verdict}`));
    const extra = events.filter(
      (event) => !seen.has(`${event.at}:${event.kind}:${event.verdict}`),
    );
    merged[id] = [...existing, ...extra].sort((a, b) => a.at - b.at);
  }

  return merged;
}

/** Where the backup lives inside the synced repository. */
export const BACKUP_PATH = '.redo/backup.json';

export function backupFilename(at: number): string {
  return `${PRODUCT.toLowerCase()}-backup-${new Date(at).toISOString().slice(0, 10)}.json`;
}

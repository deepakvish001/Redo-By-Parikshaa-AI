import { DEFAULT_FOCUS } from './focus.ts';
import { appendEvent } from './journal.ts';
import type { ParikshaaCredentials } from './parikshaa.ts';
import type { UpsolveItem } from './upsolve.ts';
import {
  PLATFORMS,
  type AttemptEvent,
  type PendingCsesSubmission,
  type Platform,
  type Settings,
  type SolvedProblem,
} from './types.ts';

const KEYS = {
  settings: 'settings',
  problems: 'problems',
  meta: 'meta',
  journal: 'journal',
  parikshaaCredentials: 'parikshaaCredentials',
  parikshaaApi: 'parikshaaApiKey',
  upsolve: 'upsolve',
  pendingCsesSubmissions: 'pendingCsesSubmissions',
} as const;

export const PENDING_CSES_SUBMISSION_TTL_MS = 15 * 60_000;

/** Aggregate counters that do not belong to any single problem. */
export interface Meta {
  reviewsCompleted: number;
  /** `YYYY-MM-DD` of the last day the user reviewed anything. */
  lastReviewDay: string | null;
  currentStreak: number;
  longestStreak: number;
}

export const DEFAULT_SETTINGS: Settings = {
  github: {
    token: '',
    owner: '',
    repo: '',
    branch: 'main',
    enabled: false,
    commitMessage: 'solve: {title} ({platform})',
    backup: true,
  },
  parikshaa: {
    enabled: false,
  },
  diagnostics: {
    enabled: false,
  },
  contests: {
    remind: true,
    leadMinutes: 60,
    platforms: { codeforces: true, leetcode: true, codechef: true, atcoder: true },
  },
  wrapped: { notify: true },
  focus: DEFAULT_FOCUS,
  handles: { codeforces: '', leetcode: '', goal: 0 },
  revision: {
    intervals: [1, 3, 7, 21, 45, 90],
    skipEasy: false,
    notify: true,
  },
  // Every supported judge is tracked unless the user turns one off.
  platforms: Object.fromEntries(PLATFORMS.map((platform) => [platform, true])) as Record<
    Platform,
    boolean
  >,
};

const DEFAULT_META: Meta = {
  reviewsCompleted: 0,
  lastReviewDay: null,
  currentStreak: 0,
  longestStreak: 0,
};

async function readKey<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T | undefined) ?? fallback;
}

/** A selected CSES file is only valid for the brief trip to its result page. */
export function isPendingCsesSubmissionFresh(
  pending: Pick<PendingCsesSubmission, 'submittedAt'>,
  now: number,
): boolean {
  return Number.isFinite(pending.submittedAt)
    && pending.submittedAt <= now
    && now - pending.submittedAt <= PENDING_CSES_SUBMISSION_TTL_MS;
}

function prunePendingCsesSubmissions(
  pending: Record<string, PendingCsesSubmission>,
  now: number,
): Record<string, PendingCsesSubmission> {
  return Object.fromEntries(
    Object.entries(pending).filter(([, submission]) => isPendingCsesSubmissionFresh(submission, now)),
  );
}

async function readPendingCsesSubmissions(now: number): Promise<Record<string, PendingCsesSubmission>> {
  const pending = await readKey<Record<string, PendingCsesSubmission>>(KEYS.pendingCsesSubmissions, {});
  const fresh = prunePendingCsesSubmissions(pending, now);
  if (Object.keys(fresh).length !== Object.keys(pending).length) {
    await chrome.storage.local.set({ [KEYS.pendingCsesSubmissions]: fresh });
  }
  return fresh;
}

/** Saves one selected CSES file per task and prunes every expired capture. */
export async function savePendingCsesSubmission(
  submission: PendingCsesSubmission,
  now = Date.now(),
): Promise<void> {
  const pending = await readPendingCsesSubmissions(now);
  pending[submission.taskId] = submission;
  await chrome.storage.local.set({ [KEYS.pendingCsesSubmissions]: pending });
}

/** Reads the task's selected source, removing all captures that have expired. */
export async function getFreshPendingCsesSubmission(
  taskId: string,
  now = Date.now(),
): Promise<PendingCsesSubmission | undefined> {
  return (await readPendingCsesSubmissions(now))[taskId];
}

/** Consumes one CSES capture after an accepted result, while pruning the rest. */
export async function clearPendingCsesSubmission(taskId: string, now = Date.now()): Promise<void> {
  const pending = await readPendingCsesSubmissions(now);
  delete pending[taskId];
  await chrome.storage.local.set({ [KEYS.pendingCsesSubmissions]: pending });
}

export async function getSettings(): Promise<Settings> {
  const stored = await readKey<Partial<Settings>>(KEYS.settings, {});
  // Merged per-section so a settings shape added in a later version still gets
  // its defaults on an existing install.
  return {
    github: { ...DEFAULT_SETTINGS.github, ...stored.github },
    parikshaa: { ...DEFAULT_SETTINGS.parikshaa, ...stored.parikshaa },
    diagnostics: { ...DEFAULT_SETTINGS.diagnostics, ...stored.diagnostics },
    contests: {
      ...DEFAULT_SETTINGS.contests,
      ...stored.contests,
      platforms: { ...DEFAULT_SETTINGS.contests.platforms, ...stored.contests?.platforms },
    },
    wrapped: { ...DEFAULT_SETTINGS.wrapped, ...stored.wrapped },
    focus: { ...DEFAULT_SETTINGS.focus, ...stored.focus },
    handles: { ...DEFAULT_SETTINGS.handles, ...stored.handles },
    revision: { ...DEFAULT_SETTINGS.revision, ...stored.revision },
    platforms: { ...DEFAULT_SETTINGS.platforms, ...stored.platforms } as Record<Platform, boolean>,
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = {
    github: { ...current.github, ...patch.github },
    parikshaa: { ...current.parikshaa, ...patch.parikshaa },
    diagnostics: { ...current.diagnostics, ...patch.diagnostics },
    contests: { ...current.contests, ...patch.contests },
    wrapped: { ...current.wrapped, ...patch.wrapped },
    focus: { ...current.focus, ...patch.focus },
    handles: { ...current.handles, ...patch.handles },
    revision: { ...current.revision, ...patch.revision },
    platforms: { ...current.platforms, ...patch.platforms },
  };
  await chrome.storage.local.set({ [KEYS.settings]: next });
  return next;
}

export async function getProblems(): Promise<Record<string, SolvedProblem>> {
  return readKey<Record<string, SolvedProblem>>(KEYS.problems, {});
}

export async function getProblemList(): Promise<SolvedProblem[]> {
  return Object.values(await getProblems());
}

export async function getProblem(id: string): Promise<SolvedProblem | undefined> {
  return (await getProblems())[id];
}

export async function putProblem(problem: SolvedProblem): Promise<void> {
  const problems = await getProblems();
  problems[problem.id] = problem;
  await chrome.storage.local.set({ [KEYS.problems]: problems });
}

export async function updateProblem(
  id: string,
  mutate: (problem: SolvedProblem) => SolvedProblem,
): Promise<SolvedProblem | undefined> {
  const problems = await getProblems();
  const existing = problems[id];
  if (!existing) return undefined;
  const updated = mutate(existing);
  problems[id] = updated;
  await chrome.storage.local.set({ [KEYS.problems]: problems });
  return updated;
}

export async function deleteProblem(id: string): Promise<void> {
  const problems = await getProblems();
  delete problems[id];
  await chrome.storage.local.set({ [KEYS.problems]: problems });
}

/* ------------------------------------------------------- attempt journal */

/**
 * Runs and submits are recorded before a problem is ever solved — that is the
 * whole point — so they live in their own map keyed by `<platform>:<slug>`
 * rather than on the problem record.
 */
export async function getJournals(): Promise<Record<string, AttemptEvent[]>> {
  return readKey<Record<string, AttemptEvent[]>>(KEYS.journal, {});
}

export async function getJournal(id: string): Promise<AttemptEvent[]> {
  return (await getJournals())[id] ?? [];
}

export async function appendJournalEvents(
  id: string,
  events: AttemptEvent[],
): Promise<AttemptEvent[]> {
  const journals = await getJournals();
  let entries = journals[id] ?? [];
  for (const event of events) entries = appendEvent(entries, event);
  journals[id] = entries;
  await chrome.storage.local.set({ [KEYS.journal]: pruneJournals(journals, Date.now()) });
  return entries;
}

/**
 * Journals for problems that were never solved are only interesting while the
 * attempt is recent — otherwise every abandoned problem accumulates forever.
 */
export function pruneJournals(
  journals: Record<string, AttemptEvent[]>,
  now: number,
  solvedIds: Set<string> = new Set(),
  maxAgeMs = 30 * 86_400_000,
): Record<string, AttemptEvent[]> {
  const kept: Record<string, AttemptEvent[]> = {};
  for (const [id, events] of Object.entries(journals)) {
    if (events.length === 0) continue;
    const last = events[events.length - 1]?.at ?? 0;
    if (solvedIds.has(id) || now - last <= maxAgeMs) kept[id] = events;
  }
  return kept;
}

export async function deleteJournal(id: string): Promise<void> {
  const journals = await getJournals();
  delete journals[id];
  await chrome.storage.local.set({ [KEYS.journal]: journals });
}

export async function getParikshaaCredentials(): Promise<ParikshaaCredentials | undefined> {
  const stored = await readKey<ParikshaaCredentials | undefined>(KEYS.parikshaaCredentials, undefined);
  return stored;
}

export async function saveParikshaaCredentials(
  credentials: ParikshaaCredentials,
): Promise<void> {
  await chrome.storage.local.set({ [KEYS.parikshaaCredentials]: credentials });
}

export async function clearParikshaaCredentials(): Promise<void> {
  await chrome.storage.local.remove(KEYS.parikshaaCredentials);
}

export interface ParikshaaApi {
  /**
   * Parikshaa's publishable API key, observed once and kept so later visits do
   * not depend on catching a request in flight. It is public by design — it
   * ships in the site's own JavaScript — and grants nothing without a user
   * session alongside it.
   */
  apiKey: string;
  /**
   * The Supabase origin the site talks to. Kept because a browser profile can
   * hold sessions for several projects, and this is what says which one is
   * Parikshaa's.
   */
  origin?: string;
}

export async function getParikshaaApi(): Promise<ParikshaaApi | undefined> {
  const stored = await readKey<ParikshaaApi | string | undefined>(KEYS.parikshaaApi, undefined);
  if (!stored) return undefined;
  // An earlier version stored the bare key string.
  return typeof stored === 'string' ? { apiKey: stored } : stored;
}

export async function saveParikshaaApi(apiKey: string, origin?: string): Promise<void> {
  await chrome.storage.local.set({ [KEYS.parikshaaApi]: { apiKey, origin } });
}

/* -------------------------------------------------------- upsolve queue */

export async function getUpsolve(): Promise<UpsolveItem[]> {
  return readKey<UpsolveItem[]>(KEYS.upsolve, []);
}

export async function saveUpsolve(items: UpsolveItem[]): Promise<UpsolveItem[]> {
  await chrome.storage.local.set({ [KEYS.upsolve]: items });
  return items;
}

/* --------------------------------------------------------- backup/restore */

/** Everything a backup contains, read in one pass. */
export async function readEverything(): Promise<{
  settings: Settings;
  problems: Record<string, SolvedProblem>;
  journal: Record<string, AttemptEvent[]>;
  meta: Meta;
  upsolve: UpsolveItem[];
}> {
  const [settings, problems, journal, meta, upsolve] = await Promise.all([
    getSettings(),
    getProblems(),
    getJournals(),
    getMeta(),
    getUpsolve(),
  ]);
  return { settings, problems, journal, meta, upsolve };
}

/**
 * Writes a restored backup.
 *
 * Settings are written by section like `saveSettings` does, and the caller
 * decides what to merge — this only puts the result down, in as few writes as
 * possible so a restore cannot half-apply across a browser crash.
 */
export async function writeRestored(state: {
  problems: Record<string, SolvedProblem>;
  journal: Record<string, AttemptEvent[]>;
  meta?: Partial<Meta>;
  upsolve?: UpsolveItem[];
  settings?: Partial<Settings>;
}): Promise<void> {
  if (state.settings) await saveSettings(state.settings);
  const patch: Record<string, unknown> = {
    [KEYS.problems]: state.problems,
    [KEYS.journal]: state.journal,
  };
  if (state.meta) patch[KEYS.meta] = { ...(await getMeta()), ...state.meta };
  if (state.upsolve) patch[KEYS.upsolve] = state.upsolve;
  await chrome.storage.local.set(patch);
}

export async function getMeta(): Promise<Meta> {
  return { ...DEFAULT_META, ...(await readKey<Partial<Meta>>(KEYS.meta, {})) };
}

export async function saveMeta(patch: Partial<Meta>): Promise<Meta> {
  const next = { ...(await getMeta()), ...patch };
  await chrome.storage.local.set({ [KEYS.meta]: next });
  return next;
}

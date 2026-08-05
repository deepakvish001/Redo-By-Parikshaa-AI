import type { ParikshaaCredentials } from './parikshaa.ts';
import type { Platform, Settings, SolvedProblem } from './types.ts';

const KEYS = {
  settings: 'settings',
  problems: 'problems',
  meta: 'meta',
  parikshaaCredentials: 'parikshaaCredentials',
} as const;

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
  },
  parikshaa: {
    enabled: false,
  },
  revision: {
    intervals: [1, 3, 7, 21, 45, 90],
    skipEasy: false,
    notify: true,
  },
  platforms: {
    leetcode: true,
    codeforces: true,
  },
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

export async function getSettings(): Promise<Settings> {
  const stored = await readKey<Partial<Settings>>(KEYS.settings, {});
  // Merged per-section so a settings shape added in a later version still gets
  // its defaults on an existing install.
  return {
    github: { ...DEFAULT_SETTINGS.github, ...stored.github },
    parikshaa: { ...DEFAULT_SETTINGS.parikshaa, ...stored.parikshaa },
    revision: { ...DEFAULT_SETTINGS.revision, ...stored.revision },
    platforms: { ...DEFAULT_SETTINGS.platforms, ...stored.platforms } as Record<Platform, boolean>,
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = {
    github: { ...current.github, ...patch.github },
    parikshaa: { ...current.parikshaa, ...patch.parikshaa },
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

export async function getMeta(): Promise<Meta> {
  return { ...DEFAULT_META, ...(await readKey<Partial<Meta>>(KEYS.meta, {})) };
}

export async function saveMeta(patch: Partial<Meta>): Promise<Meta> {
  const next = { ...(await getMeta()), ...patch };
  await chrome.storage.local.set({ [KEYS.meta]: next });
  return next;
}

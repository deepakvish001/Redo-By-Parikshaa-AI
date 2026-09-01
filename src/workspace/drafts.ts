/**
 * What you had typed, kept per problem.
 *
 * The single most expensive thing a browser editor can do is lose work, so the
 * draft is written on every keystroke (debounced) rather than on close: a tab
 * that crashes, a laptop that sleeps and a stray ⌘W all end the same way, and
 * none of them run an unload handler you can rely on.
 */

export interface Draft {
  source: string;
  /** Codeforces' `programTypeId`, so the language comes back with the code. */
  languageId?: string;
  at: number;
}

export type DraftMap = Record<string, Draft>;

export const DRAFTS_KEY = 'workspaceDrafts';

/**
 * How many problems' drafts are kept.
 *
 * Not a storage limit — `unlimitedStorage` is on — but a limit on how much of
 * your source code this extension is holding at any moment. Sixty problems is
 * more than a person has open, and everything past it is code from months ago
 * that has already been committed.
 */
export const MAX_DRAFTS = 60;

/** `codeforces:1234A`, matching the key problems are stored under elsewhere. */
export function draftKey(contestId: string, index: string): string {
  return `codeforces:${contestId}${index.toUpperCase()}`;
}

/**
 * Stores a draft, dropping the oldest once there are too many.
 *
 * An empty draft is a deletion rather than a stored empty string: clearing the
 * editor should forget the problem, not remember that you cleared it, and
 * otherwise every problem you ever opened would hold a slot forever.
 */
export function putDraft(map: DraftMap, key: string, draft: Draft, limit = MAX_DRAFTS): DraftMap {
  const next: DraftMap = { ...map };

  if (draft.source.trim() === '') {
    delete next[key];
    return next;
  }

  next[key] = draft;

  const keys = Object.keys(next);
  if (keys.length <= limit) return next;

  // Oldest first, so the ones dropped are the ones untouched longest.
  const ordered = keys.sort((a, b) => (next[a]?.at ?? 0) - (next[b]?.at ?? 0));
  for (const stale of ordered.slice(0, keys.length - limit)) delete next[stale];

  return next;
}

export function readDraft(map: DraftMap, key: string): Draft | undefined {
  return map[key];
}

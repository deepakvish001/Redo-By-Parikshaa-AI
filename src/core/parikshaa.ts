/**
 * Parikshaa (parikshaa.org) sync.
 *
 * Parikshaa is a Supabase app whose `coding_problems` are keyed by the same
 * slugs LeetCode uses, so an accepted LeetCode submission can mark the matching
 * problem solved. Row-level security scopes every write to the signed-in user,
 * and the credentials come from the user's own browser session on parikshaa.org
 * — this file never holds a password and the extension ships no project keys.
 */

export interface ParikshaaCredentials {
  /** Supabase REST origin, derived from the session token's issuer claim. */
  url: string;
  /** Publishable key, observed from the site's own requests. Not a secret. */
  apiKey: string;
  accessToken: string;
  /** ms since epoch. */
  expiresAt: number;
  userId: string;
  email?: string;
  capturedAt: number;
}

/**
 * Language ids Parikshaa stores solutions under, with their Judge0 ids.
 * Anything outside this set cannot be represented in Parikshaa's editor, so
 * those submissions are skipped rather than written in a shape the app cannot
 * read back.
 */
const LANGUAGES: Record<string, { id: string; judge0Id: number }> = {
  python: { id: 'python', judge0Id: 71 },
  python3: { id: 'python', judge0Id: 71 },
  pypy: { id: 'python', judge0Id: 71 },
  cpp: { id: 'cpp', judge0Id: 54 },
  'c++': { id: 'cpp', judge0Id: 54 },
  'g++': { id: 'cpp', judge0Id: 54 },
  'clang++': { id: 'cpp', judge0Id: 54 },
  java: { id: 'java', judge0Id: 62 },
  javascript: { id: 'javascript', judge0Id: 63 },
  js: { id: 'javascript', judge0Id: 63 },
  node: { id: 'javascript', judge0Id: 63 },
  typescript: { id: 'typescript', judge0Id: 74 },
  c: { id: 'c', judge0Id: 50 },
  gcc: { id: 'c', judge0Id: 50 },
  go: { id: 'go', judge0Id: 60 },
  golang: { id: 'go', judge0Id: 60 },
  mysql: { id: 'mysql', judge0Id: 82 },
  sql: { id: 'sql', judge0Id: 82 },
};

/** Resolves a platform's language label to Parikshaa's editor language. */
export function parikshaaLanguage(
  language: string,
): { id: string; judge0Id: number } | undefined {
  const normalized = language.trim().toLowerCase();
  if (!normalized) return undefined;

  const exact = LANGUAGES[normalized];
  if (exact) return exact;

  // Same token walk as the file-extension mapping: match whole words and trim
  // version suffixes, so "GNU G++17" resolves but "whitespace" does not.
  for (const token of normalized.split(/[^a-z0-9+#.]+/)) {
    for (let candidate = token; candidate.length > 0; candidate = candidate.slice(0, -1)) {
      const hit = LANGUAGES[candidate];
      if (hit) return hit;
    }
  }
  return undefined;
}

export interface StoredSession {
  access_token?: string;
  expires_at?: number;
  user?: { id?: string; email?: string };
}

/**
 * supabase-js stores the session under `sb-<project-ref>-auth-token`; older
 * releases used the literal `supabase.auth.token`. Both may be split across
 * numbered chunks. Sibling keys like `…-auth-token-user` and
 * `…-auth-token-code-verifier` are deliberately not matched.
 */
const SESSION_KEY = /^(sb-.+-auth-token|supabase\.auth\.token)(\.\d+)?$/;

/** One stored session, and what could be worked out about it. */
export interface SessionCandidate {
  /** The localStorage keys it was assembled from. */
  keys: string[];
  session?: StoredSession;
  /** REST origin from the token's issuer claim, e.g. `https://<ref>.supabase.co`. */
  origin?: string;
  expiresAt?: number;
}

/** `sb-<ref>-auth-token.3` and `sb-<ref>-auth-token` belong to the same session. */
function baseKey(key: string): string {
  return key.replace(/\.\d+$/, '');
}

function parseSessionValue(raw: string): StoredSession | undefined {
  let text = raw;
  // Newer clients prefix the serialised session with `base64-`.
  if (text.startsWith('base64-')) {
    try {
      text = atob(text.slice('base64-'.length));
    } catch {
      return undefined;
    }
  }

  try {
    const parsed = JSON.parse(text) as StoredSession & { currentSession?: StoredSession };
    return parsed.currentSession ?? parsed;
  } catch {
    return undefined;
  }
}

/**
 * Every Supabase session stored on the page.
 *
 * A browser profile can hold sessions for several Supabase projects at once —
 * a project that was migrated away from, another app on the same domain — and
 * they sit side by side under different `sb-<ref>-auth-token` keys. Grouping by
 * base key keeps them apart; only the numbered chunks of one key are joined,
 * because concatenating two separate sessions produces `{…}{…}`, which is not
 * valid JSON and reads as a corrupt session rather than two good ones.
 */
export function readStoredSessions(storage: Storage): SessionCandidate[] {
  const groups = new Map<string, Array<[string, string]>>();

  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key || !SESSION_KEY.test(key)) continue;
    const value = storage.getItem(key);
    if (!value) continue;

    const group = groups.get(baseKey(key));
    if (group) group.push([key, value]);
    else groups.set(baseKey(key), [[key, value]]);
  }

  const candidates: SessionCandidate[] = [];
  for (const chunks of groups.values()) {
    // Numeric ordering matters — a plain sort puts ".10" before ".2".
    chunks.sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }));
    const keys = chunks.map(([key]) => key);
    const session = parseSessionValue(chunks.map(([, value]) => value).join(''));

    const claims = session?.access_token ? decodeJwtPayload(session.access_token) : undefined;
    const issuer = typeof claims?.iss === 'string' ? claims.iss : undefined;
    const exp = typeof claims?.exp === 'number' ? claims.exp * 1000 : undefined;

    candidates.push({
      keys,
      session,
      origin: issuer ? issuer.replace(/\/auth\/v1\/?$/, '') : undefined,
      expiresAt: session?.expires_at ? session.expires_at * 1000 : exp,
    });
  }

  return candidates;
}

/**
 * Chooses which stored session to use.
 *
 * When the page talks to a known Supabase origin, the session issued by that
 * same project is the only correct answer — picking another project's session
 * would authenticate against a database that knows nothing about it. Without
 * that hint, the longest-lived session is the best available guess.
 */
export function pickSession(
  candidates: SessionCandidate[],
  preferredOrigin?: string,
): SessionCandidate | undefined {
  const usable = candidates.filter((candidate) => candidate.session?.access_token);
  if (usable.length === 0) return undefined;

  if (preferredOrigin) {
    const matching = usable.find((candidate) => candidate.origin === preferredOrigin);
    if (matching) return matching;
  }

  return [...usable].sort((a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0))[0];
}

/** The session to authenticate with, preferring the project the page uses. */
export function readStoredSession(
  storage: Storage,
  preferredOrigin?: string,
): StoredSession | undefined {
  return pickSession(readStoredSessions(storage), preferredOrigin)?.session;
}

/**
 * Why the session read did or did not produce credentials.
 *
 * Deliberately carries no token, no key and no email — only the names of the
 * storage keys involved, a handful of booleans, and the token issuer's origin
 * (which is a public API endpoint). It exists so a failure explains itself
 * instead of being guessed at from the outside.
 */
export interface SessionDiagnostic {
  /** Names of localStorage keys that looked like a Supabase session. */
  matchedKeys: string[];
  /** Every key present, when nothing matched — the fastest way to spot a rename. */
  sampleKeys?: string[];
  /** How many distinct Supabase projects have a session stored here. */
  candidateCount: number;
  /** Their REST origins, so a mismatch with the page's project is visible. */
  candidateOrigins: string[];
  /** The origin the page itself talks to, when the observer has seen it. */
  preferredOrigin?: string;
  parsed: boolean;
  hasAccessToken: boolean;
  hasIssuer: boolean;
  hasUserId: boolean;
  issuer?: string;
}

export function diagnoseSession(storage: Storage, preferredOrigin?: string): SessionDiagnostic {
  const matchedKeys: string[] = [];
  const allKeys: string[] = [];

  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key) continue;
    allKeys.push(key);
    if (SESSION_KEY.test(key)) matchedKeys.push(key);
  }

  const candidates = readStoredSessions(storage);
  const chosen = pickSession(candidates, preferredOrigin);
  const session = chosen?.session;
  const claims = session?.access_token ? decodeJwtPayload(session.access_token) : undefined;
  const issuer = typeof claims?.iss === 'string' ? claims.iss : undefined;

  return {
    matchedKeys,
    // Only listed when nothing matched, and capped — this is a hint, not a dump.
    ...(matchedKeys.length === 0 ? { sampleKeys: allKeys.slice(0, 25) } : {}),
    candidateCount: candidates.length,
    candidateOrigins: candidates
      .map((candidate) => candidate.origin)
      .filter((origin): origin is string => Boolean(origin)),
    preferredOrigin,
    parsed: candidates.some((candidate) => candidate.session),
    hasAccessToken: Boolean(session?.access_token),
    hasIssuer: Boolean(issuer),
    hasUserId: Boolean(session?.user?.id ?? (typeof claims?.sub === 'string' ? claims.sub : '')),
    issuer: issuer ? issuer.replace(/\/auth\/v1\/?$/, '') : undefined,
  };
}

/** Decodes a JWT payload without verifying it — we only need its claims. */
export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const segment = token.split('.')[1];
  if (!segment) return undefined;
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Builds credentials from a Supabase session and an observed API key.
 *
 * The REST origin and user id come out of the token's own claims, so no
 * project identifiers need to be hard-coded or configured.
 */
export function credentialsFromSession(
  session: StoredSession,
  apiKey: string,
  now: number,
): ParikshaaCredentials | undefined {
  const accessToken = session.access_token;
  if (!accessToken || !apiKey) return undefined;

  const claims = decodeJwtPayload(accessToken);
  const issuer = typeof claims?.iss === 'string' ? claims.iss : '';
  // `iss` looks like https://<ref>.supabase.co/auth/v1
  const url = issuer.replace(/\/auth\/v1\/?$/, '');
  const userId = session.user?.id ?? (typeof claims?.sub === 'string' ? claims.sub : '');
  if (!url || !userId) return undefined;

  const expiresAt =
    typeof session.expires_at === 'number'
      ? session.expires_at * 1000
      : typeof claims?.exp === 'number'
        ? claims.exp * 1000
        : now;

  return {
    url,
    apiKey,
    accessToken,
    expiresAt,
    userId,
    email: session.user?.email,
    capturedAt: now,
  };
}

/**
 * Access tokens last about an hour. Refreshing them here would rotate the
 * refresh token and sign the user out of the website, so an expired
 * credential is treated as "wait for the next visit to parikshaa.org".
 */
export function isExpired(credentials: ParikshaaCredentials, now: number): boolean {
  // A small margin avoids firing a request that expires mid-flight.
  return credentials.expiresAt - 30_000 <= now;
}

export class ParikshaaError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ParikshaaError';
    this.status = status;
  }
}

function headers(credentials: ParikshaaCredentials, extra: Record<string, string> = {}) {
  return {
    apikey: credentials.apiKey,
    Authorization: `Bearer ${credentials.accessToken}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function rest<T>(
  credentials: ParikshaaCredentials,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${credentials.url}/rest/v1${path}`, {
    ...init,
    headers: { ...headers(credentials), ...(init.headers as Record<string, string> | undefined) },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const message =
      response.status === 401 || response.status === 403
        ? 'Parikshaa rejected the session. Open parikshaa.org and sign in again.'
        : `Parikshaa request failed (${response.status}): ${body.slice(0, 200)}`;
    throw new ParikshaaError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** True when Parikshaa has a published problem under this slug. */
export async function hasProblem(
  credentials: ParikshaaCredentials,
  slug: string,
): Promise<boolean> {
  const rows = await rest<Array<{ slug: string }>>(
    credentials,
    `/coding_problems?slug=eq.${encodeURIComponent(slug)}&select=slug&limit=1`,
  );
  return Array.isArray(rows) && rows.length > 0;
}

interface SolutionRow {
  notes?: string;
  code?: Record<string, string>;
  code_updated_at?: Record<string, number>;
}

export interface ParikshaaSubmission {
  slug: string;
  language: string;
  code: string;
  runtimeMs?: number;
  memoryKb?: number;
}

export interface ParikshaaSyncOutcome {
  status: 'synced' | 'skipped';
  reason?: string;
  problemSlug: string;
  url?: string;
}

/**
 * Records an accepted submission against a Parikshaa problem.
 *
 * Two writes, in this order:
 *  1. `user_problem_solutions` — the saved solution. The existing row is read
 *     first and merged, because the user may already have notes and solutions
 *     in other languages there that must survive.
 *  2. `code_submissions` — an `Accepted` row, which is what the app reads to
 *     tick a problem off across sheets and dashboards.
 */
export async function syncSubmission(
  credentials: ParikshaaCredentials,
  submission: ParikshaaSubmission,
): Promise<ParikshaaSyncOutcome> {
  const language = parikshaaLanguage(submission.language);
  if (!language) {
    return {
      status: 'skipped',
      problemSlug: submission.slug,
      reason: `Parikshaa has no editor language matching "${submission.language}".`,
    };
  }

  if (!(await hasProblem(credentials, submission.slug))) {
    return {
      status: 'skipped',
      problemSlug: submission.slug,
      reason: 'No Parikshaa problem uses this slug.',
    };
  }

  const existing = await rest<SolutionRow[]>(
    credentials,
    `/user_problem_solutions?user_id=eq.${credentials.userId}&problem_slug=eq.${encodeURIComponent(
      submission.slug,
    )}&select=notes,code,code_updated_at&limit=1`,
  );
  const current = existing?.[0];
  const now = Date.now();

  await rest(credentials, '/user_problem_solutions?on_conflict=user_id,problem_slug', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: credentials.userId,
      problem_slug: submission.slug,
      // Existing notes are kept verbatim — this sync adds a solution, it does
      // not have an opinion about what the user wrote.
      notes: current?.notes ?? '',
      code: { ...(current?.code ?? {}), [language.id]: submission.code },
      code_updated_at: { ...(current?.code_updated_at ?? {}), [language.id]: now },
      updated_at: new Date(now).toISOString(),
    }),
  });

  await rest(credentials, '/code_submissions', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: credentials.userId,
      problem_slug: submission.slug,
      language: language.id,
      language_id: language.judge0Id,
      source_code: submission.code,
      // Exactly this casing: the app derives solved slugs from `verdict === "Accepted"`.
      verdict: 'Accepted',
      runtime_ms: submission.runtimeMs ?? null,
      memory_kb: submission.memoryKb ?? null,
      is_submission: true,
    }),
  });

  return {
    status: 'synced',
    problemSlug: submission.slug,
    url: `https://parikshaa.org/library/problems/${submission.slug}`,
  };
}

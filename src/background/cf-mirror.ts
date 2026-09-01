import { STORES, idbGet, idbPut } from '../core/idb.ts';
import { codeforces, problemKeyOf } from './cf-api.ts';

/**
 * A local mirror of the two Codeforces tables everything else is a view of.
 *
 * The problemset — every problem's rating and tags — and your own submission
 * history. Between them they answer: what is this problem worth, what is it
 * about, have I solved it, and did I ever try. The rating chip on a problem
 * page, the ticks down a listing, the heatmap, the histogram, the doughnut, the
 * unsolved list, the recommender and the upsolve queue are all that same pair
 * of tables asked a different question.
 *
 * Fetching it once and keeping it is not an optimisation. Codeforces allows one
 * request every two seconds; nine features each fetching a three-megabyte
 * problemset would spend their whole time queued behind each other.
 */

/* ------------------------------------------------------------- problemset */

export interface CfProblemMeta {
  name: string;
  rating?: number;
  tags: string[];
}

interface ProblemsetCache {
  fetchedAt: number;
  /** `<contestId><index>` → what Codeforces says about it. */
  problems: Record<string, CfProblemMeta>;
}

/**
 * A week.
 *
 * New problems appear at every round, but a rating chip that is seven days
 * stale is wrong only for problems added since — and those are exactly the ones
 * whose rating Codeforces has not settled on yet anyway.
 */
const PROBLEMSET_TTL = 7 * 86_400_000;

const PROBLEMSET_KEY = 'problemset';

interface CfProblemRow {
  contestId?: number;
  index: string;
  name: string;
  rating?: number;
  tags?: string[];
}

let problemsetInFlight: Promise<ProblemsetCache> | undefined;

async function readProblemset(): Promise<ProblemsetCache | undefined> {
  return idbGet<ProblemsetCache>(STORES.cfProblems, PROBLEMSET_KEY);
}

/**
 * The problemset, fetched if it is missing or stale.
 *
 * Concurrent callers share one fetch: the problem rail and the listing
 * decorator both wake on the same page load, and two three-megabyte downloads
 * for the same data would be the whole point missed.
 */
export async function ensureProblemset(force = false): Promise<ProblemsetCache> {
  const cached = await readProblemset();
  if (!force && cached && Date.now() - cached.fetchedAt < PROBLEMSET_TTL) return cached;

  problemsetInFlight ??= (async () => {
    try {
      const result = await codeforces<{ problems: CfProblemRow[] }>('problemset.problems');
      const problems: Record<string, CfProblemMeta> = {};
      for (const row of result.problems) {
        // Gym and unofficial problems arrive without a contest id and cannot be
        // keyed the way every other part of the extension keys a problem.
        if (row.contestId === undefined) continue;
        problems[problemKeyOf(row.contestId, row.index)] = {
          name: row.name,
          rating: row.rating,
          tags: row.tags ?? [],
        };
      }

      const fresh: ProblemsetCache = { fetchedAt: Date.now(), problems };
      await idbPut(STORES.cfProblems, PROBLEMSET_KEY, fresh);
      return fresh;
    } finally {
      problemsetInFlight = undefined;
    }
  })();

  try {
    return await problemsetInFlight;
  } catch (error) {
    // A stale mirror beats no mirror: an API outage should dim the rating chip,
    // not blank it.
    if (cached) return cached;
    throw error;
  }
}

/* ----------------------------------------------------------- user history */

export interface CfUserCache {
  handle: string;
  fetchedAt: number;
  /** Problem keys with at least one accepted submission. */
  solved: string[];
  /** Problem keys submitted to and never accepted. */
  attempted: string[];
  /**
   * When each problem was first solved, in seconds since epoch.
   *
   * A pair array rather than a map because it serialises smaller, and this is
   * the largest thing in the cache — a three-thousand-problem history. The
   * heatmap is the only reader, and it wants exactly this.
   */
  solvedAt?: Array<[string, number]>;
  /** Last failure per never-solved problem, for the windowed charts. */
  attemptedAt?: Array<[string, number]>;
}

/**
 * An hour.
 *
 * Short, because the thing this drives — a tick beside a problem you solved
 * this morning — is wrong in the most annoying possible way when it lags. A
 * solve made through the extension updates the mirror immediately (see
 * `noteSolved`), so the hour only covers solves made elsewhere.
 */
const STATUS_TTL = 60 * 60_000;

interface CfSubmission {
  problem: { contestId?: number; index: string };
  verdict?: string;
  creationTimeSeconds?: number;
}

const statusInFlight = new Map<string, Promise<CfUserCache>>();

export async function ensureUserStatus(handle: string, force = false): Promise<CfUserCache> {
  const key = handle.trim().toLowerCase();
  if (!key) throw new Error('No Codeforces handle set.');

  const cached = await idbGet<CfUserCache>(STORES.cfStatus, key);
  if (!force && cached && Date.now() - cached.fetchedAt < STATUS_TTL) return cached;

  const existing = statusInFlight.get(key);
  if (existing) return existing;

  const pending = (async () => {
    try {
      // The whole history in one call. Codeforces has no incremental cursor, and
      // paging it would cost one request per page against the two-second limit.
      const submissions = await codeforces<CfSubmission[]>('user.status', { handle });

      const solved = new Set<string>();
      const tried = new Set<string>();
      const firstAccepted = new Map<string, number>();
      const lastTried = new Map<string, number>();

      for (const submission of submissions) {
        const { contestId, index } = submission.problem;
        if (contestId === undefined) continue;
        const problem = problemKeyOf(contestId, index);

        if (submission.verdict !== 'OK') {
          tried.add(problem);
          // The *most recent* failure, which is the date that answers "am I
          // still losing to this?" — unlike a solve, where the first one is
          // the moment worth recording.
          const failedAt = submission.creationTimeSeconds;
          if (failedAt !== undefined) {
            const seen = lastTried.get(problem);
            if (seen === undefined || failedAt > seen) lastTried.set(problem, failedAt);
          }
          continue;
        }

        solved.add(problem);
        // The *first* accepted one. Codeforces returns newest first, and a
        // re-solve years later would otherwise move the problem to today and
        // put a false square on the heatmap.
        const at = submission.creationTimeSeconds;
        if (at !== undefined) {
          const existing = firstAccepted.get(problem);
          if (existing === undefined || at < existing) firstAccepted.set(problem, at);
        }
      }

      const fresh: CfUserCache = {
        handle,
        fetchedAt: Date.now(),
        solved: [...solved],
        // Attempted means "tried and never got it" — a problem you failed twice
        // and then solved belongs in `solved` and nowhere else.
        attempted: [...tried].filter((problem) => !solved.has(problem)),
        solvedAt: [...firstAccepted],
        attemptedAt: [...lastTried].filter(([problem]) => !solved.has(problem)),
      };
      await idbPut(STORES.cfStatus, key, fresh);
      return fresh;
    } finally {
      statusInFlight.delete(key);
    }
  })();

  statusInFlight.set(key, pending);

  try {
    return await pending;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

/**
 * Records a solve locally, without waiting for the mirror to expire.
 *
 * The extension watches submissions land, so it knows about a solve the moment
 * it happens — an hour of a page still showing the problem as unsolved would be
 * the extension disagreeing with something the user just watched it record.
 */
export async function noteSolved(handle: string, problem: string): Promise<void> {
  const key = handle.trim().toLowerCase();
  const cached = await idbGet<CfUserCache>(STORES.cfStatus, key);
  if (!cached || cached.solved.includes(problem)) return;

  await idbPut(STORES.cfStatus, key, {
    ...cached,
    solved: [...cached.solved, problem],
    attempted: cached.attempted.filter((entry) => entry !== problem),
  } satisfies CfUserCache);
}

/* --------------------------------------------------------------- lookups */

export interface CfProblemView extends Partial<CfProblemMeta> {
  key: string;
  solved: boolean;
  attempted: boolean;
  /** False when the problemset could not be read at all. */
  known: boolean;
}

/**
 * What the page needs to know about a batch of problems, in one answer.
 *
 * Batched because a problemset listing is a hundred rows, and a hundred
 * messages to the service worker to colour a hundred chips would wake it a
 * hundred times.
 */
export async function lookup(
  keys: string[],
  handle?: string,
  /**
   * Problems Redo itself has recorded as solved. Unioned with the mirror
   * because the two can honestly disagree: anything solved before the mirror
   * existed is in Redo's records and not in an hour-old cache, and a page that
   * says "unsolved" about a problem the extension committed for you reads as
   * the extension having lost it.
   */
  alsoSolved: Set<string> = new Set(),
): Promise<Record<string, CfProblemView>> {
  const [problemset, status] = await Promise.all([
    ensureProblemset().catch(() => undefined),
    handle ? ensureUserStatus(handle).catch(() => undefined) : Promise.resolve(undefined),
  ]);

  const solved = new Set([...(status?.solved ?? []), ...alsoSolved]);
  const attempted = new Set(status?.attempted ?? []);

  const view: Record<string, CfProblemView> = {};
  for (const raw of keys) {
    const key = raw.toUpperCase();
    const meta = problemset?.problems[key];
    view[raw] = {
      key,
      ...meta,
      solved: solved.has(key),
      attempted: attempted.has(key),
      known: meta !== undefined,
    };
  }
  return view;
}

/* ----------------------------------------------------------------- people */

export interface CfHandleCard {
  handle: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  maxRank?: string;
  contribution?: number;
  organization?: string;
  country?: string;
  city?: string;
  lastOnlineSeconds?: number;
  registrationTimeSeconds?: number;
  avatar?: string;
}

interface CfUserInfo extends CfHandleCard {
  titlePhoto?: string;
}

/** Cards are short-lived in memory only — a rating does not change mid-session. */
const cards = new Map<string, { at: number; card: CfHandleCard }>();
const CARD_TTL = 15 * 60_000;

/**
 * Public profile details for a batch of handles.
 *
 * Batched because a standings page has a hundred handles on it and the API
 * takes them all in one call. Nothing here needs a session — it is the same
 * data the profile page prints.
 */
export async function handleCards(handles: string[]): Promise<Record<string, CfHandleCard>> {
  const wanted = [...new Set(handles.map((handle) => handle.trim()).filter(Boolean))];
  const now = Date.now();

  const out: Record<string, CfHandleCard> = {};
  const missing: string[] = [];

  for (const handle of wanted) {
    const cached = cards.get(handle.toLowerCase());
    if (cached && now - cached.at < CARD_TTL) out[handle] = cached.card;
    else missing.push(handle);
  }

  if (missing.length === 0) return out;

  try {
    const users = await codeforces<CfUserInfo[]>('user.info', { handles: missing.join(';') });
    for (const user of users) {
      const card: CfHandleCard = {
        handle: user.handle,
        rating: user.rating,
        maxRating: user.maxRating,
        rank: user.rank,
        maxRank: user.maxRank,
        contribution: user.contribution,
        organization: user.organization,
        country: user.country,
        city: user.city,
        lastOnlineSeconds: user.lastOnlineSeconds,
        registrationTimeSeconds: user.registrationTimeSeconds,
        avatar: user.titlePhoto,
      };
      cards.set(user.handle.toLowerCase(), { at: now, card });
      out[user.handle] = card;
    }
  } catch {
    // A handle that does not exist fails the whole call, so a miss returns what
    // was cached rather than nothing.
  }

  return out;
}

interface CfFriendSubmission {
  id: number;
  creationTimeSeconds: number;
  problem: { contestId?: number; index: string };
  author: { members: Array<{ handle: string }> };
  programmingLanguage: string;
  verdict?: string;
}

export interface FriendSolve {
  handle: string;
  submissionId: number;
  at: number;
  language: string;
  accepted: boolean;
  url: string;
}

/**
 * Which of these handles has solved this problem, and with what.
 *
 * One `user.status` call per handle, so the list is deliberately short and only
 * read on demand. Codeforces has no "who solved X" endpoint; this is the only
 * way to answer it without scraping the status page for every friend.
 */
export async function friendSolves(
  handles: string[],
  problem: string,
  limit = 6,
): Promise<FriendSolve[]> {
  const out: FriendSolve[] = [];

  for (const handle of handles.slice(0, limit)) {
    try {
      // `count` keeps this to one page rather than the whole history.
      const submissions = await codeforces<CfFriendSubmission[]>('user.status', {
        handle,
        from: '1',
        count: '2000',
      });

      const hit = submissions.find(
        (submission) =>
          submission.verdict === 'OK' &&
          submission.problem.contestId !== undefined &&
          problemKeyOf(submission.problem.contestId, submission.problem.index) === problem,
      );

      if (!hit) continue;
      out.push({
        handle,
        submissionId: hit.id,
        at: hit.creationTimeSeconds * 1000,
        language: hit.programmingLanguage,
        accepted: true,
        url: `https://codeforces.com/contest/${hit.problem.contestId}/submission/${hit.id}`,
      });
    } catch {
      // One unreadable handle should not cost the others.
    }
  }

  return out.sort((a, b) => b.at - a.at);
}

/** When each cache was last filled, for the Settings panel to report. */
export async function mirrorState(handle?: string): Promise<{
  problems: number;
  problemsAt: number;
  solved: number;
  statusAt: number;
}> {
  const [problemset, status] = await Promise.all([
    readProblemset(),
    handle ? idbGet<CfUserCache>(STORES.cfStatus, handle.trim().toLowerCase()) : undefined,
  ]);

  return {
    problems: Object.keys(problemset?.problems ?? {}).length,
    problemsAt: problemset?.fetchedAt ?? 0,
    solved: status?.solved.length ?? 0,
    statusAt: status?.fetchedAt ?? 0,
  };
}

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
      for (const submission of submissions) {
        const { contestId, index } = submission.problem;
        if (contestId === undefined) continue;
        const problem = problemKeyOf(contestId, index);
        if (submission.verdict === 'OK') solved.add(problem);
        else tried.add(problem);
      }

      const fresh: CfUserCache = {
        handle,
        fetchedAt: Date.now(),
        solved: [...solved],
        // Attempted means "tried and never got it" — a problem you failed twice
        // and then solved belongs in `solved` and nowhere else.
        attempted: [...tried].filter((problem) => !solved.has(problem)),
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

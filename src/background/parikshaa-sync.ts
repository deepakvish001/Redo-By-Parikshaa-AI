import {
  isExpired,
  syncSubmission,
  type ParikshaaCredentials,
} from '../core/parikshaa.ts';
import { getProblemList, getParikshaaCredentials, putProblem } from '../core/storage.ts';
import type { ParikshaaSyncState, Settings, SolvedProblem } from '../core/types.ts';

/**
 * Only LeetCode slugs line up with Parikshaa's `coding_problems.slug`.
 * Codeforces problems are keyed as `1352A`, which will never match, so they are
 * marked skipped rather than sent on a pointless round trip.
 */
const SUPPORTED_PLATFORMS = new Set(['leetcode']);

function unavailable(reason: string): ParikshaaSyncState {
  return { status: 'pending', reason };
}

/**
 * Syncs one problem, returning the state to store against it.
 *
 * A missing or stale session is not an error — it leaves the problem `pending`
 * so the next visit to parikshaa.org picks it up.
 */
export async function syncToParikshaa(
  problem: SolvedProblem,
  settings: Settings,
  credentials?: ParikshaaCredentials,
): Promise<ParikshaaSyncState> {
  if (!settings.parikshaa.enabled) return { status: 'disabled' };

  if (!SUPPORTED_PLATFORMS.has(problem.platform)) {
    return {
      status: 'skipped',
      reason: 'Parikshaa problems are matched by LeetCode slug, so Codeforces is not synced.',
    };
  }

  const session = credentials ?? (await getParikshaaCredentials());
  if (!session) {
    return unavailable('Waiting for a Parikshaa session — open parikshaa.org and sign in.');
  }
  if (isExpired(session, Date.now())) {
    return unavailable('The stored Parikshaa session expired. Open parikshaa.org to refresh it.');
  }

  try {
    const outcome = await syncSubmission(session, {
      slug: problem.slug,
      language: problem.language,
      code: problem.code,
    });

    if (outcome.status === 'skipped') {
      return { status: 'skipped', reason: outcome.reason };
    }
    return { status: 'synced', url: outcome.url, syncedAt: Date.now() };
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Retries everything left pending, called when a fresh session arrives from the
 * parikshaa.org content script. Runs sequentially — this is a background catch-up,
 * not something the user is waiting on.
 */
export async function flushPending(
  settings: Settings,
  credentials: ParikshaaCredentials,
): Promise<number> {
  if (!settings.parikshaa.enabled || isExpired(credentials, Date.now())) return 0;

  const pending = (await getProblemList()).filter(
    (problem) => problem.parikshaa.status === 'pending' || problem.parikshaa.status === 'error',
  );

  let synced = 0;
  for (const problem of pending) {
    const state = await syncToParikshaa(problem, settings, credentials);
    await putProblem({ ...problem, parikshaa: state });
    if (state.status === 'synced') synced += 1;
    // A dead session will fail every remaining item the same way.
    if (state.status === 'error') break;
  }
  return synced;
}

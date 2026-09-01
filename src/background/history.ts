import { codeforces } from './cf-api.ts';
import { getSettings } from '../core/storage.ts';
import {
  buildRounds,
  describeRun,
  roundProblems,
  summarise,
  type RatingChange,
  type Round,
  type RoundProblem,
} from '../core/history.ts';

/**
 * Contest history, one call for the list and one per round you open.
 *
 * `user.rating` gives every rated round in a single request, which is the whole
 * list. The per-problem breakdown needs `contest.standings` *per contest*, and
 * at one request every two seconds a hundred rounds would be three and a half
 * minutes of fetching for a panel nobody is staring at. So the list arrives at
 * once and a round fills in when you open it — and stays filled, because a
 * finished contest's standings never change.
 */

const CACHE_KEY = 'contestRounds';

interface Cache {
  handle: string;
  /** Contest id → problems, for rounds already opened. */
  problems: Record<string, RoundProblem[]>;
}

async function readCache(handle: string): Promise<Cache> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const cached = stored[CACHE_KEY] as Cache | undefined;
  // A different handle's rounds are somebody else's rounds.
  return cached && cached.handle === handle ? cached : { handle, problems: {} };
}

export interface HistoryData {
  handle: string;
  rounds: Round[];
  summary: ReturnType<typeof summarise>;
  /** One line about the recent run, when there are enough rounds to say one. */
  run?: string;
  reason?: string;
}

const EMPTY: HistoryData = {
  handle: '',
  rounds: [],
  summary: { rounds: 0, net: 0, best: undefined, worst: undefined, positive: 0, bestRank: undefined },
};

export async function buildHistory(): Promise<HistoryData> {
  const { handles } = await getSettings();
  const handle = handles.codeforces.trim();
  if (!handle) {
    return { ...EMPTY, reason: 'Add your Codeforces handle in Settings to see your rounds.' };
  }

  let changes: RatingChange[] = [];
  try {
    changes = await codeforces<RatingChange[]>('user.rating', { handle });
  } catch (error) {
    return {
      ...EMPTY,
      handle,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const cache = await readCache(handle);
  const rounds = buildRounds(changes).map((round) => ({
    ...round,
    problems: cache.problems[String(round.contestId)],
  }));

  return {
    handle,
    rounds,
    summary: summarise(rounds),
    run: describeRun(rounds),
    reason:
      rounds.length === 0
        ? `${handle} has not competed in a rated round yet.`
        : undefined,
  };
}

/**
 * Fills in one round's problems.
 *
 * Cached permanently once read: a finished contest's standings do not change,
 * and re-fetching them would spend the rate limit on an answer that is already
 * known.
 */
export async function loadRound(contestId: number): Promise<HistoryData> {
  const { handles } = await getSettings();
  const handle = handles.codeforces.trim();
  if (!handle) return buildHistory();

  const cache = await readCache(handle);
  if (!cache.problems[String(contestId)]) {
    try {
      const standings = await codeforces<{
        problems: Array<{ index: string; name: string; rating?: number }>;
        rows: Array<{ problemResults: Array<{ points: number; rejectedAttemptCount: number }> }>;
      }>('contest.standings', {
        contestId: String(contestId),
        handles: handle,
        showUnofficial: 'false',
      });

      const row = standings.rows[0];
      if (row) {
        cache.problems[String(contestId)] = roundProblems(standings.problems, row.problemResults);
        await chrome.storage.local.set({ [CACHE_KEY]: cache });
      }
    } catch {
      // A gym round, a deleted contest, or a rate limit. The list is still
      // worth showing; this one round simply stays collapsed.
    }
  }

  return buildHistory();
}

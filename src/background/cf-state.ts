import { bandFor, type DailyCandidate } from '../core/daily.ts';
import { getProblemList, getSettings } from '../core/storage.ts';
import { ensureProblemset, ensureUserStatus, type CfProblemMeta } from './cf-mirror.ts';

/**
 * The Codeforces picture, assembled once.
 *
 * Home, Insights and Train each need the same four things — the problemset,
 * what you have solved, what you abandoned, and roughly what level you are at —
 * and each was building them from the same two calls with the same three
 * subtleties. Three copies of that is three chances for them to drift apart and
 * quietly disagree about whether you have solved something.
 */

export interface CfState {
  handle: string;
  /** True when there is enough to answer with. */
  ok: boolean;
  /** Why not, when not. */
  reason?: string;

  problemset: Record<string, CfProblemMeta>;
  /** The problemset as pickable candidates — rated problems only. */
  candidates: DailyCandidate[];
  solved: Set<string>;
  /** Attempted and never accepted. Never overlaps `solved`. */
  attempted: Set<string>;
  /** Roughly where you are, rounded to a Codeforces band. */
  band: number;
  solvedAt: Array<[string, number]>;
  /** Last failure per never-solved problem, so the charts can be windowed. */
  attemptedAt: Array<[string, number]>;
}

const EMPTY = {
  problemset: {},
  candidates: [] as DailyCandidate[],
  solved: new Set<string>(),
  attempted: new Set<string>(),
  band: 800,
  solvedAt: [] as Array<[string, number]>,
  attemptedAt: [] as Array<[string, number]>,
};

export async function cfState(): Promise<CfState> {
  const settings = await getSettings();
  const handle = settings.handles.codeforces.trim();

  if (!handle) {
    return {
      ...EMPTY,
      handle: '',
      ok: false,
      reason: 'Add your Codeforces handle in Settings to turn this on.',
    };
  }

  const [problemset, status, problems] = await Promise.all([
    ensureProblemset().catch(() => undefined),
    ensureUserStatus(handle).catch(() => undefined),
    getProblemList(),
  ]);

  if (!problemset) {
    return {
      ...EMPTY,
      handle,
      ok: false,
      reason: 'Codeforces could not be reached, and there is no cached problemset yet.',
    };
  }

  // Redo's own records cover two gaps in the mirror: anything solved before the
  // mirror existed, and anything solved in the last hour that the cache has not
  // caught up with.
  const solved = new Set(status?.solved ?? []);
  for (const problem of problems) {
    if (problem.platform === 'codeforces') solved.add(problem.slug.toUpperCase());
  }
  const attempted = new Set((status?.attempted ?? []).filter((key) => !solved.has(key)));

  const candidates: DailyCandidate[] = Object.entries(problemset.problems)
    .filter(([, meta]) => meta.rating !== undefined)
    .map(([key, meta]) => ({ key, name: meta.name, rating: meta.rating!, tags: meta.tags }));

  // The 80th percentile of what has been solved, rather than a contest rating:
  // the hardest thing you actually get through is the better guide to what to
  // offer, and it costs no extra API call.
  const solvedRatings = [...solved]
    .map((key) => problemset.problems[key]?.rating)
    .filter((rating): rating is number => rating !== undefined)
    .sort((a, b) => a - b);

  return {
    handle,
    ok: true,
    problemset: problemset.problems,
    candidates,
    solved,
    attempted,
    band: bandFor(
      solvedRatings.length > 0
        ? solvedRatings[Math.floor(solvedRatings.length * 0.8)]
        : undefined,
    ),
    solvedAt: status?.solvedAt ?? [],
    attemptedAt: status?.attemptedAt ?? [],
  };
}

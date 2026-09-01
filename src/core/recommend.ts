import type { DailyCandidate } from './daily.ts';
import { problemUrl } from './daily.ts';
import type { TagCount } from './insights.ts';

/**
 * What to solve next, weighted by what actually beats you.
 *
 * Every recommender in the reference set works from difficulty and popularity —
 * the same two numbers Codeforces already shows on the problemset page. Redo
 * has a third that none of them do: how often *you* abandon a tag. A 1400
 * dynamic-programming problem and a 1400 implementation problem are the same
 * difficulty to a leaderboard and very different to a person who has never
 * finished a dynamic-programming problem.
 */

export interface Suggestion extends DailyCandidate {
  url: string;
  /** Why this one, in the user's own history. */
  because: string;
  score: number;
}

export interface RecommendOptions {
  /** The band to draw from. */
  rating: number;
  /** How many to return. */
  limit?: number;
  /** Tags to leave out — usually what another bucket already took. */
  exclude?: ReadonlySet<string>;
}

/**
 * A tag's weight: how often it goes unfinished, mildly.
 *
 * A tag you abandon half the time is worth about twice one you never abandon —
 * not ten times. The point is to tilt the list towards your gaps, not to serve
 * you nothing but your worst topic until you quit.
 */
function tagWeight(counts: Map<string, TagCount>, tag: string): number {
  const entry = counts.get(tag);
  if (!entry || entry.failRate === undefined) return 1;
  return 1 + entry.failRate;
}

/** True for a tag you have barely touched — worth surfacing on its own. */
function isUnexplored(counts: Map<string, TagCount>, tag: string): boolean {
  const entry = counts.get(tag);
  return !entry || entry.solved + entry.unsolved < 3;
}

export function recommend(
  candidates: DailyCandidate[],
  solved: ReadonlySet<string>,
  tags: TagCount[],
  options: RecommendOptions,
): Suggestion[] {
  const counts = new Map(tags.map((entry) => [entry.tag, entry]));
  const exclude = options.exclude ?? new Set<string>();

  const scored = candidates
    .filter(
      (candidate) =>
        candidate.rating === options.rating &&
        !solved.has(candidate.key) &&
        !candidate.tags.some((tag) => exclude.has(tag)),
    )
    .map((candidate) => {
      // The hardest tag on the problem decides, not the average: a problem is
      // as hard as its worst part, and averaging hides exactly the tag worth
      // practising.
      let best = 1;
      let reason = 'at your level';

      for (const tag of candidate.tags) {
        const weight = tagWeight(counts, tag);
        if (weight > best) {
          best = weight;
          const entry = counts.get(tag);
          reason = `${tag} — you leave ${Math.round((entry?.failRate ?? 0) * 100)}% of these unfinished`;
        } else if (best === 1 && isUnexplored(counts, tag)) {
          reason = `${tag} — barely touched`;
        }
      }

      return { ...candidate, url: problemUrl(candidate.key), because: reason, score: best };
    })
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  // One per tag-set, so a list of ten is ten different things to practise
  // rather than ten problems about the same weak topic.
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const suggestion of scored) {
    const signature = suggestion.tags.slice().sort().join('|');
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push(suggestion);
    if (out.length >= (options.limit ?? 5)) break;
  }

  return out;
}

/* ------------------------------------------------------------- readiness */

export interface BandReadiness {
  rating: number;
  solved: number;
  touched: number;
  /** Solved out of everything you have touched at this band. */
  rate: number;
}

export interface Readiness {
  target: number;
  bands: BandReadiness[];
  /** Bands below the target where you finish less often than you should. */
  gaps: number[];
  verdict: string;
}

/**
 * How close a band is to being yours.
 *
 * The measure is deliberately *your own* finish rate rather than a count:
 * solving forty 1400s means nothing if you abandoned sixty. Somebody ready for
 * 1600 finishes most of what they start at 1400 and 1500.
 */
const READY_RATE = 0.6;
const ENOUGH = 4;

export function readiness(
  target: number,
  solved: ReadonlySet<string>,
  attempted: ReadonlySet<string>,
  ratingOf: (key: string) => number | undefined,
): Readiness {
  const bands = new Map<number, { solved: number; touched: number }>();

  const add = (key: string, wasSolved: boolean) => {
    const rating = ratingOf(key);
    if (rating === undefined || rating > target) return;
    const entry = bands.get(rating) ?? { solved: 0, touched: 0 };
    entry.touched += 1;
    if (wasSolved) entry.solved += 1;
    bands.set(rating, entry);
  };

  for (const key of solved) add(key, true);
  for (const key of attempted) add(key, false);

  const rows: BandReadiness[] = [...bands.entries()]
    .map(([rating, entry]) => ({ rating, ...entry, rate: entry.solved / entry.touched }))
    .sort((a, b) => a.rating - b.rating);

  // Only the two bands below the target matter — a weak 800 says nothing about
  // whether 1600 is within reach.
  const nearby = rows.filter((row) => row.rating >= target - 200 && row.rating < target);
  const gaps = nearby
    .filter((row) => row.touched >= ENOUGH && row.rate < READY_RATE)
    .map((row) => row.rating);

  const tested = nearby.filter((row) => row.touched >= ENOUGH);

  return {
    target,
    bands: rows,
    gaps,
    verdict:
      tested.length === 0
        ? `Not enough problems at ${target - 200}–${target - 100} to say yet.`
        : gaps.length === 0
          ? `You finish most of what you start below ${target}. It is worth attempting.`
          : `You finish under ${Math.round(READY_RATE * 100)}% of what you start at ${gaps.join(' and ')} — that is the gap to close first.`,
  };
}

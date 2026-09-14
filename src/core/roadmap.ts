import type { BandReadiness, Suggestion } from './recommend.ts';
import type { TagCount } from './insights.ts';

/**
 * An ordered plan, from what is actually stopping you.
 *
 * Every other "practice roadmap" is a fixed syllabus: arrays, then sorting,
 * then binary search, the same list for everybody. Redo already knows which
 * bands you finish, which tags you abandon, and what you left behind in your
 * last three contests — so the plan can be about you instead.
 *
 * The order matters more than the contents, and it is not "hardest first". It
 * is:
 *
 *   1. **Weak bands below the target, lowest first.** Weakness compounds
 *      upward: there is no point grinding 1400s while you finish half of what
 *      you open at 1200. This is the wall, and it is almost always lower than
 *      people think.
 *   2. **The tags you abandon**, practised at a *comfortable* rating. A
 *      technique gap is learned at a difficulty where the technique is the only
 *      hard part, not at your ceiling where everything is.
 *   3. **Upsolve** — the problems your own recent contests left behind. Already
 *      relevant, already attempted, and the highest-value thing on the list
 *      once the foundations hold.
 *   4. **The target band itself**, last, because it is the reward rather than
 *      the training.
 *
 * The counts are computable rather than invented: the number of extra solves a
 * band needs is exactly the number that lifts its finish rate over the
 * threshold.
 */

export type StepKind = 'band' | 'tag' | 'upsolve' | 'target';

export interface Step {
  kind: StepKind;
  title: string;
  /** The evidence, in the user's own record. */
  why: string;
  /** The band to practise at. */
  rating: number;
  tags?: string[];
  /** How many problems this step asks for. */
  count: number;
  problems: Suggestion[];
}

export interface Roadmap {
  target: number;
  band: number;
  steps: Step[];
  /** Why there is no plan, when there is none. */
  reason?: string;
}

/** The finish rate a band needs before it counts as yours. */
export const READY_RATE = 0.6;
/** Below this a band's rate is noise, not a signal. */
export const ENOUGH = 4;
/** Problems asked for by a tag step, and by the target step. */
const TAG_COUNT = 4;

/**
 * How many more you have to finish at a band to cross the threshold.
 *
 * Solved `s` of `t` touched, wanting rate `r`: each new problem adds one to
 * both, so `(s + k) / (t + k) >= r` gives `k >= (r·t − s) / (1 − r)`. Exact,
 * and explainable to the person doing the solving — which a made-up "do ten"
 * is not.
 */
export function solvesNeeded(solved: number, touched: number, rate = READY_RATE): number {
  const needed = (rate * touched - solved) / (1 - rate);
  return needed <= 0 ? 0 : Math.ceil(needed);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** The bands below the target you do not finish often enough. */
export function weakBands(bands: BandReadiness[], target: number): BandReadiness[] {
  return bands
    .filter(
      (band) => band.rating < target && band.touched >= ENOUGH && band.rate < READY_RATE,
    )
    // Lowest first: fixing 1200 is what makes 1400 possible, not the reverse.
    .sort((a, b) => a.rating - b.rating);
}

/** The tags you give up on, worst first, ignoring the ones you barely touched. */
export function weakTags(tags: TagCount[], limit = 3): TagCount[] {
  return tags
    .filter((tag) => tag.failRate !== undefined && tag.failRate > 0.34)
    .sort((a, b) => (b.failRate ?? 0) - (a.failRate ?? 0))
    .slice(0, limit);
}

export interface RoadmapInput {
  target: number;
  band: number;
  bands: BandReadiness[];
  tags: TagCount[];
  /** Problems left behind by recent contests, already fetched. */
  upsolve: Array<{ id: string; name: string; url: string; index: string; contestName: string }>;
  /**
   * Problems for a step, drawn from the recommender. Given the band and the
   * tags to favour, because the roadmap decides *what* to practise and the
   * recommender decides *which*.
   */
  pick: (rating: number, tags: string[], limit: number) => Suggestion[];
}

export function buildRoadmap(input: RoadmapInput): Roadmap {
  const { target, band } = input;
  const steps: Step[] = [];

  /* 1 — the bands that are not yours yet */

  for (const weak of weakBands(input.bands, target)) {
    const count = solvesNeeded(weak.solved, weak.touched);
    if (count === 0) continue;

    steps.push({
      kind: 'band',
      rating: weak.rating,
      title: `Finish what you start at ${weak.rating}`,
      why: `You finish ${percent(weak.rate)} of the ${weak.rating}s you open — ${weak.solved} of ${weak.touched}. ${count} more without abandoning one takes that past ${percent(READY_RATE)}.`,
      count,
      problems: input.pick(weak.rating, [], Math.min(count, 4)),
    });
  }

  /* 2 — the techniques, at a rating where the technique is the hard part */

  const taught = weakTags(input.tags);
  // One band below where you are: learning a new technique at your ceiling
  // means failing for two reasons at once and not knowing which.
  const teachingBand = Math.max(800, band - 100);

  for (const tag of taught) {
    steps.push({
      kind: 'tag',
      rating: teachingBand,
      tags: [tag.tag],
      title: `Drill ${tag.tag} at ${teachingBand}`,
      why: `You leave ${percent(tag.failRate ?? 0)} of ${tag.tag} problems unfinished. At ${teachingBand} the technique is the only hard part.`,
      count: TAG_COUNT,
      problems: input.pick(teachingBand, [tag.tag], TAG_COUNT),
    });
  }

  /* 3 — what your own contests left behind */

  if (input.upsolve.length > 0) {
    const pick = input.upsolve.slice(0, 4);
    steps.push({
      kind: 'upsolve',
      rating: band,
      title: `Upsolve ${pick.length} from your recent rounds`,
      why: `You have ${input.upsolve.length} problem${input.upsolve.length === 1 ? '' : 's'} you did not finish in a contest. You have already read them, which is most of the work.`,
      count: pick.length,
      problems: pick.map((item) => ({
        key: item.id,
        name: item.name,
        rating: 0,
        tags: [],
        url: item.url,
        because: item.contestName,
        score: 0,
      })),
    });
  }

  /* 4 — the target itself */

  steps.push({
    kind: 'target',
    rating: target,
    title: `Solve at ${target}`,
    why:
      steps.length === 0
        ? `Nothing below ${target} is holding you back. This is the band to spend your time in.`
        : `Once the steps above hold, this is where the rating comes from.`,
    count: TAG_COUNT,
    problems: input.pick(target, [], TAG_COUNT),
  });

  return { target, band, steps };
}

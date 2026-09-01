/**
 * What your Codeforces history looks like, as pictures.
 *
 * Three of the reference extensions are chart packs over the same two tables —
 * the problemset, and your own submissions. Nothing here fetches anything: it
 * takes the mirror's two sets and shapes them, so every chart is a pure
 * function of data that was already on the machine.
 *
 * The charts are hand-drawn SVG rather than a library. There are four shapes,
 * they are twenty lines each, and a charting library would be several hundred
 * kilobytes on an extension that currently ships two hundred.
 */

export interface ProblemMeta {
  name: string;
  rating?: number;
  tags: string[];
}

export type Problemset = Record<string, ProblemMeta>;

/* ------------------------------------------------------------- histogram */

export interface Bin {
  rating: number;
  count: number;
  /** Problem keys in this bin, so a bar can be opened into a list. */
  keys: string[];
}

/** Solved problems per rating, in Codeforces' own hundred-point bands. */
export function ratingHistogram(solved: Iterable<string>, problemset: Problemset): Bin[] {
  const bins = new Map<number, string[]>();

  for (const key of solved) {
    const rating = problemset[key]?.rating;
    // An unrated problem has no band to sit in, and inventing one would put a
    // bar on the chart that means nothing.
    if (rating === undefined) continue;
    bins.set(rating, [...(bins.get(rating) ?? []), key]);
  }

  return [...bins.entries()]
    .map(([rating, keys]) => ({ rating, count: keys.length, keys: keys.sort() }))
    .sort((a, b) => a.rating - b.rating);
}

/* ------------------------------------------------------------------ tags */

export interface TagCount {
  tag: string;
  solved: number;
  /** Attempted and never accepted. */
  unsolved: number;
  /** 0–1. Undefined until there is enough to say anything. */
  failRate?: number;
}

/** Enough attempts that a rate is a rate rather than one bad afternoon. */
const MIN_TOUCHED = 4;

/**
 * Every tag you have touched, with how it went.
 *
 * Both halves matter: the doughnut wants the solved counts, and "worst tags"
 * wants the ratio. Computing them together is what keeps the two charts from
 * disagreeing about what a tag is.
 */
export function tagCounts(
  solved: Iterable<string>,
  attempted: Iterable<string>,
  problemset: Problemset,
): TagCount[] {
  const counts = new Map<string, { solved: number; unsolved: number }>();

  const add = (key: string, field: 'solved' | 'unsolved') => {
    for (const tag of problemset[key]?.tags ?? []) {
      const entry = counts.get(tag) ?? { solved: 0, unsolved: 0 };
      entry[field] += 1;
      counts.set(tag, entry);
    }
  };

  for (const key of solved) add(key, 'solved');
  for (const key of attempted) add(key, 'unsolved');

  return [...counts.entries()]
    .map(([tag, entry]) => {
      const touched = entry.solved + entry.unsolved;
      return {
        tag,
        ...entry,
        failRate: touched >= MIN_TOUCHED ? entry.unsolved / touched : undefined,
      };
    })
    .sort((a, b) => b.solved + b.unsolved - (a.solved + a.unsolved));
}

/** The tags you give up on most, worst first. */
export function worstTags(counts: TagCount[], limit = 6): TagCount[] {
  return counts
    .filter((entry) => entry.failRate !== undefined && entry.failRate > 0)
    .sort((a, b) => b.failRate! - a.failRate!)
    .slice(0, limit);
}

export interface BandOutcome {
  rating: number;
  solved: number;
  unsolved: number;
  failRate: number;
}

/** The same question asked of difficulty rather than topic. */
export function bandOutcomes(
  solved: Iterable<string>,
  attempted: Iterable<string>,
  problemset: Problemset,
): BandOutcome[] {
  const bands = new Map<number, { solved: number; unsolved: number }>();

  const add = (key: string, field: 'solved' | 'unsolved') => {
    const rating = problemset[key]?.rating;
    if (rating === undefined) return;
    const entry = bands.get(rating) ?? { solved: 0, unsolved: 0 };
    entry[field] += 1;
    bands.set(rating, entry);
  };

  for (const key of solved) add(key, 'solved');
  for (const key of attempted) add(key, 'unsolved');

  return [...bands.entries()]
    .map(([rating, entry]) => ({
      rating,
      ...entry,
      failRate: entry.unsolved / (entry.solved + entry.unsolved),
    }))
    .sort((a, b) => a.rating - b.rating);
}

export function worstBands(outcomes: BandOutcome[], limit = 4): BandOutcome[] {
  return outcomes
    .filter((entry) => entry.solved + entry.unsolved >= MIN_TOUCHED && entry.failRate > 0)
    .sort((a, b) => b.failRate - a.failRate)
    .slice(0, limit);
}

/* --------------------------------------------------------------- heatmap */

export interface HeatDay {
  /** `YYYY-MM-DD`, UTC — the same calendar the daily problem uses. */
  day: string;
  count: number;
  /** The hardest problem solved that day, which is what colours the square. */
  peak: number;
  keys: string[];
}

/**
 * A day grid coloured by the hardest thing solved, not by how many.
 *
 * This is the one genuinely better idea in the reference set. Codeforces' own
 * heatmap counts problems, so a day of ten 800s outshines a day with one 2400 —
 * which is exactly backwards as a picture of progress.
 */
export function heatmap(
  solvedAt: Iterable<[string, number]>,
  problemset: Problemset,
): Map<string, HeatDay> {
  const days = new Map<string, HeatDay>();

  for (const [key, seconds] of solvedAt) {
    const day = new Date(seconds * 1000).toISOString().slice(0, 10);
    const entry = days.get(day) ?? { day, count: 0, peak: 0, keys: [] };
    entry.count += 1;
    entry.keys.push(key);
    entry.peak = Math.max(entry.peak, problemset[key]?.rating ?? 0);
    days.set(day, entry);
  }

  return days;
}

/** Every year the history touches, newest first, for the year selector. */
export function heatmapYears(solvedAt: Iterable<[string, number]>): number[] {
  const years = new Set<number>();
  for (const [, seconds] of solvedAt) years.add(new Date(seconds * 1000).getUTCFullYear());
  return [...years].sort((a, b) => b - a);
}

/**
 * The grid for one year, as columns of seven days starting on Monday.
 *
 * Leading blanks keep the weekday rows aligned — without them, January the
 * first lands on whichever row it likes and every row means a different day.
 */
export function heatmapGrid(year: number): string[][] {
  const start = new Date(Date.UTC(year, 0, 1));
  // `getUTCDay` is 0 for Sunday; Codeforces' own grid starts on Monday.
  const lead = (start.getUTCDay() + 6) % 7;

  const columns: string[][] = [];
  let column: string[] = Array.from({ length: lead }, () => '');

  for (
    let cursor = start.getTime();
    new Date(cursor).getUTCFullYear() === year;
    cursor += 86_400_000
  ) {
    column.push(new Date(cursor).toISOString().slice(0, 10));
    if (column.length === 7) {
      columns.push(column);
      column = [];
    }
  }

  if (column.length > 0) {
    while (column.length < 7) column.push('');
    columns.push(column);
  }

  return columns;
}

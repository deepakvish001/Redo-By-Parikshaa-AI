/**
 * Your LeetCode contest record, and what the next one is likely to do to it.
 *
 * Everything here comes from **LeetCode's own GraphQL API**, from your public
 * profile: which contests you entered, where you placed, how many problems you
 * solved and what your rating was afterwards. No third party is involved, and
 * no username is sent anywhere except to leetcode.com.
 *
 * That matters because of what is *not* here. A true prediction — the number a
 * rating predictor site shows in the hours after a contest — needs the current
 * rating of every one of the twenty-odd thousand people who entered it, and
 * LeetCode publishes other people's ratings nowhere. The sites that do it crawl
 * and store the whole field; using one would mean handing your username to
 * somebody else's server, which is the one thing this extension does not do.
 *
 * So the split is deliberate and is stated in the UI rather than blurred:
 *
 * - Once LeetCode has applied a contest, **its delta is a fact**, read back
 *   from your history.
 * - In the day or two before it does, an **estimate fitted to your own past
 *   results** is offered, with the spread it was fitted against, so a weak
 *   signal looks weak instead of looking like a prediction.
 */

/** Everyone starts here, so the first contest's delta has something to be from. */
export const STARTING_RATING = 1500;

/** One row of `userContestRankingHistory`, as LeetCode returns it. */
export interface LcHistoryRow {
  attended: boolean;
  rating: number;
  ranking: number;
  trendDirection?: string;
  problemsSolved?: number;
  totalProblems?: number;
  finishTimeInSeconds?: number;
  contest: { title: string; titleSlug?: string; startTime: number };
}

export interface LcContest {
  title: string;
  slug?: string;
  /** Milliseconds, so it lines up with everything else that stores a time. */
  at: number;
  rank: number;
  /** The rating after this contest, as LeetCode has it. */
  rating: number;
  ratingBefore: number;
  delta: number;
  solved?: number;
  total?: number;
  finishSeconds?: number;
  /**
   * True while LeetCode has published your rank but not yet moved your rating.
   * This is the window a predictor exists for.
   */
  pending: boolean;
}

/**
 * Turns the raw history into contests with a rating change on each.
 *
 * Oldest first, because a delta is the difference from the one before it and
 * reading the list in the order it happened is the only way that arithmetic
 * makes sense.
 *
 * A pending contest is one whose rating is identical to the previous contest's.
 * LeetCode publishes the entry the moment the contest ends and moves the rating
 * a day or so later, and until it does the entry simply repeats the old number.
 * An exactly unchanged rating is otherwise all but impossible — they are floats
 * carried to several decimal places.
 */
export function buildContests(rows: LcHistoryRow[]): LcContest[] {
  const attended = rows
    .filter((row) => row.attended)
    .sort((a, b) => a.contest.startTime - b.contest.startTime);

  const contests: LcContest[] = [];
  let previous = STARTING_RATING;

  for (const [index, row] of attended.entries()) {
    const pending = index > 0 && row.rating === previous;

    contests.push({
      title: row.contest.title,
      slug: row.contest.titleSlug,
      at: row.contest.startTime * 1000,
      rank: row.ranking,
      rating: row.rating,
      ratingBefore: previous,
      delta: pending ? 0 : row.rating - previous,
      solved: row.problemsSolved,
      total: row.totalProblems,
      finishSeconds: row.finishTimeInSeconds,
      pending,
    });

    previous = row.rating;
  }

  return contests;
}

export interface LcSummary {
  contests: number;
  /** Everything gained or lost since 1500. */
  net: number;
  up: number;
  bestRank: number;
  best?: LcContest;
  current: number;
}

export function summarise(contests: LcContest[]): LcSummary {
  const rated = contests.filter((contest) => !contest.pending);
  const best = rated.reduce<LcContest | undefined>(
    (found, contest) => (!found || contest.rank < found.rank ? contest : found),
    undefined,
  );

  return {
    contests: rated.length,
    net: Math.round(rated.reduce((total, contest) => total + contest.delta, 0)),
    up: rated.filter((contest) => contest.delta > 0).length,
    bestRank: best?.rank ?? 0,
    best,
    current: rated.at(-1)?.rating ?? STARTING_RATING,
  };
}

/* ------------------------------------------------------------ the estimate */

export interface DeltaFit {
  /** Delta ≈ intercept + slope · ln(rank). */
  slope: number;
  intercept: number;
  /** How many of your contests it was fitted to. */
  n: number;
  /** Typical distance between the fit and what actually happened. */
  spread: number;
  /** True when only contests near your current rating were used. */
  nearby: boolean;
}

/**
 * Fits your own rank-to-delta relationship.
 *
 * Against `ln(rank)` rather than rank: the difference between 500th and 1000th
 * is worth far more rating than the difference between 20,000th and 20,500th,
 * and a straight line through raw ranks would say they are the same.
 *
 * Contests are preferred from when your rating was near what it is now, because
 * the same rank is worth a very different delta at 1500 and at 2100 — the whole
 * point of Elo is that it depends on who you were expected to beat. That filter
 * is dropped when it leaves too little to fit, and `nearby` says which happened
 * so the caller can be honest about it.
 */
export function fitDelta(contests: LcContest[], currentRating: number, window = 150): DeltaFit | undefined {
  const rated = contests.filter((contest) => !contest.pending && contest.rank > 0);
  const near = rated.filter((contest) => Math.abs(contest.ratingBefore - currentRating) <= window);
  const sample = near.length >= 4 ? near : rated;

  // Four points is already thin for a two-parameter fit; three is not a fit at
  // all, it is a shape drawn through noise.
  if (sample.length < 4) return undefined;

  const xs = sample.map((contest) => Math.log(contest.rank));
  const ys = sample.map((contest) => contest.delta);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

  let covariance = 0;
  let variance = 0;
  for (const [index, x] of xs.entries()) {
    covariance += (x - meanX) * (ys[index]! - meanY);
    variance += (x - meanX) ** 2;
  }

  // Every contest at the same rank: no line to draw through them.
  if (variance === 0) return undefined;

  const slope = covariance / variance;
  const intercept = meanY - slope * meanX;

  // Divided by n - 2, not by n: two parameters were fitted from these same
  // points, so two of them are spent describing the line rather than testing
  // it. Dividing by n would report a tighter spread than the data supports —
  // which on this card would mean an estimate looking more certain than it is,
  // the exact failure the spread is here to prevent.
  const residuals = xs.map((x, index) => ys[index]! - (intercept + slope * x));
  const spread = Math.sqrt(
    residuals.reduce((total, r) => total + r * r, 0) / Math.max(1, residuals.length - 2),
  );

  return { slope, intercept, n: sample.length, spread, nearby: near.length >= 4 };
}

export interface DeltaEstimate {
  delta: number;
  /** Plus or minus. Wide means your own results have been inconsistent. */
  spread: number;
  n: number;
  nearby: boolean;
}

/**
 * What a given rank would probably do to your rating.
 *
 * An estimate from your own history, not a prediction from this contest's
 * field — which cannot be computed without every entrant's rating, and LeetCode
 * does not publish those. The spread is returned with it and is meant to be
 * shown: "+18 ± 30" is an honest way of saying "this is barely a signal".
 */
export function estimateDelta(fit: DeltaFit | undefined, rank: number): DeltaEstimate | undefined {
  if (!fit || rank <= 0) return undefined;

  return {
    delta: Math.round(fit.intercept + fit.slope * Math.log(rank)),
    spread: Math.max(1, Math.round(fit.spread)),
    n: fit.n,
    nearby: fit.nearby,
  };
}

/** The contest LeetCode has ranked but not yet rated, if there is one. */
export function pendingContest(contests: LcContest[]): LcContest | undefined {
  const last = contests.at(-1);
  return last?.pending ? last : undefined;
}

/**
 * A sentence about the recent run, or nothing.
 *
 * Nothing under four contests: three results is a mood, not a trend, and a
 * confident sentence about them would be the extension inventing a story.
 */
export function describeForm(contests: LcContest[], window = 5): string | undefined {
  const rated = contests.filter((contest) => !contest.pending);
  if (rated.length < 4) return undefined;

  const recent = rated.slice(-window);
  const net = Math.round(recent.reduce((total, contest) => total + contest.delta, 0));
  const up = recent.filter((contest) => contest.delta > 0).length;
  const span = `last ${recent.length}`;

  // "up in only 0 of them" is what a template writes; a person writes "none of
  // them went up".
  const how = up === 0 ? 'none of them went up' : `up in ${up} of them`;

  if (net > 0) return `+${net} over your ${span}, ${how}.`;
  if (net < 0) return `${net} over your ${span}, ${how}.`;
  return `Level over your ${span}, ${how}.`;
}

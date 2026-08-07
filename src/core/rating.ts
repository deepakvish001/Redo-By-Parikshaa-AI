/**
 * Codeforces' rating system, reimplemented.
 *
 * This is Mikhail Mirzayanov's published algorithm ("Open Codeforces Rating
 * System"), not an approximation of it. Given every participant's rank and
 * pre-contest rating it produces the same deltas Codeforces will apply, which
 * is the only way a prediction is worth showing — an estimate that is 40 points
 * out is worse than no number at all.
 *
 * The shape of it:
 *
 *   seed_i  = 1 + Σ_{j≠i} P(j beats i)      expected rank against the field
 *   m_i     = √(rank_i × seed_i)            geometric mean of actual and expected
 *   R_i     = the rating whose seed is m_i  (binary search)
 *   d_i     = (R_i − rating_i) / 2
 *
 * followed by two corrections that keep the system from inflating.
 */

export interface Participant {
  handle: string;
  /** Rank as the standings show it, before tie handling. */
  rank: number;
  /** Points, used only to detect ties. */
  points: number;
  /** Rating before this contest. */
  rating: number;
}

export interface RatingDelta {
  handle: string;
  rank: number;
  rating: number;
  delta: number;
  /** What the rating becomes if the prediction holds. */
  newRating: number;
  /** Expected rank given the field — better than this means a rise. */
  seed: number;
}

/** Elo: the chance a player rated `a` finishes above one rated `b`. */
export function winProbability(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/**
 * Ranks as Codeforces assigns them for ties.
 *
 * Everyone on the same score shares the *worst* rank in their group — five
 * people tied at the top are all rank 5, not rank 1. Getting this backwards
 * quietly inflates every prediction in a contest with ties, which is all of
 * them.
 */
export function reassignRanks(participants: Participant[]): Participant[] {
  const sorted = [...participants].sort((a, b) => b.points - a.points || a.rank - b.rank);
  const ranked = sorted.map((participant) => ({ ...participant }));

  let first = 0;
  for (let i = 1; i <= ranked.length; i += 1) {
    const ends = i === ranked.length || ranked[i]!.points < ranked[first]!.points;
    if (!ends) continue;
    for (let j = first; j < i; j += 1) ranked[j]!.rank = i;
    first = i;
  }

  return ranked;
}

const MIN_RATING = 1;
const MAX_RATING = 8000;

/**
 * The seed of every possible rating against this field, precomputed.
 *
 * The direct definition is O(n²) — thirty thousand participants would be nine
 * hundred million probability calculations, which is not something to run in a
 * side panel. Two observations collapse it: ratings are small integers, so the
 * field reduces to a few thousand buckets; and the binary search below needs
 * seeds at arbitrary ratings, so those are computed once for the whole range
 * rather than per participant. That is `range × buckets` ≈ 8000 × 1500, done
 * once.
 */
function seedTable(ratings: number[]): Float64Array {
  const counts = new Map<number, number>();
  for (const rating of ratings) counts.set(rating, (counts.get(rating) ?? 0) + 1);
  const buckets = [...counts.entries()];

  const table = new Float64Array(MAX_RATING + 1);
  for (let rating = MIN_RATING; rating <= MAX_RATING; rating += 1) {
    let seed = 1;
    for (const [value, count] of buckets) seed += count * winProbability(value, rating);
    table[rating] = seed;
  }
  return table;
}

/**
 * The rating whose seed — against the field *minus this participant* — is
 * `target`.
 *
 * Excluding the participant is not a detail. Their own contribution to the
 * seed varies with the rating being tested, so treating it as a constant ½
 * skews everyone's prediction: on a field of equal ratings it made the median
 * participant lose fifteen points for finishing exactly where expected.
 */
function ratingForSeed(target: number, table: Float64Array, ownRating: number): number {
  const seedWithout = (rating: number) => table[rating]! - winProbability(ownRating, rating);

  let low = MIN_RATING;
  let high = MAX_RATING;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (seedWithout(mid) < target) high = mid;
    else low = mid;
  }
  return low;
}

/**
 * Every participant's predicted delta.
 *
 * Exported whole rather than for one handle because the two corrections at the
 * end depend on the entire field — you cannot compute one person's change in
 * isolation.
 */
export function predictDeltas(participants: Participant[]): RatingDelta[] {
  if (participants.length === 0) return [];

  const ranked = reassignRanks(participants);
  const table = seedTable(ranked.map((participant) => participant.rating));

  const results = ranked.map((participant) => {
    // At their own rating the exclusion is exactly a half — they beat
    // themselves half the time — but that is a coincidence of this one point,
    // not a constant, which is why the search below recomputes it.
    const seed = table[participant.rating]! - 0.5;
    const middle = Math.sqrt(participant.rank * seed);
    const needed = ratingForSeed(middle, table, participant.rating);
    return {
      handle: participant.handle,
      rank: participant.rank,
      rating: participant.rating,
      seed,
      delta: Math.trunc((needed - participant.rating) / 2),
      newRating: 0,
    };
  });

  const total = results.reduce((sum, entry) => sum + entry.delta, 0);
  // First correction: the field as a whole must not gain rating.
  const spread = Math.trunc(-total / results.length) - 1;
  for (const entry of results) entry.delta += spread;

  // Second: the strongest 4√n participants, taken together, must not gain
  // either — this is what stops the top of the leaderboard drifting upwards
  // contest after contest.
  const byRating = [...results].sort((a, b) => b.rating - a.rating);
  const top = Math.min(byRating.length, Math.floor(4 * Math.round(Math.sqrt(byRating.length))));
  const topSum = byRating.slice(0, top).reduce((sum, entry) => sum + entry.delta, 0);
  const adjust = Math.min(Math.max(Math.trunc(-topSum / top), -10), 0);
  for (const entry of results) entry.delta += adjust;

  for (const entry of results) entry.newRating = entry.rating + entry.delta;
  return results;
}

/** One participant's prediction, or undefined when the handle did not compete. */
export function predictFor(
  participants: Participant[],
  handle: string,
): RatingDelta | undefined {
  const wanted = handle.trim().toLowerCase();
  return predictDeltas(participants).find(
    (entry) => entry.handle.toLowerCase() === wanted,
  );
}

/* ------------------------------------------------------------------ ranks */

/** The bands Codeforces itself uses, highest first. */
const CODEFORCES_RANKS: Array<{ from: number; title: string; colour: string }> = [
  { from: 3000, title: 'Legendary Grandmaster', colour: '#ff0000' },
  { from: 2600, title: 'International Grandmaster', colour: '#ff0000' },
  { from: 2400, title: 'Grandmaster', colour: '#ff0000' },
  { from: 2300, title: 'International Master', colour: '#ff8c00' },
  { from: 2100, title: 'Master', colour: '#ff8c00' },
  { from: 1900, title: 'Candidate Master', colour: '#aa00aa' },
  { from: 1600, title: 'Expert', colour: '#0000ff' },
  { from: 1400, title: 'Specialist', colour: '#03a89e' },
  { from: 1200, title: 'Pupil', colour: '#008000' },
  { from: 0, title: 'Newbie', colour: '#808080' },
];

export function codeforcesRank(rating: number): { title: string; colour: string } {
  const found = CODEFORCES_RANKS.find((entry) => rating >= entry.from);
  return found ?? { title: 'Unrated', colour: '#808080' };
}

/** The bottom of the band a rating sits in — where a progress bar starts. */
export function bandFloor(rating: number): number {
  return CODEFORCES_RANKS.find((entry) => rating >= entry.from)?.from ?? 0;
}

/**
 * LeetCode does not publish rank names, but the community uses these bands and
 * they line up with the badges the site awards.
 */
export function leetcodeBand(rating: number): { title: string; colour: string } {
  if (rating >= 2600) return { title: 'Guardian', colour: '#ff8c00' };
  if (rating >= 2200) return { title: 'Knight', colour: '#aa00aa' };
  if (rating >= 1900) return { title: 'Top 10%', colour: '#0000ff' };
  if (rating >= 1600) return { title: 'Above average', colour: '#03a89e' };
  return { title: 'Getting started', colour: '#808080' };
}

/* ------------------------------------------------------------ rating goals */

export interface RatingGoal {
  target: number;
  title: string;
  current: number;
  gap: number;
  /** Mean delta over the recent contests used for the projection. */
  perContest: number;
  /** Contests needed at that rate, or undefined when the trend is flat or down. */
  contests?: number;
  /** Mean days between those contests, for an ETA. */
  daysPerContest?: number;
  etaDays?: number;
}

/** The next band up, which is the goal almost everyone actually has. */
export function nextBand(rating: number): { from: number; title: string } | undefined {
  const above = [...CODEFORCES_RANKS]
    .filter((entry) => entry.from > rating)
    .sort((a, b) => a.from - b.from)[0];
  return above ? { from: above.from, title: above.title } : undefined;
}

export interface ContestResult {
  /** Seconds since epoch, as Codeforces reports them. */
  at: number;
  delta: number;
}

/**
 * How far the next band is, at the rate the recent contests set.
 *
 * Deliberately built on the last handful rather than the whole history: a
 * projection from two years ago describes somebody else. It reports no
 * estimate at all when the recent trend is flat or falling, because "∞
 * contests" is not a number worth printing.
 */
export function projectGoal(
  current: number,
  history: ContestResult[],
  window = 8,
  target?: number,
): RatingGoal | undefined {
  const band = target ? { from: target, title: codeforcesRank(target).title } : nextBand(current);
  if (!band) return undefined;

  const recent = history.slice(-window);
  const gap = band.from - current;

  const perContest =
    recent.length > 0 ? recent.reduce((sum, entry) => sum + entry.delta, 0) / recent.length : 0;

  const goal: RatingGoal = {
    target: band.from,
    title: band.title,
    current,
    gap,
    perContest: Number(perContest.toFixed(1)),
  };

  if (perContest <= 0 || gap <= 0) return goal;

  goal.contests = Math.ceil(gap / perContest);

  // Cadence comes from the gaps between contests actually entered, so somebody
  // who competes monthly is not told "six weeks".
  if (recent.length >= 2) {
    const spans: number[] = [];
    for (let i = 1; i < recent.length; i += 1) {
      spans.push((recent[i]!.at - recent[i - 1]!.at) / 86_400);
    }
    const days = spans.reduce((sum, span) => sum + span, 0) / spans.length;
    if (days > 0) {
      goal.daysPerContest = Math.round(days);
      goal.etaDays = Math.round(goal.contests * days);
    }
  }

  return goal;
}

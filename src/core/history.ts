/**
 * Your rated rounds, as a record rather than a number.
 *
 * Codeforces shows a rating graph and the standings of one contest at a time.
 * Neither answers the question people actually have after a bad round — *was
 * that a bad day or a pattern?* — because that needs the rounds side by side
 * with what you actually got out of each one: the rank, the delta, and which
 * problems you solved before the clock ran out.
 *
 * The shaping is here, away from the fetching, so it can be checked against
 * recorded API responses rather than against Codeforces.
 */

export interface RatingChange {
  contestId: number;
  contestName: string;
  rank: number;
  oldRating: number;
  newRating: number;
  ratingUpdateTimeSeconds: number;
}

export interface RoundProblem {
  index: string;
  name: string;
  rating?: number;
  /** Solved during the round itself. */
  solved: boolean;
  /** Rejected submissions during the round. */
  attempts: number;
}

export interface Round {
  contestId: number;
  name: string;
  /** Milliseconds, because everything else in the panel is. */
  at: number;
  rank: number;
  oldRating: number;
  newRating: number;
  delta: number;
  /** Filled once the standings for this round have been read. */
  problems?: RoundProblem[];
}

/** The rounds, newest first, from the rating history. */
export function buildRounds(changes: RatingChange[]): Round[] {
  return changes
    .map((change) => ({
      contestId: change.contestId,
      name: change.contestName,
      at: change.ratingUpdateTimeSeconds * 1000,
      rank: change.rank,
      oldRating: change.oldRating,
      newRating: change.newRating,
      delta: change.newRating - change.oldRating,
    }))
    .sort((a, b) => b.at - a.at);
}

/**
 * Per-problem outcome for one round.
 *
 * `points > 0` is the only honest test for "solved it": Codeforces awards
 * points per problem and zero of them means it never passed, whatever the
 * attempt count says. In an ICPC-rules round points are 1, which works the
 * same way.
 */
export function roundProblems(
  problems: Array<{ index: string; name: string; rating?: number }>,
  results: Array<{ points: number; rejectedAttemptCount: number }>,
): RoundProblem[] {
  return problems.map((problem, index) => ({
    index: problem.index.toUpperCase(),
    name: problem.name,
    rating: problem.rating,
    solved: (results[index]?.points ?? 0) > 0,
    attempts: results[index]?.rejectedAttemptCount ?? 0,
  }));
}

export interface HistorySummary {
  rounds: number;
  /** Net rating across every round shown. */
  net: number;
  best: Round | undefined;
  worst: Round | undefined;
  /** Rounds gained rating, out of rounds played. */
  positive: number;
  /** Best rank achieved, which is the smallest number. */
  bestRank: number | undefined;
}

export function summarise(rounds: Round[]): HistorySummary {
  if (rounds.length === 0) {
    return { rounds: 0, net: 0, best: undefined, worst: undefined, positive: 0, bestRank: undefined };
  }

  let best = rounds[0]!;
  let worst = rounds[0]!;
  let net = 0;
  let positive = 0;

  for (const round of rounds) {
    net += round.delta;
    if (round.delta > best.delta) best = round;
    if (round.delta < worst.delta) worst = round;
    if (round.delta > 0) positive += 1;
  }

  return {
    rounds: rounds.length,
    net,
    best,
    worst,
    positive,
    bestRank: Math.min(...rounds.map((round) => round.rank)),
  };
}

/**
 * A short, honest reading of the run.
 *
 * Deliberately refuses to say anything from two rounds. Codeforces deltas swing
 * by fifty points on luck, and "you are trending down" after two contests is
 * the kind of confident nonsense that makes people quit.
 */
export function describeRun(rounds: Round[], window = 5): string | undefined {
  if (rounds.length < 3) return undefined;

  const recent = rounds.slice(0, window);
  const net = recent.reduce((total, round) => total + round.delta, 0);
  const count = recent.length;

  if (net > 0) return `Up ${net} over your last ${count} rounds.`;
  if (net < 0) return `Down ${Math.abs(net)} over your last ${count} rounds.`;
  return `Level over your last ${count} rounds.`;
}

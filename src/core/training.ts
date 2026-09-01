import { hashString, problemUrl, type DailyCandidate } from './daily.ts';

/**
 * A contest you set yourself.
 *
 * The reference extension's insight is that the useful unit of practice is not
 * a problem, it is a *round*: five problems, two hours, no editorial, and a
 * clock. Codeforces only runs one of those a week, and you cannot choose what
 * it trains. Picking the ratings yourself turns the same problemset into a
 * speed drill, an endurance session, or an hour on the one band you keep
 * failing at.
 *
 * All of it is pure and all of it is stored, so closing the panel mid-round
 * does not lose the round.
 */

export interface TrainingProblem {
  key: string;
  name: string;
  rating: number;
  tags: string[];
  url: string;
  /** The rating this slot was asked for, which reroll draws from again. */
  slot: number;
}

export interface TrainingContest {
  id: string;
  startedAt: number;
  durationMs: number;
  problems: TrainingProblem[];
  /** Set when the user stops it early or the clock runs out and it is filed. */
  finishedAt?: number;
  /**
   * Problems already attempted and failed before the round began.
   *
   * Without this a problem you gave up on last year shows as "Tried" the second
   * the clock starts, and the live status stops meaning anything about the
   * round you are actually in.
   */
  attemptedBefore?: string[];
  /** Ratings asked for, so the UI can say when a slot could not be filled. */
  requested?: number[];
}

export type SlotState = 'solved' | 'attempted' | 'todo';

/** The longest a training round may run. Beyond this it is not a round. */
export const MAX_DURATION_MS = 6 * 60 * 60 * 1000;

function toProblem(candidate: DailyCandidate, slot: number): TrainingProblem {
  return { ...candidate, url: problemUrl(candidate.key), slot };
}

/**
 * Draws one problem at a rating, avoiding anything already taken.
 *
 * Seeded rather than random so a contest can be rebuilt from its id — and so
 * the tests can assert on a specific problem rather than on "something".
 */
export function drawAt(
  candidates: DailyCandidate[],
  rating: number,
  taken: ReadonlySet<string>,
  seed: string,
): DailyCandidate | undefined {
  const band = candidates
    .filter((candidate) => candidate.rating === rating && !taken.has(candidate.key))
    .sort((a, b) => a.key.localeCompare(b.key));
  if (band.length === 0) return undefined;
  return band[hashString(seed) % band.length];
}

/**
 * Builds a round from a list of wanted ratings.
 *
 * A slot with nothing left at its rating is dropped rather than filled from a
 * neighbouring band: you asked for a 1600 because you wanted a 1600, and
 * quietly handing you a 1400 would make the round train something else.
 */
export function buildContest(
  candidates: DailyCandidate[],
  ratings: number[],
  solved: ReadonlySet<string>,
  durationMinutes: number,
  now: number,
  seed = '',
  attempted: ReadonlySet<string> = new Set(),
): TrainingContest {
  const id = `${now.toString(36)}-${hashString(`${seed}:${ratings.join(',')}`).toString(36)}`;
  const taken = new Set(solved);
  const problems: TrainingProblem[] = [];

  for (const [index, rating] of ratings.entries()) {
    const drawn = drawAt(candidates, rating, taken, `${id}:${index}`);
    if (!drawn) continue;
    taken.add(drawn.key);
    problems.push(toProblem(drawn, rating));
  }

  return {
    id,
    startedAt: now,
    durationMs: Math.min(MAX_DURATION_MS, Math.max(1, durationMinutes) * 60_000),
    problems,
    requested: ratings,
    attemptedBefore: problems
      .map((problem) => problem.key)
      .filter((key) => attempted.has(key)),
  };
}

/**
 * Swaps one problem for another at the same rating.
 *
 * The salt is the current key, so rerolling twice gives two different problems
 * rather than flipping between the same pair.
 */
export function reroll(
  contest: TrainingContest,
  index: number,
  candidates: DailyCandidate[],
  solved: ReadonlySet<string>,
): TrainingContest {
  const current = contest.problems[index];
  if (!current) return contest;

  const taken = new Set([...solved, ...contest.problems.map((problem) => problem.key)]);
  const drawn = drawAt(candidates, current.slot, taken, `${contest.id}:${index}:${current.key}`);
  if (!drawn) return contest;

  const problems = [...contest.problems];
  problems[index] = toProblem(drawn, current.slot);
  return { ...contest, problems };
}

export function remainingMs(contest: TrainingContest, now: number): number {
  return Math.max(0, contest.startedAt + contest.durationMs - now);
}

export function isRunning(contest: TrainingContest, now: number): boolean {
  return !contest.finishedAt && remainingMs(contest, now) > 0;
}

/**
 * What became of each problem.
 *
 * Read from the same solved and attempted sets everything else uses, so a
 * problem solved in another tab shows here without the contest having to watch
 * for it.
 */
export function slotStates(
  contest: TrainingContest,
  solved: ReadonlySet<string>,
  attempted: ReadonlySet<string>,
): SlotState[] {
  // Only attempts made *during* this round count. A problem you abandoned a
  // year ago is a fine thing to put in a round; reporting it as already tried
  // is not.
  const before = new Set(contest.attemptedBefore ?? []);

  return contest.problems.map((problem) =>
    solved.has(problem.key)
      ? 'solved'
      : attempted.has(problem.key) && !before.has(problem.key)
        ? 'attempted'
        : 'todo',
  );
}

/** Ratings that had nothing left to draw, so the UI can say so. */
export function unfilled(contest: TrainingContest): number[] {
  const filled = contest.problems.map((problem) => problem.slot);
  const missing: number[] = [];

  for (const rating of contest.requested ?? []) {
    const index = filled.indexOf(rating);
    if (index === -1) missing.push(rating);
    else filled.splice(index, 1);
  }
  return missing;
}

export interface TrainingScore {
  solved: number;
  attempted: number;
  total: number;
  /** Minutes from the start to now, or to when it was filed. */
  elapsedMinutes: number;
}

export function score(
  contest: TrainingContest,
  states: SlotState[],
  now: number,
): TrainingScore {
  const end = contest.finishedAt ?? Math.min(now, contest.startedAt + contest.durationMs);
  return {
    solved: states.filter((state) => state === 'solved').length,
    attempted: states.filter((state) => state === 'attempted').length,
    total: contest.problems.length,
    elapsedMinutes: Math.max(0, Math.round((end - contest.startedAt) / 60_000)),
  };
}

/**
 * A sensible starting ladder for somebody at this level.
 *
 * Shaped like a real Div. 2: two you should get, one you should get with
 * thought, and two that are the point of entering.
 */
export function suggestedLadder(band: number): number[] {
  const clamp = (rating: number) => Math.min(3500, Math.max(800, rating));
  return [clamp(band - 200), clamp(band - 100), clamp(band), clamp(band + 100), clamp(band + 200)];
}

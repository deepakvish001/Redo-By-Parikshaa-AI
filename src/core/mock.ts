import type { SolvedProblem } from './types.ts';

/**
 * A timed interview round against yourself.
 *
 * Revision with the schedule is unhurried by design — you look at the note, you
 * rate how it went. An interview is not that: it is one problem, a clock, and
 * nobody to ask. The gap between "I know this one" and "I can write this one in
 * thirty-five minutes with someone watching" is the whole thing people are
 * actually preparing for, and nothing else in Redo measures it.
 *
 * So: one problem, a countdown, and the hints sealed until the clock stops.
 * Sealed rather than hidden — you can end the round early and everything opens,
 * which is the honest version of a lock. A lock you cannot open is a lock
 * people work around by opening the problem in another tab.
 */

export type MockOutcome = 'solved' | 'gave-up' | 'time-up';

export interface MockProblem {
  /** Set when the problem is one you have solved before. */
  id?: string;
  title: string;
  url: string;
  platform: string;
  slug: string;
  difficulty?: string;
}

export interface MockSession {
  startedAt: number;
  endsAt: number;
  minutes: number;
  problem: MockProblem;
  finishedAt?: number;
  outcome?: MockOutcome;
}

export interface MockState {
  session?: MockSession;
  running: boolean;
  /** Milliseconds left; 0 once the clock has run out. */
  remainingMs: number;
  /** Hints and your own past solution stay shut while this is true. */
  hintsLocked: boolean;
}

/** The lengths an interview round actually comes in. */
export const MOCK_LENGTHS = [20, 30, 45, 60];
export const DEFAULT_MOCK_MINUTES = 35;

/**
 * Problems worth being asked, oldest-reviewed first.
 *
 * Drawn from what you have already solved on purpose: an interview question is
 * one you are supposed to be able to do, and the interesting measurement is
 * whether you still can under a clock. A problem you have never seen would
 * measure something else entirely, and you already have the sheet tab for that.
 *
 * Least-recently-revised first, so the round asks about the things furthest
 * from your fingertips rather than what you did yesterday.
 */
export function mockCandidates(problems: SolvedProblem[], now: number, minAgeDays = 7): SolvedProblem[] {
  const floor = now - minAgeDays * 86_400_000;
  return problems
    .filter((problem) => (problem.revision?.lastReviewedAt ?? problem.solvedAt ?? 0) <= floor)
    .sort(
      (a, b) =>
        (a.revision?.lastReviewedAt ?? a.solvedAt ?? 0) - (b.revision?.lastReviewedAt ?? b.solvedAt ?? 0),
    );
}

/**
 * FNV-1a again, so a seed picks the same problem twice.
 *
 * `Math.random` would mean a round that could not be described, reproduced or
 * tested — and "reroll" needs to be a deliberate act, not something that
 * happens because the panel re-rendered.
 */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

/**
 * One of the oldest few, chosen by the seed.
 *
 * From a window rather than strictly the oldest, so rerolling gives you a
 * different problem instead of the same one back — but a small window, so the
 * round still asks about something genuinely stale.
 */
export function pickMock(
  candidates: SolvedProblem[],
  seed: string,
  window = 10,
): SolvedProblem | undefined {
  if (candidates.length === 0) return undefined;
  const pool = candidates.slice(0, Math.max(1, Math.min(window, candidates.length)));
  return pool[hash(seed) % pool.length];
}

export function startMock(problem: SolvedProblem, minutes: number, now: number): MockSession {
  const length = Math.max(1, Math.round(minutes));
  return {
    startedAt: now,
    endsAt: now + length * 60_000,
    minutes: length,
    problem: {
      id: problem.id,
      title: problem.title,
      url: problem.url,
      platform: problem.platform,
      slug: problem.slug,
      difficulty: problem.difficulty,
    },
  };
}

export function mockState(session: MockSession | undefined, now: number): MockState {
  if (!session || session.finishedAt) {
    return { session, running: false, remainingMs: 0, hintsLocked: false };
  }

  const remainingMs = Math.max(0, session.endsAt - now);
  return {
    session,
    running: remainingMs > 0,
    remainingMs,
    // The clock running out unlocks everything. A round that stays sealed after
    // time is up would just be a round you cannot review, and reviewing it is
    // the part that is worth anything.
    hintsLocked: remainingMs > 0,
  };
}

export interface MockResult {
  session: MockSession;
  /** How long it actually took, capped at the length of the round. */
  tookMs: number;
  /** True when it was finished inside the time. */
  inTime: boolean;
}

export function finishMock(session: MockSession, outcome: MockOutcome, now: number): MockResult {
  const finishedAt = Math.min(now, session.endsAt);
  const resolved: MockOutcome = now >= session.endsAt && outcome === 'solved' ? 'time-up' : outcome;

  return {
    session: { ...session, finishedAt: now, outcome: resolved },
    tookMs: Math.max(0, finishedAt - session.startedAt),
    inTime: resolved === 'solved',
  };
}

/** `08:42`, counting down. */
export function formatClock(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * What the round is worth saying afterwards.
 *
 * Deliberately plain. "Solved in 22 of 35 minutes" is a fact; congratulating
 * somebody for it would make the times they did not solve it feel like a
 * verdict, and the whole point of practising is to have some of those.
 */
export function describeResult(result: MockResult): string {
  const minutes = Math.round(result.tookMs / 60_000);
  if (result.session.outcome === 'solved') {
    return `Solved in ${minutes} of ${result.session.minutes} minutes.`;
  }
  if (result.session.outcome === 'time-up') {
    return `Time ran out after ${result.session.minutes} minutes.`;
  }
  return `Stopped after ${minutes} minutes.`;
}

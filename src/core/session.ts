import type { SolvedProblem } from './types.ts';
import { dayKey } from './analytics.ts';

/**
 * A revision session: the due list, one problem at a time.
 *
 * The Due tab has always been a list, and a list of nineteen problems is a
 * decision to make nineteen times before any work happens. A session makes it
 * one decision — start — and then hands you one problem, waits for the rating,
 * and moves on.
 *
 * The set is **fixed when the session starts**. Rating a problem changes when it
 * is next due, which would silently reshuffle a list you are halfway through and
 * make "3 of 8" mean nothing; and a solve during the session would add to the
 * pile you are trying to clear. A session you can finish is the whole point.
 */

export interface Session {
  /** The problems this session is for, in the order they will be offered. */
  ids: string[];
  startedAt: number;
  /** Ids already rated in this session. */
  done: string[];
}

/**
 * Twenty at most.
 *
 * Somebody coming back from a fortnight away has ninety problems due, and a
 * session that cannot be finished is a list with extra steps. Twenty is a
 * sitting; the rest are still there tomorrow, and the header says so rather
 * than hiding them.
 */
export const SESSION_CAP = 20;

export function startSession(due: SolvedProblem[], now: number, cap = SESSION_CAP): Session {
  return {
    // Whatever order the caller had — the due list is already most-overdue
    // first, and that is the right order to spend a limited sitting in.
    ids: due.slice(0, cap).map((problem) => problem.id),
    startedAt: now,
    done: [],
  };
}

/**
 * True for a session belonging to an earlier day.
 *
 * Reopening the panel on Tuesday to find Monday's half-finished session waiting
 * is confusing — Tuesday has its own due list, and the honest thing is to offer
 * a fresh session rather than resume one whose set is now wrong.
 */
export function isStale(session: Session, now: number): boolean {
  return dayKey(session.startedAt) !== dayKey(now);
}

export function markDone(session: Session, id: string): Session {
  return session.done.includes(id) ? session : { ...session, done: [...session.done, id] };
}

/**
 * What is left, in order.
 *
 * A problem rated somewhere else — on the judge's page, in the Due list, on
 * another machine that synced — counts as done here too. Offering it again
 * because this session did not personally witness the rating would be pedantic.
 */
export function remaining(
  session: Session,
  problems: Map<string, SolvedProblem>,
  now: number,
): SolvedProblem[] {
  const out: SolvedProblem[] = [];

  for (const id of session.ids) {
    if (session.done.includes(id)) continue;
    const problem = problems.get(id);
    // Gone, or no longer due — rated elsewhere while this session was open.
    if (!problem || problem.revision.dueAt > now) continue;
    out.push(problem);
  }

  return out;
}

export interface Progress {
  done: number;
  total: number;
  /** The one to do now, if the session is not finished. */
  current?: SolvedProblem;
}

export function progress(
  session: Session,
  problems: Map<string, SolvedProblem>,
  now: number,
): Progress {
  const left = remaining(session, problems, now);
  const total = session.ids.length;

  return { done: total - left.length, total, current: left[0] };
}

/** The heading for a session, said the way a person would say it. */
export function describeProgress(value: Progress): string {
  if (!value.current) return `All ${value.total} done.`;
  return `${value.done + 1} of ${value.total}`;
}

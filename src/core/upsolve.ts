/**
 * The problems a contest left behind.
 *
 * Upsolving — going back for what you could not get during the round — is the
 * habit that separates people who improve from people who just compete, and it
 * is almost always tracked by hand in a spreadsheet. The standings already say
 * which problems were attempted and failed and which were never opened, so the
 * list builds itself.
 */

export type UpsolveState = 'failed' | 'untouched' | 'done';

export interface UpsolveItem {
  /** `<contestId><index>`, e.g. `2248A` — the same key the adapter uses. */
  id: string;
  contestId: number;
  contestName: string;
  index: string;
  name: string;
  url: string;
  state: UpsolveState;
  /** Submissions made during the contest, all rejected. */
  attempts: number;
  addedAt: number;
  solvedAt?: number;
}

export interface ContestProblem {
  index: string;
  name: string;
}

/** One row of `problemResults`, as `contest.standings` returns it. */
export interface ProblemResult {
  points: number;
  rejectedAttemptCount: number;
}

/**
 * Splits a contest's problems into solved, fought-and-lost, and never-opened.
 *
 * The distinction matters for what to do next: a problem you submitted to four
 * times and could not pass is a gap in technique; one you never opened is
 * usually just time, and belongs lower in the queue.
 */
export function buildUpsolveList(
  contest: { id: number; name: string },
  problems: ContestProblem[],
  results: ProblemResult[],
  now: number,
): UpsolveItem[] {
  return problems
    .map((problem, index): UpsolveItem | undefined => {
      const result = results[index];
      const attempts = result?.rejectedAttemptCount ?? 0;
      const solved = (result?.points ?? 0) > 0;
      if (solved) return undefined;

      return {
        id: `${contest.id}${problem.index.toUpperCase()}`,
        contestId: contest.id,
        contestName: contest.name,
        index: problem.index.toUpperCase(),
        name: problem.name,
        url: `https://codeforces.com/contest/${contest.id}/problem/${problem.index}`,
        state: attempts > 0 ? ('failed' as const) : ('untouched' as const),
        attempts,
        addedAt: now,
      };
    })
    .filter((item): item is UpsolveItem => item !== undefined);
}

/**
 * Marks anything now solved as done, keeping the rest.
 *
 * Matched on the problem key rather than by removing entries, so the list
 * remembers that a problem was once an upsolve — that history is the point.
 */
export function reconcile(
  items: UpsolveItem[],
  solvedIds: Set<string>,
  now: number,
): UpsolveItem[] {
  return items.map((item) => {
    if (item.state === 'done') return item;
    // The adapter keys Codeforces problems as `codeforces:2248A`.
    if (!solvedIds.has(`codeforces:${item.id}`)) return item;
    return { ...item, state: 'done' as const, solvedAt: now };
  });
}

/** Merges a freshly built list into the stored one without losing progress. */
export function mergeUpsolve(current: UpsolveItem[], incoming: UpsolveItem[]): UpsolveItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const existing = byId.get(item.id);
    // A problem already upsolved stays upsolved even if the contest is re-read.
    byId.set(item.id, existing?.state === 'done' ? existing : { ...item, addedAt: existing?.addedAt ?? item.addedAt });
  }
  return [...byId.values()].sort(
    (a, b) => b.contestId - a.contestId || a.index.localeCompare(b.index),
  );
}

export interface UpsolveSummary {
  pending: number;
  failed: number;
  untouched: number;
  done: number;
}

export function summariseUpsolve(items: UpsolveItem[]): UpsolveSummary {
  return {
    pending: items.filter((item) => item.state !== 'done').length,
    failed: items.filter((item) => item.state === 'failed').length,
    untouched: items.filter((item) => item.state === 'untouched').length,
    done: items.filter((item) => item.state === 'done').length,
  };
}

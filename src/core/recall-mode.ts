import { applyRecall } from './srs.ts';
import type { Recall, RevisionState } from './types.ts';

/**
 * Two ways to revise, because the honest one is too expensive to do.
 *
 * A revision has always meant re-solving the problem. Nineteen due is ten
 * hours, so the queue grows, the schedule stops meaning anything, and the whole
 * feature quietly goes unused — which is a worse outcome than a weaker review
 * that actually happens.
 *
 * So there is a second tier: write down the approach from memory, then look at
 * your own note and your own solution, and rate what you find. Thirty seconds
 * instead of thirty minutes.
 *
 * **It is not worth the same, and it does not pretend to be.** Recalling an
 * approach is weaker evidence than writing the code again — you can hold "sort
 * it, then two pointers" perfectly and still not be able to produce the loop.
 * If both moved the ladder identically the schedule would drift optimistic, and
 * an optimistic spaced-repetition schedule is one that stops showing you the
 * things you are about to lose. So a recall can carry a problem up to a point
 * and no further; past that it holds its place until you actually re-solve it.
 */

export type ReviewMode = 'recall' | 'resolve';

/**
 * How far recall alone can take a problem.
 *
 * Stage 3 on the default ladder is a three-week interval — about as far as
 * "I remember the idea" honestly gets you. Beyond that the claim being made is
 * that you could write it today, and only writing it today supports that.
 */
export const RECALL_CEILING = 3;

export interface ReviewOutcome {
  revision: RevisionState;
  /**
   * True when a recall would have advanced the problem but was not allowed to.
   * The UI says so rather than silently doing less than the button implied.
   */
  held: boolean;
}

/**
 * Applies a review, capping what a recall can earn.
 *
 * A recall still counts: the review is recorded, the ease moves, and the
 * problem is rescheduled — checking and finding you still know it is real
 * information. What it cannot do is push the interval past the ceiling on its
 * own, so a problem at the top of the recall range keeps coming back at that
 * spacing until a full re-solve carries it further.
 *
 * A *bad* recall is never capped. Discovering you have forgotten something is
 * exactly as good evidence however you discovered it, and the whole point of
 * the schedule is to act on that quickly.
 */
export function applyReview(
  state: RevisionState,
  recall: Recall,
  mode: ReviewMode,
  intervals: number[],
  now: number,
): ReviewOutcome {
  const next = applyRecall(state, recall, intervals, now);
  const cap = Math.max(state.stage, RECALL_CEILING);
  if (mode === 'resolve' || next.stage <= cap) {
    return { revision: next, held: false };
  }

  // Capped — and the interval has to be capped with it.
  //
  // Clamping the stage after the fact is not enough: `applyRecall` computes the
  // next due date *from* the stage it just worked out, so a review held at
  // stage 3 was still being scheduled at stage 4's spacing. The stage said one
  // thing and the schedule did another, which is the cap not working at all.
  //
  // So the review is re-run against a starting stage lowered by exactly the
  // overshoot. Whatever this rating would have added, it now lands on the cap,
  // and the due date is computed from there. Ease, lapses and the review count
  // are unaffected by the starting stage, so they come out as they should.
  const held = applyRecall(
    { ...state, stage: state.stage - (next.stage - cap) },
    recall,
    intervals,
    now,
  );

  return { revision: held, held: true };
}

/** True when this problem has gone as far as recall can take it. */
export function needsFullResolve(state: RevisionState): boolean {
  return state.stage >= RECALL_CEILING;
}

/**
 * The prompt shown before anything is revealed.
 *
 * Deliberately asks for the *approach* rather than the answer: the thing worth
 * checking three months on is whether you can still reach for the right idea,
 * not whether you have the loop bounds memorised.
 */
export const RECALL_PROMPT = 'In one line: what is the approach?';

/**
 * What the check is worth, said plainly.
 *
 * Shown next to the rating buttons so nobody has to guess why a problem came
 * back sooner than the interval they expected.
 */
export function describeMode(mode: ReviewMode, held: boolean): string {
  if (mode === 'resolve') return 'Full re-solve — counts in full.';
  return held
    ? `Recall check. This one is at the top of what recall can earn — re-solve it to push the interval out further.`
    : 'Recall check — quicker than a re-solve, and worth less.';
}

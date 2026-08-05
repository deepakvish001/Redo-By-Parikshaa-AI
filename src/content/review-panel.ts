/**
 * The in-page revision panel, shared by every site that can show one.
 *
 * A revision happens on the problem page, so both the judge content script and
 * the Parikshaa one put the same panel up: rate how it went, or climb the hint
 * ladder first if you are stuck.
 */

import { buildHintLadder, type Hint } from '../core/hints.ts';
import { send } from '../core/messages.ts';
import { formatDueIn } from '../core/srs.ts';
import type { Recall, SolvedProblem } from '../core/types.ts';
import { showToast } from './toast.ts';

const RECALLS: Array<{ recall: Recall; label: string; primary?: boolean }> = [
  { recall: 'forgot', label: 'Forgot' },
  { recall: 'hard', label: 'Hard' },
  { recall: 'good', label: 'Good', primary: true },
  { recall: 'easy', label: 'Easy' },
];

/**
 * Reveals one rung of the ladder, and records it.
 *
 * Reaching for a hint is a real signal about how well a topic is known, so
 * each reveal is reported — that is what stops a topic you can only solve with
 * help from scoring the same as one you cannot.
 */
function showHint(problem: SolvedProblem, ladder: Hint[], index: number): void {
  const hint = ladder[index];
  if (!hint) return;

  void send({ type: 'problem:hint', id: problem.id, level: hint.level }).catch(() => undefined);

  const next = ladder[index + 1];
  showToast({
    title: `Hint ${hint.level} of ${ladder.length} — ${hint.title}`,
    body: hint.body,
    mono: hint.level === 3,
    tone: 'info',
    actions: next
      ? [
          {
            label: `Show ${next.title.toLowerCase()}`,
            onClick: () => showHint(problem, ladder, index + 1),
          },
        ]
      : [],
  });
}

export interface ReviewPanelOptions {
  /** Called after a rating is recorded, so callers can refresh their own state. */
  onReviewed?: () => void;
  /** ms before the nudge dismisses itself. */
  timeout?: number;
}

export function showReviewPanel(
  problem: SolvedProblem,
  options: ReviewPanelOptions = {},
): () => void {
  const solvedDaysAgo = Math.max(1, Math.round((Date.now() - problem.solvedAt) / 86_400_000));
  const ladder = buildHintLadder(problem);

  const dismiss = showToast({
    title: `Due for revision: ${problem.title}`,
    body: `You solved this ${solvedDaysAgo} day${
      solvedDaysAgo === 1 ? '' : 's'
    } ago. Re-solve it, then rate how it went.`,
    tone: 'info',
    actions: [
      {
        label: 'Stuck? Hint',
        keepOpen: true,
        onClick: () => showHint(problem, ladder, 0),
      },
      ...RECALLS.map(({ recall, label, primary }) => ({
        label,
        primary,
        onClick: async () => {
          try {
            const { problem: updated } = await send({
              type: 'problem:review',
              id: problem.id,
              recall,
            });
            options.onReviewed?.();
            if (updated) {
              showToast({
                title: 'Review recorded',
                body: `Scheduled again ${formatDueIn(updated.revision.dueAt, Date.now())}.`,
                tone: 'success',
                timeout: 5000,
              });
            }
          } catch (error) {
            showToast({
              title: 'Could not record the review',
              body: error instanceof Error ? error.message : String(error),
              tone: 'error',
            });
          }
        },
      })),
    ],
  });

  // The panel is a nudge, not a modal — it goes away on its own.
  setTimeout(dismiss, options.timeout ?? 45_000);
  return dismiss;
}

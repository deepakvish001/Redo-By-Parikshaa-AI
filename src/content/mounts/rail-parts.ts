import { buildHintLadder } from '../../core/hints.ts';
import { describeStruggle, summarise } from '../../core/journal.ts';
import { send, type RailData } from '../../core/messages.ts';
import { formatDueIn } from '../../core/srs.ts';
import type { Recall } from '../../core/types.ts';
import { button, h } from '../inject/dom.ts';
import type { MountContext } from '../inject/registry.ts';
import { showToast } from '../toast.ts';

/**
 * The parts of a problem rail that have nothing to do with which judge it is.
 *
 * What Redo knows about a problem — the attempts it took, the note you wrote,
 * whether it is due and the hint ladder behind it — is the same on Codeforces
 * and on LeetCode, and the second rail exists precisely because that knowledge
 * was only ever shown on one of them. Sharing the blocks rather than copying
 * them is what keeps the two from drifting into two different products.
 *
 * Everything judge-specific stays in the mount that knows about that judge:
 * Codeforces' rating colours and editorials, LeetCode's difficulty.
 */

export const RECALLS: Array<{ recall: Recall; label: string; primary?: boolean }> = [
  { recall: 'forgot', label: 'Forgot' },
  { recall: 'hard', label: 'Hard' },
  { recall: 'good', label: 'Good', primary: true },
  { recall: 'easy', label: 'Easy' },
];

/** What this problem has already cost you, from the attempt journal. */
export function historyRow(data: RailData): HTMLElement | null {
  const events = data.journal;
  const problem = data.problem;
  if (events.length === 0 && !problem) return null;

  const journal = summarise(events);
  const parts = [
    journal.submits > 0 && `${journal.submits} submit${journal.submits === 1 ? '' : 's'}`,
    journal.runs > 0 && `${journal.runs} run${journal.runs === 1 ? '' : 's'}`,
    problem &&
      `solved ${new Date(problem.solvedAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
      })}`,
    problem?.revision.struggle !== undefined && describeStruggle(problem.revision.struggle),
  ].filter(Boolean);

  if (parts.length === 0) return null;
  return h('div', { class: 'muted', text: parts.join(' · ') });
}

/** The note, and a box to write one. */
export function noteBlock(data: RailData, context: MountContext): HTMLElement | null {
  const problem = data.problem;
  if (!problem) return null;

  const wrap = h('div', { class: 'row', style: 'align-items:flex-start' });
  const text = h('div', { class: 'muted', style: 'flex:1;min-width:0' });
  text.textContent = problem.note?.trim() || 'No note yet.';
  if (!problem.note?.trim()) text.className = 'faint';

  const edit = button('Note', () => {
    wrap.replaceChildren();
    const box = h('textarea', { placeholder: 'How did you approach it? What tripped you up?' });
    box.value = problem.note ?? '';

    const save = button(
      'Save',
      async () => {
        save.disabled = true;
        try {
          await send({ type: 'problem:details', id: problem.id, note: box.value });
          context.refresh();
        } catch (error) {
          showToast({
            title: 'Could not save the note',
            body: error instanceof Error ? error.message : String(error),
            tone: 'error',
          });
          save.disabled = false;
        }
      },
      { class: 'primary' },
    );

    wrap.append(box, h('div', { class: 'row' }, save, button('Cancel', () => context.refresh(), { class: 'ghost' })));
    box.focus();
  }, { class: 'ghost' });

  wrap.append(text, edit);
  return wrap;
}

/** The revision prompt, when this problem is due. */
export function dueBlock(data: RailData, context: MountContext): HTMLElement | null {
  const problem = data.problem;
  if (!problem || !data.due) return null;

  const ladder = buildHintLadder(problem);
  let level = 0;

  const wrap = h('div', { class: 'row', style: 'flex-direction:column;align-items:stretch;gap:6px' });
  // `formatDueIn` phrases a deadline — on a past timestamp it says "overdue
  // 5d", which is nonsense about the day you solved something.
  const days = Math.max(1, Math.round((data.now - problem.solvedAt) / 86_400_000));

  wrap.append(
    h('div', { class: 'row' },
      h('span', { class: 'chip chip--due', text: 'Due for revision' }),
      h('span', {
        class: 'faint',
        text: `solved ${days} day${days === 1 ? '' : 's'} ago`,
      }),
    ),
  );

  const grid = h('div', { class: 'grid' });
  for (const { recall, label, primary } of RECALLS) {
    grid.append(
      button(
        label,
        async () => {
          try {
            const { problem: updated } = await send({
              type: 'problem:review',
              id: problem.id,
              recall,
            });
            showToast({
              title: 'Review recorded',
              body: updated
                ? `Scheduled again ${formatDueIn(updated.revision.dueAt, Date.now())}.`
                : 'Saved.',
              tone: 'success',
              timeout: 5000,
            });
            context.refresh();
          } catch (error) {
            showToast({
              title: 'Could not record the review',
              body: error instanceof Error ? error.message : String(error),
              tone: 'error',
            });
          }
        },
        { class: primary ? 'primary' : undefined },
      ),
    );
  }
  wrap.append(grid);

  if (ladder.length > 0) {
    const hint = button('Stuck? Hint', () => {
      const rung = ladder[level];
      if (!rung) return;
      level += 1;
      void send({ type: 'problem:hint', id: problem.id, level: rung.level }).catch(() => undefined);
      showToast({
        title: `Hint ${rung.level} of ${ladder.length} — ${rung.title}`,
        body: rung.body,
        mono: rung.level === 3,
        tone: 'info',
      });
      if (level >= ladder.length) hint.disabled = true;
    }, { class: 'ghost' });
    wrap.append(hint);
  }

  return wrap;
}

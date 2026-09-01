import { buildHintLadder } from '../../core/hints.ts';
import { describeStruggle, summarise } from '../../core/journal.ts';
import { send, type RailData } from '../../core/messages.ts';
import { formatDueIn } from '../../core/srs.ts';
import type { Recall, Settings } from '../../core/types.ts';
import { button, clock, h } from '../inject/dom.ts';
import type { Mount, MountContext } from '../inject/registry.ts';
import { showToast } from '../toast.ts';

/**
 * One card in the Codeforces sidebar, holding everything Redo knows about the
 * problem you are looking at.
 *
 * Nine of the reference extensions each put one of these facts on the page and
 * nothing else — the rating, the tags, a clock, your history, a standings link.
 * Every one of them is a fact Redo already had and had never shown anywhere
 * except a side panel you had to open on purpose.
 */

const PROBLEM_PATH =
  /\/(?:contest|gym)\/(\d+)\/problem\/([A-Za-z0-9]+)|\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/;

const RECALLS: Array<{ recall: Recall; label: string; primary?: boolean }> = [
  { recall: 'forgot', label: 'Forgot' },
  { recall: 'hard', label: 'Hard' },
  { recall: 'good', label: 'Good', primary: true },
  { recall: 'easy', label: 'Easy' },
];

export function parseProblem(pathname: string): { contestId: string; index: string } | null {
  const match = PROBLEM_PATH.exec(pathname);
  if (!match) return null;
  const contestId = match[1] ?? match[3];
  const index = match[2] ?? match[4];
  return contestId && index ? { contestId, index: index.toUpperCase() } : null;
}

/** Codeforces' own rank colours, which are what a rating means to a reader. */
export function ratingColour(rating: number | undefined): string {
  if (rating === undefined) return 'var(--text-faint)';
  if (rating >= 2400) return 'hsl(0 85% 66%)';
  if (rating >= 2100) return 'hsl(30 95% 60%)';
  if (rating >= 1900) return 'hsl(291 55% 66%)';
  if (rating >= 1600) return 'hsl(222 90% 68%)';
  if (rating >= 1400) return 'hsl(175 60% 48%)';
  if (rating >= 1200) return 'hsl(122 40% 55%)';
  return 'hsl(240 4% 62%)';
}

/* ------------------------------------------------------------- the pieces */

/**
 * The rating, and the tags kept behind a button.
 *
 * Hiding the tags is the point, not an accident of layout: knowing a problem is
 * rated 1600 tells you whether to attempt it, and knowing it is a segment tree
 * tells you the answer. Two of the reference extensions exist purely to
 * separate those two facts.
 */
function ratingRow(data: RailData, page: Settings['page']): HTMLElement | null {
  if (!page.rating) return null;
  const cf = data.cf;

  const row = h('div', { class: 'row' });

  if (cf?.rating !== undefined) {
    const chip = h('span', { class: 'chip chip--rating mono', text: `★ ${cf.rating}` });
    chip.style.color = ratingColour(cf.rating);
    row.append(chip);
  } else if (cf?.known) {
    row.append(h('span', { class: 'chip faint', text: 'Unrated' }));
  } else {
    row.append(h('span', { class: 'chip faint', text: 'Rating unavailable' }));
  }

  if (cf?.solved) row.append(h('span', { class: 'chip chip--ok', text: '✓ Solved' }));
  else if (cf?.attempted) row.append(h('span', { class: 'chip', text: 'Attempted' }));

  const tags = cf?.tags ?? [];
  if (page.tags && tags.length > 0) {
    const reveal = button('Reveal tags', () => {
      reveal.remove();
      for (const tag of tags) row.append(h('span', { class: 'chip chip--tag', text: tag }));
    }, { class: 'ghost' });
    row.append(reveal);
  }

  return row;
}

/** What this problem has already cost you, from the attempt journal. */
function historyRow(data: RailData): HTMLElement | null {
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
function noteBlock(data: RailData, context: MountContext): HTMLElement | null {
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
function dueBlock(data: RailData, context: MountContext): HTMLElement | null {
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

/* --------------------------------------------------------------- the mount */

async function render(context: MountContext): Promise<void> {
  const parsed = parseProblem(context.url.pathname);
  if (!parsed) return;

  const slug = `${parsed.contestId}${parsed.index}`;
  const data = await send({ type: 'rail:get', platform: 'codeforces', slug });
  if (context.signal.aborted) return;

  const card = h('div', { class: 'card' });
  const head = h('div', { class: 'head' },
    h('span', { class: 'head__mark', text: '↻' }),
    h('span', { class: 'head__title', text: 'Redo' }),
    h('span', { class: 'head__spacer' }),
  );

  // The clock starts when the page is opened, which the service worker already
  // records for the solve-time figure — this just shows it running.
  if (data.page.timer && data.openedAt) {
    const timer = h('span', { class: 'timer mono' });
    const tick = () => { timer.textContent = clock(Date.now() - data.openedAt!); };
    tick();
    const handle = setInterval(tick, 1000);
    context.signal.addEventListener('abort', () => clearInterval(handle));
    head.append(timer);
  }

  const body = h('div', { class: 'body' });
  const blocks = [
    ratingRow(data, data.page),
    dueBlock(data, context),
    historyRow(data),
    noteBlock(data, context),
  ].filter((block): block is HTMLElement => block !== null);

  for (const [index, block] of blocks.entries()) {
    if (index > 0) body.append(h('div', { class: 'sep' }));
    body.append(block);
  }

  const actions = h('div', { class: 'row' });
  actions.append(
    h('a', {
      href: `/contest/${parsed.contestId}/standings`,
      class: 'chip',
      style: 'text-decoration:none',
      text: 'Standings',
    }),
  );

  if (data.problem) {
    const push = button('Push to GitHub', async () => {
      push.disabled = true;
      push.textContent = 'Pushing…';
      try {
        const { problem } = await send({ type: 'problem:resync', id: data.problem!.id });
        showToast({
          title: problem?.github.status === 'synced' ? 'Pushed' : 'Could not push',
          body: problem?.github.error ?? problem?.github.path ?? 'Done.',
          tone: problem?.github.status === 'synced' ? 'success' : 'error',
          timeout: 6000,
        });
      } finally {
        push.disabled = false;
        push.textContent = 'Push to GitHub';
      }
    }, { class: 'ghost' });
    actions.append(push);
  }

  actions.append(
    button('Open Redo', () => {
      // The panel cannot be opened from a content script, so this is the
      // honest version: tell the user where the button is.
      showToast({
        title: 'Open the side panel',
        body: 'Click the Redo icon in the toolbar to open the full panel.',
        tone: 'info',
        timeout: 5000,
      });
    }, { class: 'ghost' }),
  );

  body.append(h('div', { class: 'sep' }), actions);
  card.append(head, body);
  context.el.replaceChildren(card);
}

export const codeforcesRail: Mount = {
  id: 'cf-rail',
  matches: (url) =>
    url.hostname.endsWith('codeforces.com') && parseProblem(url.pathname) !== null,
  enabled: (settings) => settings.page.rail,
  anchor: () => {
    // Codeforces' right-hand column, above its own boxes. `#sidebar` is the
    // long-standing id; the roomy fallback keeps the card somewhere visible if
    // that ever changes rather than dropping it entirely.
    const sidebar = document.querySelector('#sidebar');
    if (sidebar) return { parent: sidebar, position: 'afterbegin' };
    const statement = document.querySelector('.problem-statement');
    return statement ? { parent: statement, position: 'beforebegin' } : null;
  },
  render,
};

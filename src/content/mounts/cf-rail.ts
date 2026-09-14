import { isHost } from '../../core/hosts.ts';
import { parseProblem } from '../../core/cf-url.ts';
import { send, type RailData } from '../../core/messages.ts';
import type { Settings } from '../../core/types.ts';
import { button, clock, h } from '../inject/dom.ts';
import type { Mount, MountContext } from '../inject/registry.ts';
import { showToast } from '../toast.ts';
import { dueBlock, historyRow, noteBlock } from './rail-parts.ts';

/**
 * One card in the Codeforces sidebar, holding everything Redo knows about the
 * problem you are looking at.
 *
 * Nine of the reference extensions each put one of these facts on the page and
 * nothing else — the rating, the tags, a clock, your history, a standings link.
 * Every one of them is a fact Redo already had and had never shown anywhere
 * except a side panel you had to open on purpose.
 */

// Re-exported because the mount's own tests — and its readers — expect to find
// the page-matching rule next to the mount that uses it.
export { parseProblem };

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

/* --------------------------------------------------------------- the mount */

/**
 * A way out, and a way on.
 *
 * The editorial when you are beaten, and three like it when you are not — the
 * two things you go looking for at opposite ends of a problem, both of them a
 * search away today, which is far enough that most people do neither.
 *
 * The editorial link is not shown for a problem you have not solved unless you
 * ask for it: a link marked "Editorial" sitting in the corner of a problem you
 * are still thinking about is not an offer, it is a temptation, and the whole
 * hint ladder exists because giving the answer away is the easy mistake.
 */
function nextBlock(data: RailData): HTMLElement | null {
  if (!data.page.next) return null;

  const editorial = data.editorial;
  const similar = data.similar ?? [];
  if (!editorial && similar.length === 0) return null;

  const wrap = h('div', { class: 'row', style: 'flex-direction:column;align-items:stretch;gap:6px' });
  const solved = data.cf?.solved || data.problem !== undefined;

  if (editorial) {
    if (solved) {
      wrap.append(link(editorial.url, 'Read the editorial'));
    } else {
      // Behind one press, the same way the tags are.
      const reveal = button('Editorial', () => {
        reveal.replaceWith(link(editorial.url, 'Read the editorial'));
      }, { title: 'You have not solved this one yet' });
      wrap.append(reveal);
    }
  }

  if (similar.length > 0) {
    wrap.append(h('div', { class: 'label', text: 'MORE LIKE THIS' }));
    for (const problem of similar) {
      const row = link(problem.url, '');
      row.classList.add('similar');
      row.replaceChildren(
        h('span', { class: 'similar__name', text: problem.name }),
        (() => {
          const chip = h('span', { class: 'similar__rating mono', text: String(problem.rating) });
          chip.style.color = ratingColour(problem.rating);
          return chip;
        })(),
      );
      row.title = `Shares ${problem.shared.join(', ')}`;
      wrap.append(row);
    }
  }

  return wrap;
}

function link(href: string, text: string): HTMLAnchorElement {
  const anchor = h('a', { class: 'nextlink', text }) as HTMLAnchorElement;
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noreferrer';
  return anchor;
}

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
    nextBlock(data),
  ].filter((block): block is HTMLElement => block !== null);

  for (const [index, block] of blocks.entries()) {
    if (index > 0) body.append(h('div', { class: 'sep' }));
    body.append(block);
  }

  const actions = h('div', { class: 'row' });

  if (data.page.workspace) {
    const open = button('Open workspace', async () => {
      open.disabled = true;
      try {
        // The content script cannot inject a second bundle into its own tab, so
        // the request goes to the service worker, which knows which tab asked.
        const result = await send({ type: 'workspace:open' });
        if (!result.ok) {
          showToast({
            title: 'Could not open the workspace',
            body: result.error ?? 'Unknown error.',
            tone: 'error',
          });
        }
      } finally {
        open.disabled = false;
      }
    }, { class: 'primary', title: 'Statement beside an editor, on this page' });
    actions.append(open);
  }

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

  if (data.page.friends) {
    const friends = h('div', { class: 'row', style: 'flex-direction:column;align-items:stretch;gap:5px' });

    const load = button('Friends\u2019 code', async () => {
      load.disabled = true;
      load.textContent = 'Looking\u2026';
      try {
        const { solves, watched } = await send({ type: 'cf:friends', problem: slug });
        friends.replaceChildren();

        if (watched === 0) {
          friends.append(h('div', { class: 'faint', text: 'Add handles in Settings \u2192 People.' }));
        } else if (solves.length === 0) {
          friends.append(
            h('div', {
              class: 'faint',
              text: `None of your ${watched} handle${watched === 1 ? '' : 's'} has solved this.`,
            }),
          );
        } else {
          for (const solve of solves) {
            const link = h('a', { href: solve.url, style: 'flex:1;text-decoration:none' });
            link.textContent = solve.handle;
            friends.append(
              h('div', { class: 'row', style: 'gap:7px' },
                link,
                h('span', { class: 'faint', text: solve.language }),
                h('span', {
                  class: 'faint mono',
                  text: new Date(solve.at).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  }),
                }),
              ),
            );
          }
        }
        load.remove();
      } catch (error) {
        load.disabled = false;
        load.textContent = 'Friends\u2019 code';
        showToast({
          title: 'Could not read your friends\u2019 submissions',
          body: error instanceof Error ? error.message : String(error),
          tone: 'error',
        });
      }
    }, { class: 'ghost', title: 'One Codeforces call per handle, so it is on demand' });

    friends.append(load);
    body.append(h('div', { class: 'sep' }), friends);
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
    isHost(url.hostname, 'codeforces.com') && parseProblem(url.pathname) !== null,
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

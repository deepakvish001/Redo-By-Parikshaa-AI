import { isAnyHost } from '../../core/hosts.ts';
import { send, type RailData } from '../../core/messages.ts';
import type { Settings } from '../../core/types.ts';
import { clock, h } from '../inject/dom.ts';
import type { Mount, MountContext } from '../inject/registry.ts';
import { dueBlock, historyRow, noteBlock } from './rail-parts.ts';

/**
 * The same card, on LeetCode.
 *
 * Everything Redo knows about a problem — what it cost you, the note you wrote,
 * whether it is due and the hint ladder behind that — has only ever been shown
 * on Codeforces. Which is odd, because LeetCode is where most of the solving
 * happens: the extension has always *watched* it and never had anything to say
 * on it.
 *
 * The blocks are the shared ones, so the two rails cannot drift into two
 * different products. What is here is only what is LeetCode's own: where its
 * pages put a sidebar, how to read a slug out of the URL, and the difficulty,
 * which is LeetCode's answer to Codeforces' rating.
 */

/** `/problems/two-sum/` and every tab under it. */
export function parseSlug(pathname: string): string | undefined {
  return /^\/problems\/([^/]+)/.exec(pathname)?.[1];
}

/** LeetCode's own three words, in its own three colours. */
const DIFFICULTY: Record<string, string> = {
  easy: 'hsl(152 60% 45%)',
  medium: 'hsl(43 96% 52%)',
  hard: 'hsl(0 84% 62%)',
};

function difficultyRow(data: RailData, page: Settings['page']): HTMLElement | null {
  const problem = data.problem;
  if (!page.rating || !problem) return null;

  const row = h('div', { class: 'row' });
  const chip = h('span', { class: 'chip', text: problem.difficulty });
  chip.style.color = DIFFICULTY[problem.difficulty] ?? 'var(--text-muted)';
  row.append(chip);

  if (page.tags && problem.tags.length > 0) {
    // Behind a press, exactly as on Codeforces: knowing a problem is Medium
    // tells you whether to attempt it, knowing it is a monotonic stack tells
    // you the answer.
    const tags = h('span', { class: 'faint', text: problem.tags.join(', ') });
    tags.hidden = true;
    const reveal = h('button', { class: 'ghost', text: 'Reveal tags' }) as HTMLButtonElement;
    reveal.type = 'button';
    reveal.addEventListener('click', () => {
      tags.hidden = false;
      reveal.remove();
    });
    row.append(reveal, tags);
  }

  return row;
}

/**
 * Where LeetCode's problem page has room.
 *
 * It is a two-pane app with no sidebar of its own, and every container class in
 * it is generated — `.flexlayout__tab` today, something else after the next
 * deploy. So the card is fixed to the corner of the viewport rather than nailed
 * to a node whose name is a build artefact: it survives a redesign, and it
 * cannot push the site's own layout around.
 *
 * On the left, because the toast stack is on the right — and with a `×`,
 * because any fixed card on a two-pane app covers something.
 */
const HOST_STYLE = [
  'position:fixed',
  // Bottom *left*. Redo's own toast stack is bottom-right, and the first build
  // put the card underneath it — the revision toast and the card's own rating
  // buttons sitting on top of each other, both saying the same thing.
  'left:16px',
  'bottom:16px',
  'width:300px',
  'max-height:70vh',
  'overflow:auto',
  'z-index:2147482000',
].join(';');

async function render(context: MountContext): Promise<void> {
  const slug = parseSlug(context.url.pathname);
  if (!slug) return;

  const data = await send({ type: 'rail:get', platform: 'leetcode', slug });
  if (context.signal.aborted) return;

  // The mount's element lives in a shadow root; its host is the element the
  // runner put in the page, and that is the one to position.
  const root = context.el.getRootNode();
  const host = root instanceof ShadowRoot ? (root.host as HTMLElement) : undefined;

  // Nothing known and nothing due: no card. An empty box in the corner of a
  // problem you have never touched is clutter, not a feature.
  //
  // Hidden rather than removed: the runner puts the host back on the next
  // mutation, and LeetCode mutates constantly, so removing it here would be a
  // loop. `display:none` is the state that survives being re-evaluated.
  if (!data.problem && data.journal.length === 0) {
    if (host) host.style.cssText = 'display:none';
    context.el.replaceChildren();
    return;
  }

  if (host) host.style.cssText = HOST_STYLE;

  const card = h('div', { class: 'card' });
  const head = h('div', { class: 'head' },
    h('span', { class: 'head__mark', text: '↻' }),
    h('span', { class: 'head__title', text: 'Redo' }),
    h('span', { class: 'head__spacer' }),
  );

  if (data.page.timer && data.openedAt) {
    const timer = h('span', { class: 'timer mono' });
    const tick = () => {
      timer.textContent = clock(Date.now() - data.openedAt!);
    };
    tick();
    const handle = setInterval(tick, 1000);
    context.signal.addEventListener('abort', () => clearInterval(handle));
    head.append(timer);
  }

  const collapse = h('button', { class: 'ghost', text: '×', title: 'Hide until the next page' }) as HTMLButtonElement;
  collapse.type = 'button';
  collapse.addEventListener('click', () => host?.remove());
  head.append(collapse);

  const body = h('div', { class: 'body' });
  const blocks = [
    difficultyRow(data, data.page),
    dueBlock(data, context),
    historyRow(data),
    noteBlock(data, context),
  ].filter((block): block is HTMLElement => block !== null);

  for (const [index, block] of blocks.entries()) {
    if (index > 0) body.append(h('div', { class: 'sep' }));
    body.append(block);
  }

  card.append(head, body);
  context.el.replaceChildren(card);
}

export const leetcodeRail: Mount = {
  id: 'lc-rail',
  matches: (url) =>
    isAnyHost(url.hostname, ['leetcode.com', 'leetcode.cn']) &&
    parseSlug(url.pathname) !== undefined,
  enabled: (settings) => settings.page.rail,
  // Fixed to the viewport, so the anchor only has to be somewhere in the page.
  anchor: () => (document.body ? { parent: document.body, position: 'beforeend' } : null),
  render,
};

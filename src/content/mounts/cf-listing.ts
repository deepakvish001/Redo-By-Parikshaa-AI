import { send } from '../../core/messages.ts';
import type { Mount, MountContext } from '../inject/registry.ts';
import { ratingColour } from './cf-rail.ts';

/**
 * Rating, solved and due, marked down a listing page.
 *
 * The unusual one of the mounts: it has no card of its own, it annotates rows
 * the host page already drew. That means it cannot use a shadow root — a badge
 * inside a shadow root cannot sit inside a table cell — so it writes plain
 * elements with inline styles and a marker class, and removes exactly those on
 * teardown. Nothing else on the page is touched.
 *
 * Deliberately one span per row and no layout change. A listing that reflows
 * when the extension loads is worse than a listing with no badges.
 */

const MARK = 'redo-mark';

const PROBLEM_HREF = /\/(?:contest|gym)\/(\d+)\/problem\/([A-Za-z0-9]+)|\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/;

export function keyFromHref(href: string): string | null {
  const match = PROBLEM_HREF.exec(href);
  if (!match) return null;
  const contestId = match[1] ?? match[3];
  const index = match[2] ?? match[4];
  return contestId && index ? `${contestId}${index.toUpperCase()}` : null;
}

function badge(text: string, colour: string, title?: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = MARK;
  span.textContent = text;
  if (title) span.title = title;
  span.style.cssText = [
    'display:inline-block',
    'margin-left:6px',
    'padding:0 5px',
    'border-radius:4px',
    'font-size:10px',
    'font-weight:700',
    'font-family:ui-monospace,Menlo,monospace',
    'vertical-align:middle',
    'line-height:16px',
    `color:${colour}`,
    'border:1px solid currentColor',
  ].join(';');
  return span;
}

async function render(context: MountContext): Promise<void> {
  // Every problem link on the page, deduplicated to one lookup per problem.
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/problem/"]')];
  const byKey = new Map<string, HTMLAnchorElement[]>();

  for (const link of links) {
    // Already marked, or marked by a previous pass that is still attached.
    if (link.dataset.redoMarked === '1') continue;
    const key = keyFromHref(link.getAttribute('href') ?? '');
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), link]);
  }

  if (byKey.size === 0) return;

  const view = await send({ type: 'cf:lookup', keys: [...byKey.keys()] });
  if (context.signal.aborted) return;

  const added: HTMLElement[] = [];

  for (const [key, anchors] of byKey) {
    const entry = view[key];
    if (!entry) continue;

    for (const anchor of anchors) {
      // Only the link that names the problem gets badges — a listing row often
      // carries three links to the same problem and badging all of them is
      // noise.
      if (anchor.dataset.redoMarked === '1') continue;
      anchor.dataset.redoMarked = '1';

      const marks: HTMLElement[] = [];
      if (entry.rating !== undefined) {
        marks.push(badge(String(entry.rating), ratingColour(entry.rating), 'Problem rating'));
      }
      if (entry.solved) marks.push(badge('✓', 'hsl(152 60% 42%)', 'You have solved this'));
      else if (entry.attempted) marks.push(badge('·', 'hsl(0 84% 58%)', 'Attempted, never accepted'));

      if (marks.length === 0) continue;

      // Through a fragment, not one `after()` per badge: `after()` inserts
      // immediately behind the anchor, so a second call lands in front of the
      // first and the rating ends up after the tick.
      const fragment = document.createDocumentFragment();
      fragment.append(...marks);
      anchor.after(fragment);
      added.push(...marks);
    }
  }

  // The runner aborts on navigation and on teardown; the badges are ours to
  // clean up because they live in the host page rather than in a shadow root.
  context.signal.addEventListener('abort', () => {
    for (const mark of added) mark.remove();
    for (const anchors of byKey.values()) {
      for (const anchor of anchors) delete anchor.dataset.redoMarked;
    }
  });
}

export const codeforcesListing: Mount = {
  id: 'cf-listing',
  matches: (url) =>
    url.hostname.endsWith('codeforces.com') &&
    /\/(problemset|contests?|gym|group|submissions|profile)/.test(url.pathname),
  enabled: (settings) => settings.page.listings,
  // No card of its own: it attaches to `body` purely so the runner has
  // something to hold the lifetime against, and draws nothing there.
  anchor: () => (document.body ? { parent: document.body, position: 'beforeend' } : null),
  render,
};

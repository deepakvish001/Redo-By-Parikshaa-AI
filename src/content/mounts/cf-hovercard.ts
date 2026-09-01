import type { CfHandleCard } from '../../background/cf-mirror.ts';
import { send } from '../../core/messages.ts';
import { h } from '../inject/dom.ts';
import type { Mount, MountContext } from '../inject/registry.ts';

/**
 * A profile card when you hover a handle.
 *
 * The reference extension's pitch is exactly right: checking whether the person
 * who wrote a blog comment is a grandmaster or a newbie currently costs a tab.
 *
 * Read-only, and deliberately so. The reference also offers "add friend" from
 * the card, which needs your Codeforces session — Redo will not touch that, and
 * a button that quietly acts as you is not worth the convenience.
 */

const HANDLE_HREF = /^\/profile\/([^/?#]+)/;

export function handleFromHref(href: string): string | null {
  try {
    const path = href.startsWith('http') ? new URL(href).pathname : href;
    return HANDLE_HREF.exec(path)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Codeforces' own rank colours, by the rank name the API returns. */
export function rankColour(rank: string | undefined): string {
  const name = (rank ?? '').toLowerCase();

  // Order matters and is not obvious: "candidate master" and "international
  // master" both contain "master", so the specific names have to be tested
  // before the general one or a Candidate Master comes out orange.
  if (name.includes('grandmaster')) return 'hsl(0 85% 66%)';
  if (name.includes('candidate')) return 'hsl(291 55% 66%)';
  if (name.includes('master')) return 'hsl(30 95% 60%)';
  if (name.includes('expert')) return 'hsl(222 90% 68%)';
  if (name.includes('specialist')) return 'hsl(175 60% 48%)';
  if (name.includes('pupil')) return 'hsl(122 40% 55%)';
  return 'hsl(240 4% 62%)';
}

/** `5 hours ago`, `3 days ago` — how recently they were around. */
export function lastSeen(seconds: number | undefined, now: number): string | undefined {
  if (!seconds) return undefined;
  const minutes = Math.round((now - seconds * 1000) / 60_000);
  if (minutes < 2) return 'online now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function cardFor(card: CfHandleCard, now: number): HTMLElement {
  const head = h('div', { class: 'row' });
  const name = h('span', { style: 'font-weight:800;font-size:13px', text: card.handle });
  name.style.color = rankColour(card.rank);
  head.append(name);
  if (card.rank) head.append(h('span', { class: 'faint', text: card.rank }));

  const facts = [
    card.rating !== undefined && `rating ${card.rating}`,
    card.maxRating !== undefined && `max ${card.maxRating}`,
    card.contribution ? `contribution ${card.contribution > 0 ? '+' : ''}${card.contribution}` : undefined,
  ].filter(Boolean) as string[];

  const where = [card.city, card.country, card.organization].filter(Boolean).join(', ');
  const seen = lastSeen(card.lastOnlineSeconds, now);

  const body = h('div', { class: 'body', style: 'gap:4px;padding:9px 11px' }, head);
  if (facts.length > 0) body.append(h('div', { class: 'muted mono', text: facts.join(' · ') }));
  if (where) body.append(h('div', { class: 'faint', text: where }));
  if (seen) body.append(h('div', { class: 'faint', text: `last seen ${seen}` }));

  return h('div', { class: 'card' }, body);
}

/**
 * One floating card, moved and refilled rather than one per link.
 *
 * A standings page has several hundred handle links on it. Attaching a card to
 * each would be several hundred shadow roots for a thing only one of which is
 * ever visible.
 */
function render(context: MountContext): void {
  const host = context.el;
  // `pointer-events: none` because the card is purely something to read: you
  // never click it, and without this it sits over the page and swallows clicks
  // on whatever it happens to be covering.
  host.style.cssText =
    'position:fixed;z-index:2147483646;width:236px;display:none;pointer-events:none';

  let over: HTMLAnchorElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hide = () => {
    over = null;
    if (timer) clearTimeout(timer);
    host.style.display = 'none';
  };

  const place = (anchor: HTMLAnchorElement) => {
    const box = anchor.getBoundingClientRect();
    // Flipped above when there is no room below, so the card never hangs off
    // the bottom of a long standings table.
    const below = window.innerHeight - box.bottom > 190;
    host.style.left = `${Math.min(Math.max(8, box.left), window.innerWidth - 244)}px`;
    host.style.top = below ? `${box.bottom + 6}px` : '';
    host.style.bottom = below ? '' : `${window.innerHeight - box.top + 6}px`;
    host.style.display = 'block';
  };

  const onOver = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest?.('a[href*="/profile/"]');
    if (!(anchor instanceof HTMLAnchorElement)) return;

    const handle = handleFromHref(anchor.getAttribute('href') ?? '');
    if (!handle || anchor === over) return;

    over = anchor;
    if (timer) clearTimeout(timer);
    // A short delay so moving the mouse across a table of handles does not
    // fire a hundred lookups.
    timer = setTimeout(() => {
      void send({ type: 'cf:handles', handles: [handle] })
        .then((cards) => {
          const card = cards[handle] ?? Object.values(cards)[0];
          if (!card || over !== anchor || context.signal.aborted) return;
          host.replaceChildren(cardFor(card, Date.now()));
          place(anchor);
        })
        .catch(() => undefined);
    }, 280);
  };

  document.addEventListener('mouseover', onOver, { signal: context.signal });
  document.addEventListener('mouseout', (event) => {
    const anchor = (event.target as Element | null)?.closest?.('a[href*="/profile/"]');
    if (anchor === over) hide();
  }, { signal: context.signal });
  window.addEventListener('scroll', hide, { signal: context.signal, passive: true });
}

export const codeforcesHoverCard: Mount = {
  id: 'cf-hovercard',
  matches: (url) => url.hostname.endsWith('codeforces.com'),
  enabled: (settings) => settings.page.hovercards,
  anchor: () => (document.body ? { parent: document.body, position: 'beforeend' } : null),
  render,
};

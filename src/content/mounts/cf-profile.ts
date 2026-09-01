import { send } from '../../core/messages.ts';
import { h } from '../inject/dom.ts';
import type { Mount, MountContext } from '../inject/registry.ts';
import { ratingColour } from './cf-rail.ts';

/**
 * Redo's card on a Codeforces profile page.
 *
 * Three of the reference extensions put something here — streak rows, a
 * problems-of-the-day table, charts — and a profile is where somebody goes when
 * they want to know how they are doing, so it is the right place for it. This
 * is the streak and today's picks; the charts land on this same mount in the
 * next phase.
 *
 * Only on your own profile. Somebody else's page showing your streak would be
 * confusing at best and misleading at worst.
 */

const PROFILE_PATH = /^\/profile\/([^/]+)\/?$/;

export function profileHandle(pathname: string): string | null {
  return PROFILE_PATH.exec(pathname)?.[1] ?? null;
}

/** The handle Codeforces says is signed in, from its own header. */
function signedInHandle(): string | null {
  const link = document.querySelector<HTMLAnchorElement>('#header a[href^="/profile/"]');
  return link?.textContent?.trim() || null;
}

export function isOwnProfile(pathname: string, signedIn: string | null): boolean {
  const viewing = profileHandle(pathname);
  return Boolean(viewing && signedIn && viewing.toLowerCase() === signedIn.toLowerCase());
}

function streakRow(label: string, value: string): HTMLElement {
  return h('div', { class: 'row' },
    h('span', { class: 'muted', style: 'flex:1', text: label }),
    h('span', { class: 'mono', style: 'font-weight:700', text: value }),
  );
}

function pickRow(label: string, pick: { key: string; name: string; rating: number; url: string } | undefined, solved: boolean): HTMLElement | null {
  if (!pick) return null;

  const link = h('a', { href: pick.url, style: 'flex:1;min-width:0;text-decoration:none' });
  link.textContent = pick.name;

  const rating = h('span', { class: 'mono', style: 'font-weight:700', text: String(pick.rating || '—') });
  rating.style.color = ratingColour(pick.rating);

  return h('div', { class: 'row', style: 'gap:8px' },
    h('span', { class: 'faint', style: 'min-width:52px', text: label }),
    rating,
    link,
    solved ? h('span', { class: 'chip chip--ok', text: '✓' }) : h('span', { class: 'faint', text: '·' }),
  );
}

async function render(context: MountContext): Promise<void> {
  const home = await send({ type: 'daily:get' });
  if (context.signal.aborted) return;

  const card = h('div', { class: 'card' });
  card.append(
    h('div', { class: 'head' },
      h('span', { class: 'head__mark', text: '↻' }),
      h('span', { class: 'head__title', text: 'Redo' }),
      h('span', { class: 'head__spacer' }),
      h('span', { class: 'faint', text: `${home.solvedToday} solved today` }),
    ),
  );

  const body = h('div', { class: 'body' });

  body.append(
    streakRow(
      'Daily problem streak',
      `${home.streak.current}${home.streak.todayPending ? ' · today still open' : ''}`,
    ),
    streakRow('Longest daily run', String(home.streak.longest)),
    streakRow('Solving streak', `${home.solveStreak}`),
  );

  if (home.reason) {
    body.append(h('div', { class: 'sep' }), h('div', { class: 'faint', text: home.reason }));
  }

  const picks = [
    pickRow('Today', home.daily?.medium, home.dailyState === 'done'),
    pickRow('Easier', home.daily?.easy, false),
    pickRow('Harder', home.daily?.hard, false),
  ].filter((row): row is HTMLElement => row !== null);

  if (picks.length > 0) {
    body.append(h('div', { class: 'sep' }), ...picks);
  }

  if (home.dueTotal > 0) {
    body.append(
      h('div', { class: 'sep' }),
      h('div', { class: 'row' },
        h('span', { class: 'chip chip--due', text: `${home.dueTotal} due for revision` }),
        // No button: a content script cannot open the side panel, and a control
        // that does nothing is worse than a sentence saying where it is.
        h('span', { class: 'faint', text: 'in the Redo panel' }),
      ),
    );
  }

  card.append(body);
  context.el.replaceChildren(card);
}

export const codeforcesProfile: Mount = {
  id: 'cf-profile',
  matches: (url) =>
    url.hostname.endsWith('codeforces.com') && isOwnProfile(url.pathname, signedInHandle()),
  enabled: (settings) => settings.page.profile,
  anchor: () => {
    const sidebar = document.querySelector('#sidebar');
    return sidebar ? { parent: sidebar, position: 'afterbegin' } : null;
  },
  render,
};

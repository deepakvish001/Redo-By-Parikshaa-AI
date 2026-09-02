import { isHost } from '../../core/hosts.ts';
import { heatmapGrid } from '../../core/insights.ts';
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

/**
 * A year of days, coloured by the hardest problem solved on each.
 *
 * The profile page is where this belongs — it is the one chart Codeforces
 * already draws here, and draws worse: its own heatmap counts problems, so a
 * day of ten 800s outshines a day with one 2400.
 */
function heatSection(
  heat: Record<string, { count: number; peak: number }>,
  years: number[],
): HTMLElement | null {
  if (years.length === 0) return null;

  const wrap = h('div', { style: 'display:flex;flex-direction:column;gap:7px' });

  const picker = h('select', {
    style:
      'font:inherit;font-size:11px;background:var(--surface-raised);color:var(--text);' +
      'border:1px solid var(--border-strong);border-radius:6px;padding:2px 5px',
  });
  for (const year of years) {
    const option = h('option', { value: String(year) });
    option.textContent = String(year);
    picker.append(option);
  }

  wrap.append(
    h('div', { class: 'row' },
      h('span', { class: 'faint', style: 'flex:1', text: 'Hardest problem solved each day' }),
      picker,
    ),
  );

  const scroller = h('div', { style: 'overflow-x:auto;padding-bottom:3px' });
  wrap.append(scroller);

  const draw = (year: number) => {
    const grid = h('div', { style: 'display:flex;gap:2px;width:max-content' });
    for (const column of heatmapGrid(year)) {
      const col = h('div', { style: 'display:flex;flex-direction:column;gap:2px' });
      for (const day of column) {
        const entry = day ? heat[day] : undefined;
        const cell = h('span', {
          style:
            'width:9px;height:9px;border-radius:2px;background:' +
            (day ? (entry ? ratingColour(entry.peak || undefined) : 'var(--surface-raised)') : 'transparent'),
          title: entry
            ? `${day} — ${entry.count} solved, hardest ${entry.peak || 'unrated'}`
            : day || '',
        });
        col.append(cell);
      }
      grid.append(col);
    }
    scroller.replaceChildren(grid);
  };

  draw(years[0]!);
  picker.addEventListener('change', () => draw(Number(picker.value)));
  return wrap;
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

  // Labelled by where each pick actually landed. When everything easier is
  // already solved the search walks upward, and calling an 1800 "easier" than
  // another 1800 would be a plain lie.
  const level = home.daily?.medium?.rating ?? 0;
  const relative = (rating: number) =>
    rating < level ? 'Easier' : rating > level ? 'Harder' : 'Also';

  const picks = [
    pickRow('Today', home.daily?.medium, home.dailyState === 'done'),
    home.daily?.easy && pickRow(relative(home.daily.easy.rating), home.daily.easy, false),
    home.daily?.hard && pickRow(relative(home.daily.hard.rating), home.daily.hard, false),
  ].filter((row): row is HTMLElement => Boolean(row));

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

  // Fetched after the card is up: the mirror may have to be read, and the
  // streak should not wait on a chart.
  const insights = await send({ type: 'insights:get' }).catch(() => undefined);
  if (context.signal.aborted || !insights) return;

  const heat = heatSection(insights.heat, insights.years);
  if (heat) body.append(h('div', { class: 'sep' }), heat);
}

export const codeforcesProfile: Mount = {
  id: 'cf-profile',
  matches: (url) =>
    isHost(url.hostname, 'codeforces.com') && isOwnProfile(url.pathname, signedInHandle()),
  enabled: (settings) => settings.page.profile,
  anchor: () => {
    const sidebar = document.querySelector('#sidebar');
    return sidebar ? { parent: sidebar, position: 'afterbegin' } : null;
  },
  render,
};

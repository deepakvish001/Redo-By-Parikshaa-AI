import { isHost } from '../../core/hosts.ts';
import { send } from '../../core/messages.ts';
import { button, h } from '../inject/dom.ts';
import type { Mount, MountContext } from '../inject/registry.ts';

/**
 * Your place among the people you actually compete with.
 *
 * "Rank 3,412 of 28,000" says almost nothing. "Third in your college" and
 * "875th in India" both say something, and Codeforces prints neither. The
 * standings page already contains everything needed — each row carries a flag
 * and an organisation — so this is a filter over what is on screen rather than
 * anything fetched.
 *
 * Reading the page rather than the API is deliberate here: the API's standings
 * do not carry country or organisation at all, and a hundred `user.info` calls
 * to find out would take four minutes.
 */

const STANDINGS_PATH = /\/(?:contest|gym)\/(\d+)\/standings/;

export function isStandings(pathname: string): boolean {
  return STANDINGS_PATH.test(pathname);
}

export interface StandingsRow {
  rank: number;
  handle: string;
  country?: string;
  organization?: string;
  element: HTMLTableRowElement;
}

/**
 * Reads the rows Codeforces drew.
 *
 * The flag is an `<img class="standings-flag" title="India">` and the
 * organisation an `<img class="standings-org" title="…">` — both titles, both
 * only present when the participant filled them in.
 */
export function readRows(table: Element): StandingsRow[] {
  const rows: StandingsRow[] = [];

  for (const element of table.querySelectorAll<HTMLTableRowElement>('tr[participantid]')) {
    const handle = element
      .querySelector<HTMLAnchorElement>('td.contestant-cell a, a[href^="/profile/"]')
      ?.textContent?.trim();
    if (!handle) continue;

    // The rank cell reads "1 (537)" on a filtered view; the leading number is
    // the one that matters.
    const rank = Number.parseInt(element.querySelector('td')?.textContent?.trim() ?? '', 10);
    if (!Number.isFinite(rank)) continue;

    rows.push({
      rank,
      handle,
      country: element.querySelector('img.standings-flag')?.getAttribute('title') ?? undefined,
      organization: element.querySelector('img.standings-org')?.getAttribute('title') ?? undefined,
      element,
    });
  }

  return rows;
}

/** Your position among rows matching a filter, one-based. */
export function placeAmong(
  rows: StandingsRow[],
  handle: string,
  matches: (row: StandingsRow) => boolean,
): { place: number; total: number } | undefined {
  const filtered = rows.filter(matches).sort((a, b) => a.rank - b.rank);
  const index = filtered.findIndex((row) => row.handle.toLowerCase() === handle.toLowerCase());
  return index === -1 ? undefined : { place: index + 1, total: filtered.length };
}

/** The organisation and country of the signed-in participant, from their row. */
export function ownRow(rows: StandingsRow[], handle: string): StandingsRow | undefined {
  return rows.find((row) => row.handle.toLowerCase() === handle.toLowerCase());
}

async function render(context: MountContext): Promise<void> {
  const table = document.querySelector('table.standings');
  if (!table) return;

  const settings = await send({ type: 'settings:get' });
  if (context.signal.aborted) return;

  const handle = settings.handles.codeforces.trim();
  if (!handle) return;

  const rows = readRows(table);
  const mine = ownRow(rows, handle);
  // Nothing to say about a contest you did not enter — and the whole feature is
  // about where *you* placed.
  if (!mine) return;

  const organization = settings.handles.organization.trim() || mine.organization;

  const country = mine.country
    ? placeAmong(rows, handle, (row) => row.country === mine.country)
    : undefined;
  const college = organization
    ? placeAmong(rows, handle, (row) => row.organization === organization)
    : undefined;

  const card = h('div', { class: 'card' });
  const head = h('div', { class: 'head' },
    h('span', { class: 'head__mark', text: '↻' }),
    h('span', { class: 'head__title', text: 'Your place' }),
  );

  const body = h('div', { class: 'body' });
  const overall = h('div', { class: 'row' },
    h('span', { class: 'muted', style: 'flex:1', text: 'Overall on this page' }),
    h('span', { class: 'mono', style: 'font-weight:700', text: `#${mine.rank}` }),
  );
  body.append(overall);

  if (country) {
    body.append(
      h('div', { class: 'row' },
        h('span', { class: 'muted', style: 'flex:1', text: mine.country! }),
        h('span', { class: 'mono', style: 'font-weight:700', text: `#${country.place}` }),
        h('span', { class: 'faint', text: `of ${country.total}` }),
      ),
    );
  }

  if (college) {
    const row = h('div', { class: 'row' },
      h('span', { class: 'muted', style: 'flex:1;min-width:0', text: organization! }),
      h('span', { class: 'mono', style: 'font-weight:700', text: `#${college.place}` }),
      h('span', { class: 'faint', text: `of ${college.total}` }),
    );
    body.append(row);

    // Highlighting in place rather than building a second table: Codeforces'
    // standings carry per-problem timings and penalties that a rebuilt table
    // would have to reproduce and would get subtly wrong.
    let showing = false;
    const toggle = button('Show only my college', () => {
      showing = !showing;
      for (const entry of rows) {
        entry.element.style.display =
          !showing || entry.organization === organization ? '' : 'none';
      }
      toggle.textContent = showing ? 'Show everyone' : 'Show only my college';
    }, { class: 'ghost' });

    context.signal.addEventListener('abort', () => {
      for (const entry of rows) entry.element.style.display = '';
    });

    body.append(h('div', { class: 'row' }, toggle));
  } else {
    body.append(
      h('div', {
        class: 'faint',
        text: 'No organisation on your Codeforces profile — set one there, or in Redo’s Settings, for a college rank.',
      }),
    );
  }

  card.append(head, body);
  context.el.replaceChildren(card);
}

export const codeforcesStandings: Mount = {
  id: 'cf-standings',
  matches: (url) => isHost(url.hostname, 'codeforces.com') && isStandings(url.pathname),
  enabled: (settings) => settings.page.standings,
  anchor: () => {
    const sidebar = document.querySelector('#sidebar');
    if (sidebar) return { parent: sidebar, position: 'afterbegin' };
    const table = document.querySelector('table.standings');
    return table ? { parent: table, position: 'beforebegin' } : null;
  },
  render,
};

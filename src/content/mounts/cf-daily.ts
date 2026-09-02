import { send, type HomeData } from '../../core/messages.ts';
import type { DailyPick } from '../../core/daily.ts';
import { button, h } from '../inject/dom.ts';
import type { Mount, MountContext } from '../inject/registry.ts';
import { showToast } from '../toast.ts';
import { ratingColour } from './cf-rail.ts';

/**
 * The daily problem, on Codeforces itself.
 *
 * It has always existed — picked from the band your solved history actually
 * sits in, fixed for the day, with a streak behind it — and it has always been
 * in a side panel you had to open on purpose. Which meant that on the one page
 * where you are already deciding what to solve, it was invisible.
 *
 * So it goes in two places, both of them where Codeforces already puts things
 * of that kind:
 *
 * - **Two rows pinned to the top of the problemset table**, in the site's own
 *   row markup: a `Global` one and a `For You` one. They are real rows, with
 *   the rating and the tags, so the eye reads them as part of the list rather
 *   than as an advertisement wedged above it.
 * - **A streak calendar in the sidebar**, in a Codeforces `roundbox`, because
 *   the streak is the reason to come back tomorrow and a number nobody sees
 *   motivates nobody.
 *
 * Nothing here is promotional and nothing is inserted on a page that is not
 * about choosing a problem — the Chrome Web Store rule about injecting content
 * into other people's sites is a good rule, and this stays the right side of it
 * by adding only the user's own data.
 */

const TABLE = 'table.problems';

/** The sidebar box lives inside the mount's shadow root, so it needs its own. */
const CSS = `
.box {
  /* Bounded rather than filling whatever column it lands in. Codeforces' own
     sidebar is about 250px, but this must not become a wall of squares if a
     skin, a zoom level or a narrow window hands it a wider parent. */
  max-width: 260px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  overflow: hidden;
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 11px;
  border-bottom: 1px solid var(--border);
  font-weight: 700;
  font-size: 12.5px;
}

.streak {
  font-weight: 600;
  font-size: 11.5px;
  color: var(--amber);
}

.body { padding: 10px 11px 11px; }

/* Seven columns, because a grid whose columns are not weekdays is a grid you
   cannot read a habit off — which is the only thing it is for. */
.cal {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 3px;
}

.cal__head {
  text-align: center;
  font-size: 9.5px;
  font-weight: 700;
  color: var(--text-faint);
}

.cal__day {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  max-height: 30px;
  border-radius: 4px;
  background: var(--surface-raised);
  font-size: 10px;
  color: var(--text-faint);
}

.cal__day.is-done { background: var(--ok); color: hsl(0 0% 8%); font-weight: 700; }
.cal__day.is-missed { background: hsl(0 84% 64% / 0.25); color: var(--text-muted); }
.cal__day.is-skipped { background: var(--surface-raised); color: var(--text-muted); text-decoration: line-through; }
.cal__day.is-today { outline: 1.5px solid var(--accent); }

.note {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.later {
  margin-top: 9px;
  width: 100%;
  padding: 5px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.later:hover { color: var(--text); border-color: var(--accent); }
`;

/** Codeforces' own sidebar, whichever of its two shapes this page uses. */
function sidebar(): Element | null {
  return document.querySelector('#sidebar') ?? document.querySelector('.sidebar');
}

/* ------------------------------------------------------------- the rows */

/**
 * One pinned row, in Codeforces' own table markup.
 *
 * Deliberately built from the same `<tr><td>` shape the site uses rather than a
 * card floated above the table: a row that does not line up with the columns
 * beside it reads as something bolted on, and this is meant to read as the
 * first two entries of the list you came to read.
 */
function problemRow(
  label: string,
  pick: DailyPick,
  state: { solved: boolean; skipped?: boolean },
): HTMLTableRowElement {
  const row = document.createElement('tr');
  // Inline styles rather than a page-level stylesheet, which is how every other
  // light-DOM injection here works: nothing to fight the site's own CSS, and
  // cleanup is removing the element. The class is a marker for that removal,
  // not a hook for styling.
  row.className = 'redo-potd';
  row.style.background = 'rgba(255, 138, 0, 0.06)';

  const cell = (width?: string) => {
    const td = document.createElement('td');
    td.style.cssText = `padding:7px 8px;vertical-align:middle;${width ? `width:${width};` : ''}`;
    return td;
  };

  const index = cell('68px');
  const tag = h('span', { text: label });
  tag.style.cssText = [
    'display:inline-block',
    'padding:1px 7px',
    'border-radius:999px',
    'background:#ff8a00',
    'color:#fff',
    'font-size:10.5px',
    'font-weight:700',
    'letter-spacing:0.03em',
    'white-space:nowrap',
  ].join(';');
  index.append(tag);

  const name = cell();
  const link = document.createElement('a');
  link.href = pick.url;
  link.textContent = pick.name;
  link.style.fontWeight = '600';
  name.append(link);

  if (pick.tags.length > 0) {
    // Behind a click, the same way the rail does it. Knowing a problem is rated
    // 1600 tells you whether to attempt it; knowing it is a segment tree tells
    // you the answer.
    const tags = h('span', { text: ` ${pick.tags.join(', ')}` });
    tags.style.cssText = 'color:#777;font-size:11.5px';
    tags.hidden = true;

    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.textContent = 'tags';
    reveal.style.cssText = [
      'margin-left:8px',
      'padding:0 5px',
      'border:1px solid #ccc',
      'border-radius:4px',
      'background:transparent',
      'color:#777',
      'font-size:10.5px',
      'cursor:pointer',
    ].join(';');
    reveal.addEventListener('click', () => {
      tags.hidden = false;
      reveal.remove();
    });

    name.append(reveal, tags);
  }

  const status = cell('72px');
  status.style.textAlign = 'center';
  if (state.solved || state.skipped) {
    const mark = h('span', { text: state.solved ? 'solved' : 'skipped' });
    mark.style.cssText = `font-size:11px;color:${state.solved ? '#0a0' : '#999'}`;
    status.append(mark);
  }

  const rating = cell('56px');
  rating.style.textAlign = 'center';
  if (pick.rating > 0) {
    const chip = h('span', { text: String(pick.rating) });
    chip.style.cssText = `font-weight:700;color:${ratingColour(pick.rating)}`;
    rating.append(chip);
  }

  row.append(index, name, status, rating);
  return row;
}

/* ---------------------------------------------------------- the calendar */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Five weeks of squares, aligned to real weekdays.
 *
 * Aligned rather than simply chunked by seven: a grid whose columns do not line
 * up with the days of the week is a grid you cannot read a habit off, which is
 * the only thing it is for.
 */
function calendarGrid(data: HomeData): HTMLElement {
  const wrap = h('div', { class: 'cal' });

  for (const letter of WEEKDAYS) {
    wrap.append(h('span', { class: 'cal__head', text: letter }));
  }

  const first = data.calendar[0];
  if (first) {
    // Blank cells so the first day lands under its own weekday.
    const offset = new Date(`${first.day}T00:00:00Z`).getUTCDay();
    for (let index = 0; index < offset; index += 1) {
      wrap.append(h('span', {}));
    }
  }

  for (const day of data.calendar) {
    const cell = h('span', {
      class: `cal__day is-${day.state}${day.day === data.today ? ' is-today' : ''}`,
      text: String(Number(day.day.slice(-2))),
    });
    cell.title = `${day.day} — ${day.state === 'none' ? 'nothing picked' : day.state}`;
    wrap.append(cell);
  }

  return wrap;
}

function streakBox(data: HomeData): HTMLElement {
  const box = h('div', { class: 'box' });

  const caption = h('div', { class: 'head' },
    h('span', { text: 'Problem of the Day' }),
    h('span', {
      class: 'streak',
      text: data.streak.current === 1 ? '1-day streak' : `${data.streak.current}-day streak`,
    }),
  );

  const body = h('div', { class: 'body' }, calendarGrid(data));

  if (data.streak.longest > data.streak.current) {
    body.append(h('div', { class: 'note', text: `Best run: ${data.streak.longest} days.` }));
  }
  if (data.dailyState === 'open' && data.streak.todayPending) {
    // "Not yet" and "broken" are different things, and a streak reading zero at
    // nine in the morning is the opposite of motivating.
    body.append(h('div', { class: 'note', text: 'Today is still open.' }));
  }

  box.append(caption, body);
  return box;
}

/* ------------------------------------------------------------- rendering */

async function render(context: MountContext): Promise<void> {
  const { el } = context;
  el.replaceChildren();

  const style = document.createElement('style');
  style.textContent = CSS;
  el.append(style);

  let data: HomeData;
  try {
    data = await send({ type: 'daily:get' });
  } catch {
    return;
  }

  // Nothing to say without a handle or a warm mirror, and an empty box on
  // somebody's problemset page is worse than no box.
  if (data.dailyState === 'unavailable' && !data.global) return;

  const box = streakBox(data);
  el.append(box);

  const table = document.querySelector(TABLE);
  const body = table?.querySelector('tbody') ?? table;
  if (!body) return;

  // The rows live in Codeforces' table, not in this mount's host, so they are
  // removed by hand when the mount is torn down.
  const rows: HTMLTableRowElement[] = [];
  const insert = (row: HTMLTableRowElement) => {
    const header = body.querySelector('tr');
    if (header && rows.length === 0) header.after(row);
    else if (rows.length > 0) rows[rows.length - 1]!.after(row);
    else body.prepend(row);
    rows.push(row);
  };

  if (data.global) {
    insert(problemRow('Global', data.global, { solved: data.globalSolved ?? false }));
  }
  if (data.daily?.main) {
    insert(
      problemRow('For You', data.daily.main, {
        solved: data.dailyState === 'done',
        skipped: data.dailyState === 'skipped',
      }),
    );
  }

  context.signal.addEventListener('abort', () => {
    for (const row of rows) row.remove();
  });

  if (data.daily?.main && data.dailyState === 'open') {
    const later = button('Keep for later', () => {
      void send({ type: 'backlog:add', key: data.daily!.main!.key })
        .then(() =>
          showToast({
            title: 'Added to your backlog',
            body: 'Today stays open — the streak survives until midnight.',
            tone: 'success',
            timeout: 4000,
          }),
        )
        .catch(() => showToast({ title: 'Could not add it.', tone: 'error', timeout: 4000 }));
    }, { class: 'later' });
    box.querySelector('.body')?.append(later);
  }
}

export const codeforcesDaily: Mount = {
  id: 'cf-daily',
  // The problemset listing only. This is the page where you are already
  // choosing what to solve; anywhere else it would be an interruption.
  matches: (url) =>
    url.hostname.endsWith('codeforces.com') && /^\/problemset(\/page\/\d+)?\/?$/.test(url.pathname),
  enabled: (settings) => settings.page.daily,
  anchor: () => {
    const parent = sidebar();
    return parent ? { parent, position: 'afterbegin' } : null;
  },
  render,
};

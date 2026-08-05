import type { Platform } from './types.ts';

/**
 * Upcoming contests, gathered from each judge's own listing.
 *
 * Every source is fetched independently and parsed defensively: one judge
 * changing its response shape must cost you that judge's contests, not the
 * whole list. The parsers are pure so each shape can be checked against a
 * recorded payload.
 */

export interface Contest {
  /** `<platform>:<native id>` — stable across refreshes, so reminders survive. */
  id: string;
  platform: Platform;
  name: string;
  url: string;
  /** ms since epoch. */
  startAt: number;
  durationMs: number;
}

const HOUR_MS = 3_600_000;

function contestId(platform: Platform, native: string | number): string {
  return `${platform}:${native}`;
}

/* ------------------------------------------------------------ Codeforces */

interface CodeforcesContest {
  id?: number;
  name?: string;
  phase?: string;
  durationSeconds?: number;
  startTimeSeconds?: number;
}

export function parseCodeforces(body: string): Contest[] {
  let json: { status?: string; result?: CodeforcesContest[] };
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    return [];
  }
  if (json.status !== 'OK' || !Array.isArray(json.result)) return [];

  return json.result
    // `BEFORE` is Codeforces' own word for "not started yet".
    .filter((contest) => contest.phase === 'BEFORE' && contest.id && contest.startTimeSeconds)
    .map((contest) => ({
      id: contestId('codeforces', contest.id as number),
      platform: 'codeforces' as const,
      name: contest.name ?? `Contest ${contest.id}`,
      url: `https://codeforces.com/contests/${contest.id}`,
      startAt: (contest.startTimeSeconds as number) * 1000,
      durationMs: (contest.durationSeconds ?? 0) * 1000,
    }));
}

/* -------------------------------------------------------------- LeetCode */

interface LeetCodeContest {
  title?: string;
  titleSlug?: string;
  startTime?: number;
  duration?: number;
}

export function parseLeetCode(body: string): Contest[] {
  let json: { data?: { upcomingContests?: LeetCodeContest[] } };
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    return [];
  }

  const contests = json.data?.upcomingContests;
  if (!Array.isArray(contests)) return [];

  return contests
    .filter((contest) => contest.titleSlug && contest.startTime)
    .map((contest) => ({
      id: contestId('leetcode', contest.titleSlug as string),
      platform: 'leetcode' as const,
      name: contest.title ?? (contest.titleSlug as string),
      url: `https://leetcode.com/contest/${contest.titleSlug}`,
      startAt: (contest.startTime as number) * 1000,
      durationMs: (contest.duration ?? 0) * 1000,
    }));
}

export const LEETCODE_CONTEST_QUERY =
  'query { upcomingContests { title titleSlug startTime duration } }';

/* -------------------------------------------------------------- CodeChef */

interface CodeChefContest {
  contest_code?: string;
  contest_name?: string;
  contest_start_date_iso?: string;
  contest_end_date_iso?: string;
}

export function parseCodeChef(body: string): Contest[] {
  let json: { future_contests?: CodeChefContest[] };
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    return [];
  }
  if (!Array.isArray(json.future_contests)) return [];

  return json.future_contests
    .map((contest): Contest | undefined => {
      const startAt = Date.parse(contest.contest_start_date_iso ?? '');
      const endAt = Date.parse(contest.contest_end_date_iso ?? '');
      if (!contest.contest_code || Number.isNaN(startAt)) return undefined;

      return {
        id: contestId('codechef', contest.contest_code),
        platform: 'codechef' as const,
        name: contest.contest_name ?? contest.contest_code,
        url: `https://www.codechef.com/${contest.contest_code}`,
        startAt,
        durationMs: Number.isNaN(endAt) ? 0 : Math.max(0, endAt - startAt),
      };
    })
    .filter((contest): contest is Contest => contest !== undefined);
}

/* --------------------------------------------------------------- AtCoder */

/**
 * AtCoder publishes no contest API, so the upcoming table on `/contests/` is
 * read instead. Times are rendered in the viewer's chosen timezone with an
 * explicit offset, which is what makes them parseable at all.
 */
export function parseAtCoder(document_: Document): Contest[] {
  const table =
    document_.querySelector('#contest-table-upcoming') ??
    document_.querySelector('.table-responsive');
  if (!table) return [];

  const contests: Contest[] = [];
  for (const row of table.querySelectorAll('tbody tr')) {
    const timeText = row.querySelector('time')?.textContent?.trim() ?? '';
    const link = row.querySelector<HTMLAnchorElement>('a[href^="/contests/"]');
    const href = link?.getAttribute('href') ?? '';
    const slug = /\/contests\/([^/?#]+)/.exec(href)?.[1];
    if (!slug || !timeText) continue;

    const startAt = Date.parse(timeText.replace(' ', 'T'));
    if (Number.isNaN(startAt)) continue;

    // The duration column reads "01:40"; anything else is left at zero.
    const duration = /(\d+):(\d{2})/.exec(row.querySelector('td:nth-child(3)')?.textContent ?? '');
    const durationMs = duration
      ? (Number(duration[1]) * 60 + Number(duration[2])) * 60_000
      : 0;

    contests.push({
      id: contestId('atcoder', slug),
      platform: 'atcoder',
      name: link?.textContent?.trim() || slug,
      url: `https://atcoder.jp${href}`,
      startAt,
      durationMs,
    });
  }
  return contests;
}

/* ---------------------------------------------------------------- shared */

/** Drops contests that already started and orders what remains by start time. */
export function upcoming(contests: Contest[], now: number, withinDays = 30): Contest[] {
  const horizon = now + withinDays * 24 * HOUR_MS;
  const seen = new Set<string>();

  return contests
    .filter((contest) => contest.startAt > now && contest.startAt <= horizon)
    .filter((contest) => {
      // Sources can overlap on a refresh; the id is what makes them one entry.
      if (seen.has(contest.id)) return false;
      seen.add(contest.id);
      return true;
    })
    .sort((a, b) => a.startAt - b.startAt);
}

/** `in 2d 4h`, `in 45m`, `starting now`. */
export function formatStartsIn(startAt: number, now: number): string {
  const delta = startAt - now;
  if (delta <= 0) return 'starting now';

  const days = Math.floor(delta / (24 * HOUR_MS));
  const hours = Math.floor((delta % (24 * HOUR_MS)) / HOUR_MS);
  const minutes = Math.floor((delta % HOUR_MS) / 60_000);

  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}

export function formatDuration(durationMs: number): string {
  if (durationMs <= 0) return '';
  const hours = Math.floor(durationMs / HOUR_MS);
  const minutes = Math.round((durationMs % HOUR_MS) / 60_000);
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/**
 * A Google Calendar link rather than a downloaded `.ics`, because it works on
 * every platform without the extension touching the filesystem.
 */
export function calendarUrl(contest: Contest): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const end = contest.startAt + (contest.durationMs || 2 * HOUR_MS);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: contest.name,
    dates: `${stamp(contest.startAt)}/${stamp(end)}`,
    details: contest.url,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Contests whose reminder is due, given how far ahead the user wants warning. */
export function dueReminders(
  contests: Contest[],
  reminded: string[],
  leadMinutes: number,
  now: number,
): Contest[] {
  const already = new Set(reminded);
  const lead = leadMinutes * 60_000;

  return contests.filter(
    (contest) =>
      !already.has(contest.id) &&
      contest.startAt > now &&
      contest.startAt - now <= lead,
  );
}

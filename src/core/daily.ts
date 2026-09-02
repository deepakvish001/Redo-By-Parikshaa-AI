/**
 * One problem a day, at your level.
 *
 * Two of the reference extensions exist for this alone, and the reason is not
 * the problem — it is the deciding. Opening the problemset and choosing takes
 * ten minutes and often ends in not solving anything, so the habit dies on the
 * choosing rather than on the solving.
 *
 * Everything here is pure: given the problemset, what you have solved and which
 * day it is, the pick is fixed. That matters for a reason beyond testing — the
 * same day must produce the same problem on every device, without a server to
 * agree with, and without the pick sliding to something easier each time the
 * panel is opened.
 */

export interface DailyCandidate {
  key: string;
  name: string;
  rating: number;
  tags: string[];
}

export interface DailyPick extends DailyCandidate {
  url: string;
}

/**
 * The day, in UTC.
 *
 * UTC rather than local time so a pick does not change under you when you
 * travel, and so two devices in different time zones agree on what "today" is.
 */
export function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function previousDay(key: string): string {
  return dayKey(Date.parse(`${key}T00:00:00Z`) - 86_400_000);
}

/**
 * FNV-1a, 32-bit.
 *
 * Any stable hash would do; this one is four lines and has no dependencies.
 * `Math.random()` cannot be used here at all — the whole point is that the same
 * day gives the same problem.
 */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function problemUrl(key: string): string {
  // `1980C` → contest 1980, problem C. Four-digit-and-up contest ids are the
  // norm; the split takes the trailing letters whatever the id's length.
  const match = /^(\d+)([A-Za-z]\d*)$/.exec(key);
  return match
    ? `https://codeforces.com/contest/${match[1]}/problem/${match[2]}`
    : `https://codeforces.com/problemset?search=${encodeURIComponent(key)}`;
}

function toPick(candidate: DailyCandidate): DailyPick {
  return { ...candidate, url: problemUrl(candidate.key) };
}

/**
 * The band to draw from.
 *
 * Rounded to the nearest hundred because that is how Codeforces rates
 * problems, and an unrated account starts at 800 — the rating everybody's first
 * solvable problem has.
 */
export function bandFor(rating: number | undefined): number {
  if (!rating || rating <= 0) return 800;
  return Math.min(3500, Math.max(800, Math.round(rating / 100) * 100));
}

/**
 * Picks deterministically from a band, skipping what is already solved.
 *
 * The rotation is a fixed order derived from the day, walked until it finds
 * something unsolved. Choosing the *first* unsolved in a day-seeded rotation
 * rather than filtering first and then picking is what keeps a past day's pick
 * reproducible: solving problems changes which one you land on today, but never
 * which one you landed on last Tuesday.
 */
export function pickFromBand(
  candidates: DailyCandidate[],
  rating: number,
  solved: ReadonlySet<string>,
  day: string,
  seed = '',
): DailyPick | undefined {
  const band = candidates.filter((candidate) => candidate.rating === rating);
  if (band.length === 0) return undefined;

  // Sorted so the rotation does not depend on the order Codeforces happened to
  // return the problemset in.
  const ordered = [...band].sort((a, b) => a.key.localeCompare(b.key));
  const start = hashString(`${day}:${seed}:${rating}`) % ordered.length;

  for (let step = 0; step < ordered.length; step += 1) {
    const candidate = ordered[(start + step) % ordered.length]!;
    if (!solved.has(candidate.key)) return toPick(candidate);
  }

  // Every problem at this rating is solved, which is a good problem to have.
  return undefined;
}

/**
 * The nearest band with something left in it.
 *
 * Somebody who has solved everything at their own rating is the most likely
 * user of a daily problem, not the least — and handing them nothing at all is
 * the worst possible answer. So the search steps outward: the band asked for,
 * then a hundred up, then a hundred down, and so on. Upward first, because
 * running out at your level means the level is behind you.
 */
export function pickNear(
  candidates: DailyCandidate[],
  target: number,
  solved: ReadonlySet<string>,
  day: string,
  seed = '',
  spread = 600,
): DailyPick | undefined {
  for (let step = 0; step <= spread; step += 100) {
    for (const rating of step === 0 ? [target] : [target + step, target - step]) {
      if (rating < 800 || rating > 3500) continue;
      const pick = pickFromBand(candidates, rating, solved, day, seed);
      if (pick) return pick;
    }
  }
  return undefined;
}

export interface DailySet {
  /** The one to do today. The same problem as `medium` — that is the point. */
  main?: DailyPick;
  /** A gentler one, one at your band, and a reach — the reference's trio. */
  easy?: DailyPick;
  medium?: DailyPick;
  hard?: DailyPick;
  /** The band everything was aimed at, so the UI can label each pick honestly. */
  band: number;
}

/**
 * Today's set: one at your level, and the easier/reach row beside it.
 *
 * The trio is spaced two hundred points apart rather than by Codeforces' own
 * difficulty words, because at 1600 an "easy" problem means 1400, not 800.
 *
 * Each pick is excluded from the ones after it. Without that, somebody who has
 * cleared everything below their level gets the same problem three times: all
 * three searches walk upward and land on the first unsolved band together.
 */
export function chooseDaily(
  candidates: DailyCandidate[],
  rating: number | undefined,
  solved: ReadonlySet<string>,
  day: string,
  seed = '',
): DailySet {
  const band = bandFor(rating);
  const taken = new Set(solved);

  const take = (target: number) => {
    const pick = pickNear(
      candidates,
      Math.min(3500, Math.max(800, target)),
      taken,
      day,
      seed,
    );
    if (pick) taken.add(pick.key);
    return pick;
  };

  // Today's problem first, so it gets the band it was aimed at rather than
  // whatever the other two left behind.
  const medium = take(band);
  const easy = take(band - 200);
  const hard = take(band + 200);

  return { main: medium, easy, medium, hard, band };
}

/**
 * One problem a day, the same one for everybody, with no server.
 *
 * The reference extension puts a "Global" problem of the day above your
 * personal one, and the obvious way to do that is a backend that picks one and
 * hands it out. There is no backend here and there is not going to be one — so
 * it is derived instead: the day seeds a rotation over the whole problemset,
 * and every copy of the extension walks to the same entry. Two people comparing
 * notes see the same problem because the arithmetic is the same, not because a
 * server told them.
 *
 * Unlike the personal pick this ignores what you have solved. That is the
 * point of a global one — it is the same problem whether or not you have done
 * it, and the UI says "solved" rather than quietly moving on.
 */
export function pickGlobal(candidates: DailyCandidate[], day: string): DailyPick | undefined {
  // Rated problems only. An unrated one is usually an April Fools' entry or a
  // gym leftover, and "today's problem" landing on one of those is a bad day
  // for everybody at once.
  const rated = candidates.filter((candidate) => candidate.rating > 0);
  if (rated.length === 0) return undefined;

  const ordered = [...rated].sort((a, b) => a.key.localeCompare(b.key));
  return toPick(ordered[hashString(`global:${day}`) % ordered.length]!);
}

/* ---------------------------------------------------------------- streaks */

/** What was picked on a given day, and what became of it. */
export interface DailyRecord {
  key: string;
  pickedAt: number;
  /** Set when the user chose to skip rather than solve. */
  skipped?: boolean;
}

export type DailyLog = Record<string, DailyRecord>;

export interface Streak {
  current: number;
  longest: number;
  /** True when today's is still open — the streak survives until midnight. */
  todayPending: boolean;
}

/**
 * How many days in a row the daily problem was actually solved.
 *
 * Two things today can be that are not "done", and they are not the same:
 * *not yet* is pending — a streak reading zero at nine in the morning, before
 * you have had a chance, is the opposite of motivating — while *skipped* is a
 * decision, and a decision not to do it today is what breaking a streak means.
 * The backlog is the honest middle: it keeps the day pending rather than
 * spending a skip on it.
 */
export function dailyStreak(log: DailyLog, solved: ReadonlySet<string>, today: string): Streak {
  const done = (day: string) => {
    const record = log[day];
    return record !== undefined && !record.skipped && solved.has(record.key);
  };

  let current = 0;
  if (log[today]?.skipped) {
    // Deliberately passed on today: the run ends here, whatever came before.
    return { current: 0, longest: longestRun(log, done), todayPending: false };
  }

  let cursor = done(today) ? today : previousDay(today);
  while (done(cursor)) {
    current += 1;
    cursor = previousDay(cursor);
  }

  return {
    current,
    longest: Math.max(longestRun(log, done), current),
    todayPending: !done(today),
  };
}

/**
 * The longest run anywhere in the log.
 *
 * Kept alongside the current one because it is what makes a bad week
 * survivable: a streak that only ever shows today's number turns one missed
 * day into a reason to stop looking.
 */
function longestRun(log: DailyLog, done: (day: string) => boolean): number {
  let longest = 0;
  let run = 0;
  let expected: string | undefined;

  for (const day of Object.keys(log).sort()) {
    if (!done(day)) {
      run = 0;
      expected = undefined;
      continue;
    }
    run = expected === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    expected = dayKey(Date.parse(`${day}T00:00:00Z`) + 86_400_000);
  }

  return longest;
}

/** The last `days` days, oldest first, with whether each was solved. */
export function calendar(
  log: DailyLog,
  solved: ReadonlySet<string>,
  today: string,
  days = 35,
): Array<{ day: string; state: 'done' | 'skipped' | 'missed' | 'future' | 'none' }> {
  const out: Array<{ day: string; state: 'done' | 'skipped' | 'missed' | 'future' | 'none' }> = [];
  let cursor = today;

  for (let i = 0; i < days; i += 1) {
    const record = log[cursor];
    const state = !record
      ? 'none'
      : record.skipped
        ? 'skipped'
        : solved.has(record.key)
          ? 'done'
          : cursor === today
            ? 'future'
            : 'missed';
    out.unshift({ day: cursor, state });
    cursor = previousDay(cursor);
  }

  return out;
}

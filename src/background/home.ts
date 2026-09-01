import { dayKey as localDay } from '../core/analytics.ts';
import {
  calendar,
  chooseDaily,
  dailyStreak,
  dayKey as utcDay,
  problemUrl,
  type DailyCandidate,
  type DailyPick,
} from '../core/daily.ts';
import type { HomeData } from '../core/messages.ts';
import {
  getBacklog,
  getDailyLog,
  getMeta,
  getProblemList,
  getSettings,
  saveBacklog,
  saveDailyRecord,
} from '../core/storage.ts';
import { dueProblems } from '../core/srs.ts';
import { ensureProblemset, ensureUserStatus } from './cf-mirror.ts';

/**
 * Assembles the Home tab.
 *
 * The tab answers one question — what should I do in the next hour — so the
 * data for it is built in one pass rather than by five components each fetching
 * their own piece and shifting the layout as it lands.
 */

/** Everything solved, from both halves of the truth. */
async function solvedSet(handle: string): Promise<Set<string>> {
  const [status, problems] = await Promise.all([
    handle ? ensureUserStatus(handle).catch(() => undefined) : undefined,
    getProblemList(),
  ]);

  const solved = new Set(status?.solved ?? []);
  // Redo's own records cover anything solved before the mirror existed, and
  // anything solved in the last hour that the cache has not caught up with.
  for (const problem of problems) {
    if (problem.platform === 'codeforces') solved.add(problem.slug.toUpperCase());
  }
  return solved;
}

/**
 * Two calendars, deliberately.
 *
 * The daily problem is keyed in UTC so that two devices in different time zones
 * are offered the same problem and agree on whether it was done. "Solved today"
 * is keyed locally, because that one is about the user's own day — the evening
 * of the 3rd is still the 3rd to the person having it.
 */
export async function buildHome(now = Date.now()): Promise<HomeData> {
  const today = utcDay(now);
  const [settings, meta, problems, log, backlogKeys] = await Promise.all([
    getSettings(),
    getMeta(),
    getProblemList(),
    getDailyLog(),
    getBacklog(),
  ]);

  const handle = settings.handles.codeforces.trim();
  const due = dueProblems(problems, now);
  const localToday = localDay(now);
  const solvedToday = problems.filter(
    (problem) => localDay(problem.solvedAt) === localToday,
  ).length;

  const base = {
    today,
    solveStreak: meta.currentStreak,
    due: due.slice(0, 5).map((problem) => ({
      id: problem.id,
      slug: problem.slug,
      title: problem.title,
      platform: problem.platform,
      dueAt: problem.revision.dueAt,
      stage: problem.revision.stage,
    })),
    dueTotal: due.length,
    solvedToday,
    now,
  };

  if (!handle) {
    return {
      ...base,
      dailyState: 'unavailable',
      streak: { current: 0, longest: 0, todayPending: false },
      calendar: [],
      backlog: [],
      reason: 'Add your Codeforces handle in Settings to get a problem a day at your level.',
    };
  }

  const [problemset, solved] = await Promise.all([
    ensureProblemset().catch(() => undefined),
    solvedSet(handle),
  ]);

  if (!problemset) {
    return {
      ...base,
      dailyState: 'unavailable',
      streak: dailyStreak(log, solved, today),
      calendar: calendar(log, solved, today),
      backlog: [],
      reason: 'Codeforces could not be reached, so there is no problem to offer yet.',
    };
  }

  const candidates: DailyCandidate[] = Object.entries(problemset.problems)
    .filter(([, meta]) => meta.rating !== undefined)
    .map(([key, meta]) => ({ key, name: meta.name, rating: meta.rating!, tags: meta.tags }));

  // The account's rating is not on hand here without another API call, so the
  // band comes from what has actually been solved — the hardest thing you have
  // got through is a better guide to what to offer than a contest rating is
  // anyway, and it needs nothing extra.
  const solvedRatings = [...solved]
    .map((key) => problemset.problems[key]?.rating)
    .filter((rating): rating is number => rating !== undefined)
    .sort((a, b) => a - b);
  const level = solvedRatings.length > 0
    ? solvedRatings[Math.floor(solvedRatings.length * 0.8)]
    : undefined;

  const daily = chooseDaily(candidates, level, solved, today, handle.toLowerCase());

  // The pick is recorded the first time it is seen, which is what makes a past
  // day's streak answerable at all — the exclusion set moves as you solve.
  const recorded = log[today];
  if (!recorded && daily.main) {
    await saveDailyRecord(today, { key: daily.main.key, pickedAt: now });
    log[today] = { key: daily.main.key, pickedAt: now };
  }

  const record = log[today];
  // A recorded day keeps its problem even once solved, so the card can say so
  // rather than silently rolling on to the next one.
  const pinned = record ? problemset.problems[record.key] : undefined;
  if (record && pinned) {
    daily.main = { key: record.key, name: pinned.name, rating: pinned.rating ?? 0, tags: pinned.tags, url: problemUrl(record.key) };
  }

  const dailyState = !record
    ? 'unavailable'
    : record.skipped
      ? 'skipped'
      : solved.has(record.key)
        ? 'done'
        : 'open';

  const backlog: DailyPick[] = backlogKeys
    .map((key) => {
      const meta = problemset.problems[key];
      return meta
        ? { key, name: meta.name, rating: meta.rating ?? 0, tags: meta.tags, url: problemUrl(key) }
        : undefined;
    })
    .filter((pick): pick is DailyPick => pick !== undefined)
    // Solving one from the backlog takes it off the list without a click.
    .filter((pick) => !solved.has(pick.key));

  if (backlog.length !== backlogKeys.length) {
    await saveBacklog(backlog.map((pick) => pick.key));
  }

  return {
    ...base,
    daily,
    dailyState,
    reason: daily.main
      ? undefined
      : 'Everything within six hundred points of your level is solved. Nothing left to offer — which is a good problem to have.',
    streak: dailyStreak(log, solved, today),
    calendar: calendar(log, solved, today),
    backlog,
  };
}

export async function skipToday(now = Date.now()): Promise<HomeData> {
  const today = utcDay(now);
  const log = await getDailyLog();
  const record = log[today];
  if (record) await saveDailyRecord(today, { ...record, skipped: true });
  return buildHome(now);
}

export async function addToBacklog(key: string, now = Date.now()): Promise<HomeData> {
  const backlog = await getBacklog();
  await saveBacklog([key.toUpperCase(), ...backlog]);
  return buildHome(now);
}

export async function removeFromBacklog(key: string, now = Date.now()): Promise<HomeData> {
  const backlog = await getBacklog();
  await saveBacklog(backlog.filter((entry) => entry !== key.toUpperCase()));
  return buildHome(now);
}

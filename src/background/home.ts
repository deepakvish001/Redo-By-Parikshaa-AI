import { dayKey as localDay } from '../core/analytics.ts';
import {
  calendar,
  chooseDaily,
  dailyStreak,
  pickGlobal,
  dayKey as utcDay,
  problemUrl,
  type DailyPick,
} from '../core/daily.ts';
import type { HomeData } from '../core/messages.ts';
import {
  getBacklog,
  getDailyLog,
  getMeta,
  getProblemList,
  saveBacklog,
  saveDailyRecord,
} from '../core/storage.ts';
import { dueProblems } from '../core/srs.ts';
import { cfState } from './cf-state.ts';

/**
 * Assembles the Home tab.
 *
 * The tab answers one question — what should I do in the next hour — so the
 * data for it is built in one pass rather than by five components each fetching
 * their own piece and shifting the layout as it lands.
 */

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
  const [meta, problems, log, backlogKeys] = await Promise.all([
    getMeta(),
    getProblemList(),
    getDailyLog(),
    getBacklog(),
  ]);

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

  const state = await cfState();
  if (!state.ok) {
    return {
      ...base,
      dailyState: 'unavailable',
      streak: dailyStreak(log, state.solved, today),
      calendar: calendar(log, state.solved, today),
      backlog: [],
      reason: state.reason,
    };
  }

  const { solved, problemset, candidates, band, handle } = state;
  const daily = chooseDaily(candidates, band, solved, today, handle.toLowerCase());
  const global = pickGlobal(candidates, today);

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
  const pinned = record ? problemset[record.key] : undefined;
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
      const meta = problemset[key];
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
    global,
    globalSolved: global ? solved.has(global.key) : false,
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

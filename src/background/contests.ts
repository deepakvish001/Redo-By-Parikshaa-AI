import {
  LEETCODE_CONTEST_QUERY,
  dueReminders,
  formatStartsIn,
  parseAtCoder,
  parseCodeChef,
  parseCodeforces,
  parseLeetCode,
  upcoming,
  type Contest,
} from '../core/contests.ts';
import type { Platform, Settings } from '../core/types.ts';

const CACHE_KEY = 'contests';
const REMINDED_KEY = 'contestsReminded';

export interface ContestCache {
  contests: Contest[];
  fetchedAt: number;
  /** Sources that failed on the last refresh, so the UI can say so. */
  failed: Platform[];
}

/**
 * One fetcher per judge. Each returns its own contests or throws; a thrown
 * source is reported and skipped rather than emptying the list.
 */
const SOURCES: Array<{ platform: Platform; fetch: () => Promise<Contest[]> }> = [
  {
    platform: 'codeforces',
    fetch: async () => {
      const response = await fetch('https://codeforces.com/api/contest.list?gym=false');
      if (!response.ok) throw new Error(`Codeforces returned ${response.status}`);
      return parseCodeforces(await response.text());
    },
  },
  {
    platform: 'leetcode',
    fetch: async () => {
      const response = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: LEETCODE_CONTEST_QUERY }),
      });
      if (!response.ok) throw new Error(`LeetCode returned ${response.status}`);
      return parseLeetCode(await response.text());
    },
  },
  {
    platform: 'codechef',
    fetch: async () => {
      const response = await fetch('https://www.codechef.com/api/list/contests/all');
      if (!response.ok) throw new Error(`CodeChef returned ${response.status}`);
      return parseCodeChef(await response.text());
    },
  },
  {
    platform: 'atcoder',
    fetch: async () => {
      const response = await fetch('https://atcoder.jp/contests/');
      if (!response.ok) throw new Error(`AtCoder returned ${response.status}`);
      return parseAtCoder(await response.text());
    },
  },
];

export async function getCachedContests(): Promise<ContestCache> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  return (
    (stored[CACHE_KEY] as ContestCache | undefined) ?? {
      contests: [],
      fetchedAt: 0,
      failed: [],
    }
  );
}

/**
 * Refreshes every enabled source. Sources run in parallel and are settled
 * independently, so a judge being down costs only its own entries.
 */
export async function refreshContests(settings: Settings): Promise<ContestCache> {
  const enabled = SOURCES.filter((source) => settings.contests.platforms[source.platform] !== false);

  const results = await Promise.allSettled(enabled.map((source) => source.fetch()));

  const contests: Contest[] = [];
  const failed: Platform[] = [];

  results.forEach((result, index) => {
    const platform = enabled[index]?.platform;
    if (result.status === 'fulfilled') contests.push(...result.value);
    else if (platform) failed.push(platform);
  });

  const cache: ContestCache = {
    contests: upcoming(contests, Date.now()),
    fetchedAt: Date.now(),
    failed,
  };
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
  return cache;
}

/**
 * Notifies about contests starting within the lead time.
 *
 * Reminders already sent are remembered so a refresh does not re-notify, and
 * the record is pruned to contests still in the cache so it cannot grow
 * without bound.
 */
export async function sendContestReminders(settings: Settings): Promise<number> {
  if (!settings.contests.remind) return 0;

  const cache = await getCachedContests();
  const stored = await chrome.storage.local.get(REMINDED_KEY);
  const reminded = (stored[REMINDED_KEY] as string[] | undefined) ?? [];

  const due = dueReminders(cache.contests, reminded, settings.contests.leadMinutes, Date.now());

  for (const contest of due) {
    chrome.notifications.create(`contest:${contest.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: `${contest.name} starts ${formatStartsIn(contest.startAt, Date.now())}`,
      message: contest.url.replace(/^https:\/\//, ''),
      priority: 1,
    });
  }

  if (due.length > 0) {
    const live = new Set(cache.contests.map((contest) => contest.id));
    const next = [...reminded, ...due.map((contest) => contest.id)].filter((id) => live.has(id));
    await chrome.storage.local.set({ [REMINDED_KEY]: next });
  }

  return due.length;
}

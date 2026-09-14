import {
  dayKey,
  decide,
  resolveTarget,
  utcDayKey,
  type FocusTarget,
  type PauseState,
} from '../core/focus.ts';
import { dueProblems } from '../core/srs.ts';
import { getProblemList, getSettings } from '../core/storage.ts';

const PAUSE_KEY = 'focusPause';
const DAILY_KEY = 'leetcodeDaily';

export async function getPause(): Promise<PauseState> {
  const stored = await chrome.storage.local.get(PAUSE_KEY);
  return (stored[PAUSE_KEY] as PauseState | undefined) ?? {};
}

/**
 * Spends the day's one emergency pause.
 *
 * Returns false when it has already been used today — the limit is the only
 * thing that makes the gate mean anything.
 */
export async function startPause(now = Date.now()): Promise<{ started: boolean; until?: number }> {
  const [pause, settings] = await Promise.all([getPause(), getSettings()]);
  if (pause.day === dayKey(now)) {
    return { started: false, until: pause.until };
  }

  const until = now + Math.max(1, settings.focus.pauseHours) * 3_600_000;
  await chrome.storage.local.set({ [PAUSE_KEY]: { until, day: dayKey(now) } satisfies PauseState });
  return { started: true, until };
}

interface DailyCache {
  /** UTC day the entry is for — LeetCode rolls the daily at 00:00 UTC. */
  day: string;
  url: string;
  title: string;
}

const DAILY_QUERY = `query daily {
  activeDailyCodingChallengeQuestion {
    link
    question { title titleSlug difficulty }
  }
}`;

/**
 * Today's LeetCode challenge, cached for the UTC day.
 *
 * Fetched rather than guessed: LeetCode publishes no stable URL for the daily,
 * only this query, and the answer changes at UTC midnight regardless of where
 * the user is.
 */
export async function getDaily(now = Date.now()): Promise<DailyCache | undefined> {
  const today = utcDayKey(now);
  const stored = await chrome.storage.local.get(DAILY_KEY);
  const cached = stored[DAILY_KEY] as DailyCache | undefined;
  if (cached?.day === today) return cached;

  try {
    const response = await fetch('https://leetcode.com/graphql/', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: DAILY_QUERY, variables: {} }),
    });
    if (!response.ok) return cached;

    const json = (await response.json()) as {
      data?: {
        activeDailyCodingChallengeQuestion?: {
          link?: string;
          question?: { title?: string; titleSlug?: string };
        };
      };
    };

    const entry = json.data?.activeDailyCodingChallengeQuestion;
    const slug = entry?.question?.titleSlug;
    if (!slug) return cached;

    const fresh: DailyCache = {
      day: today,
      url: entry?.link
        ? new URL(entry.link, 'https://leetcode.com').toString()
        : `https://leetcode.com/problems/${slug}/`,
      title: entry?.question?.title ?? slug,
    };
    await chrome.storage.local.set({ [DAILY_KEY]: fresh });
    return fresh;
  } catch {
    // Offline, or LeetCode is down. A stale entry is better than no gate at all.
    return cached;
  }
}

/** Everything the gate page needs to render itself. */
export async function focusState(now = Date.now()) {
  const [settings, problems, pause] = await Promise.all([
    getSettings(),
    getProblemList(),
    getPause(),
  ]);

  const decision = decide('https://example.com', settings.focus, problems, pause, now);
  const due = dueProblems(problems, now)[0];
  const daily = settings.focus.mode === 'daily' ? await getDaily(now) : undefined;

  return {
    settings: settings.focus,
    decision,
    pause,
    target: resolveTarget(settings.focus, due, daily),
    dueCount: dueProblems(problems, now).length,
  };
}

/** The gate page, carrying where the user was headed so it can offer it back. */
function gateUrl(from: string, target: FocusTarget): string {
  const url = new URL(chrome.runtime.getURL('focus/index.html'));
  url.searchParams.set('from', from);
  url.searchParams.set('to', target.url);
  return url.toString();
}

/**
 * Watches navigation and gates it.
 *
 * `tabs.onUpdated` with the `tabs` permission is enough to read the URL and to
 * navigate the tab — deliberately chosen over `<all_urls>` host permissions,
 * which would let the extension read page content it has no business reading
 * and would change the install warning to cover every site.
 *
 * Three triggers, not one. The first version listened only for `changeInfo.url`
 * and that is why focus mode looked broken: a URL *change* is not the only way
 * to arrive somewhere.
 */
export function watchNavigation(): void {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // `changeInfo.url` is set only when the address actually changes — so a
    // reload did not fire it, and neither did re-entering the address you were
    // already on. Those need a second trigger.
    //
    // `complete` and not `loading` for that trigger: early in a navigation the
    // tab still reports the URL it is leaving, so gating on `loading` would
    // sometimes read the old page and yank a legitimate trip to Codeforces back
    // to the gate. At `complete` the URL is settled. An ordinary navigation
    // still gates instantly through `changeInfo.url`; only the cases that had
    // no gate at all wait for the load to finish.
    const url = changeInfo.url ?? (changeInfo.status === 'complete' ? tab.url : undefined);
    if (!url) return;
    void gateIfNeeded(tabId, url);
  });

  // Switching to a tab counts as arriving at it. This is also what makes
  // gating on settings changes safe to keep to the active tab: a background
  // tab is left alone until you actually look at it.
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void gateTab(tabId);
  });

  // Turning focus mode on has to act on the tab you are looking at, or the
  // feature appears to do nothing at all — the one tab in front of you when
  // you flip the switch was the one tab it would never touch.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('settings' in changes)) return;
    void gateActiveTabs();
  });
}

async function gateTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) await gateIfNeeded(tabId, tab.url);
  } catch {
    // The tab went away between the event and the lookup.
  }
}

/**
 * Gates what is on screen right now, and only that.
 *
 * The active tab of each window rather than every tab open: replacing forty
 * background tabs with forty gate pages the moment somebody tries the feature
 * would be destructive in a way that no amount of "you can go back" makes up
 * for. A background tab is gated by `onActivated` when it is looked at, which
 * is the moment the gate is actually for.
 */
export async function gateActiveTabs(): Promise<void> {
  const settings = await getSettings();
  if (!settings.focus.enabled) return;

  const tabs = await chrome.tabs.query({ active: true });
  await Promise.all(
    tabs.map((tab) => (tab.id !== undefined && tab.url ? gateIfNeeded(tab.id, tab.url) : undefined)),
  );
}

async function gateIfNeeded(tabId: number, url: string): Promise<void> {
  // Never gate our own gate — that is an infinite loop with a UI.
  if (url.startsWith(chrome.runtime.getURL(''))) return;

  const now = Date.now();
  const [settings, problems, pause] = await Promise.all([
    getSettings(),
    getProblemList(),
    getPause(),
  ]);

  const decision = decide(url, settings.focus, problems, pause, now);
  if (!decision.gate) return;

  const due = dueProblems(problems, now)[0];
  const daily = settings.focus.mode === 'daily' ? await getDaily(now) : undefined;
  const target = resolveTarget(settings.focus, due, daily);

  try {
    await chrome.tabs.update(tabId, { url: gateUrl(url, target) });
  } catch {
    // The tab was closed or navigated again mid-decision; nothing to recover.
  }
}

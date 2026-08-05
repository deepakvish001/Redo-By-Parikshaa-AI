import { PARIKSHAA_URL } from './brand.ts';
import type { SolvedProblem } from './types.ts';

/**
 * Focus mode: nothing else until today's problem is done.
 *
 * The idea is Brian Tracy's — do the hardest thing first and the day stops
 * negotiating with you. The implementation here is deliberately a gate rather
 * than a silent redirect: yanking someone from YouTube to LeetCode with no
 * explanation is indistinguishable from a hijacked browser, and it gives them
 * nowhere to press the escape hatch.
 */

export type FocusMode = 'daily' | 'due' | 'any';

export interface FocusSettings {
  enabled: boolean;
  /** Which problem the gate points at. */
  mode: FocusMode;
  /** Problems that must be solved today before browsing opens up. */
  dailyGoal: number;
  /** Hosts never gated, on top of the built-in list. One per line in Settings. */
  allowlist: string[];
  /** Hours one emergency pause buys. */
  pauseHours: number;
}

export const DEFAULT_FOCUS: FocusSettings = {
  enabled: false,
  mode: 'due',
  dailyGoal: 1,
  allowlist: [],
  pauseHours: 3,
};

export const FOCUS_MODE_LABELS: Record<FocusMode, string> = {
  daily: "LeetCode's daily challenge",
  due: 'A problem due for revision',
  any: 'Any problem from the problem set',
};

/**
 * Hosts the gate never applies to.
 *
 * The judges are the point of the exercise; Parikshaa and GitHub are where the
 * work goes; the rest are the places you cannot lock someone out of without
 * breaking their machine — mail and search included, because an extension that
 * blocks Gmail gets uninstalled the first morning it does so.
 */
export const ALWAYS_ALLOWED = [
  'leetcode.com',
  'leetcode.cn',
  'codeforces.com',
  'atcoder.jp',
  'codechef.com',
  'hackerrank.com',
  'geeksforgeeks.org',
  'parikshaa.org',
  'github.com',
  'accounts.google.com',
  'mail.google.com',
  'calendar.google.com',
  'localhost',
];

/** True when the URL is not something the gate should ever interrupt. */
export function isAllowed(url: string, allowlist: string[] = []): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL we can reason about — never gate it.
    return true;
  }

  // Anything that is not an ordinary web page: extension pages, new tab,
  // devtools, files, blobs. Redirecting these is either impossible or hostile.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;

  const host = parsed.hostname.toLowerCase();
  const entries = [...ALWAYS_ALLOWED, ...allowlist]
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => entry.replace(/^https?:\/\//, '').replace(/\/.*$/, ''));

  // A bare host matches its subdomains, so "google.com" covers "docs.google.com"
  // — but never "notgoogle.com".
  return entries.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/** Local calendar day, which is the day the user thinks in. */
export function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

export function solvedToday(problems: SolvedProblem[], now: number): number {
  const today = dayKey(now);
  return problems.filter((problem) => dayKey(problem.solvedAt) === today).length;
}

export interface PauseState {
  /** ms since epoch the current pause runs until, if any. */
  until?: number;
  /** The day the pause was spent, so only one is granted per day. */
  day?: string;
}

export function isPaused(pause: PauseState, now: number): boolean {
  return Boolean(pause.until && pause.until > now);
}

export function canPause(pause: PauseState, now: number): boolean {
  return pause.day !== dayKey(now);
}

export interface GateDecision {
  gate: boolean;
  /** Why not, when it is not gating — used by the panel to explain itself. */
  reason?: 'off' | 'paused' | 'goal-met' | 'allowed';
  solved: number;
  goal: number;
}

/** The whole decision, in one pure function so it can be tested directly. */
export function decide(
  url: string,
  settings: FocusSettings,
  problems: SolvedProblem[],
  pause: PauseState,
  now: number,
): GateDecision {
  const solved = solvedToday(problems, now);
  const goal = Math.max(1, settings.dailyGoal);
  const base = { solved, goal };

  if (!settings.enabled) return { gate: false, reason: 'off', ...base };
  if (isPaused(pause, now)) return { gate: false, reason: 'paused', ...base };
  if (solved >= goal) return { gate: false, reason: 'goal-met', ...base };
  if (isAllowed(url, settings.allowlist)) return { gate: false, reason: 'allowed', ...base };

  return { gate: true, ...base };
}

export interface FocusTarget {
  url: string;
  title: string;
  /** What the gate says about why this problem. */
  note: string;
}

export const PROBLEM_SET_URL = 'https://leetcode.com/problemset/';

/**
 * Where the gate sends you.
 *
 * `due` is the mode that only Redo can offer: the extension already knows which
 * problem you are about to forget, which beats a random one on every axis that
 * matters.
 */
export function resolveTarget(
  settings: FocusSettings,
  due: SolvedProblem | undefined,
  daily: { url: string; title: string } | undefined,
): FocusTarget {
  if (settings.mode === 'due' && due) {
    return {
      url: due.url,
      title: due.title,
      note: 'Due for revision — re-solve it, then rate how it went.',
    };
  }

  if (settings.mode === 'daily' && daily) {
    return { url: daily.url, title: daily.title, note: "Today's LeetCode challenge." };
  }

  if (settings.mode === 'daily') {
    // The daily lookup failed; the problem set still gets them started.
    return {
      url: PROBLEM_SET_URL,
      title: 'LeetCode problem set',
      note: "Could not reach today's challenge, so here is the full set.",
    };
  }

  if (settings.mode === 'due') {
    return {
      url: `${PARIKSHAA_URL}/library`,
      title: 'Parikshaa problem library',
      note: 'Nothing is due for revision — pick something new.',
    };
  }

  return {
    url: PROBLEM_SET_URL,
    title: 'LeetCode problem set',
    note: 'Pick one and get it done.',
  };
}

/** LeetCode rolls the daily over at 00:00 UTC, not at local midnight. */
export function utcDayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

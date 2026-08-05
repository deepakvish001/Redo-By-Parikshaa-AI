import { computeStats, dayKey } from '../core/analytics.ts';
import { verifyAccess } from '../core/github.ts';
import type { Request, Response, ResponseMap } from '../core/messages.ts';
import { problemKey } from '../core/paths.ts';
import { isExpired, type SessionDiagnostic } from '../core/parikshaa.ts';
import {
  deleteProblem,
  getMeta,
  getParikshaaApi,
  getParikshaaCredentials,
  getProblem,
  getProblemList,
  getSettings,
  putProblem,
  saveMeta,
  saveParikshaaCredentials,
  saveSettings,
  updateProblem,
} from '../core/storage.ts';
import { applyRecall, dueProblems, initialRevision, isDue } from '../core/srs.ts';
import type { AcceptedSubmission, Recall, SolvedProblem } from '../core/types.ts';
import { flushPending, syncToParikshaa } from './parikshaa-sync.ts';
import { syncProblem } from './sync.ts';

const BADGE_ALARM = 'refresh-badge';
const DIGEST_ALARM = 'daily-digest';

/* ------------------------------------------------------------------ badge */

async function refreshBadge(): Promise<number> {
  const problems = await getProblemList();
  const due = dueProblems(problems, Date.now()).length;
  await chrome.action.setBadgeText({ text: due > 0 ? String(due) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#6d4aff' });
  return due;
}

async function sendDigest(): Promise<void> {
  const settings = await getSettings();
  if (!settings.revision.notify) return;

  const due = await refreshBadge();
  if (due === 0) return;

  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: `${due} problem${due === 1 ? '' : 's'} due for revision`,
    message: 'Open the extension to see which ones, then re-solve them on the site.',
    priority: 0,
  });
}

/* --------------------------------------------------------- solve timing */

const OPENED_KEY = 'openedAt';
/**
 * Anything longer than this is a tab left open, not time spent solving, so it
 * is discarded rather than recorded as a six-hour struggle.
 */
const MAX_SOLVE_MS = 6 * 60 * 60 * 1000;

async function readOpened(): Promise<Record<string, number>> {
  const stored = await chrome.storage.local.get(OPENED_KEY);
  return (stored[OPENED_KEY] as Record<string, number> | undefined) ?? {};
}

/**
 * Notes when a problem page was opened. An existing timestamp is kept unless
 * it has gone stale, so navigating away and back mid-solve does not restart
 * the clock.
 */
async function recordPageOpened(key: string): Promise<void> {
  const opened = await readOpened();
  const existing = opened[key];
  const now = Date.now();
  if (existing && now - existing < MAX_SOLVE_MS) return;

  opened[key] = now;
  await chrome.storage.local.set({ [OPENED_KEY]: opened });
}

/** Elapsed time since the page was opened, and forgets the entry. */
async function takeSolveTime(key: string): Promise<number | undefined> {
  const opened = await readOpened();
  const startedAt = opened[key];
  if (!startedAt) return undefined;

  delete opened[key];
  await chrome.storage.local.set({ [OPENED_KEY]: opened });

  const elapsed = Date.now() - startedAt;
  return elapsed > 0 && elapsed <= MAX_SOLVE_MS ? elapsed : undefined;
}

/* ------------------------------------------------------- solved problems */

async function recordSubmission(
  submission: AcceptedSubmission,
): Promise<ResponseMap['submission:accepted']> {
  const settings = await getSettings();
  if (!settings.platforms[submission.platform]) {
    return { saved: false, reason: `Tracking for ${submission.platform} is turned off in options.` };
  }

  const id = problemKey(submission.platform, submission.slug);
  const existing = await getProblem(id);
  const now = Date.now();

  const problem: SolvedProblem = {
    id,
    platform: submission.platform,
    problemId: submission.problemId,
    slug: submission.slug,
    title: submission.title,
    url: submission.url,
    difficulty: submission.difficulty,
    // Keep known tags if a re-solve resolves without them.
    tags: submission.tags.length > 0 ? submission.tags : (existing?.tags ?? []),
    language: submission.language,
    code: submission.code,
    solvedAt: now,
    attempts: submission.attempts ?? existing?.attempts ?? 1,
    runtimeNote: submission.runtimeNote,
    memoryNote: submission.memoryNote,
    note: existing?.note,
    complexity: existing?.complexity,
    solveTimeMs: (await takeSolveTime(id)) ?? existing?.solveTimeMs,
    github: { status: 'pending' },
    parikshaa: { status: 'pending' },
    // A re-solve keeps its place on the ladder; only new problems start over.
    revision: existing?.revision ?? initialRevision(settings.revision.intervals, now),
  };

  await putProblem(problem);
  await refreshBadge();

  const [github, parikshaa] = await Promise.all([
    syncProblem(problem, settings),
    syncToParikshaa(problem, settings),
  ]);
  const synced = { ...problem, github, parikshaa };
  await putProblem(synced);

  return { saved: true, problem: synced };
}

async function reviewProblem(
  id: string,
  recall: Recall,
): Promise<ResponseMap['problem:review']> {
  const settings = await getSettings();
  const now = Date.now();

  const problem = await updateProblem(id, (current) => ({
    ...current,
    revision: applyRecall(current.revision, recall, settings.revision.intervals, now),
  }));

  if (problem) {
    const meta = await getMeta();
    const today = dayKey(now);
    const yesterday = dayKey(now - 86_400_000);
    const streak =
      meta.lastReviewDay === today
        ? meta.currentStreak
        : meta.lastReviewDay === yesterday
          ? meta.currentStreak + 1
          : 1;

    await saveMeta({
      reviewsCompleted: meta.reviewsCompleted + 1,
      lastReviewDay: today,
      currentStreak: streak,
      longestStreak: Math.max(meta.longestStreak, streak),
    });
  }

  await refreshBadge();
  return { problem };
}

/* --------------------------------------------------------------- routing */

async function handle(request: Request): Promise<unknown> {
  switch (request.type) {
    case 'submission:accepted':
      return recordSubmission(request.submission);

    case 'page:context': {
      const problem = await getProblem(`${request.platform}:${request.slug}`);
      if (!problem) return { tracked: false, due: false };
      return { tracked: true, due: isDue(problem.revision, Date.now()), problem };
    }

    case 'dashboard:get': {
      const [problems, settings] = await Promise.all([getProblemList(), getSettings()]);
      const now = Date.now();
      return {
        problems: problems.sort((a, b) => a.revision.dueAt - b.revision.dueAt),
        stats: computeStats(problems, settings.revision.intervals, now),
        settings,
        now,
      };
    }

    case 'problem:review':
      return reviewProblem(request.id, request.recall);

    case 'problem:details': {
      const problem = await updateProblem(request.id, (current) => ({
        ...current,
        note: request.note ?? current.note,
        complexity: request.complexity ?? current.complexity,
      }));
      // Notes belong in the committed README, so a save pushes them.
      if (problem) {
        const settings = await getSettings();
        const github = await syncProblem(problem, settings);
        const updated = { ...problem, github };
        await putProblem(updated);
        return { problem: updated };
      }
      return { problem };
    }

    case 'problem:get':
      return { problem: await getProblem(request.id) };

    case 'problem:hint': {
      const problem = await updateProblem(request.id, (current) => ({
        ...current,
        revision: {
          ...current.revision,
          // Counting reveals, not clicks: re-opening level 1 is not new help.
          hintsUsed: Math.max(current.revision.hintsUsed ?? 0, request.level),
        },
      }));
      return { problem };
    }

    case 'page:opened': {
      await recordPageOpened(`${request.platform}:${request.slug}`);
      return { tracking: true };
    }

    case 'problem:resync': {
      const [problem, settings] = await Promise.all([getProblem(request.id), getSettings()]);
      if (!problem) return { problem: undefined };
      const [github, parikshaa] = await Promise.all([
        syncProblem(problem, settings),
        syncToParikshaa(problem, settings),
      ]);
      const updated = { ...problem, github, parikshaa };
      await putProblem(updated);
      return { problem: updated };
    }

    case 'parikshaa:credentials': {
      await saveParikshaaCredentials(request.credentials);
      const settings = await getSettings();
      const flushed = await flushPending(settings, request.credentials);
      return { accepted: true, flushed };
    }

    case 'due:list': {
      const problems = await getProblemList();
      return {
        problems: dueProblems(problems, Date.now()).map((problem) => ({
          id: problem.id,
          slug: problem.slug,
          title: problem.title,
          platform: problem.platform,
          dueAt: problem.revision.dueAt,
          stage: problem.revision.stage,
        })),
      };
    }

    case 'parikshaa:diagnostic': {
      await chrome.storage.local.set({
        parikshaaDiagnostic: { ...request.diagnostic, at: Date.now() },
      });
      return { recorded: true };
    }

    case 'parikshaa:status': {
      const [credentials, api, problems, stored] = await Promise.all([
        getParikshaaCredentials(),
        getParikshaaApi(),
        getProblemList(),
        chrome.storage.local.get('parikshaaDiagnostic'),
      ]);
      const recorded = stored.parikshaaDiagnostic as
        | (SessionDiagnostic & { at: number })
        | undefined;
      return {
        diagnostic: recorded,
        diagnosticAt: recorded?.at,
        connected: Boolean(credentials),
        expired: credentials ? isExpired(credentials, Date.now()) : false,
        hasApiKey: Boolean(api?.apiKey),
        hasSession: Boolean(credentials?.accessToken),
        email: credentials?.email,
        capturedAt: credentials?.capturedAt,
        pending: problems.filter((problem) => problem.parikshaa?.status === 'pending').length,
      };
    }

    case 'problem:delete':
      await deleteProblem(request.id);
      await refreshBadge();
      return { ok: true };

    case 'settings:get':
      return getSettings();

    case 'settings:save': {
      const settings = await saveSettings(request.patch);
      await refreshBadge();
      return settings;
    }

    case 'github:verify':
      return verifyAccess(request.config);

    default: {
      const exhaustive: never = request;
      throw new Error(`Unknown request: ${JSON.stringify(exhaustive)}`);
    }
  }
}

chrome.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
  handle(request)
    .then((data) => sendResponse({ ok: true, data } as Response<Request['type']>))
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } as Response<Request['type']>),
    );
  // Keeps the message channel open for the async response above.
  return true;
});

/* ---------------------------------------------------------------- alarms */

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 30 });
  chrome.alarms.create(DIGEST_ALARM, { periodInMinutes: 60 * 12 });
  void refreshBadge();
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  void refreshBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BADGE_ALARM) void refreshBadge();
  if (alarm.name === DIGEST_ALARM) void sendDigest();
});

chrome.notifications.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

void refreshBadge();

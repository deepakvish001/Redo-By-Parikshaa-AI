import { computeStats, dayKey } from '../core/analytics.ts';
import { backupFilename, readBackup } from '../core/backup.ts';
import { verifyAccess } from '../core/github.ts';
import { MAX_LABELS, normalise } from '../core/labels.ts';
import { mergeUpsolve, reconcile, summariseUpsolve } from '../core/upsolve.ts';
import type { DiagnosticEntry, Request, Response, ResponseMap } from '../core/messages.ts';
import { extensionForLanguage, problemKey } from '../core/paths.ts';
import { isExpired, type SessionDiagnostic } from '../core/parikshaa.ts';
import { appendActivity, struggleScore } from '../core/journal.ts';
import { WEEK_MS, summariseWeek, wrappedCaption } from '../core/wrapped.ts';
import {
  appendJournalEvents,
  deleteJournal,
  deleteProblem,
  getJournal,
  getJournals,
  getMeta,
  getParikshaaApi,
  getParikshaaCredentials,
  getProblem,
  getProblemList,
  claimSubmissionIds,
  getSettings,
  getUpsolve,
  putProblem,
  saveMeta,
  saveParikshaaCredentials,
  saveSettings,
  saveUpsolve,
  updateProblem,
} from '../core/storage.ts';
import { applyRecall, dueProblems, initialRevision, isDue } from '../core/srs.ts';
import type {
  AcceptedSubmission,
  ActivityEvent,
  Recall,
  SolvedProblem,
} from '../core/types.ts';
import { getCachedContests, refreshContests, sendContestReminders } from './contests.ts';
import { focusState, startPause, watchNavigation } from './focus.ts';
import { applyBackup, currentBackup, pullBackup, pushBackup } from './backup.ts';
import {
  ensureProblemset,
  ensureUserStatus,
  friendSolves,
  handleCards,
  lookup,
  mirrorState,
  noteSolved,
  type CfProblemView,
} from './cf-mirror.ts';
import { dayKey as utcDay } from '../core/daily.ts';
import { addToBacklog, buildHome, removeFromBacklog, skipToday } from './home.ts';
import { buildInsights } from './insights.ts';
import { buildTrain, finishContest, rerollSlot, startContest } from './train.ts';
import { codeforcesProfile, fetchUpsolve, leetcodeProfile, predictCodeforces } from './rating.ts';
import { flushPending, syncToParikshaa } from './parikshaa-sync.ts';
import { syncProblem } from './sync.ts';
import { DRAFTS_KEY } from '../workspace/drafts.ts';

const BADGE_ALARM = 'refresh-badge';
const DIGEST_ALARM = 'daily-digest';
const CONTEST_ALARM = 'refresh-contests';
const WRAPPED_ALARM = 'weekly-wrapped';
const BACKUP_ALARM = 'daily-backup';
const STREAK_ALARM = 'streak-nudge';

const DIAGNOSTIC_KEY = 'detectionLog';
/** Enough to cover a submission flow, small enough to stay in storage. */
const DIAGNOSTIC_LIMIT = 300;

/* ------------------------------------------------------------------ badge */

async function refreshBadge(): Promise<number> {
  const problems = await getProblemList();
  const due = dueProblems(problems, Date.now()).length;
  await chrome.action.setBadgeText({ text: due > 0 ? String(due) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#f97316' });
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

  // A visit is logged even when the solve clock is already running — how many
  // times you came back to a problem is exactly the kind of thing worth having.
  await note(key, { at: now, kind: 'opened' });

  if (existing && now - existing < MAX_SOLVE_MS) return;

  opened[key] = now;
  await chrome.storage.local.set({ [OPENED_KEY]: opened });
}

/**
 * Appends one line to a problem's history.
 *
 * Silently does nothing for a problem that is not tracked yet — opens before
 * the first accepted submission have nowhere to go, and the attempt journal
 * already covers that stretch.
 */
async function note(id: string, event: ActivityEvent): Promise<void> {
  await updateProblem(id, (problem) => ({
    ...problem,
    history: appendActivity(problem.history ?? [], event),
  }));
}

/** The history line a finished sync deserves, whichever way it went. */
function syncNote(
  kind: 'github' | 'parikshaa',
  state: { status: string; reason?: string; error?: string; path?: string; url?: string },
  at: number,
): ActivityEvent {
  return {
    at,
    kind,
    outcome: state.status,
    reason: state.error ?? state.reason ?? state.path ?? state.url,
  };
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
    return { saved: false, reason: `Tracking for ${submission.platform} is turned off in Settings.` };
  }

  const id = problemKey(submission.platform, submission.slug);
  const existing = await getProblem(id);
  const now = Date.now();

  // Everything the judge said on the way here, including the runs and the
  // failed submits, which is what decides how hard this problem was.
  const events = await getJournal(id);
  const solveTimeMs = (await takeSolveTime(id)) ?? existing?.solveTimeMs;
  const struggle = struggleScore({
    events,
    attempts: submission.attempts,
    solveTimeMs,
    difficulty: submission.difficulty,
  });

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
    // Keyed by extension, so re-solving in C++20 replaces the C++17 file while
    // a Python solve sits beside it rather than on top of it.
    solutions: {
      ...existing?.solutions,
      [extensionForLanguage(submission.language)]: {
        language: submission.language,
        code: submission.code,
        solvedAt: now,
      },
    },
    solvedAt: now,
    attempts: submission.attempts ?? existing?.attempts ?? 1,
    runtimeNote: submission.runtimeNote,
    memoryNote: submission.memoryNote,
    note: existing?.note,
    complexity: existing?.complexity,
    solveTimeMs,
    events,
    history: appendActivity(existing?.history ?? [], {
      at: now,
      kind: 'solved',
      outcome: existing ? 're-solved' : 'first time',
      reason: `${submission.language}, ${submission.attempts ?? 1} attempt(s)`,
    }),
    github: { status: 'pending' },
    parikshaa: { status: 'pending' },
    // A re-solve keeps its place on the ladder; only new problems start over.
    revision: existing?.revision ?? initialRevision(settings.revision.intervals, now, struggle),
  };

  await putProblem(problem);
  await refreshBadge();

  // The mirror caches an hour at a time, but the extension just watched this
  // solve happen — leaving the page showing it as unsolved would be Redo
  // disagreeing with something the user saw it record.
  if (submission.platform === 'codeforces' && settings.handles.codeforces) {
    await noteSolved(settings.handles.codeforces, submission.slug.toUpperCase()).catch(
      () => undefined,
    );
  }

  const [github, parikshaa] = await Promise.all([
    syncProblem(problem, settings),
    syncToParikshaa(problem, settings),
  ]);
  const at = Date.now();
  const synced = {
    ...problem,
    github,
    parikshaa,
    history: [
      syncNote('github', github, at),
      syncNote('parikshaa', parikshaa, at),
    ].reduce(appendActivity, problem.history ?? []),
  };
  await putProblem(synced);

  return { saved: true, problem: synced };
}

async function reviewProblem(
  id: string,
  recall: Recall,
): Promise<ResponseMap['problem:review']> {
  const settings = await getSettings();
  const now = Date.now();

  const problem = await updateProblem(id, (current) => {
    const revision = applyRecall(current.revision, recall, settings.revision.intervals, now);
    return {
      ...current,
      revision,
      history: appendActivity(current.history ?? [], {
        at: now,
        kind: 'review',
        outcome: recall,
        reason: `stage ${current.revision.stage + 1} → ${revision.stage + 1}, next in ${Math.round(
          (revision.dueAt - now) / 86_400_000,
        )}d`,
      }),
    };
  });

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

async function handle(request: Request, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (request.type) {
    case 'submission:accepted':
      return recordSubmission(request.submission);

    case 'page:context': {
      const problem = await getProblem(`${request.platform}:${request.slug}`);
      if (!problem) return { tracked: false, due: false };
      return { tracked: true, due: isDue(problem.revision, Date.now()), problem };
    }

    case 'dashboard:get': {
      const [problems, settings, journals] = await Promise.all([
        getProblemList(),
        getSettings(),
        getJournals(),
      ]);
      const now = Date.now();
      const solved = new Set(problems.map((problem) => problem.id));

      // Problems still being worked on have a journal but no record yet; the
      // panel shows those as work in progress.
      const openJournals: Record<string, typeof journals[string]> = {};
      for (const [id, events] of Object.entries(journals)) {
        if (!solved.has(id)) openJournals[id] = events;
      }

      return {
        problems: problems.sort((a, b) => a.revision.dueAt - b.revision.dueAt),
        stats: computeStats(problems, settings.revision.intervals, now),
        settings,
        now,
        openJournals,
      };
    }

    case 'attempt:record': {
      // The platform comes off the wire as a string; the key is the same shape
      // either way, and an unknown platform simply never matches a problem.
      const id = `${request.platform}:${request.slug}`;
      const events = await appendJournalEvents(id, request.events);
      // A problem already solved keeps its journal on the record too, so a
      // re-solve's attempts are not lost when the journal is pruned.
      await updateProblem(id, (problem) => ({ ...problem, events }));
      return { recorded: events.length };
    }

    case 'problem:resync-parikshaa': {
      const [problem, settings] = await Promise.all([getProblem(request.id), getSettings()]);
      if (!problem) return { problem: undefined };
      const parikshaa = await syncToParikshaa(problem, settings);
      const updated = {
        ...problem,
        parikshaa,
        history: appendActivity(
          problem.history ?? [],
          syncNote('parikshaa', parikshaa, Date.now()),
        ),
      };
      await putProblem(updated);
      return { problem: updated };
    }

    case 'problem:review':
      return reviewProblem(request.id, request.recall);

    case 'problem:details': {
      const problem = await updateProblem(request.id, (current) => ({
        ...current,
        note: request.note ?? current.note,
        complexity: request.complexity ?? current.complexity,
        history: appendActivity(current.history ?? [], {
          at: Date.now(),
          kind: 'note',
          outcome: 'saved',
          reason: [
            request.note?.trim() ? 'approach' : undefined,
            request.complexity?.time || request.complexity?.space ? 'complexity' : undefined,
          ]
            .filter(Boolean)
            .join(' + ') || 'cleared',
        }),
      }));
      // Notes belong in the committed README, so a save pushes them.
      if (problem) {
        const settings = await getSettings();
        const github = await syncProblem(problem, settings);
        const updated = {
          ...problem,
          github,
          history: appendActivity(problem.history ?? [], syncNote('github', github, Date.now())),
        };
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
        history: appendActivity(current.history ?? [], {
          at: Date.now(),
          kind: 'hint',
          outcome: `level ${request.level}`,
          reason: ['nudge', 'approach', 'your own solution'][request.level - 1],
        }),
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
      const at = Date.now();
      const updated = {
        ...problem,
        github,
        parikshaa,
        history: [syncNote('github', github, at), syncNote('parikshaa', parikshaa, at)].reduce(
          appendActivity,
          problem.history ?? [],
        ),
      };
      await putProblem(updated);
      return { problem: updated };
    }

    case 'parikshaa:credentials': {
      await saveParikshaaCredentials(request.credentials);
      const settings = await getSettings();
      const flushed = await flushPending(settings, request.credentials);
      return { accepted: true, flushed };
    }

    case 'contests:get': {
      const [cache, settings] = await Promise.all([getCachedContests(), getSettings()]);
      // A cold or stale cache is refreshed on demand so the first open is not empty.
      const fresh =
        Date.now() - cache.fetchedAt > 3 * 60 * 60 * 1000
          ? await refreshContests(settings)
          : cache;
      return { ...fresh, now: Date.now() };
    }

    case 'contests:refresh': {
      const cache = await refreshContests(await getSettings());
      return { ...cache, now: Date.now() };
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

    case 'diagnostics:record': {
      const stored = await chrome.storage.local.get(DIAGNOSTIC_KEY);
      const existing = (stored[DIAGNOSTIC_KEY] as DiagnosticEntry[] | undefined) ?? [];
      // A ring buffer — a judge that polls every second must not fill storage.
      const next = [...existing, ...request.entries].slice(-DIAGNOSTIC_LIMIT);
      await chrome.storage.local.set({ [DIAGNOSTIC_KEY]: next });
      return { recorded: request.entries.length };
    }

    case 'diagnostics:get': {
      const [stored, settings] = await Promise.all([
        chrome.storage.local.get(DIAGNOSTIC_KEY),
        getSettings(),
      ]);
      return {
        entries: (stored[DIAGNOSTIC_KEY] as DiagnosticEntry[] | undefined) ?? [],
        enabled: settings.diagnostics.enabled,
      };
    }

    case 'focus:status':
      return focusState();

    case 'focus:pause':
      return startPause();

    case 'problem:labels': {
      const cleaned = [...new Set(request.labels.map(normalise).filter(Boolean))]
        .sort()
        .slice(0, MAX_LABELS);
      const problem = await updateProblem(request.id, (current) => ({
        ...current,
        labels: cleaned,
        history: appendActivity(current.history ?? [], {
          at: Date.now(),
          kind: 'note',
          outcome: 'labelled',
          reason: cleaned.length > 0 ? cleaned.join(', ') : 'labels cleared',
        }),
      }));
      return { problem };
    }

    case 'upsolve:get': {
      const [items, problems] = await Promise.all([getUpsolve(), getProblemList()]);
      const solved = new Set(problems.map((problem) => problem.id));
      const reconciled = reconcile(items, solved, Date.now());
      // Reconciling on read rather than on solve keeps the queue correct even
      // for problems solved before the contest was ever added to it.
      if (reconciled.some((item, index) => item !== items[index])) {
        await saveUpsolve(reconciled);
      }
      return { items: reconciled, summary: summariseUpsolve(reconciled) };
    }

    case 'upsolve:refresh': {
      const [settings, stored, problems] = await Promise.all([
        getSettings(),
        getUpsolve(),
        getProblemList(),
      ]);
      if (!settings.handles.codeforces) {
        return {
          items: stored,
          summary: summariseUpsolve(stored),
          error: 'Add your Codeforces handle in Settings first.',
        };
      }
      try {
        const fetched = await fetchUpsolve(settings.handles.codeforces);
        const solved = new Set(problems.map((problem) => problem.id));
        const merged = reconcile(mergeUpsolve(stored, fetched), solved, Date.now());
        await saveUpsolve(merged);
        return { items: merged, summary: summariseUpsolve(merged), fetchedAt: Date.now() };
      } catch (error) {
        return {
          items: stored,
          summary: summariseUpsolve(stored),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    case 'backup:export': {
      const now = Date.now();
      return { filename: backupFilename(now), json: await currentBackup(now) };
    }

    case 'backup:import':
      return applyBackup(readBackup(request.text));

    case 'backup:push':
      return pushBackup();

    case 'backup:pull':
      return pullBackup();

    case 'submissions:claim':
      return claimSubmissionIds(request.platform, request.ids, request.watched);

    case 'rail:get': {
      const id = problemKey(request.platform as SolvedProblem['platform'], request.slug);
      const [problem, settings, journal, opened] = await Promise.all([
        getProblem(id),
        getSettings(),
        getJournal(id),
        readOpened(),
      ]);

      // The mirror is only consulted for Codeforces, and only when it can
      // answer — a cold cache must not hold the whole card back.
      let cf: CfProblemView | undefined;
      if (request.platform === 'codeforces') {
        cf = (
          await lookup(
            [request.slug],
            settings.handles.codeforces,
            problem ? new Set([request.slug.toUpperCase()]) : undefined,
          ).catch(() => undefined)
        )?.[request.slug];
      }

      return {
        problem,
        // A solved problem carries its own journal on the record.
        journal: problem?.events ?? journal,
        due: problem ? isDue(problem.revision, Date.now()) : false,
        openedAt: opened[id],
        cf,
        page: settings.page,
        now: Date.now(),
      };
    }

    case 'cf:lookup': {
      const [{ handles }, problems] = await Promise.all([getSettings(), getProblemList()]);
      const mine = new Set(
        problems
          .filter((problem) => problem.platform === 'codeforces')
          .map((problem) => problem.slug.toUpperCase()),
      );
      return lookup(request.keys, handles.codeforces, mine);
    }

    case 'daily:get':
      return buildHome();

    case 'daily:skip':
      return skipToday();

    case 'backlog:add':
      return addToBacklog(request.key);

    case 'backlog:remove':
      return removeFromBacklog(request.key);

    case 'insights:get':
      return buildInsights(request.days);

    case 'cf:handles':
      return handleCards(request.handles);

    case 'cf:friends': {
      const { handles } = await getSettings();
      const watched = handles.friends.filter(Boolean);
      return { solves: await friendSolves(watched, request.problem), watched: watched.length };
    }

    /**
     * Injects the workspace bundle into the tab that asked for it.
     *
     * It lives outside the always-on content script because CodeMirror is the
     * single heaviest thing this extension ships, and a person reading the
     * problemset should never pay for an editor they did not open. A content
     * script cannot inject itself, so the request comes here and the tab id
     * comes from the sender rather than from the message — a page cannot ask
     * for code to be run in a tab that is not its own.
     */
    case 'workspace:open': {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return { ok: false, error: 'No tab to open the workspace in.' };

      const { page } = await getSettings();
      if (!page.enabled || !page.workspace) {
        return { ok: false, error: 'The workspace is switched off in Settings.' };
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: sender.frameId === undefined ? undefined : [sender.frameId] },
          files: ['workspace.js'],
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    case 'workspace:drafts': {
      const stored = await chrome.storage.local.get(DRAFTS_KEY);
      return { count: Object.keys(stored[DRAFTS_KEY] ?? {}).length };
    }

    // Unfinished code is the most personal thing this extension holds, so
    // there is a button that deletes it rather than only a promise that it
    // eventually rolls over.
    case 'workspace:forget-drafts':
      await chrome.storage.local.remove(DRAFTS_KEY);
      return { count: 0 };

    case 'train:get':
      return buildTrain();

    case 'train:start':
      return startContest(request.ratings, request.minutes);

    case 'train:reroll':
      return rerollSlot(request.index);

    case 'train:finish':
      return finishContest();

    case 'cf:refresh': {
      const { handles } = await getSettings();
      await ensureProblemset(true);
      if (handles.codeforces) await ensureUserStatus(handles.codeforces, true);
      return mirrorState(handles.codeforces);
    }

    case 'rating:profiles': {
      const { handles } = await getSettings();
      // Fetched together but reported separately: one judge being unreachable
      // must not blank out the other.
      const [codeforces, leetcode] = await Promise.allSettled([
        handles.codeforces
          ? codeforcesProfile(handles.codeforces, handles.goal)
          : Promise.resolve(undefined),
        handles.leetcode ? leetcodeProfile(handles.leetcode) : Promise.resolve(undefined),
      ]);

      return {
        codeforces: codeforces.status === 'fulfilled' ? codeforces.value : undefined,
        leetcode: leetcode.status === 'fulfilled' ? leetcode.value : undefined,
        errors: {
          codeforces:
            codeforces.status === 'rejected' ? String(codeforces.reason?.message ?? codeforces.reason) : undefined,
          leetcode:
            leetcode.status === 'rejected' ? String(leetcode.reason?.message ?? leetcode.reason) : undefined,
        },
      };
    }

    case 'rating:predict': {
      const { handles } = await getSettings();
      if (!handles.codeforces) return { error: 'Add your Codeforces handle in Settings first.' };
      try {
        return { prediction: await predictCodeforces(handles.codeforces) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }

    case 'diagnostics:clear':
      await chrome.storage.local.remove(DIAGNOSTIC_KEY);
      return { ok: true };

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
      await deleteJournal(request.id);
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

chrome.runtime.onMessage.addListener((request: Request, sender, sendResponse) => {
  handle(request, sender)
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

// With no popup declared, clicking the toolbar icon has to be told to open
// the side panel; without this the click does nothing at all.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => undefined);
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 30 });
  chrome.alarms.create(DIGEST_ALARM, { periodInMinutes: 60 * 12 });
  // Contests move slowly, but reminders need a tighter tick than the refresh.
  chrome.alarms.create(CONTEST_ALARM, { periodInMinutes: 15 });
  // Checked daily; the nudge itself only fires once a week (see below).
  chrome.alarms.create(WRAPPED_ALARM, { periodInMinutes: 60 * 24 });
  chrome.alarms.create(BACKUP_ALARM, { periodInMinutes: 60 * 24 });
  // Hourly, but it only ever says anything in the evening (see below).
  chrome.alarms.create(STREAK_ALARM, { periodInMinutes: 60 });
  void refreshBadge();
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  void refreshBadge();
});

// Registered unconditionally: the listener itself checks whether focus mode is
// on, and a listener added later would miss navigations after a worker restart.
watchNavigation();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BADGE_ALARM) void refreshBadge();
  if (alarm.name === DIGEST_ALARM) void sendDigest();
  if (alarm.name === CONTEST_ALARM) void tickContests();
  if (alarm.name === WRAPPED_ALARM) void offerWrapped();
  if (alarm.name === BACKUP_ALARM) void dailyBackup();
  if (alarm.name === STREAK_ALARM) void nudgeStreak();
});

const STREAK_SENT_KEY = 'streakNudgedOn';

/**
 * One nudge, in the evening, only when a streak is genuinely at risk.
 *
 * The bar is deliberately high. A notification that fires when nothing is
 * actually about to be lost is the kind people turn off within a week, taking
 * the useful ones with it — so this stays quiet unless there is a run of at
 * least three days, today is still open, and it is late enough that "later"
 * has stopped being a plausible answer.
 */
async function nudgeStreak(): Promise<void> {
  const settings = await getSettings();
  if (!settings.revision.notify) return;

  // Local hour, not UTC: the point is that it is evening where the user is.
  const hour = new Date().getHours();
  if (hour < 19 || hour > 22) return;

  // The daily problem's calendar, so "already nudged today" and "today's pick"
  // never disagree across the UTC boundary.
  const today = utcDay(Date.now());
  const stored = await chrome.storage.local.get(STREAK_SENT_KEY);
  if (stored[STREAK_SENT_KEY] === today) return;

  const home = await buildHome().catch(() => undefined);
  if (!home) return;
  if (!home.streak.todayPending || home.streak.current < 3) return;
  if (home.solvedToday > 0) return;

  await chrome.storage.local.set({ [STREAK_SENT_KEY]: today });
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: `${home.streak.current}-day streak, still going`,
    message: home.daily?.main
      ? `Today's problem is ${home.daily.main.key} (${home.daily.main.rating}). It keeps the run alive.`
      : 'Solve one problem today to keep it.',
    priority: 0,
  });
}

/**
 * Commits the backup once a day, quietly.
 *
 * Daily and not per-solve: the file holds every problem's code and journal, so
 * writing it alongside every commit would put a few hundred kilobytes of churn
 * into the repository several times an evening. A day old is a good enough
 * safety net for something whose alternative is nothing at all.
 */
async function dailyBackup(): Promise<void> {
  const settings = await getSettings();
  if (!settings.github.backup || !settings.github.enabled) return;
  const problems = await getProblemList();
  if (problems.length === 0) return;
  try {
    await pushBackup();
  } catch {
    // A failed backup is not worth a notification; the button in Settings
    // reports the reason when somebody asks for one.
  }
}

const WRAPPED_SENT_KEY = 'wrappedSentAt';

/**
 * Nudges once a week, on the day the alarm happens to land after seven days
 * have passed — not on a fixed weekday, because a Sunday alarm is missed
 * entirely if the browser is closed that day, and a recap is not worth a
 * scheduling apparatus.
 *
 * Stays quiet in a week where nothing was solved: a card that says zero is not
 * something anyone wants shown to them, let alone shared.
 */
async function offerWrapped(): Promise<void> {
  const settings = await getSettings();
  if (!settings.wrapped.notify) return;

  const now = Date.now();
  const stored = await chrome.storage.local.get(WRAPPED_SENT_KEY);
  const sentAt = (stored[WRAPPED_SENT_KEY] as number | undefined) ?? 0;
  if (now - sentAt < WEEK_MS) return;

  const [problems, meta] = await Promise.all([getProblemList(), getMeta()]);
  const recap = summariseWeek(problems, now, meta.currentStreak);
  if (recap.solved === 0 && recap.reviews === 0) return;

  await chrome.storage.local.set({ [WRAPPED_SENT_KEY]: now });
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: 'Your week in code is ready',
    message: wrappedCaption(recap),
    priority: 0,
  });
}

/**
 * Reminders are checked every quarter hour, but the sources themselves are
 * only re-fetched every few hours — contest listings do not change often, and
 * four judges do not need polling.
 */
async function tickContests(): Promise<void> {
  const settings = await getSettings();
  const cache = await getCachedContests();
  if (Date.now() - cache.fetchedAt > 3 * 60 * 60 * 1000) {
    await refreshContests(settings);
  }
  await sendContestReminders(settings);
}

chrome.notifications.onClicked.addListener((notificationId) => {
  // Contest notifications carry their own destination.
  if (notificationId.startsWith('contest:')) {
    void getCachedContests().then((cache) => {
      const contest = cache.contests.find((entry) => `contest:${entry.id}` === notificationId);
      if (contest) void chrome.tabs.create({ url: contest.url });
    });
    return;
  }
  void chrome.runtime.openOptionsPage();
});

void refreshBadge();

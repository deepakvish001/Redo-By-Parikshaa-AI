import { adapterFor } from '../adapters/index.ts';
import { OBSERVER_CHANNEL, type ObservedGlimpse } from '../adapters/observed.ts';
import { shouldAutoOpenWorkspace } from '../core/cf-url.ts';
import { send, type DiagnosticEntry } from '../core/messages.ts';
import { formatDueIn } from '../core/srs.ts';
import type { AttemptEvent, Settings, SolvedProblem } from '../core/types.ts';
import { MountRunner } from './inject/registry.ts';
import { codeforcesListing } from './mounts/cf-listing.ts';
import { codeforcesHoverCard } from './mounts/cf-hovercard.ts';
import { codeforcesProfile } from './mounts/cf-profile.ts';
import { codeforcesRail } from './mounts/cf-rail.ts';
import { codeforcesStandings } from './mounts/cf-standings.ts';
import { showReviewPanel } from './review-panel.ts';
import { showToast } from './toast.ts';

function describeSync(problem: SolvedProblem): string {
  switch (problem.github.status) {
    case 'synced':
      return `Pushed to ${problem.github.path}.`;
    case 'error':
      return problem.github.error ?? 'GitHub sync failed.';
    case 'pending':
      return 'Saved locally. GitHub sync is queued.';
    default:
      return 'Saved locally. Turn on GitHub sync in Settings to back it up.';
  }
}

function announceSaved(problem: SolvedProblem): void {
  const dueIn = formatDueIn(problem.revision.dueAt, Date.now());
  showToast({
    title: `Tracked: ${problem.title}`,
    body: `${describeSync(problem)} Next revision ${dueIn}.`,
    tone: problem.github.status === 'error' ? 'error' : 'success',
    timeout: problem.github.status === 'error' ? 0 : 9000,
  });
}

async function checkRevisionDue(
  slug: string,
  platform: string,
  railHandlesIt: () => boolean,
): Promise<void> {
  try {
    // Starts the clock for this problem, whether or not it is already tracked.
    await send({ type: 'page:opened', platform, slug });
    const context = await send({ type: 'page:context', platform, slug });
    if (!context.tracked || !context.due || !context.problem) return;
    // On a page where the rail is drawing the same prompt in the sidebar, a
    // toast saying it again is the extension talking over itself.
    if (railHandlesIt()) return;
    showReviewPanel(context.problem);
  } catch {
    // The service worker may still be starting up; a missed nudge is harmless.
  }
}

/**
 * Buffers diagnostic lines and ships them in batches.
 *
 * A judge can fire dozens of requests a second; one message per request would
 * wake the service worker constantly for something that is only ever read
 * afterwards.
 */
function createDiagnosticSink(platform: string) {
  let queue: DiagnosticEntry[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    timer = undefined;
    if (queue.length === 0) return;
    const entries = queue;
    queue = [];
    void send({ type: 'diagnostics:record', entries }).catch(() => undefined);
  };

  return (kind: DiagnosticEntry['kind'], detail: string, matched?: boolean) => {
    queue.push({ at: Date.now(), platform, kind, detail, matched });
    if (!timer) timer = setTimeout(flush, 1500);
  };
}

/**
 * Buffers attempt events the same way, and for the same reason: a debugging
 * session produces a run every few seconds.
 */
function createJournalSink(platform: string) {
  const queues = new Map<string, AttemptEvent[]>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Returns a promise so a caller can wait for the journal to land.
   *
   * This matters: the problem's README is built during `submission:accepted`,
   * from the journal as it stands at that moment. With only the timer, the
   * accepted submit was still sitting in this queue when the README was
   * written, and the committed file said "0 submits · 1 run" for a problem it
   * had just recorded as solved.
   */
  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (queues.size === 0) return;

    const pending = [...queues.entries()];
    queues.clear();
    await Promise.all(
      pending.map(([slug, events]) =>
        send({ type: 'attempt:record', platform, slug, events }).catch(() => undefined),
      ),
    );
  };

  const record = (slug: string, event: AttemptEvent) => {
    queues.set(slug, [...(queues.get(slug) ?? []), event]);
    if (!timer) timer = setTimeout(() => void flush(), 1200);
  };

  return { record, flush };
}

function main(): void {
  const url = new URL(window.location.href);
  const adapter = adapterFor(url);
  if (!adapter) return;

  const record = createDiagnosticSink(adapter.platform);
  const journal = createJournalSink(adapter.platform);

  // Redo's own widgets on the judge's page. The runner owns their whole
  // lifetime; nothing else in this file knows they exist.
  const mounts = new MountRunner([
    codeforcesRail,
    codeforcesListing,
    codeforcesProfile,
    codeforcesStandings,
    codeforcesHoverCard,
  ]);
  mounts.start();

  let current: Settings | undefined;

  /**
   * Opens the workspace by itself, at most once per page.
   *
   * Keyed on the address rather than on a flag, because the alternative is a
   * loop: the user presses Close, some mutation re-runs this, and the overlay
   * they just dismissed comes straight back. Once per URL means Close stays
   * closed until you navigate somewhere else.
   */
  let autoOpenedFor: string | null = null;

  const maybeAutoOpenWorkspace = async (): Promise<void> => {
    const settings = current;
    if (!settings || !shouldAutoOpenWorkspace(settings.page, window.location.pathname)) return;

    const href = window.location.href;
    if (autoOpenedFor === href) return;

    // The statement is what the workspace is built around, and on a slow page
    // it can arrive after this script does. Waiting a moment beats burning the
    // one attempt on a page that was not finished loading.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (document.querySelector('.problem-statement')) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (window.location.href !== href) return;
    }
    if (!document.querySelector('.problem-statement')) return;

    autoOpenedFor = href;
    await send({ type: 'workspace:open' }).catch(() => undefined);
  };

  const applySettings = (settings: Settings) => {
    const first = current === undefined;
    current = settings;
    mounts.setSettings(settings);
    void maybeAutoOpenWorkspace();
    if (!first || !settings.diagnostics.enabled) return;

    // The MAIN-world observer cannot read extension storage, so the setting is
    // handed to it from here.
    window.postMessage(
      { channel: OBSERVER_CHANNEL, kind: 'diagnostics', enabled: true },
      window.location.origin,
    );
    record('page', `${adapter.platform} content script on ${window.location.pathname}`);

    window.addEventListener('message', (event: MessageEvent<ObservedGlimpse>) => {
      if (event.source !== window) return;
      if (event.data?.channel !== OBSERVER_CHANNEL || event.data.kind !== 'seen') return;
      record('seen', `${event.data.method} ${event.data.path}`, event.data.matched);
    });
  };

  void send({ type: 'settings:get' }).then(applySettings).catch(() => undefined);

  // Turning a switch off in Settings should take the widget off the page you
  // are already looking at, not on the next reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('settings' in changes)) return;
    void send({ type: 'settings:get' }).then(applySettings).catch(() => undefined);
  });

  /** True when the sidebar card is already showing the revision prompt. */
  const railShowsDue = () =>
    Boolean(
      current?.page.enabled &&
        current.page.rail &&
        codeforcesRail.matches(new URL(window.location.href)),
    );

  adapter.start({
    onAccepted: async (submission) => {
      record('accepted', `${submission.slug} (${submission.language})`);
      // The README is built from the journal during this call, so the accepted
      // attempt has to be in it before the call is made.
      await journal.flush();
      try {
        const result = await send({ type: 'submission:accepted', submission });
        if (result.saved && result.problem) announceSaved(result.problem);
        else if (result.reason) {
          showToast({ title: 'Not tracked', body: result.reason, tone: 'info', timeout: 6000 });
        }
      } catch (error) {
        showToast({
          title: 'Could not save this solution',
          body: error instanceof Error ? error.message : String(error),
          tone: 'error',
        });
      }
    },
    onAttempt: (key) => {
      // Attempt counts are tallied inside the adapter and travel with the
      // accepted submission; nothing to show for a failed verdict.
      record('attempt', key);
    },
    onEvent: (slug, event) => {
      record(
        'event',
        `${event.kind} ${slug}: ${event.verdict}${
          event.testsTotal ? ` (${event.testsPassed ?? 0}/${event.testsTotal})` : ''
        }`,
      );
      journal.record(slug, event);
    },
    onError: (message) => {
      record('error', message);
      showToast({ title: 'Redo', body: message, tone: 'error' });
    },
    onNotice: (message) => {
      record('event', message);
      showToast({ title: 'Redo', body: message, tone: 'info', timeout: 12_000 });
    },
    claim: async (ids, watched) => {
      try {
        const claim = await send({
          type: 'submissions:claim',
          platform: adapter.platform,
          ids,
          watched,
        });
        record(
          'event',
          `claimed ${claim.actionable.length} of ${ids.length} submissions${
            claim.adopted ? ' (first sight of this judge — history adopted)' : ''
          }`,
        );
        return claim;
      } catch {
        // The service worker being asleep must not turn into a page of history
        // being committed, so a failed claim means nothing is acted on.
        return { actionable: [], adopted: false };
      }
    },
  });

  let lastSlug: string | null = null;
  const checkCurrentPage = () => {
    const slug = adapter.currentSlug(new URL(window.location.href));
    if (!slug || slug === lastSlug) return;
    lastSlug = slug;
    void checkRevisionDue(slug, adapter.platform, railShowsDue);
    void maybeAutoOpenWorkspace();
  };

  checkCurrentPage();

  // Both sites are single-page apps, so navigation does not reload the script.
  const originalPushState = history.pushState.bind(history);
  history.pushState = ((...args: Parameters<typeof history.pushState>) => {
    originalPushState(...args);
    setTimeout(checkCurrentPage, 250);
  }) as typeof history.pushState;
  window.addEventListener('popstate', () => setTimeout(checkCurrentPage, 250));
}

main();

import { adapterFor } from '../adapters/index.ts';
import { OBSERVER_CHANNEL, type ObservedGlimpse } from '../adapters/observed.ts';
import { send, type DiagnosticEntry } from '../core/messages.ts';
import { formatDueIn } from '../core/srs.ts';
import type { SolvedProblem } from '../core/types.ts';
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
      return 'Saved locally. Turn on GitHub sync in the extension options to back it up.';
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

async function checkRevisionDue(slug: string, platform: string): Promise<void> {
  try {
    // Starts the clock for this problem, whether or not it is already tracked.
    await send({ type: 'page:opened', platform, slug });
    const context = await send({ type: 'page:context', platform, slug });
    if (context.tracked && context.due && context.problem) showReviewPanel(context.problem);
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

function main(): void {
  const url = new URL(window.location.href);
  const adapter = adapterFor(url);
  if (!adapter) return;

  const record = createDiagnosticSink(adapter.platform);

  void send({ type: 'settings:get' })
    .then((settings) => {
      if (!settings.diagnostics.enabled) return;

      // The MAIN-world observer cannot read extension storage, so the setting
      // is handed to it from here.
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
    })
    .catch(() => undefined);

  adapter.start({
    onAccepted: async (submission) => {
      record('accepted', `${submission.slug} (${submission.language})`);
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
    onError: (message) => {
      record('error', message);
      showToast({ title: 'Redo', body: message, tone: 'error' });
    },
  });

  let lastSlug: string | null = null;
  const checkCurrentPage = () => {
    const slug = adapter.currentSlug(new URL(window.location.href));
    if (!slug || slug === lastSlug) return;
    lastSlug = slug;
    void checkRevisionDue(slug, adapter.platform);
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

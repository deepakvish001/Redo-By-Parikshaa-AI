import { adapterFor } from '../adapters/index.ts';
import { send } from '../core/messages.ts';
import { formatDueIn } from '../core/srs.ts';
import type { Recall, SolvedProblem } from '../core/types.ts';
import { showToast } from './toast.ts';

const RECALL_LABELS: Array<{ recall: Recall; label: string; primary?: boolean }> = [
  { recall: 'forgot', label: 'Forgot' },
  { recall: 'hard', label: 'Hard' },
  { recall: 'good', label: 'Good', primary: true },
  { recall: 'easy', label: 'Easy' },
];

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

/**
 * Shown when the user opens a problem that is due. Rating it here is the
 * whole point of the extension — the revision happens on the problem page,
 * not in a separate app.
 */
function offerReview(problem: SolvedProblem): void {
  const solvedDaysAgo = Math.max(
    1,
    Math.round((Date.now() - problem.solvedAt) / 86_400_000),
  );

  const dismiss = showToast({
    title: 'Due for revision',
    body: `You solved this ${solvedDaysAgo} day${solvedDaysAgo === 1 ? '' : 's'} ago. Re-solve it, then rate how it went.`,
    tone: 'info',
    actions: RECALL_LABELS.map(({ recall, label, primary }) => ({
      label,
      primary,
      onClick: async () => {
        try {
          const { problem: updated } = await send({ type: 'problem:review', id: problem.id, recall });
          if (updated) {
            showToast({
              title: 'Review recorded',
              body: `Scheduled again ${formatDueIn(updated.revision.dueAt, Date.now())}.`,
              tone: 'success',
              timeout: 5000,
            });
          }
        } catch (error) {
          showToast({
            title: 'Could not record the review',
            body: error instanceof Error ? error.message : String(error),
            tone: 'error',
          });
        }
      },
    })),
  });

  // The banner is a nudge, not a modal — it goes away on its own.
  setTimeout(dismiss, 30_000);
}

async function checkRevisionDue(slug: string, platform: string): Promise<void> {
  try {
    const context = await send({ type: 'page:context', platform, slug });
    if (context.tracked && context.due && context.problem) offerReview(context.problem);
  } catch {
    // The service worker may still be starting up; a missed nudge is harmless.
  }
}

function main(): void {
  const url = new URL(window.location.href);
  const adapter = adapterFor(url);
  if (!adapter) return;

  adapter.start({
    onAccepted: async (submission) => {
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
    onAttempt: () => {
      // Attempt counts are tallied inside the adapter and travel with the
      // accepted submission; nothing to show for a failed verdict.
    },
    onError: (message) => {
      showToast({ title: 'DSA Revision Buddy', body: message, tone: 'error' });
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

/**
 * Marks problems that are due for revision while browsing parikshaa.org.
 *
 * Parikshaa lists problems in several places — sheets, the curriculum sidebar,
 * recommendation strips, roadmaps — but they all link to the same
 * `/library/problems/<slug>` route, so keying off the link is far more durable
 * than matching any particular component's markup.
 */

import { send, type DueProblem } from '../core/messages.ts';
import { formatDueIn } from '../core/srs.ts';
import { showReviewPanel } from './review-panel.ts';
import { showToast } from './toast.ts';

const PROBLEM_HREF = /\/library\/problems\/([^/?#]+)/;
const MARKER = 'data-drb-due';

/**
 * Links whose text is a call to action rather than the problem's name — a card
 * usually has both, and only the title should carry the badge.
 */
const ACTION_TEXT = /^(solve|open|start|continue|view|practice|revise|try)\b/i;

const BADGE_STYLE = [
  'display:inline-flex',
  'align-items:center',
  'gap:4px',
  'margin-left:6px',
  'padding:1px 7px',
  'border-radius:999px',
  'background:#6d4aff',
  'color:#fff',
  'font-size:10px',
  'font-weight:700',
  'line-height:1.6',
  'letter-spacing:0.02em',
  'vertical-align:middle',
  'white-space:nowrap',
].join(';');

export function slugFromHref(href: string): string | null {
  return PROBLEM_HREF.exec(href)?.[1] ?? null;
}

/**
 * A problem card carries several links to the same problem — the title, a
 * "Solve" button, sometimes a bare icon. Only the title should be badged.
 */
export function isTitleLink(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !ACTION_TEXT.test(trimmed);
}

function badgeFor(problem: DueProblem, now: number): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.setAttribute(MARKER, problem.slug);
  badge.setAttribute('style', BADGE_STYLE);
  const overdue = problem.dueAt <= now;
  badge.textContent = overdue ? 'revise' : 'due soon';
  badge.title = `DSA Revision Buddy — ${formatDueIn(problem.dueAt, now)} (stage ${problem.stage + 1})`;
  return badge;
}

/** Adds a badge to every problem link on the page that is currently due. */
function decorate(due: Map<string, DueProblem>): number {
  const now = Date.now();
  let decorated = 0;

  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href*="/library/problems/"]')) {
    if (anchor.hasAttribute(MARKER)) continue;

    const slug = slugFromHref(anchor.getAttribute('href') ?? '');
    const problem = slug ? due.get(slug) : undefined;
    if (!problem) continue;

    if (!isTitleLink(anchor.textContent ?? '')) continue;

    anchor.setAttribute(MARKER, slug ?? '');
    anchor.append(badgeFor(problem, now));
    decorated += 1;
  }

  return decorated;
}

/** Removes every badge, so a refresh does not leave stale ones behind. */
function clear(): void {
  for (const element of document.querySelectorAll(`[${MARKER}]`)) {
    if (element.tagName === 'SPAN') element.remove();
    else element.removeAttribute(MARKER);
  }
}

/**
 * The full record is fetched here rather than carried in the due list, because
 * the hint ladder needs the saved notes and solution and there is no reason to
 * ship every due problem's source to every page.
 */
async function offerReview(problem: DueProblem, onReviewed: () => void): Promise<void> {
  try {
    const { problem: full } = await send({ type: 'problem:get', id: problem.id });
    if (full) showReviewPanel(full, { onReviewed });
  } catch {
    // The service worker may be asleep; the badge alone still did its job.
  }
}

export function startHighlighting(): void {
  let due = new Map<string, DueProblem>();
  let announcedPath = '';
  let promptedSlug = '';

  const observer = new MutationObserver(() => schedule());
  const watch = () => observer.observe(document.body, { childList: true, subtree: true });

  /**
   * Adding badges mutates the DOM, which would wake our own observer and spin
   * forever, so the observer is detached across every write we make.
   */
  const mutate = <T>(work: () => T): T => {
    observer.disconnect();
    try {
      return work();
    } finally {
      watch();
    }
  };

  /** Decorates anchors that appeared since the last pass. No network. */
  const apply = (): number => mutate(() => decorate(due));

  const refresh = async (): Promise<void> => {
    let problems: DueProblem[];
    try {
      problems = (await send({ type: 'due:list' })).problems;
    } catch {
      // The service worker may be asleep; the next pass will retry.
      return;
    }

    due = new Map(problems.map((problem) => [problem.slug, problem]));
    const decorated = mutate(() => {
      clear();
      return decorate(due);
    });

    const path = window.location.pathname;
    const currentSlug = slugFromHref(path);

    if (currentSlug) {
      const problem = due.get(currentSlug);
      if (problem && promptedSlug !== currentSlug) {
        promptedSlug = currentSlug;
        void offerReview(problem, () => void refresh());
      }
      return;
    }

    // On a listing page, one quiet summary per navigation — the badges
    // themselves are the real signal.
    if (decorated > 0 && announcedPath !== path) {
      announcedPath = path;
      showToast({
        title: `${decorated} problem${decorated === 1 ? '' : 's'} on this page ${decorated === 1 ? 'is' : 'are'} due`,
        body: 'Marked in the list. Re-solve one, then rate it from the extension or the problem page.',
        tone: 'info',
        timeout: 7000,
      });
    }
  };

  // Parikshaa is a single-page app, so rows arrive after a navigation without a
  // reload. Mutations only need the cheap decorating pass; the due list itself
  // is re-fetched on navigation.
  let pending: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => apply(), 400);
  };

  const navigated = () => {
    promptedSlug = '';
    void refresh();
  };

  void refresh();
  watch();

  const originalPushState = history.pushState.bind(history);
  history.pushState = ((...args: Parameters<typeof history.pushState>) => {
    originalPushState(...args);
    setTimeout(navigated, 250);
  }) as typeof history.pushState;
  window.addEventListener('popstate', () => setTimeout(navigated, 250));
}

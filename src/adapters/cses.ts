import type { AcceptedSubmission } from '../core/types.ts';
import type { AdapterContext, PlatformAdapter } from './types.ts';

/**
 * CSES — the Competitive Programmer's Handbook problem set.
 *
 * Three hundred problems, no rating, no contest, and the closest thing the
 * community has to a curriculum: people work through it in order and it is the
 * one judge where "which section am I on" is a real answer to "how am I doing".
 * It is also plain server-rendered HTML with no API at all, which makes it the
 * simplest adapter here and the one most likely to break quietly — so every
 * shape it reads is parsed by an exported function that a test can hold up
 * against recorded markup.
 *
 * The result page is the whole integration. Submitting takes you to
 * `/problemset/result/<id>/`, which carries the task, the language, the status
 * and the verdict in one summary table, and — for your own submissions — the
 * source underneath it. Nothing has to be fetched.
 */

const RESULT_HREF = /\/problemset\/result\/(\d+)/;

/** Statuses that mean the judge has not finished. */
const PENDING = /^(pending|compiling|running|testing)/i;

export interface CsesSubmission {
  submissionId: string;
  taskId: string;
  title: string;
  language: string;
  /** `READY` once judged; `PENDING`, `COMPILING`, `RUNNING` before. */
  status: string;
  /** `ACCEPTED`, `WRONG ANSWER`, `TIME LIMIT EXCEEDED`… */
  verdict: string;
  accepted: boolean;
}

export function taskIdFrom(pathname: string): string | null {
  const match = /\/problemset\/task\/(\d+)/.exec(pathname);
  return match?.[1] ?? null;
}

export function isPending(status: string): boolean {
  return PENDING.test(status.trim());
}

function textOf(element: Element | null | undefined): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/**
 * Reads a label/value table by its labels rather than by column position.
 *
 * CSES lays the summary out as rows of "Task:" / value, and the order of those
 * rows is not something to depend on — reading the third cell would break the
 * first time a row is inserted, and would break silently, filing every solve
 * under the wrong language.
 */
function labelled(root: ParentNode, label: string): Element | undefined {
  for (const row of root.querySelectorAll('tr')) {
    const cells = row.querySelectorAll('td, th');
    const name = textOf(cells[0]).replace(/:$/, '').toLowerCase();
    if (name === label.toLowerCase()) return cells[1] ?? undefined;
  }
  return undefined;
}

/** The submission a result page is showing. */
export function parseResultPage(
  document_: Document,
  url: string,
): CsesSubmission | undefined {
  const submissionId = RESULT_HREF.exec(url)?.[1];
  if (!submissionId) return undefined;

  const table = document_.querySelector('.summary-table, table') ?? document_;
  const taskCell = labelled(table, 'Task');
  const link = taskCell?.querySelector('a[href*="/task/"]') ?? taskCell;
  const taskId = taskIdFrom(link?.getAttribute?.('href') ?? '');
  if (!taskId) return undefined;

  const status = textOf(labelled(table, 'Status'));
  // The verdict is a coloured span when there is one; on a pending submission
  // the row is absent entirely.
  const resultCell = labelled(table, 'Result');
  const verdict = textOf(resultCell?.querySelector('.verdict') ?? resultCell);

  return {
    submissionId,
    taskId,
    title: textOf(link) || `Task ${taskId}`,
    language: textOf(labelled(table, 'Language')),
    status,
    verdict,
    accepted: /^accepted/i.test(verdict),
  };
}

/**
 * One row of the per-task submission list.
 *
 * The same three facts in a different shape: `/problemset/task/<id>` lists your
 * attempts underneath the statement once you have made one.
 */
export function parseSubmissionRow(row: Element, taskId: string): CsesSubmission | undefined {
  const link = row.querySelector('a[href*="/problemset/result/"]');
  const submissionId = RESULT_HREF.exec(link?.getAttribute('href') ?? '')?.[1];
  if (!submissionId) return undefined;

  const verdict = textOf(row.querySelector('.verdict')) || textOf(row.querySelector('td:last-child'));
  if (!verdict) return undefined;

  return {
    submissionId,
    taskId,
    title: '',
    language: textOf(row.querySelector('td:nth-child(2)')),
    status: 'READY',
    verdict,
    accepted: /^accepted/i.test(verdict),
  };
}

/**
 * The source, from the result page.
 *
 * CSES prints your own submission's code under the summary. Somebody else's
 * result page has no code block at all, which is the check that keeps this from
 * ever committing a stranger's solution.
 */
export function extractSource(document_: Document): string | null {
  const block = document_.querySelector('pre.prettyprint, .code pre, pre code, pre');
  const code = block?.textContent;
  return code && code.trim().length > 0 ? code : null;
}

export class CsesAdapter implements PlatformAdapter {
  readonly platform = 'cses' as const;

  private readonly processed = new Set<string>();
  /** Ids this page saw still being judged — new by definition. */
  private readonly watched = new Set<string>();
  private readonly attempts = new Map<string, number>();
  private announced = false;

  matches(url: URL): boolean {
    return url.hostname === 'cses.fi' || url.hostname.endsWith('.cses.fi');
  }

  currentSlug(url: URL): string | null {
    return taskIdFrom(url.pathname);
  }

  start(context: AdapterContext): () => void {
    const scan = () => this.scan(context);
    // CSES polls its own result page while judging and rewrites the status in
    // place, so the verdict arrives as a mutation rather than as a navigation.
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    scan();
    return () => observer.disconnect();
  }

  private scan(context: AdapterContext): void {
    const found = parseResultPage(document, window.location.href);
    if (!found) return;

    if (isPending(found.status) || found.verdict === '') {
      this.watched.add(found.submissionId);
      return;
    }
    if (this.processed.has(found.submissionId)) return;

    this.processed.add(found.submissionId);
    void this.handle(context, found);
  }

  private async handle(context: AdapterContext, found: CsesSubmission): Promise<void> {
    const claim = await context.claim([found.submissionId], [...this.watched]);

    if (claim.adopted && !this.announced) {
      this.announced = true;
      context.onNotice(
        'Redo is now watching CSES. This submission was left alone — the next one you make gets committed.',
      );
    }

    if (!claim.actionable.includes(found.submissionId)) return;

    if (!found.accepted) {
      this.attempts.set(found.taskId, (this.attempts.get(found.taskId) ?? 0) + 1);
      context.onAttempt(`cses:${found.taskId}`);
      context.onEvent(found.taskId, {
        at: Date.now(),
        kind: 'submit',
        verdict: found.verdict,
        accepted: false,
        language: found.language || undefined,
        submissionId: found.submissionId,
      });
      return;
    }

    const code = extractSource(document);
    if (!code) {
      context.onError('Accepted on CSES, but the submission source could not be read.');
      return;
    }

    const attempts = (this.attempts.get(found.taskId) ?? 0) + 1;
    this.attempts.delete(found.taskId);

    context.onAccepted({
      platform: 'cses',
      problemId: found.taskId,
      slug: found.taskId,
      title: found.title,
      url: `https://cses.fi/problemset/task/${found.taskId}`,
      // CSES publishes no difficulty and no tags. Inventing either would put a
      // number in the analytics that means nothing.
      difficulty: 'unknown',
      tags: [],
      language: found.language || 'Unknown',
      code,
      attempts,
    } satisfies AcceptedSubmission);
  }
}

import type { AcceptedSubmission } from '../core/types.ts';
import { parseHtml, type AdapterContext, type PlatformAdapter } from './types.ts';

/**
 * AtCoder renders verdicts into the submissions table as plain server HTML,
 * so it is watched the same way as Codeforces rather than through the API
 * observer.
 *
 * Task ids (`abc300_a`) are the natural key: they are stable, unique across
 * the site, and appear in every submission row.
 */

const TASK_HREF = /\/contests\/([^/]+)\/tasks\/([^/?#]+)/;
const SUBMISSION_HREF = /\/contests\/([^/]+)\/submissions\/(\d+)/;

/** Verdicts that mean the judge has not finished yet. */
const IN_PROGRESS = /^(WJ|WR|\d+\/\d+)/i;

export interface AtCoderRow {
  taskId: string;
  contestId: string;
  submissionId: string;
  verdict: string;
  language: string;
  title: string;
  accepted: boolean;
}

function textOf(element: Element | null | undefined): string {
  return element?.textContent?.trim() ?? '';
}

/**
 * Reads one submissions-table row.
 *
 * Exported so the shape can be checked against recorded markup; the live DOM
 * and a fetched page go through exactly the same code.
 */
export function parseSubmissionRow(row: Element): AtCoderRow | undefined {
  const taskLink = row.querySelector('a[href*="/tasks/"]');
  const task = TASK_HREF.exec(taskLink?.getAttribute('href') ?? '');
  if (!task?.[1] || !task[2]) return undefined;

  const submissionLink = row.querySelector('a[href*="/submissions/"]');
  const submission = SUBMISSION_HREF.exec(submissionLink?.getAttribute('href') ?? '');
  if (!submission?.[2]) return undefined;

  // The verdict lives in a status label; everything else in the row is text.
  const verdict = textOf(row.querySelector('[id^="judge-status"], .label, td:nth-child(7)'));
  if (!verdict) return undefined;

  const rawTitle = textOf(taskLink);
  return {
    contestId: task[1],
    taskId: task[2],
    submissionId: submission[2],
    verdict,
    // Column 4 is the language on both the "me" and public submission lists.
    language: textOf(row.querySelector('td:nth-child(4)')),
    // Titles read "A - Two Sum"; keep the name.
    title: rawTitle.replace(/^[A-Za-z0-9]+\s*-\s*/, '') || task[2],
    accepted: /^AC\b/i.test(verdict),
  };
}

export function isPending(verdict: string): boolean {
  return IN_PROGRESS.test(verdict.trim());
}

/** Pulls the source out of a fetched submission page. */
export function extractSource(document_: Document): string | null {
  return document_.querySelector('#submission-code')?.textContent ?? null;
}

export class AtCoderAdapter implements PlatformAdapter {
  readonly platform = 'atcoder' as const;

  private readonly processed = new Set<string>();
  /** Ids this page saw still being judged — new by definition. */
  private readonly watched = new Set<string>();
  private readonly attempts = new Map<string, number>();
  private announced = false;

  matches(url: URL): boolean {
    return url.hostname === 'atcoder.jp' || url.hostname.endsWith('.atcoder.jp');
  }

  currentSlug(url: URL): string | null {
    return TASK_HREF.exec(url.pathname)?.[2] ?? null;
  }

  start(context: AdapterContext): () => void {
    const scan = () => this.scan(context);
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    scan();
    return () => observer.disconnect();
  }

  /**
   * AtCoder shows other users' submissions on public lists, so rows are only
   * taken from the personal list unless the row's user column matches.
   */
  private isMine(row: Element): boolean {
    if (window.location.pathname.includes('/submissions/me')) return true;
    const handle = document
      .querySelector<HTMLAnchorElement>('a[href^="/users/"]')
      ?.textContent?.trim();
    const author = row.querySelector<HTMLAnchorElement>('a[href^="/users/"]')?.textContent?.trim();
    return Boolean(handle && author && handle === author);
  }

  /**
   * `/submissions/me` lists every submission this account has ever made, so a
   * row being unfamiliar says nothing about it being recent. The service worker
   * settles that; see `AdapterContext.claim`.
   */
  private scan(context: AdapterContext): void {
    const batch: AtCoderRow[] = [];

    for (const row of document.querySelectorAll('table tbody tr')) {
      const parsed = parseSubmissionRow(row);
      if (!parsed) continue;

      if (isPending(parsed.verdict)) {
        // Watching a verdict arrive is proof the submission is happening now.
        this.watched.add(parsed.submissionId);
        continue;
      }
      if (this.processed.has(parsed.submissionId)) continue;
      if (!this.isMine(row)) continue;

      this.processed.add(parsed.submissionId);
      batch.push(parsed);
    }

    if (batch.length > 0) void this.handle(context, batch);
  }

  private async handle(context: AdapterContext, batch: AtCoderRow[]): Promise<void> {
    const claim = await context.claim(
      batch.map((row) => row.submissionId),
      [...this.watched],
    );

    if (claim.adopted && !this.announced) {
      this.announced = true;
      context.onNotice(
        'Redo is now watching AtCoder. Submissions already on this page were left alone — the next one you make gets committed.',
      );
    }

    const wanted = new Set(claim.actionable);
    for (const parsed of batch) {
      if (!wanted.has(parsed.submissionId)) continue;

      if (!parsed.accepted) {
        this.attempts.set(parsed.taskId, (this.attempts.get(parsed.taskId) ?? 0) + 1);
        context.onAttempt(`atcoder:${parsed.taskId}`);
        continue;
      }

      await this.resolve(parsed, context);
    }
  }

  private async resolve(row: AtCoderRow, context: AdapterContext): Promise<void> {
    try {
      const url = `https://atcoder.jp/contests/${row.contestId}/submissions/${row.submissionId}`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`AtCoder returned ${response.status} for the submission.`);

      const code = extractSource(parseHtml(await response.text()));
      if (!code) {
        context.onError('Accepted on AtCoder, but the submission source could not be read.');
        return;
      }

      const attempts = (this.attempts.get(row.taskId) ?? 0) + 1;
      this.attempts.delete(row.taskId);

      context.onAccepted({
        platform: 'atcoder',
        problemId: row.taskId,
        slug: row.taskId,
        title: row.title,
        url: `https://atcoder.jp/contests/${row.contestId}/tasks/${row.taskId}`,
        // AtCoder publishes no per-task difficulty of its own.
        difficulty: 'unknown',
        tags: [],
        language: row.language || 'Unknown',
        code,
        attempts,
      } satisfies AcceptedSubmission);
    } catch (error) {
      context.onError(error instanceof Error ? error.message : 'AtCoder lookup failed.');
    }
  }
}

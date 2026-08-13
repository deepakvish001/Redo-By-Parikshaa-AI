import type { AcceptedSubmission } from '../core/types.ts';
import { send } from '../core/messages.ts';
import type { AdapterContext, PlatformAdapter } from './types.ts';

const PROBLEMSET_PATH = /^\/problemset\//;
const TASK_PATH = /^\/problemset\/(?:task|submit)\/(\d+)\/?$/;
const RESULT_PATH = /^\/problemset\/result\/[^/]+\/?$/;
const RESULT_TASK_HREF = /^\/problemset\/task\/(\d+)\/?$/;

export interface CsesResult {
  taskId: string;
  verdict: string;
  accepted: boolean;
  title?: string;
  runtimeNote?: string;
  memoryNote?: string;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  c: 'C',
  cc: 'C++',
  cpp: 'C++',
  cxx: 'C++',
  cs: 'C#',
  go: 'Go',
  java: 'Java',
  js: 'JavaScript',
  kt: 'Kotlin',
  php: 'PHP',
  py: 'Python',
  rb: 'Ruby',
  rs: 'Rust',
  swift: 'Swift',
  ts: 'TypeScript',
};

/** Maps only the filename the user selected to a human-readable language. */
export function languageFromFilename(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_BY_EXTENSION[extension] ?? 'Unknown';
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Reads just the final, fixture-confirmed CSES result structure. Nothing is
 * inferred from a result id, username, timing, or unrecognised page markup.
 */
export function parseCsesResult(document_: Document, href: string): CsesResult | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.hostname !== 'cses.fi' || !RESULT_PATH.test(url.pathname)) return undefined;

  const main = document_.querySelector('main');
  const taskLink = main?.querySelector<HTMLAnchorElement>('a[href^="/problemset/task/"]');
  const taskId = RESULT_TASK_HREF.exec(taskLink?.getAttribute('href') ?? '')?.[1];
  const paragraphs = Array.from(main?.querySelectorAll('p') ?? []);
  const status = paragraphs.find((paragraph) => /^Status:\s*/i.test(paragraph.textContent ?? ''))?.textContent;
  const result = paragraphs.find((paragraph) => /^Result:\s*/i.test(paragraph.textContent ?? ''))?.textContent;
  const caption = main?.querySelector('table > caption')?.textContent?.trim();
  if (!taskId || !/^Status:\s*READY\s*$/i.test(status ?? '') || !caption?.includes('Test results')) {
    return undefined;
  }

  const rawVerdict = result?.replace(/^Result:\s*/i, '').trim();
  if (!rawVerdict) return undefined;
  const verdict = titleCase(rawVerdict);
  return { taskId, verdict, accepted: /^accepted$/i.test(rawVerdict) };
}

function resultTitle(document_: Document): string | undefined {
  const title = document_
    .querySelector('main a[href^="/problemset/task/"]')
    ?.textContent
    ?.trim();
  return title || undefined;
}

export class CsesAdapter implements PlatformAdapter {
  readonly platform = 'cses' as const;

  private readonly failedAttempts = new Map<string, number>();
  private readonly renderedResults = new Set<string>();

  matches(url: URL): boolean {
    return url.hostname === 'cses.fi' && PROBLEMSET_PATH.test(url.pathname);
  }

  currentSlug(url: URL): string | null {
    if (!this.matches(url)) return null;
    return TASK_PATH.exec(url.pathname)?.[1] ?? null;
  }

  start(context: AdapterContext): () => void {
    const url = new URL(window.location.href);
    if (!this.matches(url)) return () => {};

    if (RESULT_PATH.test(url.pathname)) {
      void this.processResult(context, url);
      return () => {};
    }

    const taskId = TASK_PATH.exec(url.pathname)?.[1];
    const form = taskId ? this.submitForm(taskId) : null;
    if (!form || !taskId) return () => {};

    let replaying = false;
    let captureInFlight = false;
    const onSubmit = (event: SubmitEvent) => {
      if (replaying) {
        replaying = false;
        return;
      }

      event.preventDefault();
      // A double-click or repeated handler event must not capture the file or
      // issue another native submit while the first capture is still pending.
      if (captureInFlight) return;
      captureInFlight = true;
      const submitter = event.submitter;
      void this.captureThenReplay(context, form, taskId, () => {
        captureInFlight = false;
        replaying = true;
        form.requestSubmit(submitter);
      });
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }

  private submitForm(taskId: string): HTMLFormElement | null {
    const form = document.querySelector<HTMLFormElement>(
      'form[action="/course/send.php"][method="post"][enctype="multipart/form-data"]',
    );
    return form?.querySelector<HTMLInputElement>('input[type="hidden"][name="task"]')?.value === taskId
      && form.querySelector<HTMLInputElement>('input[type="file"][name="file"]')
      ? form
      : null;
  }

  private async captureThenReplay(
    context: AdapterContext,
    form: HTMLFormElement,
    taskId: string,
    replay: () => void,
  ): Promise<void> {
    try {
      const file = form.querySelector<HTMLInputElement>('input[type="file"][name="file"]')?.files?.[0];
      if (!file) throw new Error('No selected source file.');
      const code = await file.text();
      await send({
        type: 'cses:pending',
        pending: {
          taskId,
          submittedAt: Date.now(),
          filename: file.name,
          language: languageFromFilename(file.name),
          code,
        },
      });
    } catch {
      context.onError('CSES source could not be captured. The original submission will continue.');
    } finally {
      // This one replay enters the same listener but must not be held again.
      replay();
    }
  }

  private async processResult(context: AdapterContext, url: URL): Promise<void> {
    const result = parseCsesResult(document, url.href);
    if (!result) return;
    const renderKey = `${url.href}:${result.taskId}:${result.verdict}`;
    if (this.renderedResults.has(renderKey)) return;
    this.renderedResults.add(renderKey);

    if (!result.accepted) {
      this.failedAttempts.set(result.taskId, (this.failedAttempts.get(result.taskId) ?? 0) + 1);
      context.onAttempt(`cses:${result.taskId}`);
      context.onEvent(result.taskId, {
        at: Date.now(), kind: 'submit', verdict: result.verdict, accepted: false,
      });
      return;
    }

    const { pending } = await send({ type: 'cses:pending:consume', taskId: result.taskId });
    context.onEvent(result.taskId, {
      at: Date.now(), kind: 'submit', verdict: result.verdict, accepted: true,
      language: pending?.language,
    });
    if (!pending) {
      context.onError('Accepted on CSES, but the selected source file could not be captured.');
      return;
    }

    const attempts = (this.failedAttempts.get(result.taskId) ?? 0) + 1;
    this.failedAttempts.delete(result.taskId);
    context.onAccepted({
      platform: 'cses',
      problemId: result.taskId,
      slug: result.taskId,
      title: resultTitle(document) ?? `CSES task ${result.taskId}`,
      url: `https://cses.fi/problemset/task/${result.taskId}/`,
      difficulty: 'unknown',
      tags: [],
      language: pending.language,
      code: pending.code,
      attempts,
      runtimeNote: result.runtimeNote,
      memoryNote: result.memoryNote,
    } satisfies AcceptedSubmission);
  }
}

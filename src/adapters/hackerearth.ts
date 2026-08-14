import type { AcceptedSubmission, AttemptEvent } from '../core/types.ts';
import {
  HACKEREARTH_PUBLIC_PRACTICE_RESULT_URL,
  hackerEarthTrackableProblemSlug,
  isHackerEarthPublicPracticePage,
} from './observed.ts';
import { onExchange, parseJson } from './exchange.ts';
import type { AdapterContext, PlatformAdapter } from './types.ts';

const FINAL_RESULTS = new Set(['AC', 'WA', 'TLE', 'RE', 'CE', 'MLE']);
const PENDING_STATUS = /queued|compiling|running|processing|pending/i;

export interface HackerEarthResult {
  accepted: boolean;
  submissionId: string;
  status: string;
  language: string;
  testsPassed: number;
  testsTotal: number;
  runtime?: string;
  memory?: string;
  errorText?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numericMetric(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}

/**
 * Reads only the final response schema captured from HackerEarth public
 * practice. Pending, non-practice, and altered payloads are ignored rather
 * than guessed at.
 */
export function readHackerEarthResult(
  url: string,
  responseBody: string,
): HackerEarthResult | undefined {
  const urlMatch = HACKEREARTH_PUBLIC_PRACTICE_RESULT_URL.exec(url);
  if (!urlMatch?.[1]) return undefined;

  const payload = parseJson(responseBody);
  if (!isRecord(payload)) return undefined;

  const responseStatus = nonEmptyString(payload.status);
  if (!responseStatus || PENDING_STATUS.test(responseStatus)) return undefined;

  const context = payload.context;
  const aggregate = payload.aggregated_data;
  const messages = payload.message;
  if (!isRecord(context) || !isRecord(aggregate) || !Array.isArray(messages) || messages.length === 0) {
    return undefined;
  }
  if (
    context.is_practice !== 1 ||
    context.event !== 0
  ) {
    return undefined;
  }

  const result = nonEmptyString(aggregate.result)?.toUpperCase();
  const status = nonEmptyString(aggregate.result_status);
  const detail = nonEmptyString(aggregate.result_detail);
  const language = nonEmptyString(aggregate.lang);
  if (
    !result ||
    !FINAL_RESULTS.has(result) ||
    !status ||
    !language
  ) {
    return undefined;
  }

  let testsPassed = 0;
  for (const message of messages) {
    if (!isRecord(message)) return undefined;
    const messageStatus = nonEmptyString(message.status)?.toUpperCase();
    if (
      !messageStatus ||
      !FINAL_RESULTS.has(messageStatus) ||
      !nonEmptyString(message.status_detail)
    ) {
      return undefined;
    }
    if (messageStatus === 'AC') testsPassed += 1;
  }

  const accepted = result === 'AC';
  const runtime = numericMetric(aggregate.total_time_used);
  const memory = numericMetric(aggregate.max_memory_used);
  return {
    accepted,
    submissionId: urlMatch[1],
    status,
    language,
    testsPassed,
    testsTotal: messages.length,
    ...(runtime ? { runtime } : {}),
    ...(memory ? { memory } : {}),
    ...(accepted || !detail ? {} : { errorText: detail }),
  };
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Only public programming practice pages are in scope. The observer watches
 * only the fixture-confirmed final result endpoint, never the source-bearing
 * submit request.
 */
export class HackerEarthAdapter implements PlatformAdapter {
  readonly platform = 'hackerearth' as const;

  private readonly attempts = new Map<string, number>();
  private readonly seenFinalResults = new Set<string>();

  matches(url: URL): boolean {
    return isHackerEarthPublicPracticePage(url.href);
  }

  currentSlug(url: URL): string | null {
    if (!this.matches(url)) return null;
    return hackerEarthTrackableProblemSlug(url.href);
  }

  start(context: AdapterContext): () => void {
    return onExchange((exchange) => {
      let pageUrl: URL;
      try {
        pageUrl = new URL(exchange.href);
      } catch {
        return;
      }
      if (!this.matches(pageUrl)) return;

      const slug = this.currentSlug(pageUrl);
      if (!slug) return;

      const result = readHackerEarthResult(exchange.url, exchange.responseBody);
      if (!result) return;

      const resultKey = `${slug}:${result.submissionId}`;
      if (this.seenFinalResults.has(resultKey)) return;
      this.seenFinalResults.add(resultKey);

      const event: AttemptEvent = {
        at: Date.now(),
        kind: 'submit',
        verdict: result.status,
        accepted: result.accepted,
        language: result.language,
        testsPassed: result.testsPassed,
        testsTotal: result.testsTotal,
        submissionId: result.submissionId,
        ...(result.runtime ? { runtime: result.runtime } : {}),
        ...(result.memory ? { memory: result.memory } : {}),
        ...(result.errorText ? { errorText: result.errorText } : {}),
      };

      if (!result.accepted) {
        this.attempts.set(slug, (this.attempts.get(slug) ?? 0) + 1);
        context.onAttempt(`hackerearth:${slug}`);
        context.onEvent(slug, event);
        return;
      }

      // A result poll has no source in its fixture-confirmed schema. Do not
      // inspect `requestBody`: `/submit/AJAX/` is intentionally unobserved.
      context.onEvent(slug, event);
      const code = exchange.editorCode?.trim() ? exchange.editorCode : undefined;
      if (!code) {
        context.onError('Accepted on HackerEarth, but the solution source could not be read.');
        return;
      }

      const attempts = (this.attempts.get(slug) ?? 0) + 1;
      const canonicalUrl = `${pageUrl.origin}${pageUrl.pathname}`;
      context.onAccepted({
        platform: 'hackerearth',
        problemId: slug,
        slug,
        title: document.title.split('|')[0]?.trim() || titleFromSlug(slug),
        url: canonicalUrl,
        difficulty: 'unknown',
        tags: [],
        language: result.language,
        code,
        attempts,
        ...(result.runtime ? { runtimeNote: `Runtime ${result.runtime}` } : {}),
        ...(result.memory ? { memoryNote: `Memory ${result.memory}` } : {}),
      } satisfies AcceptedSubmission);
      this.attempts.delete(slug);
    });
  }
}

import type { AcceptedSubmission } from '../core/types.ts';
import { firstString, onExchange, parseJson, pick } from './exchange.ts';
import type { AdapterContext, PlatformAdapter } from './types.ts';

/**
 * HackerRank posts a submission to
 * `/rest/contests/<contest>/challenges/<slug>/submissions` and then polls the
 * same path with the new id until the judge finishes. Both the source and the
 * verdict come back in that payload, so nothing extra needs fetching.
 */

const SUBMISSION_URL =
  /hackerrank\.com\/rest\/contests\/([^/]+)\/challenges\/([^/]+)\/submissions(?:\/(\d+))?/i;
const CHALLENGE_HREF = /\/challenges\/([^/?#]+)/;

/** `status` is human text; `status_code` 2 is HackerRank's accepted code. */
const ACCEPTED_STATUS = /^accepted/i;

export interface HackerRankResult {
  slug: string;
  submissionId: string;
  accepted: boolean;
  status: string;
  language?: string;
  code?: string;
}

/**
 * Interprets one submissions-endpoint payload.
 *
 * HackerRank nests the useful fields under `model` on the poll response but
 * returns them flat on some endpoints, so both shapes are probed.
 */
export function readSubmission(url: string, responseBody: string): HackerRankResult | undefined {
  const match = SUBMISSION_URL.exec(url);
  if (!match?.[2]) return undefined;

  const json = parseJson(responseBody);
  if (!json) return undefined;

  const model = (pick(json, 'model') ?? json) as Record<string, unknown>;

  const status = firstString(model, [['status'], ['result']]) ?? '';
  const statusCode = pick(model, 'status_code');
  // While judging, status reads "Processing" and status_code is 0.
  if (!status && typeof statusCode !== 'number') return undefined;

  const accepted = ACCEPTED_STATUS.test(status) || statusCode === 2;
  const stillRunning = !status || /queued|processing|running|compiling/i.test(status);
  if (stillRunning && !accepted) return undefined;

  return {
    slug: match[2],
    submissionId: firstString(model, [['id']]) ?? match[3] ?? '',
    accepted,
    status,
    language: firstString(model, [['language'], ['kind']]),
    code: firstString(model, [['code'], ['source']]),
  };
}

/** The submit request body carries the source when the response does not. */
export function readSubmittedCode(requestBody: string | undefined): {
  code?: string;
  language?: string;
} {
  const json = parseJson(requestBody);
  if (json) {
    return {
      code: firstString(json, [['code'], ['source_code']]),
      language: firstString(json, [['language'], ['lang']]),
    };
  }

  // Older flows post form-encoded bodies.
  try {
    const params = new URLSearchParams(requestBody ?? '');
    return {
      code: params.get('code') ?? undefined,
      language: params.get('language') ?? undefined,
    };
  } catch {
    return {};
  }
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export class HackerRankAdapter implements PlatformAdapter {
  readonly platform = 'hackerrank' as const;

  private readonly attempts = new Map<string, number>();
  private readonly seen = new Set<string>();
  /** Source captured from the submit request, keyed by challenge slug. */
  private readonly submitted = new Map<string, { code?: string; language?: string }>();

  matches(url: URL): boolean {
    return url.hostname.endsWith('hackerrank.com');
  }

  currentSlug(url: URL): string | null {
    return CHALLENGE_HREF.exec(url.pathname)?.[1] ?? null;
  }

  start(context: AdapterContext): () => void {
    return onExchange((exchange) => {
      const match = SUBMISSION_URL.exec(exchange.url);
      if (!match?.[2]) return;

      if (exchange.method.toUpperCase() === 'POST') {
        const submitted = readSubmittedCode(exchange.requestBody);
        if (submitted.code) this.submitted.set(match[2], submitted);
      }

      const result = readSubmission(exchange.url, exchange.responseBody);
      if (!result) return;

      const key = `${result.slug}:${result.submissionId}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);

      if (!result.accepted) {
        this.attempts.set(result.slug, (this.attempts.get(result.slug) ?? 0) + 1);
        context.onAttempt(`hackerrank:${result.slug}`);
        return;
      }

      const fallback = this.submitted.get(result.slug);
      const code = result.code ?? fallback?.code ?? exchange.editorCode;
      if (!code) {
        context.onError('Accepted on HackerRank, but the solution source could not be read.');
        return;
      }

      const attempts = (this.attempts.get(result.slug) ?? 0) + 1;
      this.attempts.delete(result.slug);
      this.submitted.delete(result.slug);

      context.onAccepted({
        platform: 'hackerrank',
        problemId: result.slug,
        slug: result.slug,
        title: document.title.split('|')[0]?.trim() || titleFromSlug(result.slug),
        url: `https://www.hackerrank.com/challenges/${result.slug}/problem`,
        // HackerRank's difficulty is not in this payload.
        difficulty: 'unknown',
        tags: [],
        language: result.language ?? fallback?.language ?? 'Unknown',
        code,
        attempts,
      } satisfies AcceptedSubmission);
    });
  }
}

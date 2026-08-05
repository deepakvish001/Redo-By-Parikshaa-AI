import type { AcceptedSubmission, Difficulty } from '../core/types.ts';
import { firstString, onExchange, parseJson, pick } from './exchange.ts';
import type { AdapterContext, PlatformAdapter } from './types.ts';

/**
 * GeeksforGeeks practice problems live at `/problems/<slug>/1` and submit
 * through a separate API host. The result payload reports how many test cases
 * passed rather than a verdict string, so "accepted" is taken to mean an
 * explicit success status, or every test case passing.
 *
 * The source is never returned, so it comes from the submit request body or
 * the Ace editor the page uses.
 */

const PROBLEM_HREF = /\/problems\/([^/?#]+)/;
const SUCCESS_STATUS = /^(correct|passed|accepted|success)/i;
const PENDING_STATUS = /(pending|running|queue|compil|process)/i;

export interface GfgResult {
  accepted: boolean;
  status: string;
  slug?: string;
  language?: string;
  code?: string;
}

/**
 * Interprets a practice-API payload.
 *
 * GeeksforGeeks has shipped several shapes for this over time, so a few likely
 * field names are probed and anything unrecognised is ignored rather than
 * guessed at.
 */
export function readResult(responseBody: string): GfgResult | undefined {
  const json = parseJson(responseBody);
  if (!json) return undefined;

  const data = (pick(json, 'result') ?? pick(json, 'data') ?? json) as Record<string, unknown>;

  const status = firstString(data, [['status'], ['verdict'], ['result'], ['message']]);
  const passed = pick(data, 'testcases_passed') ?? pick(data, 'passed_testcase');
  const total = pick(data, 'total_testcases') ?? pick(data, 'total_testcase');

  const allPassed =
    typeof passed === 'number' && typeof total === 'number' && total > 0 && passed === total;

  if (!status && !allPassed) return undefined;
  if (status && PENDING_STATUS.test(status)) return undefined;

  return {
    accepted: (status ? SUCCESS_STATUS.test(status) : false) || allPassed,
    status: status ?? (allPassed ? 'Correct' : 'Unknown'),
    slug: firstString(data, [['problem_slug'], ['slug'], ['problemSlug']]),
    language: firstString(data, [['language'], ['lang']]),
    code: firstString(data, [['code'], ['source'], ['solution']]),
  };
}

export function readSubmitted(requestBody: string | undefined): {
  code?: string;
  language?: string;
} {
  const json = parseJson(requestBody);
  if (json) {
    return {
      code: firstString(json, [['code'], ['source_code'], ['sourceCode']]),
      language: firstString(json, [['language'], ['lang'], ['language_id']]),
    };
  }

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

/** GeeksforGeeks prints the difficulty in the problem header. */
export function readDifficulty(text: string): Difficulty {
  if (/\bschool\b|\bbasic\b|\beasy\b/i.test(text)) return 'easy';
  if (/\bmedium\b/i.test(text)) return 'medium';
  if (/\bhard\b/i.test(text)) return 'hard';
  return 'unknown';
}

function titleFromSlug(slug: string): string {
  return slug
    .replace(/\d+$/, '')
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export class GeeksforGeeksAdapter implements PlatformAdapter {
  readonly platform = 'geeksforgeeks' as const;

  private readonly attempts = new Map<string, number>();
  private submitted: { code?: string; language?: string } = {};
  private lastAcceptedAt = 0;

  matches(url: URL): boolean {
    return (
      url.hostname.endsWith('geeksforgeeks.org') && PROBLEM_HREF.test(url.pathname)
    );
  }

  currentSlug(url: URL): string | null {
    return PROBLEM_HREF.exec(url.pathname)?.[1] ?? null;
  }

  start(context: AdapterContext): () => void {
    return onExchange((exchange) => {
      if (exchange.method.toUpperCase() === 'POST') {
        const submitted = readSubmitted(exchange.requestBody);
        if (submitted.code) this.submitted = submitted;
      }

      const result = readResult(exchange.responseBody);
      if (!result) return;

      const slug = result.slug ?? this.currentSlug(new URL(exchange.href));
      if (!slug) return;

      if (!result.accepted) {
        this.attempts.set(slug, (this.attempts.get(slug) ?? 0) + 1);
        context.onAttempt(`geeksforgeeks:${slug}`);
        return;
      }

      // The page polls the same result for a few seconds after success; one
      // acceptance per short window is enough.
      const now = Date.now();
      if (now - this.lastAcceptedAt < 10_000) return;
      this.lastAcceptedAt = now;

      const code = result.code ?? this.submitted.code ?? exchange.editorCode;
      if (!code) {
        context.onError('Accepted on GeeksforGeeks, but the solution source could not be read.');
        return;
      }

      const attempts = (this.attempts.get(slug) ?? 0) + 1;
      this.attempts.delete(slug);

      context.onAccepted({
        platform: 'geeksforgeeks',
        problemId: slug,
        slug,
        title: document.title.split('|')[0]?.trim() || titleFromSlug(slug),
        url: `https://www.geeksforgeeks.org/problems/${slug}/1`,
        difficulty: readDifficulty(document.body?.innerText?.slice(0, 2000) ?? ''),
        tags: [],
        language: result.language ?? this.submitted.language ?? 'Unknown',
        code,
        attempts,
      } satisfies AcceptedSubmission);

      this.submitted = {};
    });
  }
}

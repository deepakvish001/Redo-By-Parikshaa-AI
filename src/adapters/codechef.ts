import { isHost } from '../core/hosts.ts';
import type { AcceptedSubmission } from '../core/types.ts';
import { firstString, onExchange, parseJson, pick } from './exchange.ts';
import type { AdapterContext, PlatformAdapter } from './types.ts';

/**
 * CodeChef's editor submits through `/api/ide/submit` and then polls the same
 * family of endpoints for a result. The result payload reports `result_code`
 * (`accepted`, `wrong`, `compile`, `runtime`, ...) rather than a verdict
 * string, and does not include the source, so the source is taken from the
 * submit request body — or from the editor as a last resort.
 */

const SUBMIT_URL = /codechef\.com\/api\/ide\/(submit|status)/i;
const PROBLEM_HREF = /\/problems\/([A-Za-z0-9_]+)/;

export interface CodeChefResult {
  accepted: boolean;
  resultCode: string;
  problemCode?: string;
  language?: string;
  solutionId?: string;
}

/**
 * Interprets a CodeChef IDE payload, or returns undefined while the judge is
 * still working. `result_code` is the field CodeChef's own UI switches on.
 */
export function readResult(responseBody: string): CodeChefResult | undefined {
  const json = parseJson(responseBody);
  if (!json) return undefined;

  const data = (pick(json, 'result', 'data') ?? pick(json, 'data') ?? json) as Record<
    string,
    unknown
  >;

  const resultCode = firstString(data, [['result_code'], ['resultCode'], ['status']]);
  if (!resultCode) return undefined;
  // The IDE returns "wait"/"running" until the judge finishes.
  if (/wait|running|queue|compiling|pending/i.test(resultCode)) return undefined;

  return {
    accepted: /^accepted$/i.test(resultCode) || /^ac$/i.test(resultCode),
    resultCode,
    problemCode: firstString(data, [['problemCode'], ['problem_code'], ['problem']]),
    language: firstString(data, [['language'], ['lang'], ['languageName']]),
    solutionId: firstString(data, [['solution_id'], ['solutionId'], ['id']]),
  };
}

/** Reads the source and language out of the submit request. */
export function readSubmitted(requestBody: string | undefined): {
  code?: string;
  language?: string;
  problemCode?: string;
} {
  const json = parseJson(requestBody);
  if (json) {
    return {
      code: firstString(json, [['sourceCode'], ['source_code'], ['source'], ['code']]),
      language: firstString(json, [['language'], ['lang'], ['languageId']]),
      problemCode: firstString(json, [['problemCode'], ['problem_code'], ['problem']]),
    };
  }

  try {
    const params = new URLSearchParams(requestBody ?? '');
    return {
      code: params.get('sourceCode') ?? params.get('source') ?? undefined,
      language: params.get('language') ?? undefined,
      problemCode: params.get('problemCode') ?? undefined,
    };
  } catch {
    return {};
  }
}

export class CodeChefAdapter implements PlatformAdapter {
  readonly platform = 'codechef' as const;

  private readonly attempts = new Map<string, number>();
  private readonly seen = new Set<string>();
  private lastSubmitted: { code?: string; language?: string; problemCode?: string } = {};

  matches(url: URL): boolean {
    return isHost(url.hostname, 'codechef.com');
  }

  currentSlug(url: URL): string | null {
    return PROBLEM_HREF.exec(url.pathname)?.[1] ?? null;
  }

  start(context: AdapterContext): () => void {
    return onExchange((exchange) => {
      if (!SUBMIT_URL.test(exchange.url)) return;

      if (exchange.method.toUpperCase() === 'POST') {
        const submitted = readSubmitted(exchange.requestBody);
        if (submitted.code) this.lastSubmitted = submitted;
      }

      const result = readResult(exchange.responseBody);
      if (!result) return;

      const slug =
        result.problemCode ??
        this.lastSubmitted.problemCode ??
        this.currentSlug(new URL(exchange.href));
      if (!slug) return;

      const key = result.solutionId ?? `${slug}:${result.resultCode}:${exchange.url}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);

      if (!result.accepted) {
        this.attempts.set(slug, (this.attempts.get(slug) ?? 0) + 1);
        context.onAttempt(`codechef:${slug}`);
        return;
      }

      const code = this.lastSubmitted.code ?? exchange.editorCode;
      if (!code) {
        context.onError('Accepted on CodeChef, but the solution source could not be read.');
        return;
      }

      const attempts = (this.attempts.get(slug) ?? 0) + 1;
      this.attempts.delete(slug);

      context.onAccepted({
        platform: 'codechef',
        problemId: slug.toUpperCase(),
        slug: slug.toUpperCase(),
        title: document.title.split('|')[0]?.trim() || slug.toUpperCase(),
        url: `https://www.codechef.com/problems/${slug.toUpperCase()}`,
        difficulty: 'unknown',
        tags: [],
        language: result.language ?? this.lastSubmitted.language ?? 'Unknown',
        code,
        attempts,
      } satisfies AcceptedSubmission);

      this.lastSubmitted = {};
    });
  }
}

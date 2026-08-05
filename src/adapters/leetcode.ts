import type { AcceptedSubmission, Difficulty } from '../core/types.ts';
import { onExchange } from './exchange.ts';
import type { AdapterContext, PlatformAdapter } from './types.ts';

const CHECK_URL = /\/submissions\/detail\/(\d+)\/check\/?/;

/** The payload LeetCode's verdict-polling endpoint returns. */
interface CheckPayload {
  state?: string;
  status_msg?: string;
  question_id?: string | number;
  submission_id?: string | number;
  lang?: string;
  pretty_lang?: string;
  status_runtime?: string;
  status_memory?: string;
  runtime_percentile?: number;
  memory_percentile?: number;
  code?: string;
}

/** What one accepted verdict tells us before metadata is fetched. */
interface AcceptedVerdict {
  submissionId: string;
  questionId: string;
  language: string;
  runtimeNote?: string;
  memoryNote?: string;
  fallbackCode?: string;
  href: string;
}

interface QuestionMeta {
  questionFrontendId?: string;
  questionId?: string;
  title?: string;
  titleSlug?: string;
  difficulty?: string;
  topicTags?: Array<{ name?: string }>;
}

interface SubmissionDetails {
  code?: string;
  lang?: { name?: string; verboseName?: string };
  runtimeDisplay?: string;
  memoryDisplay?: string;
  question?: QuestionMeta;
}

const SUBMISSION_QUERY = `query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    code
    lang { name verboseName }
    runtimeDisplay
    memoryDisplay
    question {
      questionId
      questionFrontendId
      title
      titleSlug
      difficulty
      topicTags { name }
    }
  }
}`;

const QUESTION_QUERY = `query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
    difficulty
    topicTags { name }
  }
}`;

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const csrf = readCookie('csrftoken');
  const response = await fetch(`${window.location.origin}/graphql/`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'x-csrftoken': csrf } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`LeetCode GraphQL returned ${response.status}`);
  const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors[0]?.message ?? 'GraphQL error');
  if (!json.data) throw new Error('LeetCode GraphQL returned no data');
  return json.data;
}

function normalizeDifficulty(value: string | undefined): Difficulty {
  switch (value?.toLowerCase()) {
    case 'easy':
      return 'easy';
    case 'medium':
      return 'medium';
    case 'hard':
      return 'hard';
    default:
      return 'unknown';
  }
}

function slugFromHref(href: string): string | null {
  const match = /\/problems\/([^/?#]+)/.exec(href);
  return match?.[1] ?? null;
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Interprets one verdict poll.
 *
 * Returns `undefined` while the judge is still running, the verdict text when
 * the submission failed, or the accepted details when it passed. Exported so
 * the shape can be tested against recorded payloads.
 */
export function readVerdict(
  url: string,
  responseBody: string,
  href: string,
  editorCode?: string,
): { kind: 'accepted'; verdict: AcceptedVerdict } | { kind: 'failed'; verdict: string } | undefined {
  const match = CHECK_URL.exec(url);
  if (!match) return undefined;

  let payload: CheckPayload;
  try {
    payload = JSON.parse(responseBody) as CheckPayload;
  } catch {
    return undefined;
  }

  // The endpoint is polled until the judge finishes; ignore in-flight states.
  if (payload.state && payload.state !== 'SUCCESS') return undefined;
  if (!payload.status_msg) return undefined;

  if (payload.status_msg !== 'Accepted') {
    return { kind: 'failed', verdict: payload.status_msg };
  }

  const submissionId = String(payload.submission_id ?? match[1] ?? '');
  if (!submissionId) return undefined;

  const runtimeNote = payload.status_runtime
    ? `Runtime ${payload.status_runtime}${
        payload.runtime_percentile ? ` (beats ${payload.runtime_percentile.toFixed(1)}%)` : ''
      }`
    : undefined;
  const memoryNote = payload.status_memory
    ? `Memory ${payload.status_memory}${
        payload.memory_percentile ? ` (beats ${payload.memory_percentile.toFixed(1)}%)` : ''
      }`
    : undefined;

  return {
    kind: 'accepted',
    verdict: {
      submissionId,
      questionId: String(payload.question_id ?? ''),
      language: payload.pretty_lang || payload.lang || '',
      runtimeNote,
      memoryNote,
      fallbackCode: payload.code ?? editorCode,
      href,
    },
  };
}

export class LeetCodeAdapter implements PlatformAdapter {
  readonly platform = 'leetcode' as const;

  /** Failed verdicts seen this session, per problem slug. */
  private readonly attempts = new Map<string, number>();
  /** Verdict polling repeats, so each submission is only acted on once. */
  private readonly seen = new Set<string>();

  matches(url: URL): boolean {
    return url.hostname === 'leetcode.com' || url.hostname === 'leetcode.cn';
  }

  currentSlug(url: URL): string | null {
    return slugFromHref(url.pathname);
  }

  start(context: AdapterContext): () => void {
    return onExchange((exchange) => {
      const result = readVerdict(
        exchange.url,
        exchange.responseBody,
        exchange.href,
        exchange.editorCode,
      );
      if (!result) return;

      const key = CHECK_URL.exec(exchange.url)?.[1] ?? exchange.url;
      if (this.seen.has(key)) return;
      this.seen.add(key);

      if (result.kind === 'failed') {
        const slug = slugFromHref(exchange.href);
        if (!slug) return;
        this.attempts.set(slug, (this.attempts.get(slug) ?? 0) + 1);
        context.onAttempt(`leetcode:${slug}`);
        return;
      }

      void this.resolve(result.verdict, context);
    });
  }

  private async resolve(relay: AcceptedVerdict, context: AdapterContext): Promise<void> {
    const hrefSlug = slugFromHref(relay.href);
    let details: SubmissionDetails | undefined;

    try {
      const data = await graphql<{ submissionDetails: SubmissionDetails | null }>(
        SUBMISSION_QUERY,
        { submissionId: Number(relay.submissionId) },
      );
      details = data.submissionDetails ?? undefined;
    } catch {
      // Submission-level details are the nice path; the fallbacks below still
      // produce a usable record without them.
    }

    let question = details?.question;
    if (!question && hrefSlug) {
      try {
        const data = await graphql<{ question: QuestionMeta | null }>(QUESTION_QUERY, {
          titleSlug: hrefSlug,
        });
        question = data.question ?? undefined;
      } catch {
        /* fall through to URL-derived metadata */
      }
    }

    const slug = question?.titleSlug ?? hrefSlug;
    if (!slug) {
      context.onError('Could not tell which LeetCode problem this submission belongs to.');
      return;
    }

    const code = details?.code ?? relay.fallbackCode;
    if (!code) {
      context.onError('Accepted, but the solution source could not be read from LeetCode.');
      return;
    }

    const attempts = (this.attempts.get(slug) ?? 0) + 1;
    this.attempts.delete(slug);

    const submission: AcceptedSubmission = {
      attempts,
      platform: 'leetcode',
      problemId:
        question?.questionFrontendId ?? question?.questionId ?? (relay.questionId || slug),
      slug,
      title: question?.title ?? titleFromSlug(slug),
      url: `${window.location.origin}/problems/${slug}/`,
      difficulty: normalizeDifficulty(question?.difficulty),
      tags: (question?.topicTags ?? [])
        .map((tag) => tag.name?.trim() ?? '')
        .filter((name): name is string => name.length > 0),
      language: details?.lang?.verboseName ?? details?.lang?.name ?? relay.language,
      code,
      runtimeNote:
        relay.runtimeNote ??
        (details?.runtimeDisplay ? `Runtime ${details.runtimeDisplay}` : undefined),
      memoryNote:
        relay.memoryNote ?? (details?.memoryDisplay ? `Memory ${details.memoryDisplay}` : undefined),
    };

    context.onAccepted(submission);
  }
}

import type { AcceptedSubmission, Difficulty } from '../core/types.ts';
import type { AdapterContext, PlatformAdapter } from './types.ts';

const CHANNEL = 'dsa-revision-buddy';

interface AcceptedRelay {
  channel: string;
  kind: 'accepted';
  submissionId: string;
  questionId: string;
  language: string;
  runtimeNote?: string;
  memoryNote?: string;
  fallbackCode?: string;
  href: string;
}

interface AttemptRelay {
  channel: string;
  kind: 'attempt';
  href: string;
  verdict: string;
}

type Relay = AcceptedRelay | AttemptRelay;

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

export class LeetCodeAdapter implements PlatformAdapter {
  readonly platform = 'leetcode' as const;

  /** Failed verdicts seen this session, per problem slug. */
  private readonly attempts = new Map<string, number>();

  matches(url: URL): boolean {
    return url.hostname === 'leetcode.com' || url.hostname === 'leetcode.cn';
  }

  currentSlug(url: URL): string | null {
    return slugFromHref(url.pathname);
  }

  start(context: AdapterContext): () => void {
    const listener = (event: MessageEvent<Relay>) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.channel !== CHANNEL) return;

      if (data.kind === 'attempt') {
        const slug = slugFromHref(data.href);
        if (!slug) return;
        this.attempts.set(slug, (this.attempts.get(slug) ?? 0) + 1);
        context.onAttempt(`leetcode:${slug}`);
        return;
      }

      if (data.kind === 'accepted') {
        void this.resolve(data, context);
      }
    };

    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }

  private async resolve(relay: AcceptedRelay, context: AdapterContext): Promise<void> {
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

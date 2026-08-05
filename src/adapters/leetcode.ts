import type { AcceptedSubmission, AttemptEvent, Difficulty } from '../core/types.ts';
import { onExchange, requestEditorCode } from './exchange.ts';
import type { AdapterContext, PlatformAdapter } from './types.ts';

/**
 * Both a run and a submit poll this endpoint. The id tells them apart — a
 * submit's is numeric, a run's is `runcode_<timestamp>_<nonce>` — and the path
 * gained a `/v2/` segment without the payload changing.
 */
const CHECK_URL = /\/submissions\/detail\/(\d+|runcode_[^/]+)\/(?:v\d+\/)?check\/?/;

function isRunId(id: string): boolean {
  return id.startsWith('runcode_');
}

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
  total_correct?: number | null;
  total_testcases?: number | null;
  compile_error?: string;
  full_compile_error?: string;
  runtime_error?: string;
  full_runtime_error?: string;
  last_testcase?: string;
  input_formatted?: string;
  input?: string;
  expected_output?: string;
  code_output?: string | string[];
  expected_code_answer?: string[];
  code_answer?: string[];
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

/**
 * The user's own recent submissions for one problem. Used by the DOM fallback,
 * which knows a submission was accepted but not which id it was.
 */
const SUBMISSION_LIST_QUERY = `query submissionList($questionSlug: String!, $offset: Int!, $limit: Int!) {
  questionSubmissionList(questionSlug: $questionSlug, offset: $offset, limit: $limit) {
    submissions { id statusDisplay lang runtimeDisplay memoryDisplay timestamp }
  }
}`;

/**
 * Where LeetCode renders a *submission's* verdict. The locator attribute is a
 * test hook the site has kept stable across several redesigns, which makes it a
 * better anchor than any class name.
 *
 * `console-result` deliberately is not here. That is the Run panel, which says
 * "Accepted" when the sample cases pass — including for code that then fails on
 * submit. Watching it recorded a solve the moment someone pressed Run, and the
 * dedupe then swallowed the real submission that followed.
 */
const RESULT_SELECTORS = ['[data-e2e-locator="submission-result"]'];

interface SubmissionSummary {
  id?: string | number;
  statusDisplay?: string;
  lang?: string;
  runtimeDisplay?: string;
  memoryDisplay?: string;
}

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  try {
    return await graphqlOnce<T>(query, variables);
  } catch (error) {
    // "Failed to fetch" is a transient network condition often enough — a page
    // mid-navigation, a connection reused as it closed — to be worth one retry.
    if (!(error instanceof TypeError)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 700));
    return graphqlOnce<T>(query, variables);
  }
}

async function graphqlOnce<T>(query: string, variables: Record<string, unknown>): Promise<T> {
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

/**
 * After a submission LeetCode navigates to
 * `/problems/<slug>/submissions/<id>/`, so the id is usually sitting in the
 * URL — cheaper and more reliable than asking the API which submission it was.
 */
export function submissionIdFromPath(pathname: string): string | null {
  return /\/problems\/[^/]+\/submissions\/(\d+)/.exec(pathname)?.[1] ?? null;
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
/** Trims judge output to something worth keeping in a journal. */
function trim(text: string | undefined, limit = 400): string | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function joinOutput(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return trim(value.join('\n'));
  return trim(value);
}

/**
 * Turns one finished verdict poll into a journal entry, for runs and submits
 * alike.
 *
 * Exported so the shape can be checked against recorded payloads — the field
 * names differ between a run and a submit in ways that are easy to get wrong.
 */
export function readAttempt(url: string, responseBody: string, at: number): AttemptEvent | undefined {
  const match = CHECK_URL.exec(url);
  if (!match?.[1]) return undefined;

  let payload: CheckPayload;
  try {
    payload = JSON.parse(responseBody) as CheckPayload;
  } catch {
    return undefined;
  }

  if (payload.state && payload.state !== 'SUCCESS') return undefined;
  if (!payload.status_msg) return undefined;

  const id = match[1];
  const run = isRunId(id);
  const errorText =
    trim(payload.full_compile_error) ??
    trim(payload.compile_error) ??
    trim(payload.full_runtime_error) ??
    trim(payload.runtime_error);

  return {
    at,
    kind: run ? 'run' : 'submit',
    verdict: payload.status_msg,
    accepted: payload.status_msg === 'Accepted',
    language: payload.pretty_lang || payload.lang || undefined,
    runtime: payload.status_runtime || undefined,
    memory: payload.status_memory || undefined,
    testsPassed: payload.total_correct ?? undefined,
    testsTotal: payload.total_testcases ?? undefined,
    errorText,
    failedInput: trim(payload.input_formatted ?? payload.last_testcase ?? payload.input),
    expectedOutput: joinOutput(payload.expected_code_answer ?? payload.expected_output),
    actualOutput: joinOutput(payload.code_answer ?? payload.code_output),
    submissionId: run ? undefined : String(payload.submission_id ?? id),
  };
}

export function readVerdict(
  url: string,
  responseBody: string,
  href: string,
  editorCode?: string,
): { kind: 'accepted'; verdict: AcceptedVerdict } | { kind: 'failed'; verdict: string } | undefined {
  const match = CHECK_URL.exec(url);
  if (!match?.[1]) return undefined;

  // A run only ever checks the sample cases. Passing them is not a solve, and
  // failing them is not a failed submission either.
  if (isRunId(match[1])) return undefined;

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
  /** The verdict currently rendered, so a re-render is not a new event. */
  private seenDom = '';
  private domTimer: ReturnType<typeof setTimeout> | undefined;

  matches(url: URL): boolean {
    return url.hostname === 'leetcode.com' || url.hostname === 'leetcode.cn';
  }

  currentSlug(url: URL): string | null {
    return slugFromHref(url.pathname);
  }

  /**
   * Watches the page for a verdict.
   *
   * The API observer only fires if LeetCode polls the endpoint it knows about,
   * and LeetCode has changed that flow before. The rendered verdict is the one
   * thing that must exist however the site fetches it, so this runs alongside
   * as a second, independent route to the same event.
   */
  private watchDom(context: AdapterContext): () => void {
    const read = () => {
      const text = RESULT_SELECTORS.map(
        (selector) => document.querySelector(selector)?.textContent?.trim() ?? '',
      ).find(Boolean);
      if (!text) return;

      const slug = slugFromHref(window.location.pathname);
      if (!slug) return;

      if (!/^accepted$/i.test(text)) {
        // Only count a verdict once per render of that verdict.
        const key = `${slug}:${text}`;
        if (this.seenDom === key) return;
        this.seenDom = key;
        this.attempts.set(slug, (this.attempts.get(slug) ?? 0) + 1);
        context.onAttempt(`leetcode:${slug}`);
        return;
      }

      if (this.seenDom === `${slug}:accepted`) return;
      this.seenDom = `${slug}:accepted`;
      void this.resolveFromDom(slug, context);
    };

    const observer = new MutationObserver(() => {
      if (this.domTimer) clearTimeout(this.domTimer);
      // The verdict area re-renders several times as it settles.
      this.domTimer = setTimeout(read, 350);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    read();

    return () => observer.disconnect();
  }

  /**
   * Turns an accepted verdict seen in the DOM into a submission to record.
   *
   * The id comes from the URL when LeetCode has navigated to the submission,
   * and only falls back to the API when it has not. The editor's contents are
   * fetched in parallel so that a failing API call costs metadata, not the
   * capture itself.
   */
  private async resolveFromDom(slug: string, context: AdapterContext): Promise<void> {
    const [editor, summary] = await Promise.all([
      requestEditorCode(),
      this.findSubmission(slug),
    ]);

    const submissionId = summary?.id ? String(summary.id) : undefined;
    if (submissionId) {
      if (this.seen.has(submissionId)) return;
      this.seen.add(submissionId);
    }

    // Carries the id so the journal can tell this apart from the API's report
    // of the same submission.
    context.onEvent(slug, {
      at: Date.now(),
      kind: 'submit',
      verdict: 'Accepted',
      accepted: true,
      language: summary?.lang ?? editor.language,
      runtime: summary?.runtimeDisplay,
      memory: summary?.memoryDisplay,
      submissionId,
    });

    await this.resolve(
      {
        submissionId: submissionId ?? '',
        questionId: '',
        language: summary?.lang ?? editor.language ?? '',
        runtimeNote: summary?.runtimeDisplay && `Runtime ${summary.runtimeDisplay}`,
        memoryNote: summary?.memoryDisplay && `Memory ${summary.memoryDisplay}`,
        fallbackCode: editor.code,
        href: window.location.href,
      },
      context,
    );
  }

  /** The accepted submission's id and judge stats, by whichever route works. */
  private async findSubmission(slug: string): Promise<SubmissionSummary | undefined> {
    const fromUrl = submissionIdFromPath(window.location.pathname);
    if (fromUrl) return { id: fromUrl };

    try {
      const data = await graphql<{
        questionSubmissionList?: { submissions?: SubmissionSummary[] };
      }>(SUBMISSION_LIST_QUERY, { questionSlug: slug, offset: 0, limit: 5 });

      return data.questionSubmissionList?.submissions?.find((submission) =>
        /^accepted$/i.test(submission.statusDisplay ?? ''),
      );
    } catch {
      // No id is survivable: the editor still holds the code.
      return undefined;
    }
  }

  start(context: AdapterContext): () => void {
    const stopDom = this.watchDom(context);
    const stopExchange = onExchange((exchange) => {
      // Journalled first and unconditionally: a run, a compile error and a
      // wrong answer all say something about the problem even though none of
      // them is a solve.
      const event = readAttempt(exchange.url, exchange.responseBody, Date.now());
      const eventSlug = slugFromHref(exchange.href);
      if (event && eventSlug) context.onEvent(eventSlug, event);

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

    return () => {
      stopDom();
      stopExchange();
    };
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
      context.onError(
        'Accepted on LeetCode, but the solution source could not be read from either the API or the editor.',
      );
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
      language: details?.lang?.verboseName ?? details?.lang?.name ?? relay.language ?? 'Unknown',
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

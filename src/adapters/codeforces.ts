import { isHost } from '../core/hosts.ts';
import type { AcceptedSubmission, Difficulty } from '../core/types.ts';
import { parseHtml, type AdapterContext, type PlatformAdapter } from './types.ts';

/**
 * Words that only appear in Codeforces' language column.
 *
 * Matched as whole tokens, never as substrings: an earlier version accepted
 * `D\b`, which matches the "d" ending "Threshold", so the problem-title cell
 * was read as the language for "2250A - Threshold Movement".
 */
const LANGUAGE_TOKENS = new Set(
  [
    'gnu', 'clang', 'ms', 'mono', 'delphi', 'fpc', 'pypy', 'python', 'java',
    'kotlin', 'rust', 'go', 'node', 'nodejs', 'javascript', 'haskell', 'ocaml',
    'scala', 'ruby', 'perl', 'c#', 'c++', 'pascal', 'd', 'q#', 'secret', 'gcc',
    'msvc', 'pypy3', 'py', 'cpp',
  ],
);

/**
 * Time and memory, from the status table's own columns.
 *
 * These are the figures the LeetCode adapter reports as "Runtime … · Memory …",
 * and Codeforces has had them all along — they simply were not being read, so
 * every Codeforces problem's committed README had no Judge line at all.
 */
export function readJudgeCells(row: {
  querySelector(selectors: string): { textContent: string | null } | null;
}): { runtime?: string; memory?: string } {
  const text = (selector: string) => row.querySelector(selector)?.textContent?.trim() || undefined;
  return {
    runtime: text('.time-consumed-cell'),
    memory: text('.memory-consumed-cell'),
  };
}

/**
 * How many tests passed, from "Wrong answer on test 5".
 *
 * Codeforces counts the failing test from 1 and never says how many there are,
 * so four passed before test 5 failed. An accepted row names no test.
 */
export function failedOnTest(verdict: string): number | undefined {
  const match = /on test (\d+)/i.exec(verdict) ?? /на тесте (\d+)/i.exec(verdict);
  if (!match?.[1]) return undefined;
  const failed = Number(match[1]);
  return Number.isFinite(failed) && failed > 0 ? failed - 1 : undefined;
}

/**
 * The minimum a table row has to look like for the language read below. The
 * real DOM satisfies it; a plain object in a test can too.
 */
export interface LanguageCell {
  textContent: string | null;
  previousElementSibling: LanguageCell | null;
  querySelector(selectors: string): unknown;
}

export interface LanguageRow {
  querySelector(selectors: string): LanguageCell | null;
  querySelectorAll(selectors: string): Iterable<LanguageCell>;
}

/**
 * The language, from its own column.
 *
 * Codeforces' status table runs `# · when · who · problem · language · verdict
 * · time · memory`, so the language is the cell immediately before the verdict
 * cell — which has a class, and is therefore something to anchor on rather than
 * guess from.
 *
 * Guessing is what the old code did, and it kept being wrong in a way that is
 * obvious in hindsight: the problem cell comes *first*, so any title containing
 * a word that is also a language name won the race. Codeforces really does
 * offer a language called `Secret_171`, so "1530E - Secret Santa" was filed as
 * having been solved in "1530E - Secret Santa".
 */
export function readLanguage(row: LanguageRow): string {
  const beside = row.querySelector('.status-verdict-cell')?.previousElementSibling;
  const named = beside?.textContent?.trim();
  if (named && named.length < 40) return named;

  // Older or partial markup with no verdict cell to anchor on. The token scan
  // still runs, but never over the cell holding the problem link — that is the
  // one cell guaranteed to contain a title.
  for (const cell of row.querySelectorAll('td')) {
    if (cell.querySelector('a[href*="/problem/"]')) continue;
    const text = cell.textContent?.trim() ?? '';
    if (looksLikeLanguage(text)) return text;
  }
  return '';
}

/** True when a table cell reads like a language, not like a problem title. */
export function looksLikeLanguage(text: string): boolean {
  if (!text || text.length >= 40) return false;
  // Split on everything that is not part of a language name; `c++` and `c#`
  // keep their trailing punctuation because the token set carries them too.
  return text
    .toLowerCase()
    .split(/[\s(),/]+/)
    .filter(Boolean)
    .some((token) => LANGUAGE_TOKENS.has(token.replace(/[.:;]+$/, '')));
}

interface ProblemMeta {
  title: string;
  tags: string[];
  difficulty: Difficulty;
}

function ratingToDifficulty(rating: number | undefined): Difficulty {
  if (rating === undefined) return 'unknown';
  if (rating <= 1200) return 'easy';
  if (rating <= 1800) return 'medium';
  return 'hard';
}

/** `/contest/1352/problem/A` and `/problemset/problem/1352/A` both yield `1352A`. */
function parseProblemHref(href: string): { contestId: string; index: string } | null {
  const contest = /\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/.exec(href);
  if (contest?.[1] && contest[2]) return { contestId: contest[1], index: contest[2] };
  const problemset = /\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/.exec(href);
  if (problemset?.[1] && problemset[2]) return { contestId: problemset[1], index: problemset[2] };
  const gym = /\/gym\/(\d+)\/problem\/([A-Za-z0-9]+)/.exec(href);
  if (gym?.[1] && gym[2]) return { contestId: gym[1], index: gym[2] };
  return null;
}

/** One finished row, read off the status table and waiting on a verdict of ours. */
interface CodeforcesSubmission {
  submissionId: string;
  /** `2250A` — the problem key, not the submission's. */
  key: string;
  contestId: string;
  index: string;
  verdict: string;
  accepted: boolean;
  language: string;
  runtime?: string;
  memory?: string;
  sourceHref: string;
}

export class CodeforcesAdapter implements PlatformAdapter {
  readonly platform = 'codeforces' as const;

  private readonly processed = new Set<string>();
  /** Ids this page saw still being judged — new by definition. */
  private readonly watched = new Set<string>();
  private readonly attempts = new Map<string, number>();
  private readonly metaCache = new Map<string, ProblemMeta>();
  private announced = false;

  matches(url: URL): boolean {
    return isHost(url.hostname, 'codeforces.com');
  }

  currentSlug(url: URL): string | null {
    const parsed = parseProblemHref(url.pathname);
    return parsed ? `${parsed.contestId}${parsed.index.toUpperCase()}` : null;
  }

  start(context: AdapterContext): () => void {
    const scan = () => this.scan(context);

    // Codeforces rewrites verdict cells in place while judging, so the table is
    // re-read on every mutation rather than once on load.
    const observer = new MutationObserver(() => scan());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    scan();

    return () => observer.disconnect();
  }

  private myHandle(): string | null {
    const link = document.querySelector<HTMLAnchorElement>('#header a[href^="/profile/"]');
    return link?.textContent?.trim() || null;
  }

  private isMySubmissionsPage(): boolean {
    const { pathname, search } = window.location;
    return pathname.endsWith('/my') || search.includes('my=on') || pathname.includes('/submission/');
  }

  /**
   * Reads the table, then asks which of what it found is actually new.
   *
   * Two phases, because the answer to "is this new" lives in the service worker
   * and this runs from a MutationObserver. The synchronous pass marks every row
   * it collects as processed straight away, so the observer firing again mid-
   * flight cannot queue the same submission twice.
   */
  private scan(context: AdapterContext): void {
    const rows = document.querySelectorAll<HTMLTableRowElement>(
      'table.status-frame-datatable tr[data-submission-id]',
    );
    const handle = this.myHandle();
    const batch: CodeforcesSubmission[] = [];

    for (const row of rows) {
      const submissionId = row.getAttribute('data-submission-id');
      if (!submissionId || this.processed.has(submissionId)) continue;

      const verdictCell = row.querySelector('.status-verdict-cell');
      const verdict = verdictCell?.textContent?.trim() ?? '';
      if (!verdict) continue;

      // `waiting` is Codeforces' own flag for "the judge has not finished", and
      // unlike the verdict text it is the same on the Russian locale.
      const judging =
        verdictCell?.getAttribute('waiting') === 'true' ||
        /in queue|running|testing|в очереди|выполняется/i.test(verdict);
      if (judging) {
        // Seeing a verdict arrive is the one unambiguous signal that a
        // submission is being made right now, so it is remembered: this is what
        // lets the very first solve after installing be picked up, even though
        // the rest of the page is history that must not be.
        this.watched.add(submissionId);
        continue;
      }

      const author = row.querySelector<HTMLAnchorElement>('a[href^="/profile/"]')?.textContent?.trim();
      const mine = handle ? author === handle : this.isMySubmissionsPage();
      if (!mine) continue;

      const problemLink = row.querySelector<HTMLAnchorElement>('a[href*="/problem/"]');
      const parsed = problemLink ? parseProblemHref(problemLink.getAttribute('href') ?? '') : null;
      if (!parsed) continue;

      this.processed.add(submissionId);
      const judged = readJudgeCells(row);
      // `submissionverdict` is Codeforces' machine-readable verdict; the cell's
      // text is localised and "Accepted" is "Полное решение" in Russian.
      const machine = verdictCell?.getAttribute('submissionverdict') ?? '';

      batch.push({
        submissionId,
        key: `${parsed.contestId}${parsed.index.toUpperCase()}`,
        contestId: parsed.contestId,
        index: parsed.index.toUpperCase(),
        verdict,
        accepted: machine ? machine === 'OK' : /^accepted/i.test(verdict),
        language: readLanguage(row),
        runtime: judged.runtime,
        memory: judged.memory,
        sourceHref:
          row.querySelector<HTMLAnchorElement>('a[href*="/submission/"]')?.getAttribute('href') ??
          `/contest/${parsed.contestId}/submission/${submissionId}`,
      });
    }

    if (batch.length > 0) void this.handle(context, batch);
  }

  private async handle(
    context: AdapterContext,
    batch: CodeforcesSubmission[],
  ): Promise<void> {
    const claim = await context.claim(
      batch.map((entry) => entry.submissionId),
      [...this.watched],
    );

    if (claim.adopted && !this.announced) {
      this.announced = true;
      context.onNotice(
        'Redo is now watching Codeforces. Submissions already on this page were left alone — the next one you make gets committed.',
      );
    }

    const wanted = new Set(claim.actionable);
    for (const entry of batch) {
      if (!wanted.has(entry.submissionId)) continue;

      // Codeforces has no run/submit split — every row in the status table is a
      // real submission, and the verdict cell names the test it died on.
      context.onEvent(entry.key, {
        at: Date.now(),
        kind: 'submit',
        verdict: entry.verdict,
        accepted: entry.accepted,
        language: entry.language || undefined,
        runtime: entry.runtime,
        memory: entry.memory,
        testsPassed: failedOnTest(entry.verdict),
        submissionId: entry.submissionId,
      });

      if (!entry.accepted) {
        this.attempts.set(entry.key, (this.attempts.get(entry.key) ?? 0) + 1);
        context.onAttempt(`codeforces:${entry.key}`);
        continue;
      }

      await this.resolve(context, entry);
    }
  }

  private async resolve(context: AdapterContext, submission: CodeforcesSubmission): Promise<void> {
    try {
      const code = await this.fetchSource(submission.sourceHref);
      if (!code) {
        context.onError('Accepted on Codeforces, but the submission source could not be read.');
        return;
      }

      const meta = await this.fetchProblemMeta(submission.contestId, submission.index);
      const attempts = (this.attempts.get(submission.key) ?? 0) + 1;
      this.attempts.delete(submission.key);

      context.onAccepted({
        platform: 'codeforces',
        problemId: submission.key,
        slug: submission.key,
        title: meta.title,
        url: `https://codeforces.com/contest/${submission.contestId}/problem/${submission.index}`,
        difficulty: meta.difficulty,
        tags: meta.tags,
        language: submission.language || 'Unknown',
        code,
        attempts,
        runtimeNote: submission.runtime ? `Runtime ${submission.runtime}` : undefined,
        memoryNote: submission.memory ? `Memory ${submission.memory}` : undefined,
      } satisfies AcceptedSubmission);
    } catch (error) {
      context.onError(error instanceof Error ? error.message : 'Codeforces lookup failed.');
    }
  }

  private async fetchSource(href: string): Promise<string | null> {
    // The source is already in the DOM when the user is on the submission page.
    const inline = document.querySelector('#program-source-text')?.textContent;
    if (inline && window.location.pathname === new URL(href, window.location.origin).pathname) {
      return inline;
    }

    const response = await fetch(new URL(href, window.location.origin).toString(), {
      credentials: 'include',
    });
    if (!response.ok) throw new Error(`Codeforces returned ${response.status} for the submission.`);
    const document_ = parseHtml(await response.text());
    return document_.querySelector('#program-source-text')?.textContent ?? null;
  }

  private async fetchProblemMeta(contestId: string, index: string): Promise<ProblemMeta> {
    const key = `${contestId}${index}`;
    const cached = this.metaCache.get(key);
    if (cached) return cached;

    const fallback: ProblemMeta = { title: `${contestId}${index}`, tags: [], difficulty: 'unknown' };

    // The contest page is tried first because it is the one the user is on and
    // is therefore already warm. It hides tags and the rating while the round is
    // running, though, so a solve during a contest lands here with nothing —
    // which is exactly when the problemset copy has them.
    const sources = [
      `${window.location.origin}/contest/${contestId}/problem/${index}`,
      `${window.location.origin}/problemset/problem/${contestId}/${index}`,
    ];

    let best: ProblemMeta | undefined;
    for (const source of sources) {
      const read = await this.readProblemPage(source);
      if (!read) continue;
      best ??= read;
      // A title alone is worth keeping; tags are what makes it worth stopping.
      if (read.tags.length > 0) {
        best = read;
        break;
      }
    }

    if (!best) return fallback;
    this.metaCache.set(key, best);
    return best;
  }

  private async readProblemPage(url: string): Promise<ProblemMeta | null> {
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) return null;
      const page = parseHtml(await response.text());

      const rawTitle = page.querySelector('.problem-statement .title')?.textContent?.trim() ?? '';
      // Titles arrive as "A. Sum of Round Numbers"; keep only the name.
      const title = rawTitle.replace(/^[A-Za-z0-9]+\.\s*/, '');
      if (!title) return null;

      const tags: string[] = [];
      let rating: number | undefined;
      for (const box of page.querySelectorAll('.tag-box')) {
        const text = box.textContent?.trim() ?? '';
        if (!text) continue;
        const ratingMatch = /^\*(\d+)$/.exec(text);
        if (ratingMatch?.[1]) rating = Number(ratingMatch[1]);
        else tags.push(text);
      }

      return { title, tags, difficulty: ratingToDifficulty(rating) };
    } catch {
      return null;
    }
  }
}

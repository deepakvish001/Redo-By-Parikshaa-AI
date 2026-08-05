import type { AcceptedSubmission, Difficulty } from '../core/types.ts';
import { parseHtml, type AdapterContext, type PlatformAdapter } from './types.ts';

const LANGUAGE_HINT =
  /(GNU|Clang|MS |Mono|Delphi|FPC|PyPy|Python|Java|Kotlin|Rust|Go\b|Node|JavaScript|Haskell|OCaml|Scala|Ruby|Perl|C#|C\+\+|Pascal|D\b|Q#|Secret)/i;

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

export class CodeforcesAdapter implements PlatformAdapter {
  readonly platform = 'codeforces' as const;

  private readonly processed = new Set<string>();
  private readonly attempts = new Map<string, number>();
  private readonly metaCache = new Map<string, ProblemMeta>();

  matches(url: URL): boolean {
    return url.hostname.endsWith('codeforces.com');
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

  private scan(context: AdapterContext): void {
    const rows = document.querySelectorAll<HTMLTableRowElement>(
      'table.status-frame-datatable tr[data-submission-id]',
    );
    const handle = this.myHandle();

    for (const row of rows) {
      const submissionId = row.getAttribute('data-submission-id');
      if (!submissionId || this.processed.has(submissionId)) continue;

      const verdict = row.querySelector('.status-verdict-cell')?.textContent?.trim() ?? '';
      // An empty or "running" verdict means the judge has not finished yet.
      if (!verdict || /in queue|running|testing/i.test(verdict)) continue;

      const author = row.querySelector<HTMLAnchorElement>('a[href^="/profile/"]')?.textContent?.trim();
      const mine = handle ? author === handle : this.isMySubmissionsPage();
      if (!mine) continue;

      const problemLink = row.querySelector<HTMLAnchorElement>('a[href*="/problem/"]');
      const parsed = problemLink ? parseProblemHref(problemLink.getAttribute('href') ?? '') : null;
      if (!parsed) continue;

      const key = `${parsed.contestId}${parsed.index.toUpperCase()}`;
      this.processed.add(submissionId);

      if (!/^accepted/i.test(verdict)) {
        this.attempts.set(key, (this.attempts.get(key) ?? 0) + 1);
        context.onAttempt(`codeforces:${key}`);
        continue;
      }

      const sourceHref =
        row.querySelector<HTMLAnchorElement>('a[href*="/submission/"]')?.getAttribute('href') ??
        `/contest/${parsed.contestId}/submission/${submissionId}`;
      const language = this.languageFromRow(row);

      void this.resolve(context, {
        key,
        contestId: parsed.contestId,
        index: parsed.index.toUpperCase(),
        sourceHref,
        language,
      });
    }
  }

  private languageFromRow(row: HTMLTableRowElement): string {
    for (const cell of row.querySelectorAll('td')) {
      const text = cell.textContent?.trim() ?? '';
      if (text && text.length < 40 && LANGUAGE_HINT.test(text)) return text;
    }
    return '';
  }

  private async resolve(
    context: AdapterContext,
    submission: {
      key: string;
      contestId: string;
      index: string;
      sourceHref: string;
      language: string;
    },
  ): Promise<void> {
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

    try {
      const response = await fetch(
        `https://codeforces.com/contest/${contestId}/problem/${index}`,
        { credentials: 'include' },
      );
      if (!response.ok) return fallback;
      const page = parseHtml(await response.text());

      const rawTitle = page.querySelector('.problem-statement .title')?.textContent?.trim() ?? '';
      // Titles arrive as "A. Sum of Round Numbers"; keep only the name.
      const title = rawTitle.replace(/^[A-Za-z0-9]+\.\s*/, '') || fallback.title;

      const tags: string[] = [];
      let rating: number | undefined;
      for (const box of page.querySelectorAll('.tag-box')) {
        const text = box.textContent?.trim() ?? '';
        if (!text) continue;
        const ratingMatch = /^\*(\d+)$/.exec(text);
        if (ratingMatch?.[1]) rating = Number(ratingMatch[1]);
        else tags.push(text);
      }

      const meta: ProblemMeta = { title, tags, difficulty: ratingToDifficulty(rating) };
      this.metaCache.set(key, meta);
      return meta;
    } catch {
      return fallback;
    }
  }
}

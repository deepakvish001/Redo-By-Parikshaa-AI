import type { SolvedProblem } from './types.ts';

/**
 * Search across your own solved solutions.
 *
 * The question this exists for is "where did I use a monotonic stack" — which
 * is unanswerable today without opening the repository and grepping it, and the
 * repository is the one place the answer is *least* convenient, because the
 * code is split across a few hundred directories.
 *
 * Everything searched is already in local storage: titles, tags, your own
 * labels, your notes, and the source itself. Nothing leaves the browser, and
 * there is no index to build or keep fresh — a few hundred solutions is a few
 * hundred string searches, which is nothing.
 */

export type MatchField = 'title' | 'tag' | 'label' | 'language' | 'note' | 'code';

export interface Snippet {
  /** 1-based, so it lines up with what an editor shows. */
  line: number;
  text: string;
}

export interface SearchHit {
  problem: SolvedProblem;
  /** Which parts of the record matched, most significant first. */
  fields: MatchField[];
  /** The matching line of source, when the match was in the code. */
  snippet?: Snippet;
  score: number;
}

/**
 * What a match in each place is worth.
 *
 * A title match is what you meant; a code match is very often incidental —
 * `max` appears in half of everything. Ordering by where the match landed is
 * what stops the useful hit being buried under thirty coincidences.
 */
const WEIGHT: Record<MatchField, number> = {
  title: 100,
  tag: 40,
  label: 40,
  language: 30,
  note: 25,
  code: 10,
};

const MAX_SNIPPET = 160;

/** Terms are ANDed: every word has to appear somewhere in the record. */
export function parseQuery(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean))];
}

function trimLine(text: string): string {
  const collapsed = text.trim();
  return collapsed.length > MAX_SNIPPET ? `${collapsed.slice(0, MAX_SNIPPET - 1)}…` : collapsed;
}

/** The first line of source containing the term, with its line number. */
export function findInCode(code: string, term: string): Snippet | undefined {
  const lines = code.split('\n');
  for (const [index, line] of lines.entries()) {
    if (line.toLowerCase().includes(term)) {
      return { line: index + 1, text: trimLine(line) };
    }
  }
  return undefined;
}

/** Every source the problem carries, so a C++ and a Python solve are both searched. */
function sources(problem: SolvedProblem): string[] {
  const extra = Object.values(problem.solutions ?? {}).map((slot) => slot.code);
  return [problem.code, ...extra].filter((code): code is string => Boolean(code));
}

function scoreOne(problem: SolvedProblem, term: string): { fields: MatchField[]; snippet?: Snippet } | undefined {
  const fields: MatchField[] = [];
  let snippet: Snippet | undefined;

  if (problem.title?.toLowerCase().includes(term) || problem.slug?.toLowerCase().includes(term)) {
    fields.push('title');
  }
  if ((problem.tags ?? []).some((tag) => tag.toLowerCase().includes(term))) fields.push('tag');
  if ((problem.labels ?? []).some((label) => label.toLowerCase().includes(term))) fields.push('label');
  if (problem.language?.toLowerCase().includes(term)) fields.push('language');
  if (problem.note?.toLowerCase().includes(term)) fields.push('note');

  for (const code of sources(problem)) {
    const found = findInCode(code, term);
    if (found) {
      fields.push('code');
      snippet ??= found;
      break;
    }
  }

  return fields.length > 0 ? { fields, snippet } : undefined;
}

export function searchSolutions(
  problems: SolvedProblem[],
  query: string,
  limit = 40,
): SearchHit[] {
  const terms = parseQuery(query);
  if (terms.length === 0) return [];

  const hits: SearchHit[] = [];

  for (const problem of problems) {
    const fields = new Set<MatchField>();
    let snippet: Snippet | undefined;
    let score = 0;
    let matchedEvery = true;

    for (const term of terms) {
      const match = scoreOne(problem, term);
      if (!match) {
        matchedEvery = false;
        break;
      }
      for (const field of match.fields) fields.add(field);
      // Only the best place this term matched counts, so a word appearing in
      // both the title and the code does not score as two separate hits.
      score += Math.max(...match.fields.map((field) => WEIGHT[field]));
      snippet ??= match.snippet;
    }

    if (!matchedEvery) continue;

    hits.push({
      problem,
      fields: (['title', 'tag', 'label', 'language', 'note', 'code'] as MatchField[]).filter((field) =>
        fields.has(field),
      ),
      snippet,
      score,
    });
  }

  return hits
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Same relevance: the one solved most recently is the one you are more
      // likely to be reaching for.
      return (b.problem.solvedAt ?? 0) - (a.problem.solvedAt ?? 0);
    })
    .slice(0, limit);
}

/** "Title and code", for the line under a result. */
export function describeFields(fields: MatchField[]): string {
  const names: Record<MatchField, string> = {
    title: 'title',
    tag: 'tag',
    label: 'label',
    language: 'language',
    note: 'note',
    code: 'code',
  };
  const listed = fields.map((field) => names[field]);
  if (listed.length === 0) return '';
  if (listed.length === 1) return listed[0]!;
  return `${listed.slice(0, -1).join(', ')} and ${listed.at(-1)}`;
}

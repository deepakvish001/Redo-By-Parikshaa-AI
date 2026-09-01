import type { SolvedProblem } from './types.ts';

/**
 * The notebook.
 *
 * Notes were always stored — they go into every committed README — but they
 * were only ever readable one problem at a time, behind an expander, in a list
 * sorted by when you solved things. That is the wrong shape for the question
 * people actually ask a month later: *what did I write about binary search?*
 *
 * So the same records get a second view: every note, newest first, searchable
 * by its own text.
 */

export interface Note {
  id: string;
  title: string;
  platform: SolvedProblem['platform'];
  slug: string;
  url: string;
  note: string;
  labels: string[];
  tags: string[];
  /** When the note's problem was solved — the only date a note carries. */
  at: number;
  complexity?: { time?: string; space?: string };
}

export function hasNote(problem: SolvedProblem): boolean {
  return (problem.note ?? '').trim().length > 0;
}

/** Every note there is, newest first. */
export function collectNotes(problems: SolvedProblem[]): Note[] {
  return problems
    .filter(hasNote)
    .map((problem) => ({
      id: problem.id,
      title: problem.title,
      platform: problem.platform,
      slug: problem.slug,
      url: problem.url,
      note: (problem.note ?? '').trim(),
      labels: problem.labels ?? [],
      tags: problem.tags,
      at: problem.solvedAt,
      complexity:
        problem.complexity?.time || problem.complexity?.space ? problem.complexity : undefined,
    }))
    .sort((a, b) => b.at - a.at);
}

/**
 * Whether a note answers a search.
 *
 * The note's own text is included, which is the whole point — searching the
 * library for "monotonic stack" should find the problem where you wrote that
 * down, not only the ones Codeforces happened to tag that way.
 */
export function noteMatches(note: Note, needle: string): boolean {
  const query = needle.trim().toLowerCase();
  if (!query) return true;

  return (
    note.note.toLowerCase().includes(query) ||
    note.title.toLowerCase().includes(query) ||
    note.slug.toLowerCase().includes(query) ||
    note.tags.some((tag) => tag.toLowerCase().includes(query)) ||
    note.labels.some((label) => label.toLowerCase().includes(query))
  );
}

/**
 * The first line, for a collapsed row.
 *
 * People write notes as a heading and then the detail; the heading is what
 * identifies it in a list, and rendering the whole thing would turn the view
 * into the same wall the expander was hiding.
 */
export function excerpt(text: string, limit = 140): string {
  const firstLine = text.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
  return firstLine.length > limit ? `${firstLine.slice(0, limit - 1)}…` : firstLine;
}

import type { SolvedProblem } from './types.ts';

/**
 * Labels the user puts on problems themselves.
 *
 * The obvious version of this feature is company tags — "which of these did
 * Google ask" — and it is the single most requested thing on every LeetCode
 * tracker. It is also premium-only data that the site does not expose to
 * anybody who has not paid for it, so scraping it would be both a licence
 * problem and unreliable. What is left, and what is actually more useful, is
 * letting people label their own: `revisit`, `striver-a2z`, `google-oa`,
 * `interview-round-2`. Their sheet, their words.
 */

/** The longest a label may be; the panel lays out chips, not paragraphs. */
const MAX_LENGTH = 24;

/** How many a single problem may carry, so the card stays readable. */
export const MAX_LABELS = 8;

/**
 * Lower-cased, trimmed, inner whitespace collapsed to single hyphens.
 *
 * Without this `Dynamic Programming`, `dynamic programming` and `Dynamic
 * programming ` are three different groups in the sidebar, which makes the
 * whole feature feel broken within a week of using it.
 */
export function normalise(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_LENGTH);
}

/** Turns free text — one label or a comma-separated list — into clean labels. */
export function parseLabels(input: string): string[] {
  const seen = new Set<string>();
  for (const part of input.split(/[,\n]/)) {
    const label = normalise(part);
    if (label) seen.add(label);
  }
  return [...seen];
}

export function addLabels(current: string[] | undefined, input: string): string[] {
  const next = new Set(current ?? []);
  for (const label of parseLabels(input)) next.add(label);
  return [...next].sort().slice(0, MAX_LABELS);
}

export function removeLabel(current: string[] | undefined, label: string): string[] {
  const wanted = normalise(label);
  return (current ?? []).filter((entry) => entry !== wanted);
}

export interface LabelCount {
  label: string;
  count: number;
  /** Problems carrying this label that are due for revision right now. */
  due: number;
}

/**
 * Every label in use, most-used first.
 *
 * Sorted by count rather than alphabetically because the labels somebody
 * actually organises by are the ones they have applied fifty times, and those
 * should not be below `typo` in the list.
 */
export function countLabels(problems: SolvedProblem[], now: number): LabelCount[] {
  const counts = new Map<string, LabelCount>();
  for (const problem of problems) {
    for (const label of problem.labels ?? []) {
      const entry = counts.get(label) ?? { label, count: 0, due: 0 };
      entry.count += 1;
      if (problem.revision.dueAt <= now) entry.due += 1;
      counts.set(label, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function withLabel(problems: SolvedProblem[], label: string): SolvedProblem[] {
  const wanted = normalise(label);
  return problems.filter((problem) => (problem.labels ?? []).includes(wanted));
}

/**
 * Suggestions offered when a label box is empty.
 *
 * Deliberately short and deliberately about how people study rather than about
 * topics — the judges already supply topic tags, and duplicating them here
 * would just make two half-populated taxonomies.
 */
export const SUGGESTED_LABELS = [
  'revisit',
  'tricky',
  'one-liner',
  'interview',
  'contest',
  'blind-75',
  'striver-a2z',
  'neetcode-150',
];

/** The suggestions not already on this problem. */
export function suggestionsFor(current: string[] | undefined, all: LabelCount[]): string[] {
  const used = new Set(current ?? []);
  const mine = all.map((entry) => entry.label).filter((label) => !used.has(label));
  const rest = SUGGESTED_LABELS.filter((label) => !used.has(label) && !mine.includes(label));
  return [...mine, ...rest].slice(0, 8);
}

/**
 * What changed between the last time you solved this and this time.
 *
 * The point of re-solving something months later is to find out whether you
 * have actually learned it, and the honest answer is in the two solutions side
 * by side — not in a green tick. Nothing here judges the code: it reports what
 * is different and leaves the reading to the person who wrote both.
 *
 * In particular it does **not** claim your complexity improved. It cannot know
 * that, and a confident wrong claim about your own algorithm is worse than no
 * claim. What it can say is how the shape changed, how long each attempt took,
 * and — if you wrote down the complexity yourself both times — that your own
 * two answers differ.
 */

export interface SolutionVersion {
  code: string;
  language: string;
  solvedAt: number;
  /** ms spent on that attempt, when it was measured. */
  solveTimeMs?: number;
  attempts?: number;
}

/* ----------------------------------------------------------------- the diff */

export type DiffOp = 'same' | 'added' | 'removed';

export interface DiffLine {
  op: DiffOp;
  text: string;
}

/**
 * A line diff, by longest common subsequence.
 *
 * The textbook algorithm, and a dependency would be silly for thirty lines.
 * Bounded because the table is O(n·m): two thousand-line solutions would be a
 * million cells for a panel nobody is staring at, and a solution that long is
 * not one anybody is going to read a diff of anyway.
 */
export function diffLines(before: string, after: string, limit = 400): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);

  if (a.length > limit || b.length > limit) {
    return [
      { op: 'removed', text: `${a.length} lines` },
      { op: 'added', text: `${b.length} lines` },
    ];
  }

  // table[i][j] = length of the LCS of a[i..] and b[j..]
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ op: 'removed', text: a[i]! });
      i += 1;
    } else {
      out.push({ op: 'added', text: b[j]! });
      j += 1;
    }
  }

  for (; i < a.length; i += 1) out.push({ op: 'removed', text: a[i]! });
  for (; j < b.length; j += 1) out.push({ op: 'added', text: b[j]! });

  return out;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n');
}

/**
 * The diff with unchanged stretches collapsed.
 *
 * A diff of two solutions to the same problem is mostly identical lines, and
 * scrolling through forty of them to find the three that moved defeats the
 * purpose. Keeps `context` lines either side of every change.
 */
export function collapse(lines: DiffLine[], context = 2): Array<DiffLine | { op: 'gap'; count: number }> {
  const keep = new Set<number>();

  for (const [index, line] of lines.entries()) {
    if (line.op === 'same') continue;
    for (let at = index - context; at <= index + context; at += 1) {
      if (at >= 0 && at < lines.length) keep.add(at);
    }
  }

  const out: Array<DiffLine | { op: 'gap'; count: number }> = [];
  let skipped = 0;

  for (const [index, line] of lines.entries()) {
    if (keep.has(index)) {
      if (skipped > 0) {
        out.push({ op: 'gap', count: skipped });
        skipped = 0;
      }
      out.push(line);
    } else {
      skipped += 1;
    }
  }

  if (skipped > 0) out.push({ op: 'gap', count: skipped });
  return out;
}

/* -------------------------------------------------------------- the summary */

export interface ResolveSummary {
  added: number;
  removed: number;
  /** Lines before and after, so "shorter" is a fact rather than an impression. */
  linesBefore: number;
  linesAfter: number;
  /** How long ago the previous solve was, in days. */
  daysApart: number;
  /** Rewritten from scratch, rather than edited. */
  rewritten: boolean;
  identical: boolean;
  fasterBy?: number;
  slowerBy?: number;
  /** Your own complexity notes, when they were recorded both times and differ. */
  complexityBefore?: string;
  complexityAfter?: string;
}

const DAY = 86_400_000;

export function summarise(
  before: SolutionVersion,
  after: SolutionVersion,
  complexity?: { before?: string; after?: string },
): ResolveSummary {
  const lines = diffLines(before.code, after.code);
  const added = lines.filter((line) => line.op === 'added').length;
  const removed = lines.filter((line) => line.op === 'removed').length;
  const same = lines.filter((line) => line.op === 'same').length;
  const linesBefore = removed + same;
  const linesAfter = added + same;

  const summary: ResolveSummary = {
    added,
    removed,
    linesBefore,
    linesAfter,
    daysApart: Math.max(0, Math.round((after.solvedAt - before.solvedAt) / DAY)),
    // Nothing in common but blank lines and braces: this was written again,
    // not edited — which is the interesting case, and worth naming.
    rewritten: same <= Math.max(1, Math.floor(Math.min(linesBefore, linesAfter) * 0.2)),
    identical: added === 0 && removed === 0,
  };

  if (before.solveTimeMs && after.solveTimeMs) {
    const delta = before.solveTimeMs - after.solveTimeMs;
    if (delta > 0) summary.fasterBy = delta;
    else if (delta < 0) summary.slowerBy = -delta;
  }

  // Only when both were recorded and they actually differ — reporting "still
  // O(n)" as a finding is noise.
  if (complexity?.before && complexity.after && complexity.before !== complexity.after) {
    summary.complexityBefore = complexity.before;
    summary.complexityAfter = complexity.after;
  }

  return summary;
}

function minutes(ms: number): string {
  const value = Math.round(ms / 60_000);
  return value <= 1 ? '1 min' : `${value} min`;
}

/**
 * The summary as a sentence, or nothing.
 *
 * Nothing when there is nothing to say — an identical solution after two days
 * is not a finding, it is a copy-paste, and saying something about it anyway is
 * how a feature becomes noise.
 */
export function describe(summary: ResolveSummary): string | undefined {
  if (summary.identical) {
    return summary.daysApart >= 14
      ? `Character for character the same solution, ${summary.daysApart} days later.`
      : undefined;
  }

  const parts: string[] = [];

  parts.push(
    summary.rewritten
      ? 'Written again from scratch'
      : `${summary.added} line${summary.added === 1 ? '' : 's'} added, ${summary.removed} removed`,
  );

  if (summary.linesAfter < summary.linesBefore) {
    parts.push(`${summary.linesBefore} lines down to ${summary.linesAfter}`);
  } else if (summary.linesAfter > summary.linesBefore) {
    parts.push(`${summary.linesBefore} lines up to ${summary.linesAfter}`);
  }

  if (summary.fasterBy) parts.push(`${minutes(summary.fasterBy)} quicker than last time`);
  else if (summary.slowerBy) parts.push(`${minutes(summary.slowerBy)} slower than last time`);

  if (summary.complexityBefore && summary.complexityAfter) {
    // Your own note both times, quoted. Not a claim this code makes about your
    // algorithm — it has no way to know that and will not pretend to.
    parts.push(`your complexity note went from ${summary.complexityBefore} to ${summary.complexityAfter}`);
  }

  return `${parts.join(' · ')}.`;
}

import { describeStruggle, formatDuration, summarise } from './journal.ts';
import { normalizeProblemId, solutionPath } from './paths.ts';
import { PLATFORM_LABELS, type AttemptEvent, type SolvedProblem } from './types.ts';

const PLATFORM_LABEL: Record<string, string> = PLATFORM_LABELS;

function clockTime(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(11, 16);
}

/** Keeps judge output from breaking out of a table cell or a code fence. */
function inlineCode(text: string): string {
  return `\`${text.replace(/`/g, "'").replace(/\s+/g, ' ').slice(0, 80)}\``;
}

/**
 * The run-by-run record of getting the problem accepted.
 *
 * This is the part that is worth re-reading months later: which verdict came
 * back, on which test, and how long the whole thing took.
 */
function attemptSection(events: AttemptEvent[]): string[] {
  if (events.length === 0) return [];

  const summary = summarise(events);
  const lines = ['', '## How it went', ''];

  const parts = [
    `${summary.submits} submit${summary.submits === 1 ? '' : 's'}`,
    `${summary.runs} run${summary.runs === 1 ? '' : 's'}`,
  ];
  if (summary.spanMs) parts.push(`${formatDuration(summary.spanMs)} from first attempt to accepted`);
  lines.push(parts.join(' · '), '');

  lines.push('| # | Time | Kind | Verdict | Detail |', '| --- | --- | --- | --- | --- |');
  events.forEach((event, index) => {
    const detail: string[] = [];
    if (event.testsTotal) detail.push(`${event.testsPassed ?? 0}/${event.testsTotal} tests`);
    if (event.runtime) detail.push(event.runtime);
    if (event.memory) detail.push(event.memory);
    if (event.errorText) detail.push(inlineCode(event.errorText));
    else if (!event.accepted && event.failedInput) {
      detail.push(`on ${inlineCode(event.failedInput)}`);
    }

    lines.push(
      `| ${index + 1} | ${clockTime(event.at)} | ${event.kind} | ${
        event.accepted ? `**${event.verdict}**` : escapeCell(event.verdict)
      } | ${detail.join(' · ') || '—'} |`,
    );
  });

  // The first failure is usually the interesting one — it is where the
  // original approach was wrong.
  const firstWrong = events.find(
    (event) => !event.accepted && (event.failedInput || event.expectedOutput),
  );
  if (firstWrong) {
    lines.push('', '<details><summary>First failing case</summary>', '');
    if (firstWrong.failedInput) lines.push('```', 'Input:', firstWrong.failedInput, '```');
    if (firstWrong.expectedOutput || firstWrong.actualOutput) {
      lines.push(
        '```',
        `Expected: ${firstWrong.expectedOutput ?? '—'}`,
        `Got:      ${firstWrong.actualOutput ?? '—'}`,
        '```',
      );
    }
    lines.push('', '</details>');
  }

  return lines;
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/** The per-problem README committed next to the solution file. */
export function buildProblemReadme(problem: SolvedProblem): string {
  const lines = [
    `# ${normalizeProblemId(problem.problemId)}. ${problem.title}`,
    '',
    `**Platform:** ${PLATFORM_LABEL[problem.platform] ?? problem.platform}  `,
    `**Difficulty:** ${problem.difficulty === 'unknown' ? 'n/a' : problem.difficulty}  `,
    `**Link:** ${problem.url}  `,
    `**Solved:** ${isoDate(problem.solvedAt)}  `,
    `**Language:** ${problem.language}  `,
    `**Attempts before accepted:** ${problem.attempts}`,
  ];

  if (problem.tags.length > 0) {
    lines.push('', `**Tags:** ${problem.tags.map((tag) => `\`${tag}\``).join(', ')}`);
  }

  const judge = [problem.runtimeNote, problem.memoryNote].filter(Boolean);
  if (judge.length > 0) {
    lines.push('', `**Judge:** ${judge.join(' · ')}`);
  }

  if (problem.solveTimeMs) {
    lines.push('', `**Time to solve:** ${formatDuration(problem.solveTimeMs)}`);
  }

  if (problem.revision.struggle !== undefined) {
    lines.push(
      '',
      `**Cost:** ${describeStruggle(problem.revision.struggle)} (${Math.round(
        problem.revision.struggle * 100,
      )}/100)  `,
      `**Revisions planned:** ${problem.revision.targetReviews ?? '—'}`,
    );
  }

  // The user's own analysis, kept separate from the judge's measurements.
  const complexity = [
    problem.complexity?.time && `**Time:** ${problem.complexity.time}`,
    problem.complexity?.space && `**Space:** ${problem.complexity.space}`,
  ].filter(Boolean);
  if (complexity.length > 0) {
    lines.push('', '## Complexity', '', complexity.join('  \n'));
  }

  lines.push('', '## Approach', '', problem.note?.trim() || '_Add your notes here._');
  lines.push(...attemptSection(problem.events ?? []));
  lines.push('', '---', '', '<sub>Committed by Redo.</sub>', '');

  return lines.join('\n');
}

/**
 * The repository index. Regenerated on every sync from local state, so it
 * always reflects the full solved list rather than appending blindly.
 */
export function buildIndexReadme(problems: SolvedProblem[], generatedAt: number): string {
  const synced = problems
    .filter((problem) => problem.github.path)
    .sort((a, b) => b.solvedAt - a.solvedAt);

  const byDifficulty = synced.reduce<Record<string, number>>((counts, problem) => {
    counts[problem.difficulty] = (counts[problem.difficulty] ?? 0) + 1;
    return counts;
  }, {});

  const summary = ['easy', 'medium', 'hard', 'unknown']
    .filter((key) => byDifficulty[key])
    .map((key) => `${byDifficulty[key]} ${key === 'unknown' ? 'unrated' : key}`)
    .join(' · ');

  const lines = [
    '# DSA Solutions',
    '',
    `${synced.length} solved${summary ? ` — ${summary}` : ''}. Last updated ${isoDate(generatedAt)}.`,
    '',
    '| # | Problem | Platform | Difficulty | Language | Solved |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const problem of synced) {
    const path = problem.github.path ?? solutionPath(problem);
    lines.push(
      [
        '',
        normalizeProblemId(problem.problemId),
        `[${escapeCell(problem.title)}](${encodeURI(path)})`,
        PLATFORM_LABEL[problem.platform] ?? problem.platform,
        problem.difficulty === 'unknown' ? '—' : problem.difficulty,
        escapeCell(problem.language),
        isoDate(problem.solvedAt),
        '',
      ].join(' | ').trim(),
    );
  }

  lines.push('', '---', '', '<sub>Generated by Redo.</sub>', '');
  return lines.join('\n');
}

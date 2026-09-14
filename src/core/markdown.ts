import { footer } from './brand.ts';
import {
  ACTIVITY_KINDS,
  activityLabel,
  countActivity,
  describeStruggle,
  formatDuration,
  summarise,
} from './journal.ts';
import { normalizeProblemId, solutionFiles, solutionPath } from './paths.ts';
import { describe as describeResolve, summarise as summariseResolve } from './resolve-diff.ts';
import {
  PLATFORM_LABELS,
  type ActivityEvent,
  type AttemptEvent,
  type SolvedProblem,
} from './types.ts';

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
/**
 * How this attempt compared with the last one, when there was a last one.
 *
 * A sentence, not the diff itself: the two solutions are both in git, and git
 * shows a diff better than a markdown file can. What the README adds is the
 * summary you would otherwise have to reconstruct by finding the old commit.
 */
function resolveSection(problem: SolvedProblem): string[] {
  const slot = Object.values(problem.solutions ?? {})
    .filter((entry) => entry.previous)
    .sort((a, b) => b.solvedAt - a.solvedAt)[0];
  if (!slot?.previous) return [];

  const sentence = describeResolve(
    summariseResolve(
      {
        code: slot.previous.code,
        language: slot.language,
        solvedAt: slot.previous.solvedAt,
        solveTimeMs: slot.previous.solveTimeMs,
      },
      {
        code: slot.code,
        language: slot.language,
        solvedAt: slot.solvedAt,
        solveTimeMs: problem.solveTimeMs,
      },
    ),
  );

  return sentence ? ['', '## Since last time', '', sentence] : [];
}

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
/**
 * Every language this problem has been solved in, newest first.
 *
 * One line rather than one per file: the README's job is to say what is here,
 * and "C++, Python" says it.
 */
function languageList(problem: SolvedProblem): string {
  const files = solutionFiles(problem);
  return files.map((file) => file.language).join(', ') || problem.language;
}

export function buildProblemReadme(problem: SolvedProblem): string {
  const lines = [
    `# ${normalizeProblemId(problem.problemId)}. ${problem.title}`,
    '',
    `**Platform:** ${PLATFORM_LABEL[problem.platform] ?? problem.platform}  `,
    `**Difficulty:** ${problem.difficulty === 'unknown' ? 'n/a' : problem.difficulty}  `,
    `**Link:** ${problem.url}  `,
    `**Solved:** ${isoDate(problem.solvedAt)}  `,
    `**Language:** ${languageList(problem)}  `,
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

  const files = solutionFiles(problem);
  if (files.length > 1) {
    // Only worth a section when there is more than one: a single file is
    // already named in the folder beside this README.
    lines.push(
      '',
      '## Solutions',
      '',
      ...files.map((file) => {
        const name = file.path.split('/').pop() ?? file.path;
        return `- [\`${name}\`](${encodeURIComponent(name)}) — ${file.language}`;
      }),
    );
  }

  lines.push(...resolveSection(problem));
  lines.push('', '## Approach', '', problem.note?.trim() || '_Add your notes here._');
  lines.push(...attemptSection(problem.events ?? []));
  lines.push(...historySection(problem.history ?? []));
  lines.push('', '---', '', footer('Committed'), '');

  return lines.join('\n');
}

function fullStamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * The rest of the record: how many times the problem was opened, revised,
 * hinted at and synced, and every one of those with its reason and its time.
 */
function historySection(history: ActivityEvent[]): string[] {
  if (history.length === 0) return [];

  const counts = countActivity(history);
  const summary = ACTIVITY_KINDS.filter((kind) => counts[kind] > 0)
    .map((kind) => `${activityLabel(kind)} ${counts[kind]}×`)
    .join(' · ');

  const lines = ['', '## Record', '', summary, ''];
  lines.push('| When (UTC) | What | Outcome | Reason |', '| --- | --- | --- | --- |');

  // Newest first: the current state of the problem is what a reader wants.
  for (const event of [...history].reverse()) {
    lines.push(
      `| ${fullStamp(event.at)} | ${activityLabel(event.kind)} | ${
        escapeCell(event.outcome ?? '—')
      } | ${escapeCell(event.reason ?? '—')} |`,
    );
  }

  return lines;
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
    '📊 [Coding profile](PROFILE.md) — stats, weak topics and the revision queue.',
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
        escapeCell(languageList(problem)),
        isoDate(problem.solvedAt),
        '',
      ].join(' | ').trim(),
    );
  }

  lines.push(...topicSection(synced));
  lines.push('', '---', '', footer(), '');
  return lines.join('\n');
}

/**
 * The same problems again, grouped by topic.
 *
 * A flat list answers "what have I done"; this answers "what have I done about
 * graphs", which is the question somebody browsing a solutions repository is
 * usually actually asking. Collapsed, so it does not push the table off screen.
 */
function topicSection(problems: SolvedProblem[]): string[] {
  const byTag = new Map<string, SolvedProblem[]>();
  for (const problem of problems) {
    for (const tag of problem.tags) {
      byTag.set(tag, [...(byTag.get(tag) ?? []), problem]);
    }
  }

  if (byTag.size === 0) return [];

  const lines = ['', '## By topic', ''];
  const ordered = [...byTag.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  for (const [tag, tagged] of ordered) {
    lines.push(`<details><summary><b>${escapeCell(tag)}</b> — ${tagged.length}</summary>`, '');
    for (const problem of tagged.sort((a, b) => b.solvedAt - a.solvedAt)) {
      const path = problem.github.path ?? solutionPath(problem);
      lines.push(`- [${escapeCell(problem.title)}](${encodeURI(path)})`);
    }
    lines.push('', '</details>', '');
  }

  return lines;
}

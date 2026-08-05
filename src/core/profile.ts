import { PARIKSHAA_URL, footer } from './brand.ts';
import { formatDuration, summarise } from './journal.ts';
import { PLATFORM_LABELS, type Difficulty, type SolvedProblem, type Stats } from './types.ts';

/**
 * The animated profile card committed alongside the solutions.
 *
 * It is a standalone `.svg` file referenced from markdown with an `<img>` tag,
 * not inline SVG: GitHub strips `<svg>` out of markdown, but renders a
 * committed SVG file and honours the CSS animations inside it.
 */

const WIDTH = 840;
const COLORS = {
  bg: '#0b0b0f',
  surface: '#141419',
  border: '#26262e',
  text: '#f4f4f5',
  muted: '#9a9aa5',
  accent: '#f97316',
  accent2: '#fbbf24',
  easy: '#34d399',
  medium: '#fbbf24',
  hard: '#f87171',
  unknown: '#64748b',
};

const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  easy: COLORS.easy,
  medium: COLORS.medium,
  hard: COLORS.hard,
  unknown: COLORS.unknown,
};

/** SVG text is XML — an unescaped `&` or `<` in a problem title breaks the file. */
function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

interface Bar {
  label: string;
  value: number;
  color: string;
}

/**
 * A horizontal bar that grows from zero on load.
 *
 * The animation is a CSS keyframe on `width` rather than SMIL, because SMIL is
 * deprecated and GitHub's image sandbox honours CSS reliably.
 */
function barRow(bar: Bar, max: number, y: number, index: number): string {
  const track = 470;
  const width = max > 0 ? Math.max(3, Math.round((bar.value / max) * track)) : 3;
  const delay = 0.08 * index;

  return `
    <text x="24" y="${y + 12}" class="label">${xml(truncate(bar.label, 22))}</text>
    <rect x="200" y="${y}" width="${track}" height="16" rx="8" fill="${COLORS.border}" />
    <rect x="200" y="${y}" width="${width}" height="16" rx="8" fill="${bar.color}"
          class="bar" style="animation-delay:${delay}s" />
    <text x="${200 + track + 16}" y="${y + 12}" class="value">${bar.value}</text>`;
}

function countBy<T extends string>(
  problems: SolvedProblem[],
  key: (problem: SolvedProblem) => T,
): Map<T, number> {
  const counts = new Map<T, number>();
  for (const problem of problems) {
    const value = key(problem);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export function buildProfileSvg(
  problems: SolvedProblem[],
  stats: Stats,
  generatedAt: number,
): string {
  const difficulties = (['easy', 'medium', 'hard', 'unknown'] as Difficulty[])
    .filter((key) => stats.byDifficulty[key] > 0)
    .map<Bar>((key) => ({
      label: key === 'unknown' ? 'unrated' : key,
      value: stats.byDifficulty[key],
      color: DIFFICULTY_COLOR[key],
    }));

  const platforms = [...countBy(problems, (problem) => problem.platform)]
    .sort((a, b) => b[1] - a[1])
    .map<Bar>(([platform, value]) => ({
      label: PLATFORM_LABELS[platform] ?? platform,
      value,
      color: COLORS.accent,
    }));

  const topics = stats.strongestTopics
    .concat(stats.weakestTopics)
    .slice(0, 6)
    .map<Bar>((topic) => ({
      label: topic.tag,
      value: topic.solved,
      color: topic.mastery >= 60 ? COLORS.easy : COLORS.accent2,
    }));

  const sections: Array<{ title: string; bars: Bar[] }> = [
    { title: 'By difficulty', bars: difficulties },
    { title: 'By platform', bars: platforms },
    { title: 'Most-practised topics', bars: topics },
  ].filter((section) => section.bars.length > 0);

  const headerHeight = 150;
  const rowHeight = 26;
  const sectionGap = 44;

  let cursor = headerHeight;
  let barIndex = 0;
  const body = sections
    .map((section) => {
      const title = `<text x="24" y="${cursor}" class="section">${xml(
        section.title.toUpperCase(),
      )}</text>`;
      cursor += 16;
      const rows = section.bars
        .map((bar) => {
          const max = Math.max(...section.bars.map((entry) => entry.value));
          const row = barRow(bar, max, cursor, barIndex);
          cursor += rowHeight;
          barIndex += 1;
          return row;
        })
        .join('');
      cursor += sectionGap - 16;
      return title + rows;
    })
    .join('');

  // The layout walks top-down, so the height is only known once it has run —
  // computing it up front left a section's worth of dead space at the bottom.
  const height = cursor - (sections.length > 0 ? sectionGap - 16 : 0) + 24;

  const tiles = [
    { label: 'solved', value: String(stats.total) },
    { label: 'due today', value: String(stats.dueToday) },
    { label: 'reviews', value: String(stats.reviewsCompleted) },
    { label: 'day streak', value: String(stats.currentStreak) },
  ];

  const tileWidth = 186;
  const tileMarkup = tiles
    .map(
      (tile, index) => `
    <g class="tile" style="animation-delay:${0.06 * index}s">
      <rect x="${24 + index * (tileWidth + 10)}" y="62" width="${tileWidth}" height="62" rx="12"
            fill="${COLORS.surface}" stroke="${COLORS.border}" />
      <text x="${24 + index * (tileWidth + 10) + 16}" y="94" class="tileValue">${xml(
        tile.value,
      )}</text>
      <text x="${24 + index * (tileWidth + 10) + 16}" y="112" class="tileLabel">${xml(
        tile.label,
      )}</text>
    </g>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="Coding profile">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
    .title { fill: ${COLORS.text}; font-size: 20px; font-weight: 700; }
    .subtitle { fill: ${COLORS.muted}; font-size: 12px; }
    .section { fill: ${COLORS.muted}; font-size: 10px; letter-spacing: 0.12em; font-weight: 600; }
    .label { fill: ${COLORS.text}; font-size: 12px; }
    .value { fill: ${COLORS.muted}; font-size: 12px; }
    .tileValue { fill: ${COLORS.text}; font-size: 22px; font-weight: 700; }
    .tileLabel { fill: ${COLORS.muted}; font-size: 11px; }

    .bar { transform-origin: 200px center; animation: grow 900ms cubic-bezier(.2,.8,.2,1) both; }
    .tile { animation: rise 600ms cubic-bezier(.2,.8,.2,1) both; }
    @keyframes grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    @keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) {
      .bar, .tile { animation: none; }
    }
  </style>
  <rect width="${WIDTH}" height="${height}" rx="16" fill="${COLORS.bg}" stroke="${COLORS.border}" />
  <circle cx="36" cy="33" r="13" fill="${COLORS.accent}" opacity="0.16" />
  <text x="36" y="40" class="title" fill="${COLORS.accent}" text-anchor="middle">↻</text>
  <text x="56" y="39" class="title">Coding profile</text>
  <text x="56" y="54" class="subtitle">Updated ${xml(
    new Date(generatedAt).toISOString().slice(0, 16).replace('T', ' '),
  )} UTC</text>
  ${tileMarkup}
  ${body}
</svg>
`;
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** The profile page itself, which embeds the card and adds the detail. */
export function buildProfileReadme(
  problems: SolvedProblem[],
  stats: Stats,
  generatedAt: number,
  svgPath = 'assets/profile.svg',
): string {
  const solved = [...problems].sort((a, b) => b.solvedAt - a.solvedAt);
  const allEvents = solved.flatMap((problem) => problem.events ?? []);
  const totals = summarise(allEvents);

  const lines = [
    '# Coding profile',
    '',
    `<img src="${svgPath}" alt="Coding profile" width="840">`,
    '',
    `_Regenerated on every sync — last run ${isoDate(generatedAt)}._`,
    '',
    '## At a glance',
    '',
    '| | |',
    '| --- | --- |',
    `| Problems solved | ${stats.total} |`,
    `| Due for revision today | ${stats.dueToday} |`,
    `| Revisions completed | ${stats.reviewsCompleted} |`,
    `| Current streak | ${stats.currentStreak} day${stats.currentStreak === 1 ? '' : 's'} |`,
  ];

  if (totals.submits > 0 || totals.runs > 0) {
    lines.push(
      `| Submissions recorded | ${totals.submits} (${totals.failedSubmits} rejected) |`,
      `| Runs recorded | ${totals.runs} |`,
    );
  }

  const timed = solved.filter((problem) => problem.solveTimeMs);
  if (timed.length > 0) {
    const median = [...timed]
      .map((problem) => problem.solveTimeMs ?? 0)
      .sort((a, b) => a - b)[Math.floor(timed.length / 2)];
    lines.push(`| Median time to solve | ${formatDuration(median ?? 0)} |`);
  }

  if (stats.weakestTopics.length > 0) {
    lines.push('', '## Needs work', '', '| Topic | Solved | Lapses | Mastery |', '| --- | --- | --- | --- |');
    for (const topic of stats.weakestTopics) {
      lines.push(
        `| ${topic.tag} | ${topic.solved} | ${topic.lapses} | ${Math.round(topic.mastery)}/100 |`,
      );
    }
  }

  if (stats.strongestTopics.length > 0) {
    lines.push('', '## Solid', '', '| Topic | Solved | Mastery |', '| --- | --- | --- |');
    for (const topic of stats.strongestTopics) {
      lines.push(`| ${topic.tag} | ${topic.solved} | ${Math.round(topic.mastery)}/100 |`);
    }
  }

  const hardest = solved
    .filter((problem) => problem.revision.struggle !== undefined)
    .sort((a, b) => (b.revision.struggle ?? 0) - (a.revision.struggle ?? 0))
    .slice(0, 10);

  if (hardest.length > 0) {
    lines.push(
      '',
      '## Fought hardest for these',
      '',
      'Scored from the attempts it actually took — failed submits, runs, wrong answers and time spent.',
      '',
      '| Problem | Submits | Runs | Time | Cost |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const problem of hardest) {
      const summary = summarise(problem.events ?? []);
      lines.push(
        [
          '',
          `[${problem.title.replace(/\|/g, '\\|')}](${problem.url})`,
          String(summary.submits || problem.attempts),
          String(summary.runs),
          problem.solveTimeMs ? formatDuration(problem.solveTimeMs) : '—',
          `${Math.round((problem.revision.struggle ?? 0) * 100)}/100`,
          '',
        ]
          .join(' | ')
          .trim(),
      );
    }
  }

  const upcoming = [...solved]
    .sort((a, b) => a.revision.dueAt - b.revision.dueAt)
    .slice(0, 10);
  if (upcoming.length > 0) {
    lines.push('', '## Revision queue', '', '| Problem | Stage | Reviews | Due |', '| --- | --- | --- | --- |');
    for (const problem of upcoming) {
      lines.push(
        [
          '',
          `[${problem.title.replace(/\|/g, '\\|')}](${problem.url})`,
          String(problem.revision.stage + 1),
          `${problem.revision.reviewCount}/${problem.revision.targetReviews ?? '—'}`,
          isoDate(problem.revision.dueAt),
          '',
        ]
          .join(' | ')
          .trim(),
      );
    }
  }

  lines.push(
    '',
    '---',
    '',
    `Practise these on [Parikshaa](${PARIKSHAA_URL}) — curated DSA sheets, roadmaps and`,
    'company-wise problem sets, with your solves ticked off automatically.',
    '',
    footer(),
    '',
  );
  return lines.join('\n');
}

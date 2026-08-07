import { PARIKSHAA_URL, PRODUCT } from './brand.ts';
import { formatDuration, summarise } from './journal.ts';
import {
  PLATFORM_LABELS,
  type Difficulty,
  type Platform,
  type SolvedProblem,
} from './types.ts';

export const WEEK_MS = 7 * 86_400_000;

export interface WeekRange {
  start: number;
  end: number;
  /** `28 Jul – 3 Aug` */
  label: string;
}

/** The seven days ending now, which is what "this week" means to someone grinding. */
export function weekRange(now: number, days = 7): WeekRange {
  const end = now;
  const start = now - days * 86_400_000;
  const fmt = (at: number) =>
    new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
}

export interface WeeklyRecap {
  range: WeekRange;
  solved: number;
  byDifficulty: Record<Difficulty, number>;
  byPlatform: Array<{ platform: string; count: number }>;
  reviews: number;
  hints: number;
  submits: number;
  runs: number;
  /** Sum of recorded solve times for the problems solved this week. */
  timeMs: number;
  topics: Array<{ tag: string; count: number }>;
  /** Tags that appear this week and in no earlier problem. */
  newTopics: string[];
  streak: number;
  /** The problem that cost the most, if anything was solved. */
  hardest?: {
    title: string;
    url: string;
    struggle: number;
    submits: number;
    runs: number;
    timeMs?: number;
  };
}

function emptyDifficulties(): Record<Difficulty, number> {
  return { easy: 0, medium: 0, hard: 0, unknown: 0 };
}

/**
 * Rolls the last seven days into something worth looking at — and worth
 * posting.
 *
 * Reviews and hints are counted from the activity history rather than from the
 * problem's totals, because those are lifetime counters and this is a week.
 */
export function summariseWeek(
  problems: SolvedProblem[],
  now: number,
  streak = 0,
  days = 7,
): WeeklyRecap {
  const range = weekRange(now, days);
  const inWindow = (at: number) => at >= range.start && at <= range.end;

  const solvedThisWeek = problems.filter((problem) => inWindow(problem.solvedAt));

  const byDifficulty = emptyDifficulties();
  const platformCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  let timeMs = 0;

  for (const problem of solvedThisWeek) {
    byDifficulty[problem.difficulty] += 1;
    platformCounts.set(problem.platform, (platformCounts.get(problem.platform) ?? 0) + 1);
    for (const tag of problem.tags) topicCounts.set(tag, (topicCounts.get(tag) ?? 0) + 1);
    if (problem.solveTimeMs) timeMs += problem.solveTimeMs;
  }

  // Tags this week that appear in nothing solved before it.
  const earlierTags = new Set(
    problems
      .filter((problem) => problem.solvedAt < range.start)
      .flatMap((problem) => problem.tags),
  );
  const newTopics = [...topicCounts.keys()].filter((tag) => !earlierTags.has(tag));

  let reviews = 0;
  let hints = 0;
  for (const problem of problems) {
    for (const event of problem.history ?? []) {
      if (!inWindow(event.at)) continue;
      if (event.kind === 'review') reviews += 1;
      if (event.kind === 'hint') hints += 1;
    }
  }

  let submits = 0;
  let runs = 0;
  for (const problem of problems) {
    const weekEvents = (problem.events ?? []).filter((event) => inWindow(event.at));
    const summary = summarise(weekEvents);
    submits += summary.submits;
    runs += summary.runs;
  }

  const fought = [...solvedThisWeek]
    .filter((problem) => problem.revision.struggle !== undefined)
    .sort((a, b) => (b.revision.struggle ?? 0) - (a.revision.struggle ?? 0))[0];

  const hardest = fought
    ? {
        title: fought.title,
        url: fought.url,
        struggle: fought.revision.struggle ?? 0,
        submits: summarise(fought.events ?? []).submits || fought.attempts,
        runs: summarise(fought.events ?? []).runs,
        timeMs: fought.solveTimeMs,
      }
    : undefined;

  return {
    range,
    solved: solvedThisWeek.length,
    byDifficulty,
    byPlatform: [...platformCounts.entries()]
      .map(([platform, count]) => ({ platform, count }))
      .sort((a, b) => b.count - a.count),
    reviews,
    hints,
    submits,
    runs,
    timeMs,
    topics: [...topicCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    newTopics,
    streak,
    hardest,
  };
}

/* ------------------------------------------------------------------ card */

const W = 1000;
const H = 560;

const C = {
  bg: '#0b0b0f',
  surface: '#141419',
  border: '#26262e',
  text: '#f4f4f5',
  muted: '#9a9aa5',
  faint: '#6b6b76',
  accent: '#f97316',
  amber: '#fbbf24',
  easy: '#34d399',
  medium: '#fbbf24',
  hard: '#f87171',
};

function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface WrappedOptions {
  /**
   * Animation is right for a card embedded in a README and wrong for one that
   * is about to be rasterised — a bar mid-`scaleX(0)` renders as nothing at
   * all, so the PNG export turns it off.
   */
  animate?: boolean;
  /** Shown under the title; the user's handle if they want one there. */
  subtitle?: string;
}

/**
 * The shareable card.
 *
 * Sized 1000×560 rather than square: that is close enough to the 1.91:1 both
 * X and LinkedIn crop link previews to that nothing important is cut off.
 */
export function buildWrappedSvg(recap: WeeklyRecap, options: WrappedOptions = {}): string {
  const animate = options.animate ?? true;

  const tiles = [
    { value: String(recap.solved), label: recap.solved === 1 ? 'problem solved' : 'problems solved' },
    { value: String(recap.reviews), label: 'revisions done' },
    { value: String(recap.submits), label: 'submissions' },
    { value: recap.streak > 0 ? String(recap.streak) : '—', label: 'day streak' },
  ];

  const tileW = 226;
  const tileMarkup = tiles
    .map(
      (tile, index) => `
    <g class="rise" style="animation-delay:${0.07 * index}s">
      <rect x="${40 + index * (tileW + 12)}" y="132" width="${tileW}" height="96" rx="16"
            fill="${C.surface}" stroke="${C.border}" />
      <text x="${40 + index * (tileW + 12) + 22}" y="188" class="big">${xml(tile.value)}</text>
      <text x="${40 + index * (tileW + 12) + 22}" y="211" class="small">${xml(tile.label)}</text>
    </g>`,
    )
    .join('');

  // One stacked bar for the difficulty mix, which reads faster than three counts.
  const mix = (['easy', 'medium', 'hard'] as const).map((key) => ({
    key,
    count: recap.byDifficulty[key],
    color: C[key],
  }));
  const mixTotal = mix.reduce((total, entry) => total + entry.count, 0);
  let mixX = 40;
  const mixMarkup = mixTotal
    ? mix
        .filter((entry) => entry.count > 0)
        .map((entry) => {
          const width = Math.max(6, Math.round((entry.count / mixTotal) * 920));
          const markup = `<rect x="${mixX}" y="262" width="${width}" height="14" rx="7" fill="${entry.color}" />
    <text x="${mixX}" y="296" class="small" fill="${entry.color}">${entry.count} ${entry.key}</text>`;
          mixX += width + 6;
          return markup;
        })
        .join('')
    : `<rect x="40" y="262" width="920" height="14" rx="7" fill="${C.border}" />`;

  const chips = recap.topics.slice(0, 5);
  let chipX = 40;
  const chipMarkup = chips
    .map((topic) => {
      const label = clip(topic.tag, 22);
      // No text metrics in a generated SVG, so the width is estimated from the
      // character count — generous enough that nothing overflows its pill.
      const width = label.length * 8.2 + 46;
      const markup = `
    <g class="rise">
      <rect x="${chipX}" y="336" width="${width}" height="30" rx="15" fill="${C.surface}" stroke="${C.border}" />
      <text x="${chipX + 16}" y="356" class="chip">${xml(label)}</text>
      <text x="${chipX + width - 18}" y="356" class="chipCount" text-anchor="end">${topic.count}</text>
    </g>`;
      chipX += width + 8;
      return markup;
    })
    .join('');

  const fight = recap.hardest;
  const fightMarkup = fight
    ? `
    <g class="rise" style="animation-delay:.25s">
      <rect x="40" y="396" width="920" height="86" rx="16" fill="${C.surface}" stroke="${C.border}" />
      <text x="62" y="424" class="label">BIGGEST FIGHT</text>
      <text x="62" y="452" class="fightTitle">${xml(clip(fight.title, 48))}</text>
      <text x="62" y="472" class="small">${xml(
        [
          `${fight.submits} submit${fight.submits === 1 ? '' : 's'}`,
          fight.runs > 0 ? `${fight.runs} run${fight.runs === 1 ? '' : 's'}` : '',
          fight.timeMs ? formatDuration(fight.timeMs) : '',
        ]
          .filter(Boolean)
          .join(' · '),
      )}</text>
      <text x="938" y="452" class="fightScore" text-anchor="end">${Math.round(
        fight.struggle * 100,
      )}</text>
      <text x="938" y="470" class="small" text-anchor="end">out of 100</text>
    </g>`
    : `
    <g>
      <rect x="40" y="396" width="920" height="86" rx="16" fill="${C.surface}" stroke="${C.border}" />
      <text x="62" y="446" class="small">Nothing solved this week — the streak is waiting.</text>
    </g>`;

  const timeLine = recap.timeMs > 0 ? `${formatDuration(recap.timeMs)} at the keyboard · ` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Week in code">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
    .title { fill: ${C.text}; font-size: 34px; font-weight: 800; letter-spacing: -0.02em; }
    .sub { fill: ${C.muted}; font-size: 15px; }
    .big { fill: ${C.text}; font-size: 40px; font-weight: 800; letter-spacing: -0.02em; }
    .small { fill: ${C.muted}; font-size: 13px; }
    .label { fill: ${C.faint}; font-size: 10px; letter-spacing: 0.14em; font-weight: 700; }
    .chip { fill: ${C.text}; font-size: 13px; font-weight: 600; }
    .chipCount { fill: ${C.faint}; font-size: 12px; font-weight: 700; }
    .fightTitle { fill: ${C.text}; font-size: 19px; font-weight: 700; }
    .fightScore { fill: ${C.accent}; font-size: 30px; font-weight: 800; }
    .foot { fill: ${C.faint}; font-size: 12px; }
    ${
      animate
        ? `.rise { animation: rise 620ms cubic-bezier(.2,.8,.2,1) both; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .rise { animation: none; } }`
        : '/* static: this card gets rasterised, and a mid-animation frame is blank */'
    }
  </style>
  <defs>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="24" /></clipPath>
  </defs>
  <rect width="${W}" height="${H}" rx="24" fill="${C.bg}" stroke="${C.border}" />
  <!-- Clipped to the card, or its square corners overhang the rounded ones. -->
  <rect x="0" y="0" width="${W}" height="4" fill="${C.accent}" clip-path="url(#card)" />

  <circle cx="60" cy="62" r="18" fill="${C.accent}" opacity="0.16" />
  <text x="60" y="71" class="title" fill="${C.accent}" text-anchor="middle" font-size="24">↻</text>
  <text x="92" y="60" class="title">My week in code</text>
  <text x="92" y="84" class="sub">${xml(recap.range.label)}${
    options.subtitle ? ` · ${xml(options.subtitle)}` : ''
  }</text>

  ${tileMarkup}
  <text x="40" y="252" class="label">DIFFICULTY MIX</text>
  ${mixMarkup}
  ${chips.length > 0 ? `<text x="40" y="326" class="label">TOPICS</text>${chipMarkup}` : ''}
  ${fightMarkup}

  <text x="40" y="516" class="foot">${xml(
    `${timeLine}${recap.runs} run${recap.runs === 1 ? '' : 's'} · ${recap.hints} hint${
      recap.hints === 1 ? '' : 's'
    }${recap.newTopics.length > 0 ? ` · new: ${recap.newTopics.slice(0, 3).join(', ')}` : ''}`,
  )}</text>
  <text x="960" y="516" class="foot" text-anchor="end">${xml(
    `${PRODUCT} · ${PARIKSHAA_URL.replace('https://', '')}`,
  )}</text>
</svg>
`;
}

/** The line that goes with the image when it is shared. */
export function wrappedCaption(recap: WeeklyRecap): string {
  const parts = [
    `${recap.solved} problem${recap.solved === 1 ? '' : 's'} solved`,
    recap.reviews > 0 ? `${recap.reviews} revision${recap.reviews === 1 ? '' : 's'}` : '',
    recap.streak > 0 ? `${recap.streak}-day streak` : '',
  ].filter(Boolean);

  const fight = recap.hardest
    ? ` Hardest: ${recap.hardest.title} — ${recap.hardest.submits} submit${
        recap.hardest.submits === 1 ? '' : 's'
      } before it went green.`
    : '';

  return `My week in code (${recap.range.label}): ${parts.join(', ')}.${fight}`;
}

export function platformLabel(platform: string): string {
  return (PLATFORM_LABELS as Record<string, string>)[platform as Platform] ?? platform;
}

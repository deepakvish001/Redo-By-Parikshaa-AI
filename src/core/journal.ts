import type {
  ActivityCounts,
  ActivityEvent,
  ActivityKind,
  AttemptEvent,
  AttemptSummary,
  Difficulty,
} from './types.ts';

/** A history longer than this is trimmed from the front. */
export const MAX_HISTORY = 120;

export const ACTIVITY_KINDS: ActivityKind[] = [
  'opened',
  'solved',
  'review',
  'hint',
  'github',
  'parikshaa',
  'note',
];

export function appendActivity(
  history: ActivityEvent[],
  event: ActivityEvent,
): ActivityEvent[] {
  // Opening the same problem twice in a minute is one visit, not two — the SPA
  // fires a navigation for every tab within the problem page.
  const last = history[history.length - 1];
  if (
    last &&
    last.kind === event.kind &&
    last.outcome === event.outcome &&
    last.reason === event.reason &&
    event.at - last.at < 60_000
  ) {
    return history;
  }

  const next = [...history, event];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

export function countActivity(history: ActivityEvent[] = []): ActivityCounts {
  const counts = Object.fromEntries(ACTIVITY_KINDS.map((kind) => [kind, 0])) as ActivityCounts;
  for (const event of history) counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  return counts;
}

const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  opened: 'Opened',
  solved: 'Solved',
  review: 'Revised',
  hint: 'Hint taken',
  github: 'GitHub sync',
  parikshaa: 'Parikshaa sync',
  note: 'Notes edited',
};

export function activityLabel(kind: ActivityKind): string {
  return ACTIVITY_LABEL[kind] ?? kind;
}

/** Beyond this a journal is trimmed from the front — runs pile up fast. */
export const MAX_EVENTS = 60;

/** Appends an attempt, keeping the journal ordered and bounded. */
export function appendEvent(events: AttemptEvent[], event: AttemptEvent): AttemptEvent[] {
  // One submission can be reported twice: the API poll sees it, and so does the
  // rendered verdict. When both carry the id they are the same attempt however
  // far apart they arrive.
  if (event.submissionId && events.some((seen) => seen.submissionId === event.submissionId)) {
    return events;
  }

  // The same verdict poll also arrives several times while the judge finishes,
  // and a run has no id to match on, so a repeat of the last event within a
  // second is the same attempt too.
  const last = events[events.length - 1];
  if (
    last &&
    last.kind === event.kind &&
    last.verdict === event.verdict &&
    last.submissionId === event.submissionId &&
    Math.abs(event.at - last.at) < 1000
  ) {
    return events;
  }

  const next = [...events, event].sort((a, b) => a.at - b.at);
  return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
}

export function summarise(events: AttemptEvent[]): AttemptSummary {
  const counts = new Map<string, number>();
  let runs = 0;
  let submits = 0;
  let failedSubmits = 0;
  let acceptedAt: number | undefined;

  for (const event of events) {
    if (event.kind === 'run') runs += 1;
    else {
      submits += 1;
      if (!event.accepted) failedSubmits += 1;
    }
    if (event.accepted && event.kind === 'submit' && acceptedAt === undefined) {
      acceptedAt = event.at;
    }
    if (!event.accepted && event.verdict) {
      counts.set(event.verdict, (counts.get(event.verdict) ?? 0) + 1);
    }
  }

  const firstAt = events[0]?.at;
  return {
    runs,
    submits,
    failedSubmits,
    verdicts: [...counts.entries()]
      .map(([verdict, count]) => ({ verdict, count }))
      .sort((a, b) => b.count - a.count),
    firstAt,
    acceptedAt,
    spanMs: firstAt !== undefined && acceptedAt !== undefined ? acceptedAt - firstAt : undefined,
  };
}

/**
 * Roughly how long a problem of each difficulty should take before the time
 * spent counts as a struggle. Deliberately generous — the point is to notice
 * the problem that took an hour, not to grade a comfortable twenty minutes.
 */
const EXPECTED_MINUTES: Record<Difficulty, number> = {
  easy: 12,
  medium: 25,
  hard: 45,
  unknown: 25,
};

export interface StruggleInput {
  events?: AttemptEvent[];
  attempts?: number;
  solveTimeMs?: number;
  difficulty?: Difficulty;
}

/**
 * How much the problem cost, as 0 (walked it) to 1 (fought for it).
 *
 * Three independent signals, because each can be absent: failed submits are the
 * strongest but some judges never report a failure we saw, runs show iteration
 * even when every submit passed, and time covers the problem someone stared at
 * before writing anything at all.
 */
export function struggleScore(input: StruggleInput): number {
  const events = input.events ?? [];
  const summary = summarise(events);

  // Prefer what we watched happen; fall back to the adapter's own count.
  const failed = Math.max(summary.failedSubmits, Math.max(0, (input.attempts ?? 1) - 1));
  const failedScore = Math.min(1, failed / 4);

  // Runs only start to mean something past the first couple.
  const runScore = Math.min(1, Math.max(0, summary.runs - 2) / 8);

  const expected = EXPECTED_MINUTES[input.difficulty ?? 'unknown'] * 60_000;
  const spent = input.solveTimeMs ?? summary.spanMs;
  const timeScore = spent ? Math.min(1, Math.max(0, spent / expected - 0.5) / 1.5) : 0;

  // A compile error is noise; a wrong answer means the approach was wrong.
  const wrongAnswers = summary.verdicts
    .filter(({ verdict }) => /wrong answer|time limit|runtime error/i.test(verdict))
    .reduce((total, { count }) => total + count, 0);
  const wrongScore = Math.min(1, wrongAnswers / 3);

  const score = 0.4 * failedScore + 0.2 * runScore + 0.2 * timeScore + 0.2 * wrongScore;
  return Number(Math.min(1, Math.max(0, score)).toFixed(2));
}

/** Plain-language reading of a struggle score, for the UI and the README. */
export function describeStruggle(score: number): string {
  if (score >= 0.66) return 'fought for it';
  if (score >= 0.33) return 'some resistance';
  return 'walked it';
}

/** Formats a duration the way the panel and README both want it. */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

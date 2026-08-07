import { summarise } from './journal.ts';
import type { AttemptEvent, SolvedProblem } from './types.ts';

/**
 * What goes wrong, and where.
 *
 * The attempt journal holds every rejected submission with its verdict — which
 * nothing else records — so this is the one analysis the extension can do that
 * no leaderboard, sheet or streak tracker can. "You TLE on two in five dynamic
 * programming submissions" is a sentence somebody can act on; "34 solved" is
 * not.
 */

/** Verdicts grouped into the four things that actually go wrong. */
export type FailureKind = 'wrong' | 'slow' | 'crash' | 'compile';

const FAILURE_LABELS: Record<FailureKind, string> = {
  wrong: 'Wrong answer',
  slow: 'Too slow',
  crash: 'Runtime error',
  compile: "Wouldn't compile",
};

export function failureLabel(kind: FailureKind): string {
  return FAILURE_LABELS[kind];
}

/**
 * Both judges word verdicts differently and Codeforces localises them, so this
 * matches on the distinguishing words rather than on the whole string.
 */
export function classify(verdict: string): FailureKind | undefined {
  const text = verdict.toLowerCase();
  // Compile first: "Ошибка компиляции" would otherwise be read as a crash,
  // since both start with the word for "error".
  if (/compil|компил/.test(text)) return 'compile';
  // `врем` rather than `время` — Codeforces declines the noun, and the verdict
  // uses the genitive "времени".
  if (/time limit|tle|врем/.test(text)) return 'slow';
  if (/runtime|memory limit|idleness|segmentation|памят|выполн|бездейств/.test(text)) {
    return 'crash';
  }
  // Deliberately not `failed`: "Judgement Failed" is the judge breaking, not a
  // rejected answer, and counting it would put noise in the headline.
  if (/wrong|неправильн/.test(text)) return 'wrong';
  return undefined;
}

export interface TopicFailures {
  tag: string;
  /** Problems solved carrying this tag. */
  solved: number;
  submits: number;
  failures: number;
  byKind: Record<FailureKind, number>;
  /** Submissions per accepted problem — 1.0 means first time, every time. */
  submitsPerSolve: number;
}

export interface FailureReport {
  submits: number;
  failures: number;
  byKind: Record<FailureKind, number>;
  /** Topics with enough attempts to say something about, worst first. */
  topics: TopicFailures[];
  /** The single most common way this person's submissions fail. */
  headline?: { kind: FailureKind; share: number; tag?: string };
  /** Problems where the first attempt failed, with the case it failed on. */
  firstFailures: Array<{ title: string; url: string; verdict: string; input?: string }>;
}

function emptyKinds(): Record<FailureKind, number> {
  return { wrong: 0, slow: 0, crash: 0, compile: 0 };
}

/**
 * Topics need a few attempts before a rate means anything — three submissions
 * with one failure is not "33% wrong answers", it is noise.
 */
const MIN_SUBMITS = 5;

export function buildFailureReport(problems: SolvedProblem[]): FailureReport {
  const byKind = emptyKinds();
  const topics = new Map<string, TopicFailures>();
  const firstFailures: FailureReport['firstFailures'] = [];
  let submits = 0;
  let failures = 0;

  for (const problem of problems) {
    const events = problem.events ?? [];
    const summary = summarise(events);
    submits += summary.submits;

    const tags = problem.tags.length > 0 ? problem.tags : ['untagged'];
    for (const tag of tags) {
      const entry = topics.get(tag) ?? {
        tag,
        solved: 0,
        submits: 0,
        failures: 0,
        byKind: emptyKinds(),
        submitsPerSolve: 0,
      };
      entry.solved += 1;
      entry.submits += summary.submits;
      topics.set(tag, entry);
    }

    for (const event of events) {
      if (event.kind !== 'submit' || event.accepted) continue;
      const kind = classify(event.verdict);
      failures += 1;
      if (kind) {
        byKind[kind] += 1;
        for (const tag of tags) {
          const entry = topics.get(tag)!;
          entry.failures += 1;
          entry.byKind[kind] += 1;
        }
      }
    }

    const first = events.find((event) => event.kind === 'submit');
    if (first && !first.accepted) {
      firstFailures.push({
        title: problem.title,
        url: problem.url,
        verdict: first.verdict,
        input: first.failedInput,
      });
    }
  }

  for (const entry of topics.values()) {
    entry.submitsPerSolve = entry.solved > 0 ? entry.submits / entry.solved : 0;
  }

  const ranked = [...topics.values()]
    .filter((entry) => entry.submits >= MIN_SUBMITS)
    .sort((a, b) => b.submitsPerSolve - a.submitsPerSolve || b.failures - a.failures);

  // The headline is the failure kind that dominates, and the topic it hurts
  // most — that pair is the actionable sentence.
  let headline: FailureReport['headline'];
  const worstKind = (Object.entries(byKind) as Array<[FailureKind, number]>).sort(
    (a, b) => b[1] - a[1],
  )[0];

  if (worstKind && worstKind[1] > 0 && failures > 0) {
    const [kind] = worstKind;
    const worstTopic = ranked
      .filter((entry) => entry.byKind[kind] > 0)
      .sort((a, b) => b.byKind[kind] - a.byKind[kind])[0];
    headline = { kind, share: worstKind[1] / failures, tag: worstTopic?.tag };
  }

  return {
    submits,
    failures,
    byKind,
    topics: ranked,
    headline,
    firstFailures: firstFailures.slice(-8).reverse(),
  };
}

/** The headline as a sentence, or undefined when there is not enough to say. */
export function describeHeadline(report: FailureReport): string | undefined {
  if (!report.headline || report.failures < 3) return undefined;

  const { kind, share, tag } = report.headline;
  const percent = Math.round(share * 100);
  const what = failureLabel(kind).toLowerCase();

  if (tag) {
    return `${percent}% of your rejected submissions are "${what}", and ${tag} is where it happens most.`;
  }
  return `${percent}% of your rejected submissions are "${what}".`;
}

/** Topics where getting accepted takes noticeably more tries than usual. */
export function strugglingTopics(report: FailureReport, limit = 5): TopicFailures[] {
  if (report.topics.length === 0) return [];
  const average =
    report.topics.reduce((sum, entry) => sum + entry.submitsPerSolve, 0) / report.topics.length;
  return report.topics.filter((entry) => entry.submitsPerSolve > average * 1.2).slice(0, limit);
}

/** Rolls a set of journals up the same way, for problems not yet solved. */
export function countOpenAttempts(journals: Record<string, AttemptEvent[]>): number {
  return Object.values(journals).reduce(
    (total, events) => total + summarise(events).submits,
    0,
  );
}

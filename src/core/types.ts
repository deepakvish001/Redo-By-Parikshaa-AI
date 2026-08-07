import type { FocusSettings } from './focus.ts';

export type Platform =
  | 'leetcode'
  | 'codeforces'
  | 'atcoder'
  | 'codechef'
  | 'hackerrank'
  | 'geeksforgeeks';

/** Display names, and the order platforms appear in settings and stats. */
export const PLATFORMS: Platform[] = [
  'leetcode',
  'codeforces',
  'atcoder',
  'codechef',
  'hackerrank',
  'geeksforgeeks',
];

export const PLATFORM_LABELS: Record<Platform, string> = {
  leetcode: 'LeetCode',
  codeforces: 'Codeforces',
  atcoder: 'AtCoder',
  codechef: 'CodeChef',
  hackerrank: 'HackerRank',
  geeksforgeeks: 'GeeksforGeeks',
};

export type Difficulty = 'easy' | 'medium' | 'hard' | 'unknown';

/**
 * A run is the judge checking sample cases only; a submit is the real thing.
 * They are counted separately because they mean different things — ten runs is
 * someone iterating, ten submits is someone stuck.
 */
export type AttemptKind = 'run' | 'submit';

/**
 * One run or submit, as the judge reported it.
 *
 * Kept for every attempt, not just the accepted one: what a problem cost is
 * only visible in the failures, and that cost is what decides how soon and how
 * often it needs revising.
 */
export interface AttemptEvent {
  at: number;
  kind: AttemptKind;
  /** Verdict as the judge worded it, e.g. `Wrong Answer`, `Compile Error`. */
  verdict: string;
  accepted: boolean;
  language?: string;
  runtime?: string;
  memory?: string;
  testsPassed?: number;
  testsTotal?: number;
  /** Compile or runtime error text, trimmed to something readable. */
  errorText?: string;
  /** The case it failed on, when the judge discloses it. */
  failedInput?: string;
  expectedOutput?: string;
  actualOutput?: string;
  submissionId?: string;
  /** ms between opening the problem and this attempt, when known. */
  elapsedMs?: number;
}

/**
 * Everything that happens to a problem other than a judge verdict: opening it,
 * solving it, revising it, taking a hint, a sync succeeding or failing, notes
 * being edited.
 *
 * Kept separately from `AttemptEvent` because the two answer different
 * questions — attempts say how the problem fought back, activity says what you
 * and the extension did about it — and because attempts come from the judge
 * while activity comes from us.
 */
export type ActivityKind =
  | 'opened'
  | 'solved'
  | 'review'
  | 'hint'
  | 'github'
  | 'parikshaa'
  | 'note';

export interface ActivityEvent {
  at: number;
  kind: ActivityKind;
  /** One word for what happened: `synced`, `failed`, `skipped`, `forgot`, … */
  outcome?: string;
  /** Why, quoted from whoever said it — the API, the judge, the user's rating. */
  reason?: string;
}

/** How many times each kind of thing has happened to one problem. */
export type ActivityCounts = Record<ActivityKind, number>;

/** Rolled-up view of one problem's attempt journal. */
export interface AttemptSummary {
  runs: number;
  submits: number;
  failedSubmits: number;
  /** Distinct non-accepted verdicts seen, most frequent first. */
  verdicts: Array<{ verdict: string; count: number }>;
  firstAt?: number;
  acceptedAt?: number;
  /** Wall-clock span from the first attempt to the accepted one. */
  spanMs?: number;
}

/** How well the user felt they recalled a problem during a revision. */
export type Recall = 'forgot' | 'hard' | 'good' | 'easy';

/**
 * One solved problem. The record is keyed by `id` (`<platform>:<slug>`) so a
 * re-submission of the same problem updates the existing entry rather than
 * creating a duplicate.
 */
export interface SolvedProblem {
  id: string;
  platform: Platform;
  /** Platform-native identifier, e.g. `1768` or `1352A`. */
  problemId: string;
  slug: string;
  title: string;
  url: string;
  difficulty: Difficulty;
  tags: string[];
  language: string;
  code: string;
  /** ms since epoch of the most recent accepted submission. */
  solvedAt: number;
  /** How many times the user has submitted before getting it accepted. */
  attempts: number;
  runtimeNote?: string;
  memoryNote?: string;
  /** User's own note, editable from the popup. */
  note?: string;
  /** The user's own complexity analysis — not the judge's runtime figures. */
  complexity?: { time?: string; space?: string };
  /**
   * How long the problem page was open before the accepted submission.
   * Absent when the span was implausible (a tab left open overnight).
   */
  solveTimeMs?: number;
  /**
   * Every run and submit seen for this problem, oldest first. Capped, because
   * a long debugging session can produce a great many runs.
   */
  events?: AttemptEvent[];
  /**
   * Everything else that happened to this problem, oldest first: opens, solves,
   * reviews, hints, syncs and note edits, each with its reason and timestamp.
   */
  history?: ActivityEvent[];
  github: GithubSyncState;
  parikshaa: ParikshaaSyncState;
  revision: RevisionState;
}

export interface ParikshaaSyncState {
  /** `pending` means it is queued for the next time credentials are fresh. */
  status: 'pending' | 'synced' | 'skipped' | 'error' | 'disabled';
  /** Why it was skipped — no matching problem, unsupported language, and so on. */
  reason?: string;
  error?: string;
  url?: string;
  syncedAt?: number;
}

export interface GithubSyncState {
  status: 'pending' | 'synced' | 'error' | 'disabled';
  /** Path inside the target repository, e.g. `medium/0001-two-sum/solution.py`. */
  path?: string;
  commitUrl?: string;
  error?: string;
  syncedAt?: number;
}

/**
 * Scheduling state for one problem. `stage` indexes into the configured
 * interval ladder; `ease` stretches or compresses it based on recall quality.
 */
export interface RevisionState {
  stage: number;
  ease: number;
  dueAt: number;
  lastReviewedAt?: number;
  reviewCount: number;
  /** Number of reviews rated `forgot` — the signal behind weak-topic ranking. */
  lapses: number;
  /** Hint levels revealed across all revisions of this problem. */
  hintsUsed: number;
  /**
   * 0–1, how much the problem cost when it was first solved. Derived from the
   * attempt journal at solve time and kept, so the schedule stays shaped by how
   * hard the problem actually was rather than only by later recall ratings.
   */
  struggle?: number;
  /**
   * How many clean reviews this problem should get before it is considered
   * settled. A problem that fought back earns more of them.
   */
  targetReviews?: number;
}

export interface Settings {
  github: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
    enabled: boolean;
    /** Commit message template; `{title}` and `{platform}` are substituted. */
    commitMessage: string;
  };
  parikshaa: {
    /** Mark matching problems solved on parikshaa.org. */
    enabled: boolean;
  };
  diagnostics: {
    /**
     * Records what the observer sees on each judge, so a detection failure can
     * be identified rather than guessed at. Off by default.
     */
    enabled: boolean;
  };
  contests: {
    /** Show upcoming contests and notify before they start. */
    remind: boolean;
    /** How many minutes before the start to notify. */
    leadMinutes: number;
    /** Which judges' contests to gather. */
    platforms: Partial<Record<Platform, boolean>>;
  };
  wrapped: {
    /** Nudge once a week that the shareable recap is ready. */
    notify: boolean;
  };
  /** Gate browsing until today's problem is done. Off by default. */
  focus: FocusSettings;
  revision: {
    /** Interval ladder in days. Stage n schedules `intervals[n]` days out. */
    intervals: number[];
    /** Skip scheduling for problems the user found trivial. */
    skipEasy: boolean;
    notify: boolean;
  };
  platforms: Record<Platform, boolean>;
}

export interface TopicStat {
  tag: string;
  solved: number;
  lapses: number;
  totalAttempts: number;
  hintsUsed: number;
  /** Median time to an accepted submission, where it was recorded. */
  medianSolveMs?: number;
  /** 0–100. Lower means the topic needs work. */
  mastery: number;
}

export interface Stats {
  total: number;
  byDifficulty: Record<Difficulty, number>;
  byPlatform: Record<Platform, number>;
  dueToday: number;
  reviewsCompleted: number;
  currentStreak: number;
  weakestTopics: TopicStat[];
  strongestTopics: TopicStat[];
}

/** Payload a platform adapter produces when it sees an accepted submission. */
export interface AcceptedSubmission {
  platform: Platform;
  problemId: string;
  slug: string;
  title: string;
  url: string;
  difficulty: Difficulty;
  tags: string[];
  language: string;
  code: string;
  runtimeNote?: string;
  memoryNote?: string;
  /** Submissions made for this problem in the current session, accepted one included. */
  attempts?: number;
}

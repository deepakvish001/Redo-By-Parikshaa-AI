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

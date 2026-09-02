import type { FocusSettings } from './focus.ts';
import type { RepoTarget } from './github.ts';

export type Platform =
  | 'leetcode'
  | 'codeforces'
  | 'atcoder'
  | 'codechef'
  | 'hackerrank'
  | 'geeksforgeeks'
  | 'cses';

/** Display names, and the order platforms appear in settings and stats. */
export const PLATFORMS: Platform[] = [
  'leetcode',
  'codeforces',
  'atcoder',
  'codechef',
  'hackerrank',
  'geeksforgeeks',
  'cses',
];

export const PLATFORM_LABELS: Record<Platform, string> = {
  leetcode: 'LeetCode',
  codeforces: 'Codeforces',
  atcoder: 'AtCoder',
  codechef: 'CodeChef',
  hackerrank: 'HackerRank',
  geeksforgeeks: 'GeeksforGeeks',
  cses: 'CSES',
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
  /**
   * Every accepted solution, keyed by file extension.
   *
   * Keyed by extension rather than by language name on purpose: `GNU C++17` and
   * `GNU C++20` are the same file, and the newer one should replace the older,
   * while C++ and Python are two files that must sit side by side. `code` and
   * `language` above stay as the most recent, so nothing that reads one
   * solution has to learn about this.
   */
  solutions?: Record<string, { language: string; code: string; solvedAt: number }>;
  /** ms since epoch of the most recent accepted submission. */
  solvedAt: number;
  /** How many times the user has submitted before getting it accepted. */
  attempts: number;
  runtimeNote?: string;
  memoryNote?: string;
  /** User's own note, editable from the popup. */
  note?: string;
  /**
   * User-defined labels — `revisit`, `blind-75`, `google-oa`. Normalised to
   * lower-case hyphenated form so the same word is always the same group.
   */
  labels?: string[];
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
  /**
   * When this record last changed, on whichever machine changed it.
   *
   * Exists for syncing between machines: `solvedAt` does not move when a
   * problem is *revised*, so without this a review done on the laptop and one
   * done on the desktop are indistinguishable and the merge has nothing to pick
   * on. Optional because records written before this existed do not have it —
   * those fall back to the newest timestamp they do carry.
   */
  updatedAt?: number;
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
    /**
     * A GitHub OAuth App client id, for "Sign in with GitHub".
     *
     * A setting and not only a build constant, because an OAuth App belongs to
     * an account: a build published by somebody else carries their id, and a
     * fork or a local install carries none. Rather than leaving the button
     * permanently dead for everyone who did not publish the build, the id can
     * be pasted here. It is not a secret — the device flow has no client secret,
     * which is exactly why it is the only OAuth flow an extension can run
     * honestly — so storing it beside the settings costs nothing.
     */
    clientId: string;
    /**
     * Ask for private repositories too when signing in.
     *
     * On, because "connect and then pick any of my repositories" is what people
     * mean by connecting. It does make the token broader: `repo` reaches every
     * repository you can, where `public_repo` reaches only the public ones. The
     * fine-grained token remains the narrower option, and is still offered.
     */
    signInPrivate: boolean;
    owner: string;
    repo: string;
    branch: string;
    enabled: boolean;
    /**
     * A repository per platform, for people who keep LeetCode and Codeforces
     * apart. Anything without an entry here goes to the repository above, so
     * one repository for everything stays the default and needs no setup.
     *
     * An entry is only honoured when it names both an owner and a repository;
     * a blank branch falls back to the default's.
     */
    perPlatform: Partial<Record<Platform, RepoTarget>>;
    /** Commit message template; `{title}` and `{platform}` are substituted. */
    commitMessage: string;
    /**
     * Commit a daily backup of the revision history to the same repository.
     * Daily rather than per-solve so the file does not bloat every commit.
     */
    backup: boolean;
    /**
     * Keep this browser in step with that backup, both ways.
     *
     * With it on, the extension pulls the repository's copy, merges it with
     * what is here, and pushes the result — so a schedule built on the laptop
     * is the same schedule on the desktop. The repository is the whole sync
     * mechanism; there is no server, and there is not going to be one.
     */
    sync: boolean;
  };
  parikshaa: {
    /** Mark matching problems solved on parikshaa.org. */
    enabled: boolean;
  };
  /**
   * What the extension adds to the judges' own pages. Everything here is a
   * switch because people installed Redo to sync solutions, and must not open
   * Codeforces one morning to find it rebuilt.
   */
  page: {
    /** Master switch. Off means no injection at all beyond the review nudge. */
    enabled: boolean;
    /** The sidebar card on a problem page. */
    rail: boolean;
    /** Rating chip and tags on the rail. Tags stay hidden until asked for. */
    rating: boolean;
    /** Reveal the problem's tags without leaving the page. */
    tags: boolean;
    /** A running clock for how long this attempt has taken. */
    timer: boolean;
    /** Solved ticks, due badges and rating chips down listing pages. */
    listings: boolean;
    /** Streak and today's picks on your own Codeforces profile. */
    profile: boolean;
    /**
     * Today's problem and the streak calendar on the problemset page.
     *
     * Two pinned rows at the top of the list and a box in the sidebar. On the
     * problemset page only, because that is the page where you are already
     * choosing what to solve — anywhere else it would be an interruption.
     */
    daily: boolean;
    /** A preview card when you hover a Codeforces handle. */
    hovercards: boolean;
    /** Which of your saved handles has solved the problem you are on. */
    friends: boolean;
    /** A College tab and your country rank on a standings page. */
    standings: boolean;
    /**
     * The split-pane workspace: statement beside an editor.
     *
     * Off by default, unlike everything else here. The others add a line to a
     * page; this one covers it, and it costs a two-hundred-kilobyte editor
     * that is only downloaded once you ask for it.
     */
    workspace: boolean;
    /**
     * Open the workspace by itself on every problem page.
     *
     * Off by default even when the workspace is on, because it turns a page you
     * might have opened only to read into a page you have to close. It is the
     * right setting for somebody who solves in the workspace every time, and
     * the wrong one for everybody else.
     */
    workspaceAuto: boolean;
    /**
     * Restyle Codeforces itself, dark.
     *
     * The only thing here that changes the judge's own page rather than adding
     * to it, so it is off by default and it is one stylesheet: switching it off
     * removes it and the page is exactly as the site built it.
     */
    skin: boolean;
  };
  /**
   * Hand each accepted solve to an editor listening on this machine.
   *
   * A protocol rather than an integration: Redo posts JSON to a local port and
   * anything can listen. The localhost permission is *optional* in the
   * manifest, so an install that never turns this on never carries it.
   */
  bridge: {
    enabled: boolean;
    port: number;
  };
  /**
   * Solution threads, as issues on a repository you name.
   *
   * No backend: GitHub already runs one. Posting is public, under your own
   * account, in a repository you chose — which is stated in Settings rather
   * than buried, because it is the whole trade.
   */
  community: {
    enabled: boolean;
    /** Defaults to your sync repository's owner when left blank. */
    owner: string;
    repo: string;
  };
  /**
   * Statement translation.
   *
   * The one feature that sends anything to a third party, so: off by default,
   * your own key, and PRIVACY.md names Google as the recipient. With no key it
   * does nothing at all rather than falling back to something.
   */
  translate: {
    enabled: boolean;
    /** The user's own Google Gemini key. Never leaves this machine except to Google. */
    apiKey: string;
    /** Target language code, e.g. `hi`. */
    language: string;
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
  handles: {
    /** Codeforces handle, for rating and contest prediction. */
    codeforces: string;
    /**
     * A Codeforces API key and secret, generated by you at
     * codeforces.com/settings/api.
     *
     * Optional. Everything public — rating, contest history, solved problems —
     * needs only the handle; these sign requests so the API answers *as you*,
     * which is what `user.friends` requires and what makes `user.status` include
     * gym and private-contest submissions. Stored like every other credential
     * here: unencrypted, because extension storage is the only storage there is.
     */
    cfApiKey: string;
    cfApiSecret: string;
    /** LeetCode username, for contest rating. */
    leetcode: string;
    /**
     * Rating the user is aiming for. Zero means "the next band up", which is
     * what almost everybody is actually working towards.
     */
    goal: number;
    /** Codeforces handles to look for on a problem page. Kept locally. */
    friends: string[];
    /** Your institution, as Codeforces spells it, for the College standings. */
    organization: string;
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
  /**
   * Every accepted solution, keyed by file extension.
   *
   * Keyed by extension rather than by language name on purpose: `GNU C++17` and
   * `GNU C++20` are the same file, and the newer one should replace the older,
   * while C++ and Python are two files that must sit side by side. `code` and
   * `language` above stay as the most recent, so nothing that reads one
   * solution has to learn about this.
   */
  solutions?: Record<string, { language: string; code: string; solvedAt: number }>;
  runtimeNote?: string;
  memoryNote?: string;
  /** Submissions made for this problem in the current session, accepted one included. */
  attempts?: number;
}

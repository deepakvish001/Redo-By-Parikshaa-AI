import type { RepoInfo } from './github.ts';
import type { Contest } from './contests.ts';
import type { FocusSettings, FocusTarget, GateDecision, PauseState } from './focus.ts';
import type {
  CodeforcesProfile,
  LeetCodeProfile,
  Prediction,
} from '../background/rating.ts';
import type { ParikshaaCredentials, SessionDiagnostic } from './parikshaa.ts';
import type { UpsolveItem, UpsolveSummary } from './upsolve.ts';
import type { Claim } from './watermark.ts';
import type { CfProblemView } from '../background/cf-mirror.ts';
import type {
  AcceptedSubmission,
  AttemptEvent,
  Recall,
  Settings,
  SolvedProblem,
  Stats,
} from './types.ts';

export interface DashboardData {
  problems: SolvedProblem[];
  stats: Stats;
  settings: Settings;
  now: number;
  /**
   * Attempts for problems that are not solved yet, keyed by `<platform>:<slug>`.
   * Solved problems carry their own journal on the record.
   */
  openJournals: Record<string, AttemptEvent[]>;
}

/**
 * Every request the extension's pages and content scripts can send to the
 * service worker, paired with the shape it resolves to.
 */
export type Request =
  | { type: 'submission:accepted'; submission: AcceptedSubmission }
  | { type: 'page:context'; platform: string; slug: string }
  | { type: 'dashboard:get' }
  | { type: 'problem:review'; id: string; recall: Recall }
  | {
      type: 'problem:details';
      id: string;
      note?: string;
      complexity?: { time?: string; space?: string };
    }
  | { type: 'problem:hint'; id: string; level: number }
  | { type: 'problem:get'; id: string }
  | { type: 'page:opened'; platform: string; slug: string }
  | { type: 'problem:resync'; id: string }
  | { type: 'problem:resync-parikshaa'; id: string }
  | { type: 'attempt:record'; platform: string; slug: string; events: AttemptEvent[] }
  | { type: 'problem:delete'; id: string }
  | { type: 'settings:get' }
  | { type: 'settings:save'; patch: Partial<Settings> }
  | { type: 'github:verify'; config: Settings['github'] }
  | { type: 'parikshaa:credentials'; credentials: ParikshaaCredentials }
  | { type: 'parikshaa:status' }
  | { type: 'parikshaa:diagnostic'; diagnostic: SessionDiagnostic; hasApiKey: boolean }
  | { type: 'due:list' }
  | { type: 'contests:get' }
  | { type: 'contests:refresh' }
  | { type: 'diagnostics:record'; entries: DiagnosticEntry[] }
  | { type: 'diagnostics:get' }
  | { type: 'diagnostics:clear' }
  | { type: 'focus:status' }
  | { type: 'focus:pause' }
  | { type: 'rating:profiles' }
  | { type: 'rating:predict' }
  | { type: 'problem:labels'; id: string; labels: string[] }
  | { type: 'upsolve:get' }
  | { type: 'upsolve:refresh' }
  | { type: 'backup:export' }
  | { type: 'backup:import'; text: string }
  | { type: 'backup:push' }
  | { type: 'backup:pull' }
  | { type: 'submissions:claim'; platform: string; ids: string[]; watched: string[] }
  | { type: 'rail:get'; platform: string; slug: string }
  | { type: 'cf:lookup'; keys: string[] }
  | { type: 'cf:refresh' };

export interface ResponseMap {
  'submission:accepted': { saved: boolean; problem?: SolvedProblem; reason?: string };
  'page:context': { tracked: boolean; due: boolean; problem?: SolvedProblem };
  'dashboard:get': DashboardData;
  'problem:review': { problem?: SolvedProblem };
  'problem:details': { problem?: SolvedProblem };
  'problem:hint': { problem?: SolvedProblem };
  'problem:get': { problem?: SolvedProblem };
  'page:opened': { tracking: boolean };
  'problem:resync': { problem?: SolvedProblem };
  'problem:resync-parikshaa': { problem?: SolvedProblem };
  'attempt:record': { recorded: number };
  'problem:delete': { ok: true };
  'settings:get': Settings;
  'settings:save': Settings;
  'github:verify': RepoInfo;
  'parikshaa:credentials': { accepted: boolean; flushed: number };
  'parikshaa:status': ParikshaaStatus;
  'parikshaa:diagnostic': { recorded: true };
  'due:list': { problems: DueProblem[] };
  'contests:get': ContestsResponse;
  'contests:refresh': ContestsResponse;
  'diagnostics:record': { recorded: number };
  'diagnostics:get': { entries: DiagnosticEntry[]; enabled: boolean };
  'diagnostics:clear': { ok: true };
  'focus:status': FocusStatus;
  'focus:pause': { started: boolean; until?: number };
  'rating:profiles': RatingProfiles;
  'rating:predict': { prediction?: Prediction; error?: string };
  'problem:labels': { problem?: SolvedProblem };
  'upsolve:get': UpsolveResponse;
  'upsolve:refresh': UpsolveResponse;
  'backup:export': { filename: string; json: string };
  'backup:import': RestoreResult;
  'backup:push': { path: string; commitUrl?: string };
  'backup:pull': RestoreResult;
  'submissions:claim': Claim;
  'rail:get': RailData;
  'cf:lookup': Record<string, CfProblemView>;
  'cf:refresh': MirrorState;
}

/**
 * Everything the on-page rail draws, in one round trip.
 *
 * One message rather than five because the rail renders on every problem page
 * load, and five awakenings of the service worker per page is five chances for
 * the card to appear in pieces.
 */
export interface RailData {
  /** The tracked record, when this problem has been solved before. */
  problem?: SolvedProblem;
  /** Attempts on a problem not yet solved; solved ones carry their own. */
  journal: AttemptEvent[];
  due: boolean;
  /** When this page was first opened, so the rail can run a live clock. */
  openedAt?: number;
  /** Rating, tags and solved state from the Codeforces mirror. */
  cf?: CfProblemView;
  page: Settings['page'];
  now: number;
}

/** How full each half of the Codeforces mirror is, for Settings to report. */
export interface MirrorState {
  problems: number;
  problemsAt: number;
  solved: number;
  statusAt: number;
}

export interface UpsolveResponse {
  items: UpsolveItem[];
  summary: UpsolveSummary;
  /** When the queue was last read from Codeforces. */
  fetchedAt?: number;
  error?: string;
}

export interface RestoreResult {
  /** Problems in the store after merging, and how many the file added. */
  problems: number;
  added: number;
  journals: number;
  exportedAt: number;
}

export interface RatingProfiles {
  codeforces?: CodeforcesProfile;
  leetcode?: LeetCodeProfile;
  /** Per-judge failure, so one being down does not hide the other. */
  errors: { codeforces?: string; leetcode?: string };
}

/** Everything the focus gate needs to explain itself. */
export interface FocusStatus {
  settings: FocusSettings;
  decision: GateDecision;
  pause: PauseState;
  target: FocusTarget;
  /** Problems due for revision right now, shown as the better thing to do. */
  dueCount: number;
}

/** One line in the diagnostics log. Carries no request or response body. */
export interface DiagnosticEntry {
  at: number;
  platform: string;
  kind: 'page' | 'seen' | 'accepted' | 'attempt' | 'event' | 'error';
  detail: string;
  /** For `seen`: whether the URL is one the extension acts on. */
  matched?: boolean;
}

/** Slim view of a due problem, enough to decorate a link on another site. */
export interface DueProblem {
  id: string;
  slug: string;
  title: string;
  platform: string;
  dueAt: number;
  stage: number;
}

export interface ContestsResponse {
  contests: Contest[];
  fetchedAt: number;
  /** Sources that failed on the last refresh, so the UI can say which. */
  failed: string[];
  now: number;
}

export interface ParikshaaStatus {
  connected: boolean;
  expired: boolean;
  /**
   * The two halves are reported separately because they fail for different
   * reasons: no key means the extension has not seen parikshaa.org load yet,
   * no session means the user is not signed in there.
   */
  hasApiKey: boolean;
  hasSession: boolean;
  email?: string;
  capturedAt?: number;
  /** Problems waiting on a usable session. */
  pending: number;
  /** Last report from the parikshaa.org content script, when one has run. */
  diagnostic?: SessionDiagnostic;
  diagnosticAt?: number;
}

export type Response<T extends Request['type']> =
  | { ok: true; data: ResponseMap[T] }
  | { ok: false; error: string };

/** Typed wrapper over `chrome.runtime.sendMessage` that unwraps the envelope. */
export async function send<T extends Request['type']>(
  request: Extract<Request, { type: T }>,
): Promise<ResponseMap[T]> {
  const response = (await chrome.runtime.sendMessage(request)) as Response<T> | undefined;
  if (!response) throw new Error('No response from the extension service worker.');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

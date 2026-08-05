import type { RepoInfo } from './github.ts';
import type { AcceptedSubmission, Recall, Settings, SolvedProblem, Stats } from './types.ts';

export interface DashboardData {
  problems: SolvedProblem[];
  stats: Stats;
  settings: Settings;
  now: number;
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
  | { type: 'problem:note'; id: string; note: string }
  | { type: 'problem:resync'; id: string }
  | { type: 'problem:delete'; id: string }
  | { type: 'settings:get' }
  | { type: 'settings:save'; patch: Partial<Settings> }
  | { type: 'github:verify'; config: Settings['github'] };

export interface ResponseMap {
  'submission:accepted': { saved: boolean; problem?: SolvedProblem; reason?: string };
  'page:context': { tracked: boolean; due: boolean; problem?: SolvedProblem };
  'dashboard:get': DashboardData;
  'problem:review': { problem?: SolvedProblem };
  'problem:note': { problem?: SolvedProblem };
  'problem:resync': { problem?: SolvedProblem };
  'problem:delete': { ok: true };
  'settings:get': Settings;
  'settings:save': Settings;
  'github:verify': RepoInfo;
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

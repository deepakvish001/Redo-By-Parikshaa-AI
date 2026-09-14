import {
  buildPost,
  readPost,
  readThread,
  searchQuery,
  threadTitle,
  type Thread,
} from '../core/community.ts';
import { getProblem, getSettings } from '../core/storage.ts';

/**
 * Reading and writing solution threads, as GitHub issues.
 *
 * Deliberately uses the same token as the sync, because asking for a second
 * credential to do a second thing with the same account is how a settings page
 * becomes unusable. That has a consequence worth being explicit about: a
 * fine-grained token scoped to `Contents: read and write` **cannot** post an
 * issue comment, so this feature asks for `Issues: read and write` as well and
 * says so plainly rather than failing with a 403 nobody can interpret.
 */

const API = 'https://api.github.com';

function headers(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function call<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: headers(token) });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (response.status === 403 || response.status === 404) {
      throw new Error(
        'GitHub refused. A community repository needs the token to have "Issues: read and write" on it, and the repository has to have Issues switched on.',
      );
    }
    if (response.status === 410) {
      throw new Error('Issues are disabled on that repository.');
    }
    throw new Error(`GitHub answered ${response.status}. ${detail.slice(0, 160)}`);
  }

  return response.json() as Promise<T>;
}

export interface CommunityConfig {
  owner: string;
  repo: string;
}

/** The repository threads live in — the community one, or the sync one. */
async function target(): Promise<{ token: string; config: CommunityConfig } | undefined> {
  const settings = await getSettings();
  const { community, github } = settings;
  if (!community.enabled) return undefined;

  const owner = community.owner.trim() || github.owner.trim();
  const repo = community.repo.trim();
  const token = github.token.trim();
  if (!owner || !repo || !token) return undefined;

  return { token, config: { owner, repo } };
}

export interface CommunityData {
  /** Where threads live, for the "open on GitHub" link. */
  repo?: string;
  thread?: Thread;
  /** Why nothing can be shown, when nothing can. */
  reason?: string;
}

export async function readThreads(problemKey: string): Promise<CommunityData> {
  const found = await target();
  if (!found) {
    return { reason: 'Community solutions are off, or no repository is set in Settings.' };
  }

  const { token, config } = found;
  const repo = `${config.owner}/${config.repo}`;

  try {
    const search = await call<{ items?: unknown[] }>(
      `/search/issues?q=${encodeURIComponent(searchQuery(config.owner, config.repo, problemKey))}&per_page=5`,
      token,
    );

    const thread = (search.items ?? [])
      .map((item) => readThread(item as Record<string, unknown>))
      .find((entry): entry is Thread => entry?.problemKey === problemKey);

    if (!thread) return { repo };

    const comments = await call<unknown[]>(
      `/repos/${repo}/issues/${thread.number}/comments?per_page=50`,
      token,
    );

    return {
      repo,
      thread: {
        ...thread,
        posts: [
          ...thread.posts,
          ...comments
            .map((comment) => readPost(comment as Record<string, unknown>))
            .filter((post): post is NonNullable<typeof post> => post !== undefined),
        ],
      },
    };
  } catch (error) {
    return { repo, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Posts your solution to the problem's thread, opening it if it does not exist.
 *
 * Nothing is posted that you did not solve: the code comes from your own record
 * rather than from the caller, so a page cannot ask the worker to publish
 * something arbitrary under your account.
 */
export async function postSolution(problemId: string): Promise<CommunityData & { posted?: boolean }> {
  const found = await target();
  if (!found) return { reason: 'Community solutions are off, or no repository is set in Settings.' };

  const problem = await getProblem(problemId);
  if (!problem) return { reason: 'That problem is not in your library.' };

  const { token, config } = found;
  const repo = `${config.owner}/${config.repo}`;
  const body = buildPost({
    language: problem.language,
    code: problem.code,
    note: problem.note,
    complexity: problem.complexity,
  });

  try {
    const existing = await readThreads(problem.id);

    if (existing.thread) {
      await call(`/repos/${repo}/issues/${existing.thread.number}/comments`, token, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
    } else {
      await call(`/repos/${repo}/issues`, token, {
        method: 'POST',
        body: JSON.stringify({
          title: threadTitle(problem.id, problem.title),
          body: `${problem.url}\n\n${body}`,
        }),
      });
    }

    return { ...(await readThreads(problem.id)), posted: true };
  } catch (error) {
    return { repo, reason: error instanceof Error ? error.message : String(error) };
  }
}

import type { Settings } from './types.ts';

const API = 'https://api.github.com';

export type GithubConfig = Settings['github'];

export class GithubError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
  }
}

// Only the token is ever read, so anything carrying one will do — which is what
// lets the repository picker call the API before an owner/repo is chosen.
function headers(config: { token: string }): HeadersInit {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

/** GitHub's own explanation, when the body carries one. */
function apiMessage(body: string): string {
  try {
    const json = JSON.parse(body) as { message?: string; errors?: Array<{ message?: string }> };
    const detail = json.errors?.find((entry) => entry.message)?.message;
    return [json.message, detail].filter(Boolean).join(' — ').slice(0, 240);
  } catch {
    return body.slice(0, 200);
  }
}

/**
 * Turns a failed response into something the user can act on.
 *
 * A status code alone is ambiguous — 403 is returned for a missing permission,
 * for a spent rate limit and for an org that requires SAML authorisation, and
 * they need three different fixes. GitHub says which in the body, so the reason
 * is read rather than assumed, and quoted back verbatim.
 */
function describeFailure(response: Response, body: string): string {
  const reason = apiMessage(body);
  const quoted = reason ? ` GitHub said: "${reason}".` : '';

  switch (response.status) {
    case 401:
      return `GitHub rejected the token — it is invalid or expired. Generate a new one and paste it in Settings.${quoted}`;
    case 403: {
      if (response.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        const when = Number.isFinite(reset) && reset > 0
          ? new Date(reset * 1000).toLocaleTimeString()
          : 'shortly';
        return `GitHub's rate limit is spent; it resets around ${when}. The next sync will retry.`;
      }
      if (/saml|sso/i.test(reason)) {
        return `This organisation requires the token to be authorised for SSO. Open the token at github.com/settings/personal-access-tokens and authorise it for the organisation.${quoted}`;
      }
      return `GitHub denied the request. The usual cause is a fine-grained token without "Contents: read and write" on this repository — check it at github.com/settings/personal-access-tokens.${quoted}`;
    }
    case 404:
      return `GitHub cannot see that repository — either the owner/repo is wrong, or the fine-grained token does not list it under "Repository access". A token that omits a repository gets 404, not 403.${quoted}`;
    case 409:
      return 'The branch moved while committing. The next sync will retry.';
    case 422:
      return `GitHub rejected the commit.${quoted || ` ${body.slice(0, 200)}`}`;
    default:
      return `GitHub request failed (${response.status}).${quoted || ` ${body.slice(0, 200)}`}`;
  }
}

async function request(path: string, config: { token: string }, init: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, { ...init, headers: headers(config) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new GithubError(describeFailure(response, body), response.status);
  }
  return response.json();
}

export interface RepoInfo {
  login: string;
  fullName: string;
  defaultBranch: string;
  canPush: boolean;
  /** False when the configured branch does not exist on the remote. */
  branchExists: boolean;
}

/** Used by the options page to validate credentials before the first solve. */
export async function verifyAccess(config: GithubConfig): Promise<RepoInfo> {
  const user = (await request('/user', config)) as { login: string };
  const repo = (await request(
    `/repos/${config.owner}/${config.repo}`,
    config,
  )) as { full_name: string; default_branch: string; permissions?: { push?: boolean } };

  // A branch that does not exist is a 422 at commit time and nothing before it,
  // which is a long way to travel to learn that "master" was typed as "main".
  const branch = config.branch || repo.default_branch;
  const branchResponse = await fetch(
    `${API}/repos/${config.owner}/${config.repo}/branches/${encodeURIComponent(branch)}`,
    { headers: headers(config) },
  );

  return {
    login: user.login,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    canPush: repo.permissions?.push ?? false,
    branchExists: branchResponse.ok,
  };
}

export interface RepoChoice {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  /** False for a repository you can read but not commit to. */
  canPush: boolean;
  /** Newest first, so the repository you are actually working in is at the top. */
  pushedAt: number;
}

/** GitHub's `/user/repos` rows, kept to the fields the picker shows. */
export function readRepos(rows: unknown): RepoChoice[] {
  if (!Array.isArray(rows)) return [];
  const repos: RepoChoice[] = [];

  for (const row of rows as Array<Record<string, unknown>>) {
    const fullName = typeof row.full_name === 'string' ? row.full_name : '';
    const [owner, name] = fullName.split('/');
    if (!owner || !name) continue;

    const permissions = row.permissions as { push?: boolean } | undefined;
    repos.push({
      owner,
      name,
      fullName,
      defaultBranch: typeof row.default_branch === 'string' ? row.default_branch : 'main',
      private: row.private === true,
      // A repository the token can only read is listed but marked, rather than
      // hidden: "my repo is missing" is a worse puzzle than "my repo is greyed
      // out because this token cannot write to it".
      canPush: permissions?.push === true,
      pushedAt: Date.parse(typeof row.pushed_at === 'string' ? row.pushed_at : '') || 0,
    });
  }

  return repos.sort((a, b) => b.pushedAt - a.pushedAt);
}

/**
 * Every repository this token can reach.
 *
 * Paged rather than one call: `per_page` tops out at 100, and somebody with a
 * few hundred repositories would otherwise get a silently truncated list and no
 * way to tell that the one they wanted was cut off. Capped all the same, since
 * a picker is not a place to load two thousand rows.
 */
export async function listRepos(token: string): Promise<RepoChoice[]> {
  const all: RepoChoice[] = [];

  for (let page = 1; page <= 5; page += 1) {
    const rows = (await request(
      `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
      { token },
    )) as unknown[];

    all.push(...readRepos(rows));
    if (!Array.isArray(rows) || rows.length < 100) break;
  }

  return all;
}

/** The branch names on one repository, default branch first. */
export async function listBranches(
  token: string,
  owner: string,
  repo: string,
  defaultBranch?: string,
): Promise<string[]> {
  const rows = (await request(
    `/repos/${owner}/${repo}/branches?per_page=100`,
    { token },
  )) as Array<{ name?: string }>;

  const names = rows.map((row) => row.name).filter((name): name is string => Boolean(name));
  if (!defaultBranch) return names;

  // The default branch first, because it is what all but a few people want.
  return [defaultBranch, ...names.filter((name) => name !== defaultBranch)];
}

/** UTF-8 safe base64 decode, for reading file contents back out of the API. */
export function fromBase64(encoded: string): string {
  const binary = atob(encoded.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Returns the file's decoded text, or undefined when it does not exist. */
export async function getFileContent(
  config: GithubConfig,
  path: string,
): Promise<string | undefined> {
  const url = `${API}/repos/${config.owner}/${config.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(config.branch)}`;
  const response = await fetch(url, { headers: headers(config) });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new GithubError(describeFailure(response, body), response.status);
  }
  const json = (await response.json()) as { content?: string; encoding?: string };
  if (!json.content || json.encoding !== 'base64') return undefined;
  return fromBase64(json.content);
}

export interface CommitResult {
  path: string;
  commitUrl: string;
}

export interface FileChange {
  path: string;
  content: string;
}

/**
 * Commits a set of files as one commit, through the Git Data API.
 *
 * The Contents API cannot do this. It writes one file per request, and each
 * write needs the file's current blob sha — which is read back through a GET
 * that is served from a cache lagging behind writes to the same branch. Writing
 * five files in a row therefore read a stale sha for the second one onwards,
 * the PUT came back 409, and retrying re-read the *same* stale value, so every
 * attempt failed identically. That is what "the branch kept moving" was really
 * reporting.
 *
 * Building a tree on top of the branch's current commit needs no per-file shas
 * at all, and produces one commit per solve instead of five.
 */
export async function commitFiles(
  config: GithubConfig,
  files: FileChange[],
  message: string,
): Promise<CommitResult> {
  if (files.length === 0) throw new GithubError('Nothing to commit.', 0);

  const repo = `/repos/${config.owner}/${config.repo}`;
  const ref = `heads/${config.branch}`;

  const attempt = async (): Promise<CommitResult> => {
    // A repository with no commits has no ref to read; that is the one case
    // where the new commit has no parent and the branch has to be created.
    const head = await readRef(repo, ref, config);

    const baseTree = head
      ? ((await request(`${repo}/git/commits/${head}`, config)) as { tree: { sha: string } }).tree
          .sha
      : undefined;

    const tree = (await request(`${repo}/git/trees`, config, {
      method: 'POST',
      body: JSON.stringify({
        ...(baseTree ? { base_tree: baseTree } : {}),
        tree: files.map((file) => ({
          path: file.path,
          mode: '100644',
          type: 'blob',
          content: file.content,
        })),
      }),
    })) as { sha: string };

    // Identical content produces the identical tree, and committing that would
    // add an empty commit to someone's repository on every re-sync. The URL is
    // built rather than fetched — a round trip to learn a string we can spell
    // ourselves is not worth making.
    if (baseTree && tree.sha === baseTree) {
      return {
        path: files[0]?.path ?? '',
        commitUrl: `https://github.com/${config.owner}/${config.repo}/commit/${head}`,
      };
    }

    const commit = (await request(`${repo}/git/commits`, config, {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: tree.sha,
        parents: head ? [head] : [],
      }),
    })) as { sha: string; html_url?: string };

    if (head) {
      await request(`${repo}/git/refs/${ref}`, config, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha }),
      });
    } else {
      await request(`${repo}/git/refs`, config, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/${ref}`, sha: commit.sha }),
      });
    }

    return { path: files[0]?.path ?? '', commitUrl: commit.html_url ?? '' };
  };

  // Here a conflict really does mean the branch moved under us — someone else
  // pushed — and rebuilding on the new head is the correct answer.
  const delays = [500, 1500, 3000];
  for (let round = 0; ; round += 1) {
    try {
      return await attempt();
    } catch (error) {
      const moved =
        error instanceof GithubError && (error.status === 409 || error.status === 422);
      if (!moved || round >= delays.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[round]));
    }
  }
}

/** The branch's current commit sha, or undefined when the branch is empty. */
async function readRef(
  repo: string,
  ref: string,
  config: GithubConfig,
): Promise<string | undefined> {
  const response = await fetch(`${API}${repo}/git/ref/${ref}`, { headers: headers(config) });
  // 404 here is a repository with no commits yet, or a branch that does not
  // exist — both mean "start from nothing", not "fail".
  if (response.status === 404 || response.status === 409) return undefined;
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new GithubError(describeFailure(response, body), response.status);
  }
  const json = (await response.json()) as { object?: { sha?: string } };
  return json.object?.sha;
}

export function isConfigured(config: GithubConfig): boolean {
  return Boolean(config.enabled && config.token && config.owner && config.repo);
}

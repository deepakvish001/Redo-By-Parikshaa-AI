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

/** UTF-8 safe base64, since `btoa` alone throws on non-Latin-1 characters. */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function headers(config: GithubConfig): HeadersInit {
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

async function request(path: string, config: GithubConfig, init: RequestInit = {}) {
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

async function getExistingSha(
  path: string,
  config: GithubConfig,
): Promise<string | undefined> {
  const url = `${API}/repos/${config.owner}/${config.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(config.branch)}`;
  const response = await fetch(url, { headers: headers(config) });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new GithubError(describeFailure(response, body), response.status);
  }
  const json = (await response.json()) as { sha?: string };
  return json.sha;
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

/**
 * Creates or updates a single file. GitHub requires the current blob sha to
 * overwrite, and returns 409 when the branch moved between our read and write,
 * so a conflicting write is retried once with a fresh sha.
 */
export async function putFile(
  config: GithubConfig,
  path: string,
  content: string,
  message: string,
): Promise<CommitResult> {
  const commit = async (): Promise<CommitResult> => {
    const sha = await getExistingSha(path, config);
    const json = (await request(
      `/repos/${config.owner}/${config.repo}/contents/${encodeURI(path)}`,
      config,
      {
        method: 'PUT',
        body: JSON.stringify({
          message,
          content: toBase64(content),
          branch: config.branch,
          ...(sha ? { sha } : {}),
        }),
      },
    )) as { commit?: { html_url?: string } };

    return { path, commitUrl: json.commit?.html_url ?? '' };
  };

  // A 409 means someone else moved the branch between our read of the sha and
  // our write. Re-reading and writing again is the whole fix, so it is worth
  // several tries — the previous single retry gave up and then claimed "the
  // next sync will retry", which nothing did.
  const delays = [600, 1500, 3000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await commit();
    } catch (error) {
      const conflict = error instanceof GithubError && error.status === 409;
      if (!conflict) throw error;
      if (attempt >= delays.length) {
        throw new GithubError(
          `The branch kept moving while committing ${path}; gave up after ${
            delays.length + 1
          } tries. Use "Retry these" to try again.`,
          409,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

export function isConfigured(config: GithubConfig): boolean {
  return Boolean(config.enabled && config.token && config.owner && config.repo);
}

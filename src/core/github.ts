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

function describeFailure(status: number, body: string): string {
  switch (status) {
    case 401:
      return 'GitHub rejected the token. Generate a new one and paste it in Options.';
    case 403:
      return 'GitHub denied the request — the token is missing "Contents: read and write" for this repository.';
    case 404:
      return 'Repository not found. Check the owner/repo, and that the token can see it.';
    case 409:
      return 'The branch moved while committing. The next sync will retry.';
    case 422:
      return `GitHub rejected the commit: ${body.slice(0, 200)}`;
    default:
      return `GitHub request failed (${status}): ${body.slice(0, 200)}`;
  }
}

async function request(path: string, config: GithubConfig, init: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, { ...init, headers: headers(config) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new GithubError(describeFailure(response.status, body), response.status);
  }
  return response.json();
}

export interface RepoInfo {
  login: string;
  fullName: string;
  defaultBranch: string;
  canPush: boolean;
}

/** Used by the options page to validate credentials before the first solve. */
export async function verifyAccess(config: GithubConfig): Promise<RepoInfo> {
  const user = (await request('/user', config)) as { login: string };
  const repo = (await request(
    `/repos/${config.owner}/${config.repo}`,
    config,
  )) as { full_name: string; default_branch: string; permissions?: { push?: boolean } };

  return {
    login: user.login,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    canPush: repo.permissions?.push ?? false,
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
    throw new GithubError(describeFailure(response.status, body), response.status);
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
    throw new GithubError(describeFailure(response.status, body), response.status);
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

  try {
    return await commit();
  } catch (error) {
    if (error instanceof GithubError && error.status === 409) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return commit();
    }
    throw error;
  }
}

export function isConfigured(config: GithubConfig): boolean {
  return Boolean(config.enabled && config.token && config.owner && config.repo);
}

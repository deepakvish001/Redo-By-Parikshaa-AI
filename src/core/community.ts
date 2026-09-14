/**
 * Solution threads, without a server.
 *
 * The reference set has "see how other people solved it" and "discuss it", both
 * of which normally mean a backend holding other people's writing. Redo's whole
 * privacy claim is that it has no backend, and adding one for this would change
 * what the product is.
 *
 * GitHub already runs the server. A repository's **issues** are a threaded,
 * moderated, searchable, publicly readable discussion board with an API, and
 * anybody can point Redo at one. So a problem's thread is an issue titled with
 * that problem's key, replies are comments, and the whole feature is a naming
 * convention plus two API calls.
 *
 * The consequences are stated rather than hidden: posting is public, under your
 * own GitHub account, in a repository you named. That is more honest than a
 * private backend nobody can audit, and it means the data outlives the
 * extension.
 */

/** `[redo] codeforces:1352A — Sum of Round Numbers` */
export const TITLE_PREFIX = '[redo]';

export function threadTitle(problemKey: string, problemTitle: string): string {
  return `${TITLE_PREFIX} ${problemKey} — ${problemTitle}`.slice(0, 240);
}

/**
 * The problem key out of a thread title.
 *
 * Matched on the prefix and the key, not on the title text: people rename
 * things, and a thread whose title was edited should still be that problem's
 * thread.
 */
export function keyFromTitle(title: string): string | undefined {
  // The key runs to the next space and no further. Stopping at a hyphen as
  // well — which the first version did, to avoid swallowing the em dash —
  // truncates every LeetCode slug: `leetcode:two-sum` came back as
  // `leetcode:two`.
  const match = /^\[redo\]\s+([a-z]+:\S+)/i.exec(title.trim());
  return match?.[1];
}

/** The search GitHub is asked, scoped to one repository and one problem. */
export function searchQuery(owner: string, repo: string, problemKey: string): string {
  return `repo:${owner}/${repo} is:issue in:title "${TITLE_PREFIX} ${problemKey}"`;
}

export interface ThreadPost {
  id: number;
  author: string;
  authorUrl: string;
  body: string;
  at: number;
  url: string;
}

export interface Thread {
  number: number;
  title: string;
  url: string;
  problemKey: string;
  author: string;
  comments: number;
  posts: ThreadPost[];
}

interface RawUser {
  login?: string;
  html_url?: string;
}

interface RawComment {
  id?: number;
  user?: RawUser;
  body?: string;
  created_at?: string;
  html_url?: string;
}

/** Shapes one issue comment, defensively — every field here is optional in the API. */
export function readPost(raw: RawComment): ThreadPost | undefined {
  const body = (raw.body ?? '').trim();
  if (!body) return undefined;

  return {
    id: raw.id ?? 0,
    author: raw.user?.login ?? 'unknown',
    authorUrl: raw.user?.html_url ?? '',
    body,
    at: raw.created_at ? Date.parse(raw.created_at) : 0,
    url: raw.html_url ?? '',
  };
}

interface RawIssue {
  number?: number;
  title?: string;
  html_url?: string;
  user?: RawUser;
  comments?: number;
  body?: string;
  created_at?: string;
}

export function readThread(raw: RawIssue): Thread | undefined {
  const number = raw.number;
  const title = raw.title ?? '';
  const problemKey = keyFromTitle(title);
  if (number === undefined || !problemKey) return undefined;

  // The issue body is the first post, so a thread of one is still a thread.
  const opening = readPost({
    id: 0,
    user: raw.user,
    body: raw.body,
    created_at: raw.created_at,
    html_url: raw.html_url,
  });

  return {
    number,
    title,
    url: raw.html_url ?? '',
    problemKey,
    author: raw.user?.login ?? 'unknown',
    comments: raw.comments ?? 0,
    posts: opening ? [opening] : [],
  };
}

/**
 * The body of a solution post.
 *
 * Fenced with the language so GitHub highlights it, and prefixed with the
 * approach if there is one — a wall of code with no sentence above it is the
 * least useful thing anybody can post.
 */
export function buildPost(options: {
  language: string;
  code: string;
  note?: string;
  complexity?: { time?: string; space?: string };
}): string {
  const parts: string[] = [];

  if (options.note?.trim()) parts.push(options.note.trim());

  const complexity = [
    options.complexity?.time && `Time ${options.complexity.time}`,
    options.complexity?.space && `Space ${options.complexity.space}`,
  ].filter(Boolean);
  if (complexity.length > 0) parts.push(`**${complexity.join(' · ')}**`);

  // ```` rather than ```, so a solution that itself contains a fenced block
  // does not end the fence early.
  parts.push(`\`\`\`\`${fenceLanguage(options.language)}\n${options.code.replace(/\s+$/, '')}\n\`\`\`\``);
  parts.push('<sub>Posted with Redo</sub>');

  return parts.join('\n\n');
}

/** GitHub's highlighter name for a judge's language label. */
export function fenceLanguage(language: string): string {
  const name = language.toLowerCase();
  if (/g\+\+|c\+\+|clang\+\+|cpp/.test(name)) return 'cpp';
  if (/python|pypy/.test(name)) return 'python';
  if (/javascript|node/.test(name)) return 'javascript';
  if (/typescript/.test(name)) return 'typescript';
  if (/kotlin/.test(name)) return 'kotlin';
  if (/java/.test(name)) return 'java';
  if (/rust/.test(name)) return 'rust';
  if (/\bgo\b|golang/.test(name)) return 'go';
  if (/c#|csharp/.test(name)) return 'csharp';
  if (/ruby/.test(name)) return 'ruby';
  // `\bc\b` does not match "gnu c11", which is what Codeforces calls C.
  if (/(^|\s)c\d*(\s|$)|gcc/.test(name)) return 'c';
  return '';
}

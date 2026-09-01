import type { SolvedProblem } from './types.ts';
import { extensionForLanguage, problemDirectory } from './paths.ts';

/**
 * Handing a solve to an editor on the same machine.
 *
 * The reference set asks for "submit from VS Code", which is the wrong half of
 * the problem to solve in a browser extension: an extension cannot open your
 * editor, and a VS Code plugin cannot see your Codeforces session. What it
 * *can* do is the useful half — when a solve is accepted, push it out to
 * whatever is listening on a local port, so the file lands in the project you
 * are actually working in.
 *
 * Which means this is a protocol, not an integration, and it is defined here in
 * one small shape that anybody can implement in twenty lines: a VS Code
 * extension, a Neovim plugin, a shell script with `nc`. Redo does not ship the
 * other end and does not pretend to.
 *
 * Nothing is sent unless you switch it on, and the permission for localhost is
 * *optional* in the manifest — Chrome asks for it the moment you enable this
 * and never before, so an install that does not use it never carries it.
 */

/** The port the reference listener uses. Anything is allowed. */
export const DEFAULT_PORT = 7777;

/**
 * The message posted on each accepted solve.
 *
 * Versioned from the first release: a listener written today should be able to
 * tell a payload it understands from one it does not, rather than guessing.
 */
export interface BridgePayload {
  redo: 1;
  /** `<platform>:<slug>`. */
  id: string;
  platform: string;
  title: string;
  url: string;
  difficulty: string;
  tags: string[];
  language: string;
  /** File extension for the language, so a listener need not map it again. */
  extension: string;
  /** Path this solve would take in the GitHub repository, as a suggestion. */
  path: string;
  code: string;
  note?: string;
  attempts: number;
  solvedAt: number;
}

export function buildPayload(problem: SolvedProblem): BridgePayload {
  const extension = extensionForLanguage(problem.language);

  return {
    redo: 1,
    id: problem.id,
    platform: problem.platform,
    title: problem.title,
    url: problem.url,
    difficulty: problem.difficulty,
    tags: problem.tags,
    language: problem.language,
    extension,
    path: `${problemDirectory(problem)}/solution.${extension}`,
    code: problem.code,
    note: problem.note?.trim() || undefined,
    attempts: problem.attempts,
    solvedAt: problem.solvedAt,
  };
}

/**
 * The address, from a port number.
 *
 * `127.0.0.1` rather than `localhost`, deliberately: `localhost` can resolve to
 * `::1`, a listener bound only to IPv4 is then unreachable, and the failure
 * looks like "the bridge does not work" rather than "wrong address family".
 */
export function bridgeUrl(port: number): string {
  return `http://127.0.0.1:${port}/redo`;
}

/** The origin Chrome must be asked to allow, for the optional permission. */
export function bridgeOrigin(port: number): string {
  return `http://127.0.0.1:${port}/*`;
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 1024 && port < 65_536;
}

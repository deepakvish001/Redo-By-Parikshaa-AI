import type { AdapterContext, PlatformAdapter } from './types.ts';

const PROGRAMMING_PRACTICE_PATH =
  /^\/practice\/(?:algorithms|data-structures|basic-programming|maths)(?:\/|$)/;
const PROBLEM_PATH =
  /^\/practice\/(?:algorithms|data-structures|basic-programming|maths)\/(?:[^/]+\/)*practice-problems\/(?:algorithm|data-structure)\/([^/?#]+)\/?$/;
const COMMUNITY_ALGORITHM_PATH = /^\/community\/problem\/algorithm\/([^/?#]+)\/?$/;

/**
 * Only public programming practice pages are in scope. Endpoint observation
 * is intentionally deferred until sanitised fixture evidence exists.
 */
export class HackerEarthAdapter implements PlatformAdapter {
  readonly platform = 'hackerearth' as const;

  matches(url: URL): boolean {
    return (
      url.hostname === 'www.hackerearth.com' &&
      (PROGRAMMING_PRACTICE_PATH.test(url.pathname) || COMMUNITY_ALGORITHM_PATH.test(url.pathname))
    );
  }

  currentSlug(url: URL): string | null {
    if (!this.matches(url)) return null;
    return PROBLEM_PATH.exec(url.pathname)?.[1] ?? COMMUNITY_ALGORITHM_PATH.exec(url.pathname)?.[1] ?? null;
  }

  start(_context: AdapterContext): () => void {
    return () => {};
  }
}

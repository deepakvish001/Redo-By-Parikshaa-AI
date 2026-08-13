import type { AdapterContext, PlatformAdapter } from './types.ts';

const PROBLEMSET_PATH = /^\/problemset\//;
const TASK_PATH = /^\/problemset\/(?:task|submit)\/(\d+)\/?$/;

/**
 * CSES support starts with the public Problem Set only. Submission capture is
 * deliberately deferred until the native form and final-result fixtures have
 * been recorded and sanitised.
 */
export class CsesAdapter implements PlatformAdapter {
  readonly platform = 'cses' as const;

  matches(url: URL): boolean {
    return url.hostname === 'cses.fi' && PROBLEMSET_PATH.test(url.pathname);
  }

  currentSlug(url: URL): string | null {
    if (!this.matches(url)) return null;
    return TASK_PATH.exec(url.pathname)?.[1] ?? null;
  }

  start(_context: AdapterContext): () => void {
    return () => {};
  }
}

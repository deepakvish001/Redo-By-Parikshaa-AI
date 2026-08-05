import { OBSERVER_CHANNEL, type ObservedExchange } from './observed.ts';

/** Subscribes to the MAIN-world observer. Returns a teardown function. */
export function onExchange(handler: (exchange: ObservedExchange) => void): () => void {
  const listener = (event: MessageEvent<ObservedExchange>) => {
    if (event.source !== window) return;
    if (event.data?.channel !== OBSERVER_CHANNEL) return;
    handler(event.data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/** Parses a body that may not be JSON at all, without throwing. */
export function parseJson<T = Record<string, unknown>>(body: string | undefined): T | undefined {
  if (!body) return undefined;
  try {
    return JSON.parse(body) as T;
  } catch {
    return undefined;
  }
}

/**
 * Reads a nested value by path, e.g. `pick(json, 'model', 'status')`.
 *
 * The judges' payload shapes are not documented and do shift between versions,
 * so adapters probe a few likely shapes rather than assuming one.
 */
export function pick(source: unknown, ...path: string[]): unknown {
  let current = source;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** First non-empty string found at any of the given paths. */
export function firstString(source: unknown, paths: string[][]): string | undefined {
  for (const path of paths) {
    const value = pick(source, ...path);
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

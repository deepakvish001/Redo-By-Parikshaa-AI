import { CodeforcesAdapter } from './codeforces.ts';
import { LeetCodeAdapter } from './leetcode.ts';
import type { PlatformAdapter } from './types.ts';

export const adapters: PlatformAdapter[] = [new LeetCodeAdapter(), new CodeforcesAdapter()];

export function adapterFor(url: URL): PlatformAdapter | undefined {
  return adapters.find((adapter) => adapter.matches(url));
}

export type { PlatformAdapter, AdapterContext } from './types.ts';

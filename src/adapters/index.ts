import { AtCoderAdapter } from './atcoder.ts';
import { CodeChefAdapter } from './codechef.ts';
import { CodeforcesAdapter } from './codeforces.ts';
import { CsesAdapter } from './cses.ts';
import { GeeksforGeeksAdapter } from './geeksforgeeks.ts';
import { HackerEarthAdapter } from './hackerearth.ts';
import { HackerRankAdapter } from './hackerrank.ts';
import { LeetCodeAdapter } from './leetcode.ts';
import type { PlatformAdapter } from './types.ts';

export const adapters: PlatformAdapter[] = [
  new LeetCodeAdapter(),
  new CodeforcesAdapter(),
  new AtCoderAdapter(),
  new CodeChefAdapter(),
  new HackerRankAdapter(),
  new GeeksforGeeksAdapter(),
  new CsesAdapter(),
  new HackerEarthAdapter(),
];

export function adapterFor(url: URL): PlatformAdapter | undefined {
  return adapters.find((adapter) => adapter.matches(url));
}

export type { PlatformAdapter, AdapterContext } from './types.ts';

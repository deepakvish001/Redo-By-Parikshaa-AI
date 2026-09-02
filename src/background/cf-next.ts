import {
  findEditorial,
  readMaterials,
  similarProblems,
  type Material,
  type Similar,
} from '../core/cf-materials.ts';
import { cfState } from './cf-state.ts';

/**
 * The two things the rail offers around a problem: a way out when you are
 * beaten, and a way on when you are not.
 *
 * The editorial is read from the contest page's "Contest materials" box, which
 * is the only place Codeforces publishes it — there is no API method for it.
 * That page is fetched once per contest and cached indefinitely: a round's
 * editorial does not change, and a request per problem view would burn the
 * rate limit for something that is the same answer every time.
 */

const CACHE_KEY = 'cfMaterials';

type MaterialCache = Record<string, { at: number; editorial?: Material }>;

async function cache(): Promise<MaterialCache> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  return (stored[CACHE_KEY] as MaterialCache | undefined) ?? {};
}

/**
 * The editorial for a contest, or nothing.
 *
 * A miss is cached too. A round whose editorial is not out yet is the common
 * case for the problems people are actually looking at, and re-fetching the
 * contest page on every view of every problem in it would be the worst possible
 * use of one request every two seconds. It re-checks after a day.
 */
export async function editorialFor(contestId: string): Promise<Material | undefined> {
  const store = await cache();
  const hit = store[contestId];
  const DAY = 86_400_000;
  if (hit && (hit.editorial || Date.now() - hit.at < DAY)) return hit.editorial;

  try {
    const response = await fetch(`https://codeforces.com/contest/${contestId}`, {
      credentials: 'omit',
    });
    if (!response.ok) return hit?.editorial;

    // Text, not a parsed document: an MV3 service worker has no `DOMParser`.
    const editorial = findEditorial(readMaterials(await response.text()));
    store[contestId] = { at: Date.now(), editorial };
    await chrome.storage.local.set({ [CACHE_KEY]: store });
    return editorial;
  } catch {
    return hit?.editorial;
  }
}

/** Three unsolved problems sharing a tag and a rating band with this one. */
export async function similarTo(key: string): Promise<Similar[]> {
  const state = await cfState();
  if (!state.ok) return [];

  const current = state.problemset[key.toUpperCase()];
  if (!current) return [];

  return similarProblems(
    { key: key.toUpperCase(), rating: current.rating, tags: current.tags },
    state.candidates.map((candidate) => ({
      key: candidate.key,
      name: candidate.name,
      rating: candidate.rating,
      tags: candidate.tags,
    })),
    state.solved,
  );
}

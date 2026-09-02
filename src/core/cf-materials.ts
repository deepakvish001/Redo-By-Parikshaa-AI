/**
 * Finding a round's editorial, and three problems to do next.
 *
 * Two things you reach for at opposite ends of a problem: the editorial when
 * you are beaten, and something similar when you have just finished one and
 * want another like it. Both are a search away today, and a search away is far
 * enough that most people do neither.
 *
 * **There is no API for the editorial.** Codeforces links it from the contest
 * page as "Contest materials" and nowhere else, so it is read out of that
 * page's HTML — as text, because this runs in a service worker and an MV3
 * worker has no `DOMParser`.
 */

export interface Material {
  title: string;
  url: string;
}

const BLOG_LINK = /<a[^>]+href="(\/blog\/entry\/\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;

/** Editorials go by several names, and two of them are not in English. */
const EDITORIAL = /editorial|tutorial|разбор|analysis/i;

/**
 * The materials Codeforces lists for a contest.
 *
 * Scoped to the "Contest materials" box rather than the whole page: a contest
 * page is full of blog links — the announcement, comments, everybody's profile
 * — and taking them all would hand back a reading list instead of an editorial.
 */
export function readMaterials(html: string): Material[] {
  const start = /contest materials|материалы/i.exec(html);
  if (!start) return [];

  // To the end of that box. `</ul>` closes the list Codeforces puts them in;
  // failing that, a bounded window, so a markup change cannot swallow the page.
  const after = html.slice(start.index);
  const end = after.search(/<\/ul>/i);
  const box = after.slice(0, end === -1 ? 4000 : end);

  const materials: Material[] = [];
  for (const [, href, label] of box.matchAll(BLOG_LINK)) {
    const title = (label ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (!href || !title) continue;
    materials.push({ title, url: `https://codeforces.com${href}` });
  }

  return materials;
}

/**
 * The editorial, if one of the materials is one.
 *
 * A contest's materials also include the announcement, which is posted before
 * the round and gives nothing away — returning it as "the editorial" would send
 * somebody who is stuck to a page about the start time.
 */
export function findEditorial(materials: Material[]): Material | undefined {
  return materials.find((material) => EDITORIAL.test(material.title));
}

/* ------------------------------------------------------- something similar */

export interface SimilarCandidate {
  key: string;
  name: string;
  rating: number;
  tags: string[];
}

export interface Similar extends SimilarCandidate {
  /** The tags it has in common, which is why it is being offered. */
  shared: string[];
  url: string;
}

/**
 * Three unsolved problems like this one.
 *
 * Ranked by shared tags first and closeness in rating second. A problem two
 * hundred points away that shares three tags is a better answer than one at
 * exactly this rating that shares one — the point is more practice at the
 * *idea*, and the rating only has to be close enough to be worth attempting.
 *
 * Solved problems are excluded, and so is this one. Ties break on the key so
 * that opening the same problem twice offers the same three.
 */
export function similarProblems(
  current: { key: string; rating?: number; tags?: string[] },
  candidates: SimilarCandidate[],
  solved: ReadonlySet<string>,
  count = 3,
  spread = 300,
): Similar[] {
  const tags = new Set(current.tags ?? []);
  if (tags.size === 0 || !current.rating) return [];

  const scored: Array<{ problem: Similar; score: number; distance: number }> = [];

  for (const candidate of candidates) {
    if (candidate.key === current.key || solved.has(candidate.key)) continue;

    const distance = Math.abs(candidate.rating - current.rating);
    if (distance > spread) continue;

    const shared = candidate.tags.filter((tag) => tags.has(tag));
    if (shared.length === 0) continue;

    scored.push({
      problem: { ...candidate, shared, url: problemUrl(candidate.key) },
      score: shared.length,
      distance,
    });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.distance - b.distance ||
      a.problem.key.localeCompare(b.problem.key),
  );

  return scored.slice(0, count).map((entry) => entry.problem);
}

function problemUrl(key: string): string {
  const match = /^(\d+)([A-Za-z]\d*)$/.exec(key);
  return match
    ? `https://codeforces.com/contest/${match[1]}/problem/${match[2]}`
    : `https://codeforces.com/problemset?search=${encodeURIComponent(key)}`;
}

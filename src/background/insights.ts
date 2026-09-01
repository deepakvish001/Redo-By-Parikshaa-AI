import {
  bandOutcomes,
  heatmap,
  heatmapYears,
  ratingHistogram,
  tagCounts,
  worstBands,
  worstTags,
  type BandOutcome,
  type Bin,
  type HeatDay,
  type TagCount,
} from '../core/insights.ts';
import { getProblemList, getSettings } from '../core/storage.ts';
import { ensureProblemset, ensureUserStatus } from './cf-mirror.ts';

/**
 * The Insights tab, assembled from the mirror.
 *
 * Everything is shaped here rather than in the panel for one reason: the same
 * numbers are drawn twice, once in the side panel and once injected under the
 * Codeforces profile header. Shaping them in one place is what keeps the two
 * from quietly disagreeing.
 */

export interface InsightsData {
  histogram: Bin[];
  tags: TagCount[];
  weakTags: TagCount[];
  bands: BandOutcome[];
  weakBands: BandOutcome[];
  /** Day → what happened on it. An object because a Map does not survive
   *  `chrome.runtime.sendMessage`, which serialises as JSON. */
  heat: Record<string, HeatDay>;
  years: number[];
  unsolved: Array<{ key: string; name: string; rating?: number; tags: string[] }>;
  solvedCount: number;
  /** Why there is nothing to draw, when there is nothing to draw. */
  reason?: string;
}

const EMPTY: Omit<InsightsData, 'reason'> = {
  histogram: [],
  tags: [],
  weakTags: [],
  bands: [],
  weakBands: [],
  heat: {},
  years: [],
  unsolved: [],
  solvedCount: 0,
};

export async function buildInsights(): Promise<InsightsData> {
  const settings = await getSettings();
  const handle = settings.handles.codeforces.trim();

  if (!handle) {
    return {
      ...EMPTY,
      reason: 'Add your Codeforces handle in Settings to see your history charted.',
    };
  }

  const [problemset, status, problems] = await Promise.all([
    ensureProblemset().catch(() => undefined),
    ensureUserStatus(handle).catch(() => undefined),
    getProblemList(),
  ]);

  if (!problemset || !status) {
    return { ...EMPTY, reason: 'Codeforces could not be reached, so there is nothing to chart yet.' };
  }

  // Redo's own records again, so anything solved before the mirror existed is
  // on the charts rather than missing from them.
  const solved = new Set(status.solved);
  for (const problem of problems) {
    if (problem.platform === 'codeforces') solved.add(problem.slug.toUpperCase());
  }
  const attempted = status.attempted.filter((key) => !solved.has(key));

  const tags = tagCounts(solved, attempted, problemset.problems);
  const bands = bandOutcomes(solved, attempted, problemset.problems);
  const days = heatmap(status.solvedAt ?? [], problemset.problems);

  return {
    histogram: ratingHistogram(solved, problemset.problems),
    tags,
    weakTags: worstTags(tags),
    bands,
    weakBands: worstBands(bands),
    heat: Object.fromEntries(days),
    years: heatmapYears(status.solvedAt ?? []),
    // Hardest first: the ones worth going back for are the ones that beat you.
    unsolved: attempted
      .map((key) => ({ key, ...(problemset.problems[key] ?? { name: key, tags: [] }) }))
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, 60),
    solvedCount: solved.size,
    reason:
      solved.size === 0
        ? 'Nothing solved on this handle yet — the charts fill in as you go.'
        : undefined,
  };
}

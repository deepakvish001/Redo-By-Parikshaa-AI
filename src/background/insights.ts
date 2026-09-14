import {
  bandOutcomes,
  heatmap,
  heatmapYears,
  ratingHistogram,
  tagCounts,
  within,
  worstBands,
  worstTags,
  type BandOutcome,
  type Bin,
  type HeatDay,
  type TagCount,
  type Window,
} from '../core/insights.ts';
import { cfState } from './cf-state.ts';

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
  /** The window these charts were drawn for, echoed back so the UI can say so. */
  days?: number;
  /** Solved inside the window, which is not the same as solved overall. */
  windowCount: number;
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
  windowCount: 0,
};

/**
 * @param days How far back the counting charts look. `undefined` is all time.
 *   The heatmap and the unsolved list ignore it on purpose: the heatmap has a
 *   year selector of its own, and a problem you gave up on in 2023 is still
 *   unsolved today.
 */
export async function buildInsights(days?: Window): Promise<InsightsData> {
  const state = await cfState();
  if (!state.ok) return { ...EMPTY, reason: state.reason, days };

  const { problemset, solvedAt, attemptedAt } = state;
  const now = Date.now();

  const solved = within(state.solved, new Map(solvedAt), days, now);
  const attempted = within(state.attempted, new Map(attemptedAt), days, now);

  const tags = tagCounts(solved, attempted, problemset);
  const bands = bandOutcomes(solved, attempted, problemset);
  const heat = heatmap(solvedAt, problemset);

  return {
    days,
    windowCount: solved.size,
    histogram: ratingHistogram(solved, problemset),
    tags,
    weakTags: worstTags(tags),
    bands,
    weakBands: worstBands(bands),
    heat: Object.fromEntries(heat),
    years: heatmapYears(solvedAt),
    // Hardest first: the ones worth going back for are the ones that beat you.
    unsolved: [...state.attempted]
      .map((key) => ({ key, ...(problemset[key] ?? { name: key, tags: [] }) }))
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, 60),
    solvedCount: state.solved.size,
    reason:
      state.solved.size === 0
        ? 'Nothing solved on this handle yet — the charts fill in as you go.'
        : solved.size === 0
          ? 'Nothing solved in this window. Try a longer one.'
          : undefined,
  };
}

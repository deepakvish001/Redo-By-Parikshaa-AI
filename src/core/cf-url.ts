/**
 * Which problem a Codeforces URL is pointing at.
 *
 * Codeforces spells the same problem three ways — `/contest/1352/problem/A`,
 * `/problemset/problem/1352/A` and `/gym/102253/problem/A` — and every feature
 * that reacts to a problem page needs all three. Kept here rather than in any
 * one of them because the sidebar card, the workspace and the adapters all
 * parse the same addresses, and three copies of this regex would drift.
 */

const PROBLEM_PATH =
  /\/(contest|gym)\/(\d+)\/problem\/([A-Za-z0-9]+)|\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/;

export interface CfProblemRef {
  contestId: string;
  /** Upper-cased, because `E2` and `e2` are the same problem. */
  index: string;
  /** Gym problems submit and list through a different path. */
  gym: boolean;
}

/**
 * Whether the workspace should open by itself on this page.
 *
 * All three switches have to agree, and it has to be a problem page — the
 * workspace has nothing to show on a listing or a profile, and injecting a
 * two-hundred-kilobyte editor there would be pure waste.
 */
export function shouldAutoOpenWorkspace(
  page: { enabled: boolean; workspace: boolean; workspaceAuto: boolean },
  pathname: string,
): boolean {
  return (
    page.enabled && page.workspace && page.workspaceAuto && parseProblem(pathname) !== null
  );
}

export function parseProblem(pathname: string): CfProblemRef | null {
  const match = PROBLEM_PATH.exec(pathname);
  if (!match) return null;

  const contestId = match[2] ?? match[4];
  const index = match[3] ?? match[5];
  if (!contestId || !index) return null;

  return { contestId, index: index.toUpperCase(), gym: match[1] === 'gym' };
}

import { computeStats } from '../core/analytics.ts';
import { INDEX_MARKERS } from '../core/brand.ts';
import { commitFiles, getFileContent, isConfigured } from '../core/github.ts';
import { buildIndexReadme, buildProblemReadme } from '../core/markdown.ts';
import { notesPath, solutionPath } from '../core/paths.ts';
import { buildProfileReadme, buildProfileSvg } from '../core/profile.ts';
import { getProblemList } from '../core/storage.ts';
import { buildWrappedSvg, summariseWeek } from '../core/wrapped.ts';
import type { GithubSyncState, Settings, SolvedProblem } from '../core/types.ts';

/**
 * Commits run one at a time. Two solves finishing together would otherwise
 * build their trees on the same parent, and the second would have to be redone
 * against the first — serialising is cheaper than resolving that.
 */
let queue: Promise<unknown> = Promise.resolve();

export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}

function commitMessage(template: string, problem: SolvedProblem): string {
  return template
    .replaceAll('{title}', problem.title)
    .replaceAll('{platform}', problem.platform)
    .replaceAll('{id}', problem.problemId)
    .replaceAll('{difficulty}', problem.difficulty);
}

/**
 * Picks where the solved-problems index goes.
 *
 * Overwriting a repository's existing README would be destructive, so the
 * index only claims `README.md` when the file is absent or was written by this
 * extension before; otherwise it lives beside it in `SOLUTIONS.md`.
 */
async function resolveIndexPath(settings: Settings['github']): Promise<string> {
  try {
    const existing = await getFileContent(settings, 'README.md');
    if (existing === undefined || INDEX_MARKERS.some((marker) => existing.includes(marker))) {
      return 'README.md';
    }
    return 'SOLUTIONS.md';
  } catch {
    return 'SOLUTIONS.md';
  }
}

export async function syncProblem(
  problem: SolvedProblem,
  settings: Settings,
): Promise<GithubSyncState> {
  const config = settings.github;
  if (!isConfigured(config)) {
    return { status: 'disabled' };
  }

  return enqueue(async () => {
    const path = solutionPath(problem);
    try {
      // The index is rebuilt from local state, with this problem's path already
      // in place so it appears in the table on the very first sync.
      const all = await getProblemList();
      const withCurrent = all.map((candidate) =>
        candidate.id === problem.id
          ? { ...candidate, github: { ...candidate.github, path } }
          : candidate,
      );
      if (!withCurrent.some((candidate) => candidate.id === problem.id)) {
        withCurrent.push({ ...problem, github: { ...problem.github, path } });
      }

      const now = Date.now();
      const indexPath = await resolveIndexPath(config);
      // The profile and the week's card are views over the same local state, so
      // they are rebuilt from scratch rather than patched.
      const stats = computeStats(withCurrent, settings.revision.intervals, now);
      const recap = summariseWeek(withCurrent, now, stats.currentStreak);

      // One commit, not five. Five separate writes meant four chances for the
      // Contents API's lagging sha cache to produce a conflict that no amount
      // of retrying could clear.
      const commit = await commitFiles(
        config,
        [
          { path, content: problem.code },
          { path: notesPath(problem), content: buildProblemReadme(problem) },
          { path: indexPath, content: buildIndexReadme(withCurrent, now) },
          { path: 'PROFILE.md', content: buildProfileReadme(withCurrent, stats, now) },
          { path: 'assets/profile.svg', content: buildProfileSvg(withCurrent, stats, now) },
          // Animated here because it is embedded in markdown rather than
          // rasterised, unlike the copy the panel exports.
          { path: 'assets/week.svg', content: buildWrappedSvg(recap, { animate: true }) },
        ],
        commitMessage(config.commitMessage, problem),
      );

      return {
        status: 'synced',
        path,
        commitUrl: commit.commitUrl,
        syncedAt: Date.now(),
      } satisfies GithubSyncState;
    } catch (error) {
      return {
        status: 'error',
        path,
        error: error instanceof Error ? error.message : String(error),
      } satisfies GithubSyncState;
    }
  });
}

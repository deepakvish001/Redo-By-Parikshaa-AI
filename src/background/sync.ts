import { computeStats } from '../core/analytics.ts';
import { INDEX_MARKERS } from '../core/brand.ts';
import { getFileContent, isConfigured, putFile } from '../core/github.ts';
import { buildIndexReadme, buildProblemReadme } from '../core/markdown.ts';
import { notesPath, solutionPath } from '../core/paths.ts';
import { buildProfileReadme, buildProfileSvg } from '../core/profile.ts';
import { getProblemList } from '../core/storage.ts';
import type { GithubSyncState, Settings, SolvedProblem } from '../core/types.ts';

/**
 * Commits run one at a time. Two commits racing on the same branch produce a
 * 409 from the Contents API, and serialising is cheaper than retrying.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
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
      const message = commitMessage(config.commitMessage, problem);
      const commit = await putFile(config, path, problem.code, message);
      await putFile(
        config,
        notesPath(problem),
        buildProblemReadme(problem),
        `docs: notes for ${problem.title}`,
      );

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

      const indexPath = await resolveIndexPath(config);
      const now = Date.now();
      await putFile(config, indexPath, buildIndexReadme(withCurrent, now), 'docs: update solved index');

      // The profile is a view over the same local state, so it is rebuilt from
      // scratch each time rather than patched.
      const stats = computeStats(withCurrent, settings.revision.intervals, now);
      await putFile(
        config,
        'assets/profile.svg',
        buildProfileSvg(withCurrent, stats, now),
        'docs: update profile card',
      );
      await putFile(
        config,
        'PROFILE.md',
        buildProfileReadme(withCurrent, stats, now),
        'docs: update coding profile',
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

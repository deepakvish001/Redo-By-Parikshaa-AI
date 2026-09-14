import type { GithubSyncState, ParikshaaSyncState, RevisionState, SolvedProblem } from './types.ts';

/**
 * Fills in the fields a stored record is supposed to have but might not.
 *
 * `SolvedProblem` declares `github`, `parikshaa` and `revision` as required,
 * and every code path that writes one does supply them — but the type only
 * governs what this build writes. Records also arrive from outside it: a backup
 * file restored from another machine, a repository synced from a build old
 * enough to predate a field, or a file somebody edited by hand. Those reach the
 * panel exactly as they are, and the panel reads `problem.github.status`
 * directly, so one missing object is a blank side panel rather than one row
 * that looks odd.
 *
 * Normalising on the way out of storage fixes it once, for every reader, and
 * keeps the UI free of six defensive `?.` that would each have to be
 * remembered again the next time somebody adds a field.
 */

const DEFAULT_GITHUB: GithubSyncState = { status: 'disabled' };
const DEFAULT_PARIKSHAA: ParikshaaSyncState = { status: 'disabled' };

function completeRevision(revision: Partial<RevisionState> | undefined, solvedAt: number): RevisionState {
  return {
    stage: typeof revision?.stage === 'number' ? revision.stage : 0,
    ease: typeof revision?.ease === 'number' ? revision.ease : 1,
    // A record with no due date is due now rather than never: a problem that
    // silently stops coming back is the one failure mode of a revision tool.
    dueAt: typeof revision?.dueAt === 'number' ? revision.dueAt : solvedAt,
    lastReviewedAt: revision?.lastReviewedAt,
    reviewCount: typeof revision?.reviewCount === 'number' ? revision.reviewCount : 0,
    lapses: typeof revision?.lapses === 'number' ? revision.lapses : 0,
    hintsUsed: typeof revision?.hintsUsed === 'number' ? revision.hintsUsed : 0,
    struggle: revision?.struggle,
    targetReviews: revision?.targetReviews,
  };
}

const REVISION_FIELDS = ['stage', 'ease', 'dueAt', 'reviewCount', 'lapses', 'hintsUsed'] as const;

function isComplete(problem: SolvedProblem): boolean {
  return (
    typeof problem.solvedAt === 'number' &&
    typeof problem.attempts === 'number' &&
    Array.isArray(problem.tags) &&
    Boolean(problem.github?.status) &&
    Boolean(problem.parikshaa?.status) &&
    Boolean(problem.revision) &&
    REVISION_FIELDS.every((field) => typeof problem.revision[field] === 'number')
  );
}

export function completeProblem(problem: SolvedProblem): SolvedProblem {
  // Returning the very same object when nothing is missing keeps the common
  // path free of a copy per problem on every read of the whole store — and
  // every read of the store goes through here.
  if (isComplete(problem)) return problem;

  const solvedAt = typeof problem.solvedAt === 'number' ? problem.solvedAt : Date.now();
  const github = problem.github?.status ? problem.github : DEFAULT_GITHUB;
  const parikshaa = problem.parikshaa?.status ? problem.parikshaa : DEFAULT_PARIKSHAA;
  const revision = completeRevision(problem.revision, solvedAt);

  return {
    ...problem,
    solvedAt,
    tags: Array.isArray(problem.tags) ? problem.tags : [],
    attempts: typeof problem.attempts === 'number' ? problem.attempts : 1,
    github,
    parikshaa,
    revision,
  };
}

export function completeProblems(
  problems: Record<string, SolvedProblem>,
): Record<string, SolvedProblem> {
  const out: Record<string, SolvedProblem> = {};
  for (const [id, problem] of Object.entries(problems)) {
    if (!problem || typeof problem !== 'object') continue;
    out[id] = completeProblem(problem);
  }
  return out;
}

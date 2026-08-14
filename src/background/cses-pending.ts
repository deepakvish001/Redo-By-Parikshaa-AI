import {
  claimCsesFinalResult as claimStoredCsesFinalResult,
  consumePendingCsesSubmission as consumeStoredPendingCsesSubmission,
  isValidCsesFinalResult,
  isValidPendingCsesSubmission,
  savePendingCsesSubmission,
} from '../core/storage.ts';
import type { CsesFinalResult, CsesFinalResultClaim, PendingCsesSubmission } from '../core/types.ts';

/** The worker boundary for source-bearing CSES capture messages. */
export async function storePendingCsesSubmission(pending: unknown): Promise<{ stored: true }> {
  if (!isValidPendingCsesSubmission(pending)) {
    throw new Error('CSES pending submission is malformed.');
  }
  await savePendingCsesSubmission(pending);
  return { stored: true };
}

/** The result-page boundary: one worker-owned read and clear operation. */
export async function consumePendingCsesSubmission(
  taskId: string,
): Promise<{ pending?: PendingCsesSubmission }> {
  if (!taskId.trim()) throw new Error('CSES pending submission task is malformed.');
  return { pending: await consumeStoredPendingCsesSubmission(taskId) };
}

/** Claims a final result and its state transition from the single worker. */
export async function claimCsesFinalResult(result: unknown): Promise<CsesFinalResultClaim> {
  if (!isValidCsesFinalResult(result)) throw new Error('CSES final result is malformed.');
  return claimStoredCsesFinalResult(result as CsesFinalResult);
}

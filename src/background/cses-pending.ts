import {
  consumePendingCsesSubmission as consumeStoredPendingCsesSubmission,
  isValidPendingCsesSubmission,
  savePendingCsesSubmission,
} from '../core/storage.ts';
import type { PendingCsesSubmission } from '../core/types.ts';

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

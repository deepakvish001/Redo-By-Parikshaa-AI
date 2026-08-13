import {
  isValidPendingCsesSubmission,
  savePendingCsesSubmission,
} from '../core/storage.ts';

/** The worker boundary for source-bearing CSES capture messages. */
export async function storePendingCsesSubmission(pending: unknown): Promise<{ stored: true }> {
  if (!isValidPendingCsesSubmission(pending)) {
    throw new Error('CSES pending submission is malformed.');
  }
  await savePendingCsesSubmission(pending);
  return { stored: true };
}

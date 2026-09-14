import type { Claim } from '../core/watermark.ts';
import type { AcceptedSubmission, AttemptEvent, Platform } from '../core/types.ts';

export interface AdapterContext {
  /** Called once per accepted submission the adapter manages to fully resolve. */
  onAccepted(submission: AcceptedSubmission): void;
  /** Called when a submission finished with a non-accepted verdict. */
  onAttempt(problemKey: string): void;
  /**
   * Called for every run and every submit, accepted or not. This is the record
   * of what the problem cost; `onAccepted` only ever sees the ending.
   */
  onEvent(slug: string, event: AttemptEvent): void;
  /** Surfaced to the user as a toast; adapters use it for recoverable failures. */
  onError(message: string): void;
  /** Surfaced as an ordinary toast — something worth knowing, not a failure. */
  onNotice(message: string): void;
  /**
   * Narrows a batch of finished submission ids to the ones that are new.
   *
   * Codeforces' `?my=on` and AtCoder's `/submissions/me` list every submission
   * the account has ever made, and an adapter looking at that page cannot tell
   * this morning's solve from one two years ago. The service worker keeps a
   * high-water mark per judge and answers that question; `watched` names the
   * ids this page saw still being judged, which are new by definition.
   */
  claim(ids: string[], watched: string[]): Promise<Claim>;
}

export interface PlatformAdapter {
  platform: Platform;
  matches(url: URL): boolean;
  /** Begins watching the page. Returns a teardown function. */
  start(context: AdapterContext): () => void;
  /**
   * Slug of the problem the current page is showing, or null if the page is
   * not a problem page. Used to decide whether to show a revision reminder.
   */
  currentSlug(url: URL): string | null;
}

/** Shared helper: parse HTML text into a document without executing scripts. */
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

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

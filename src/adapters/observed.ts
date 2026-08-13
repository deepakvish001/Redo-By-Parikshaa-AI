/**
 * URLs the MAIN-world observer relays to the isolated world.
 *
 * Every supported judge reports a verdict by having the page poll its own API,
 * so watching that traffic is the one detection route that works across all of
 * them. This list is shared by the observer and the adapters so the two can
 * never drift apart.
 *
 * Patterns are matched against the full request URL. Keep them narrow: the
 * observer relays request bodies, and a submission request body contains the
 * user's source code. HackerEarth is deliberately limited to its result poll;
 * its source-bearing `/submit/AJAX/` request must never be observed.
 */
export const HACKEREARTH_PUBLIC_PRACTICE_RESULT_URL =
  /^https:\/\/www\.hackerearth\.com\/response\/submission-json\/([^/?#]+)\/AJAX\/?(?:[?#]|$)/i;

const HACKEREARTH_PROGRAMMING_PRACTICE_PATH =
  /^\/practice\/(?:algorithms|data-structures|basic-programming|maths)(?:\/|$)/;
const HACKEREARTH_COMMUNITY_ALGORITHM_PATH =
  /^\/community\/problem\/algorithm\/[^/?#]+\/?$/;

export const OBSERVED_URLS: RegExp[] = [
  // LeetCode polls this until the judge finishes. The id is numeric for a
  // submit and `runcode_…` for a run, and the path picked up a `/v2/` segment
  // at some point without the payload changing shape.
  /\/submissions\/detail\/(?:\d+|runcode_[^/]+)\/(?:v\d+\/)?check\/?/,
  // HackerRank posts the submission, then polls the same path with an id.
  /hackerrank\.com\/rest\/.*\/submissions(\/\d+)?(\?|$)/i,
  // CodeChef's IDE submits and polls through its api/ide endpoints.
  /codechef\.com\/api\/ide\/(submit|status)/i,
  // GeeksforGeeks practice runs through a separate API host.
  /practiceapi\.geeksforgeeks\.org\/api\/.*(submission|submit)/i,
  /geeksforgeeks\.org\/api\/.*(submission|submit)/i,
  // Fixture-confirmed public-practice final-result poll. Do not add the
  // source-bearing `/submit/AJAX/` endpoint to this list.
  HACKEREARTH_PUBLIC_PRACTICE_RESULT_URL,
];

export function isObserved(url: string): boolean {
  return OBSERVED_URLS.some((pattern) => pattern.test(url));
}

/** Only these HackerEarth pages may receive public-practice result exchanges. */
export function isHackerEarthPublicPracticePage(href: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.hostname === 'www.hackerearth.com' &&
      (HACKEREARTH_PROGRAMMING_PRACTICE_PATH.test(url.pathname) ||
        HACKEREARTH_COMMUNITY_ALGORITHM_PATH.test(url.pathname))
    );
  } catch {
    return false;
  }
}

/**
 * HackerEarth's result endpoint is shared by public and excluded practice
 * pages, so endpoint matching alone cannot authorise source capture there.
 */
export function isObservedOnPage(url: string, pageHref: string): boolean {
  if (!isObserved(url)) return false;
  return !HACKEREARTH_PUBLIC_PRACTICE_RESULT_URL.test(url) || isHackerEarthPublicPracticePage(pageHref);
}

export const OBSERVER_CHANNEL = 'redo-observer';

/**
 * A request the observer saw but did not relay in full.
 *
 * Only the origin and path travel — never the query, never a body. It exists
 * so a user can tell us which endpoints their judge actually calls when
 * detection fails, without that turning into a traffic dump.
 */
export interface ObservedGlimpse {
  channel: typeof OBSERVER_CHANNEL;
  kind: 'seen';
  method: string;
  path: string;
  matched: boolean;
  at: number;
}

/**
 * The isolated world asking the MAIN world for the editor's contents.
 *
 * Only the page's own world can reach Monaco or Ace, and a verdict noticed in
 * the DOM arrives with no request to carry the source along with it.
 */
export interface EditorRequest {
  channel: typeof OBSERVER_CHANNEL;
  kind: 'request-editor';
  id: string;
}

export interface EditorReply {
  channel: typeof OBSERVER_CHANNEL;
  kind: 'editor';
  id: string;
  code?: string;
  /** The editor's own language id, e.g. `python`, `cpp`. */
  language?: string;
}

/** Turns the observer's path reporting on or off from the isolated world. */
export interface DiagnosticsToggle {
  channel: typeof OBSERVER_CHANNEL;
  kind: 'diagnostics';
  enabled: boolean;
}

/** Origin + path only — the query string can carry identifiers. */
export function summarisePath(url: string, base: string): string {
  try {
    const parsed = new URL(url, base);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

/** One request/response pair seen by the observer. */
export interface ObservedExchange {
  channel: typeof OBSERVER_CHANNEL;
  url: string;
  method: string;
  /** Body the page sent, when it was a string we could read. */
  requestBody?: string;
  responseBody: string;
  /** Page URL at the time, so adapters can recover the problem from the route. */
  href: string;
  /**
   * Editor contents at the time of the exchange. Several judges never return
   * the source in their API, so this is the only way to capture it.
   */
  editorCode?: string;
}

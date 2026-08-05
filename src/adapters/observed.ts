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
 * user's source code.
 */
export const OBSERVED_URLS: RegExp[] = [
  // LeetCode polls this until the judge finishes.
  /\/submissions\/detail\/\d+\/check\/?/,
  // HackerRank posts the submission, then polls the same path with an id.
  /hackerrank\.com\/rest\/.*\/submissions(\/\d+)?(\?|$)/i,
  // CodeChef's IDE submits and polls through its api/ide endpoints.
  /codechef\.com\/api\/ide\/(submit|status)/i,
  // GeeksforGeeks practice runs through a separate API host.
  /practiceapi\.geeksforgeeks\.org\/api\/.*(submission|submit)/i,
  /geeksforgeeks\.org\/api\/.*(submission|submit)/i,
];

export function isObserved(url: string): boolean {
  return OBSERVED_URLS.some((pattern) => pattern.test(url));
}

export const OBSERVER_CHANNEL = 'smriti-observer';

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

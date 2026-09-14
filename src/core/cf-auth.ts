/**
 * Connecting a Codeforces account.
 *
 * **Codeforces has no OAuth.** There is no "Sign in with Codeforces" button to
 * build, and the honest thing is to say so rather than to put up a form that
 * asks for a Codeforces password — a password box on a page that is not
 * codeforces.com is a phishing pattern, and it would be one here too, whatever
 * the intent.
 *
 * What Codeforces does offer is three separate things, and "connected" means a
 * different thing for each:
 *
 * 1. **Your handle.** Public. Rating, contest history and solved problems all
 *    come from the public API and need nothing but the name.
 * 2. **An API key and secret**, which you generate yourself at
 *    codeforces.com/settings/api. These sign requests so the API answers as
 *    *you* — which is what `user.friends` needs, and what makes `user.status`
 *    return your gym and private-contest submissions instead of nothing.
 * 3. **Your browser session on codeforces.com.** Nothing is stored for this;
 *    it is the login you already have, and it is what Run and Submit use.
 *
 * So connecting is: confirm the handle, optionally take a key and secret and
 * prove them with one signed call, and report whether the browser is signed in.
 * All three are shown separately, because a green tick that hides which of them
 * is actually working is worse than no tick.
 */

export const API_SETTINGS_URL = 'https://codeforces.com/settings/api';

export interface CfCredentials {
  key: string;
  secret: string;
}

export function hasCredentials(credentials: Partial<CfCredentials>): boolean {
  return Boolean(credentials.key?.trim() && credentials.secret?.trim());
}

/** Six random digits, which is the shape Codeforces' own examples use. */
export function randomPrefix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => String(byte % 10)).join('');
}

/**
 * The parameter string Codeforces signs, without the signature itself.
 *
 * Sorted by name, then by value for the duplicates — Codeforces specifies this
 * exactly, and a signature computed over a different order is simply wrong with
 * no hint as to why. `URLSearchParams` is not used to build it because it
 * percent-encodes differently from what the server hashes.
 */
export function signablePairs(params: Record<string, string>): string {
  return Object.entries(params)
    .sort(([aName, aValue], [bName, bValue]) =>
      aName === bName ? aValue.localeCompare(bValue) : aName.localeCompare(bName),
    )
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

async function sha512Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * `apiSig`, as Codeforces defines it.
 *
 * `<rand><sha512(<rand>/<method>?<sorted params>#<secret>)>` — the six random
 * digits are prepended to the hash, not just used inside it, because the server
 * needs them to recompute the same hash.
 */
export async function apiSignature(
  method: string,
  params: Record<string, string>,
  secret: string,
  prefix: string,
): Promise<string> {
  const hash = await sha512Hex(`${prefix}/${method}?${signablePairs(params)}#${secret}`);
  return `${prefix}${hash}`;
}

/**
 * The full parameter set for one authorised call.
 *
 * `time` is in seconds and Codeforces rejects anything more than a few minutes
 * out, so a wrong system clock fails here with "apiSig is incorrect" — which is
 * worth knowing, because it reads like a bad secret.
 */
export async function signedParams(
  method: string,
  params: Record<string, string>,
  credentials: CfCredentials,
  now: number,
  prefix: string = randomPrefix(),
): Promise<Record<string, string>> {
  const withKey = {
    ...params,
    apiKey: credentials.key,
    time: String(Math.floor(now / 1000)),
  };

  return {
    ...withKey,
    apiSig: await apiSignature(method, withKey, credentials.secret, prefix),
  };
}

/* ------------------------------------------------------------- the answers */

export interface CfConnection {
  /** The handle as Codeforces spells it, which may differ in case. */
  handle?: string;
  rating?: number;
  rank?: string;
  avatar?: string;
  /** Set when the handle could not be confirmed. */
  handleError?: string;
  /** Whether the key and secret were accepted, when a pair was given. */
  authorized?: boolean;
  authorizedError?: string;
  /** Whether this browser is signed in to codeforces.com. */
  signedIn?: boolean;
  signedInAs?: string;
}

/** Reads the one row `user.info` returns. */
export function readUserInfo(result: unknown): CfConnection {
  const row = Array.isArray(result) ? (result[0] as Record<string, unknown> | undefined) : undefined;
  if (!row || typeof row.handle !== 'string') {
    return { handleError: 'Codeforces returned no such user.' };
  }

  return {
    handle: row.handle,
    rating: typeof row.rating === 'number' ? row.rating : undefined,
    rank: typeof row.rank === 'string' ? row.rank : undefined,
    avatar: typeof row.titlePhoto === 'string' ? row.titlePhoto : undefined,
  };
}

/**
 * Whose session the browser is holding, from any Codeforces page.
 *
 * Read out of the raw HTML rather than a parsed document, because this runs in
 * the service worker and **an MV3 service worker has no `DOMParser`** — it is
 * `undefined` there, so `new DOMParser()` throws, and a `catch` around it would
 * have reported every signed-in user as signed out.
 *
 * The logout link is the tell, not a greeting: the greeting is localised, and
 * on the Russian locale it is not the word "Hi". The handle is then the last
 * profile link *before* that logout link — a signed-out page is full of profile
 * links too, in the recent-actions list, so position is what distinguishes the
 * header's one from everybody else's.
 *
 * `undefined` means signed out; `''` means signed in but the handle could not
 * be read, which is a different thing and is worth not conflating.
 */
export function readSignedInHandle(html: string): string | undefined {
  const logout = /<a[^>]+href="[^"]*logout[^"]*"/i.exec(html);
  if (!logout) return undefined;

  const header = html.slice(0, logout.index);
  const profiles = [...header.matchAll(/href="\/profile\/([A-Za-z0-9_.-]+)"/g)];
  return profiles.at(-1)?.[1] ?? '';
}

/**
 * Turns Codeforces' refusal of a signed call into something actionable.
 *
 * All three of these arrive as the same generic comment, and they need three
 * different fixes.
 */
export function describeAuthFailure(comment: string): string {
  if (/apiSig/i.test(comment)) {
    return `Codeforces did not accept the key and secret. Check both were copied whole from ${API_SETTINGS_URL}, and that this computer's clock is right — a clock a few minutes out fails the same way.`;
  }
  if (/apiKey/i.test(comment)) {
    return 'Codeforces does not recognise that API key. It may have been revoked at codeforces.com/settings/api.';
  }
  return comment || 'Codeforces refused the authorised request without saying why.';
}

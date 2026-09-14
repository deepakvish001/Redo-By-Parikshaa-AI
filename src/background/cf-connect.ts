import { codeforces } from './cf-api.ts';
import {
  describeAuthFailure,
  hasCredentials,
  readSignedInHandle,
  readUserInfo,
  signedParams,
  type CfConnection,
  type CfCredentials,
} from '../core/cf-auth.ts';

/**
 * "Connect Codeforces", such as it can honestly be.
 *
 * Three checks, reported separately, because they can each fail on their own
 * and each has a different fix:
 *
 * - the **handle** is confirmed against the public API, which needs nothing;
 * - the **key and secret**, if given, are proven with one signed call rather
 *   than being stored on trust and failing silently a week later;
 * - the **browser session** is read from codeforces.com, because that — not the
 *   API key — is what Run and Submit in the workspace actually use, and "the
 *   API says connected but Submit says signed out" is exactly the confusion
 *   this is meant to prevent.
 *
 * Nothing here can fail the whole thing: a bad key still leaves a confirmed
 * handle, and a signed-out browser still leaves a working API.
 */

/** A signed call, through the same one-every-two-seconds gate as everything else. */
export async function authorizedCall<T>(
  method: string,
  params: Record<string, string>,
  credentials: CfCredentials,
): Promise<T> {
  return codeforces<T>(method, await signedParams(method, params, credentials, Date.now()));
}

/**
 * Whether this browser is signed in to codeforces.com.
 *
 * A plain page fetch with the browser's own cookies — the same request a link
 * click would make. Nothing is stored and nothing is sent anywhere; only the
 * presence of a logout link is read back.
 */
export async function readBrowserSession(): Promise<{ signedIn: boolean; handle?: string }> {
  try {
    const response = await fetch('https://codeforces.com/', { credentials: 'include' });
    if (!response.ok) return { signedIn: false };

    const handle = readSignedInHandle(await response.text());
    return handle === undefined ? { signedIn: false } : { signedIn: true, handle: handle || undefined };
  } catch {
    // Offline, or the request was blocked. Not knowing is not the same as
    // signed out, so it is reported as unknown by leaving the field off.
    return { signedIn: false };
  }
}

export async function connectCodeforces(
  handle: string,
  credentials: Partial<CfCredentials>,
): Promise<CfConnection> {
  const connection: CfConnection = {};

  const wanted = handle.trim();
  if (wanted) {
    try {
      Object.assign(connection, readUserInfo(await codeforces('user.info', { handles: wanted })));
    } catch (error) {
      connection.handleError = error instanceof Error ? error.message : String(error);
    }
  }

  if (hasCredentials(credentials)) {
    try {
      // `user.friends` is the cheapest method that *requires* authorisation —
      // an unsigned call to it is refused outright, so a success here proves
      // the pair rather than merely failing to disprove it.
      await authorizedCall('user.friends', { onlyOnline: 'false' }, credentials as CfCredentials);
      connection.authorized = true;
    } catch (error) {
      connection.authorized = false;
      connection.authorizedError = describeAuthFailure(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const session = await readBrowserSession();
  connection.signedIn = session.signedIn;
  connection.signedInAs = session.handle;

  return connection;
}

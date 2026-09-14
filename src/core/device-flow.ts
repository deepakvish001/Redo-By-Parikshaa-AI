/**
 * Signing in to GitHub without pasting a token.
 *
 * The device flow is the only OAuth flow a browser extension can run honestly:
 * no client secret, no redirect URI to register, no server. GitHub gives you a
 * short code, you type it into github.com in a normal tab, and the extension
 * polls until you are done.
 *
 * **It is offered alongside the token, not instead of it**, and the token stays
 * the recommendation. A device-flow token for the `repo` scope can read and
 * write *every* repository you have access to; a fine-grained personal access
 * token can be scoped to the one repository you sync to, with `Contents` and
 * nothing else. That is a real difference in what a leaked credential costs,
 * and it is the reason the paste-a-token path is not being replaced.
 *
 * The shaping is here so the flow can be tested against recorded responses.
 */

export const DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

/**
 * The host the flow talks to, as an optional permission.
 *
 * `github.com`, not `api.github.com` — the device endpoints live on the website
 * rather than the API, so the permission the extension already holds does not
 * cover them. It is optional and released when the flow ends, so an install
 * that never signs in this way never grants it at all.
 */
export const GITHUB_ORIGIN = 'https://github.com/*';

/**
 * The scope asked for.
 *
 * `public_repo` rather than `repo` where it will do: committing to a public
 * solutions repository is the common case, and asking for private repositories
 * as well when they are not needed is exactly the over-reach the fine-grained
 * token path exists to avoid.
 */
export const SCOPES = { public: 'public_repo', private: 'repo' } as const;

export interface DeviceCode {
  deviceCode: string;
  /** What the user types into github.com. */
  userCode: string;
  verificationUri: string;
  /** Seconds between polls, as GitHub asks. */
  interval: number;
  expiresAt: number;
}

export function readDeviceCode(
  raw: Record<string, unknown>,
  now: number,
): DeviceCode | undefined {
  const deviceCode = typeof raw.device_code === 'string' ? raw.device_code : undefined;
  const userCode = typeof raw.user_code === 'string' ? raw.user_code : undefined;
  if (!deviceCode || !userCode) return undefined;

  return {
    deviceCode,
    userCode,
    verificationUri:
      typeof raw.verification_uri === 'string' ? raw.verification_uri : 'https://github.com/login/device',
    // GitHub's floor is 5s; polling faster earns a slow_down and then a ban.
    interval: typeof raw.interval === 'number' ? Math.max(5, raw.interval) : 5,
    expiresAt: now + (typeof raw.expires_in === 'number' ? raw.expires_in : 900) * 1000,
  };
}

export type PollOutcome =
  | { state: 'pending' }
  /** GitHub asked to be polled less often; the interval goes up. */
  | { state: 'slow-down'; interval: number }
  | { state: 'token'; token: string }
  | { state: 'failed'; error: string };

/**
 * Reads one poll response.
 *
 * `authorization_pending` is not an error — it is the normal answer for as long
 * as the user is still typing the code — so it must never surface as one.
 */
export function readPoll(raw: Record<string, unknown>): PollOutcome {
  const token = typeof raw.access_token === 'string' ? raw.access_token : undefined;
  if (token) return { state: 'token', token };

  const error = typeof raw.error === 'string' ? raw.error : '';

  switch (error) {
    case 'authorization_pending':
      return { state: 'pending' };
    case 'slow_down':
      return {
        state: 'slow-down',
        interval: typeof raw.interval === 'number' ? Math.max(5, raw.interval) : 10,
      };
    case 'expired_token':
      return { state: 'failed', error: 'The code expired. Start again.' };
    case 'access_denied':
      return { state: 'failed', error: 'You cancelled the sign-in on GitHub.' };
    case 'incorrect_client_credentials':
    case 'unauthorized_client':
      return {
        state: 'failed',
        error:
          'This build has no GitHub OAuth client id, so device sign-in cannot work. Paste a fine-grained token instead — see Settings.',
      };
    case '':
      return { state: 'failed', error: 'GitHub sent an answer with neither a token nor an error.' };
    default:
      return {
        state: 'failed',
        error: typeof raw.error_description === 'string' ? raw.error_description : error,
      };
  }
}

/** `ABCD-1234` is easier to read back than `abcd1234`. */
export function formatUserCode(code: string): string {
  return code.toUpperCase();
}

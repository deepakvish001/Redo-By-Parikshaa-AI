import {
  ACCESS_TOKEN_URL,
  DEVICE_CODE_URL,
  SCOPES,
  readDeviceCode,
  readPoll,
  type DeviceCode,
} from '../core/device-flow.ts';
import { GITHUB_CLIENT_ID } from '../core/brand.ts';

/**
 * The device flow, from the service worker.
 *
 * Two things about this file are worth reading before changing it.
 *
 * **The client id comes from the caller, falling back to a build constant that
 * is empty here.** A GitHub OAuth App is registered by whoever publishes a
 * build, not by this code, so a fork or a local install inherits none — which
 * is why Settings also takes one. Rather than failing with GitHub's unreadable
 * `unauthorized_client`, the button is hidden when there is no id at all and
 * Settings says how to get one; a sign-in button that cannot possibly work is
 * worse than no button.
 *
 * **A device-flow token is broader than a fine-grained one.** That is a
 * property of OAuth, not a shortcoming here, and it is why this is offered
 * beside the paste-a-token path rather than in place of it.
 */

export interface StartResult {
  code?: DeviceCode;
  error?: string;
}

/** The pasted id wins; the build constant is the fallback for a published build. */
export function clientIdFor(fromSettings?: string): string {
  return (fromSettings ?? '').trim() || GITHUB_CLIENT_ID.trim();
}

export function isAvailable(fromSettings?: string): boolean {
  return clientIdFor(fromSettings) !== '';
}

export async function startDeviceFlow(
  includePrivate: boolean,
  settingsClientId?: string,
): Promise<StartResult> {
  const clientId = clientIdFor(settingsClientId);
  if (!clientId) {
    return {
      error:
        'There is no GitHub OAuth client id, so sign-in cannot run. Paste one in Settings, or paste a fine-grained token instead — it is the more precise option anyway.',
    };
  }

  try {
    const response = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        scope: includePrivate ? SCOPES.private : SCOPES.public,
      }),
    });

    if (!response.ok) return { error: `GitHub answered ${response.status}.` };

    const code = readDeviceCode(
      (await response.json()) as Record<string, unknown>,
      Date.now(),
    );
    return code ? { code } : { error: 'GitHub sent no device code.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export interface PollResult {
  token?: string;
  /** Still waiting for the user to finish on github.com. */
  pending?: boolean;
  /** Seconds to wait before asking again. */
  interval?: number;
  error?: string;
}

/**
 * One poll. The caller does the waiting.
 *
 * Deliberately not a loop in here: a loop in the service worker keeps it alive
 * for fifteen minutes for something the user may already have abandoned, and
 * MV3 will kill it anyway. The Settings page — which is open, because the user
 * is looking at it — is the right place to hold the timer.
 */
export async function pollDeviceFlow(
  deviceCode: string,
  settingsClientId?: string,
): Promise<PollResult> {
  const clientId = clientIdFor(settingsClientId);
  if (!clientId) return { error: 'There is no GitHub OAuth client id to sign in with.' };

  try {
    const response = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (!response.ok) return { error: `GitHub answered ${response.status}.` };

    const outcome = readPoll((await response.json()) as Record<string, unknown>);
    switch (outcome.state) {
      case 'token':
        return { token: outcome.token };
      case 'pending':
        return { pending: true };
      case 'slow-down':
        return { pending: true, interval: outcome.interval };
      case 'failed':
        return { error: outcome.error };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

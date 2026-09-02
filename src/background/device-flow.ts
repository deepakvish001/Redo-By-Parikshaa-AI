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
 * **The client id is a build constant, and it is empty by default.** A GitHub
 * OAuth App is registered by whoever publishes a build, not by this code, so a
 * fork or a local install has no id until somebody puts one in
 * `src/core/brand.ts`. Rather than failing with GitHub's unreadable
 * `unauthorized_client`, the UI is hidden entirely when there is no id and says
 * why — a sign-in button that cannot possibly work is worse than no button.
 *
 * **A device-flow token is broader than a fine-grained one.** That is a
 * property of OAuth, not a shortcoming here, and it is why this is offered
 * beside the paste-a-token path rather than in place of it.
 */

export interface StartResult {
  code?: DeviceCode;
  error?: string;
}

export function isAvailable(): boolean {
  return GITHUB_CLIENT_ID.trim() !== '';
}

export async function startDeviceFlow(includePrivate: boolean): Promise<StartResult> {
  if (!isAvailable()) {
    return {
      error:
        'This build has no GitHub OAuth client id, so device sign-in is unavailable. Paste a fine-grained token instead — it is the more precise option anyway.',
    };
  }

  try {
    const response = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
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
export async function pollDeviceFlow(deviceCode: string): Promise<PollResult> {
  if (!isAvailable()) return { error: 'This build has no GitHub OAuth client id.' };

  try {
    const response = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
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

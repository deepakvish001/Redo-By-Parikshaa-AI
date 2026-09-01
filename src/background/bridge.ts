import { bridgeUrl, buildPayload, isValidPort } from '../core/bridge.ts';
import { getSettings } from '../core/storage.ts';
import type { SolvedProblem } from '../core/types.ts';

/**
 * Posting a solve to a local listener.
 *
 * Fire-and-forget by design. If nothing is listening the request fails
 * instantly with a connection error, and that must not turn into a toast on
 * every solve — an editor that is closed is the normal case, not a fault. The
 * result is reported when the user presses Test in Settings, and silent
 * otherwise.
 */

export interface BridgeResult {
  ok: boolean;
  error?: string;
}

/** How long to wait for something that is either there or is not. */
const TIMEOUT_MS = 2500;

export async function pushToEditor(problem: SolvedProblem): Promise<BridgeResult> {
  const { bridge } = await getSettings();
  if (!bridge.enabled) return { ok: false, error: 'The editor bridge is off.' };
  if (!isValidPort(bridge.port)) return { ok: false, error: `${bridge.port} is not a usable port.` };

  return post(bridge.port, buildPayload(problem));
}

async function post(port: number, body: unknown): Promise<BridgeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(bridgeUrl(port), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      // No cookies, ever: this is a local process, not a site you are signed
      // in to, and sending credentials to 127.0.0.1 would be indefensible.
      credentials: 'omit',
    });

    if (!response.ok) return { ok: false, error: `The listener answered ${response.status}.` };
    return { ok: true };
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, error: `Nothing answered on port ${port} within ${TIMEOUT_MS / 1000}s.` };
    }
    return {
      ok: false,
      error:
        error instanceof Error && /Failed to fetch/i.test(error.message)
          ? `Nothing is listening on port ${port}.`
          : (error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What Settings' Test button sends.
 *
 * A real payload with obviously fake content, so somebody writing a listener
 * sees exactly the shape they will get — and can tell it apart from a real
 * solve without having to solve something.
 */
export async function testBridge(port: number): Promise<BridgeResult> {
  if (!isValidPort(port)) return { ok: false, error: `${port} is not a usable port.` };

  return post(port, {
    redo: 1,
    id: 'redo:test',
    platform: 'redo',
    title: 'Bridge test',
    url: 'https://github.com/deepakvish001/Redo-By-Parikshaa-AI',
    difficulty: 'unknown',
    tags: ['test'],
    language: 'text',
    extension: 'txt',
    path: 'redo/test/solution.txt',
    code: 'This is a test payload from Redo.\n',
    attempts: 0,
    solvedAt: Date.now(),
  });
}

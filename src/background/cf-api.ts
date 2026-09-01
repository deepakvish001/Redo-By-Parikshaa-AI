/**
 * The one place that talks to Codeforces' API.
 *
 * Codeforces asks for no more than one request every two seconds, per client,
 * across everything. Five features each keeping their own polite little timer
 * is five clients as far as the server is concerned, and they trip each other's
 * limit — so the gate lives here and every caller goes through it.
 */

const CF_API = 'https://codeforces.com/api';

/** Codeforces asks for no more than one request every two seconds. */
const GAP_MS = 2100;

/** Serialises callers rather than letting them all wake at the same moment. */
let turn: Promise<void> = Promise.resolve();
let lastCall = 0;

function nextTurn(): Promise<void> {
  const mine = turn.then(async () => {
    const wait = Math.max(0, lastCall + GAP_MS - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall = Date.now();
  });
  // A rejected turn must not stall the queue behind it.
  turn = mine.catch(() => undefined);
  return mine;
}

export async function codeforces<T>(
  method: string,
  params: Record<string, string> = {},
): Promise<T> {
  await nextTurn();

  // POST because a contest's worth of handles does not fit in a URL.
  const response = await fetch(`${CF_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  if (!response.ok) {
    throw new Error(`Codeforces returned ${response.status} for ${method}.`);
  }

  const json = (await response.json()) as { status: string; result?: T; comment?: string };
  if (json.status !== 'OK' || json.result === undefined) {
    throw new Error(json.comment ?? `Codeforces refused the ${method} request.`);
  }
  return json.result;
}

/** `1352` + `A` → `1352A`, the key every part of the extension uses. */
export function problemKeyOf(contestId: number | string, index: string): string {
  return `${contestId}${index.toUpperCase()}`;
}

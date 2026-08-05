/**
 * Runs on parikshaa.org and hands the extension the credentials it needs to
 * mark problems solved on the user's behalf.
 *
 * The session is read straight from the site's own `localStorage` entry, which
 * supabase-js keeps refreshed. Nothing is stolen and nothing is entered twice:
 * if the user is signed in to Parikshaa, sync works; if not, it does not.
 */

import { credentialsFromSession, readStoredSession } from '../core/parikshaa.ts';
import { getParikshaaApiKey, saveParikshaaApiKey } from '../core/storage.ts';
import { send } from '../core/messages.ts';
import { startHighlighting } from './parikshaa-highlight.ts';

const CHANNEL = 'dsa-revision-buddy-parikshaa';

let apiKey = '';
let lastSentToken = '';

async function publish(): Promise<void> {
  if (!apiKey) return;
  const session = readStoredSession(window.localStorage);
  if (!session?.access_token || session.access_token === lastSentToken) return;

  const credentials = credentialsFromSession(session, apiKey, Date.now());
  if (!credentials) return;

  try {
    await send({ type: 'parikshaa:credentials', credentials });
    lastSentToken = credentials.accessToken;
  } catch {
    // The service worker may be asleep; the next poll will try again.
  }
}

async function useApiKey(next: string): Promise<void> {
  if (!next || next === apiKey) return;
  apiKey = next;
  // Persisting means later page loads never have to catch a request in flight.
  await saveParikshaaApiKey(next).catch(() => undefined);
  await publish();
}

window.addEventListener('message', (event: MessageEvent<{ channel?: string; apiKey?: string }>) => {
  if (event.source !== window || event.data?.channel !== CHANNEL) return;
  if (!event.data.apiKey) return;
  void useApiKey(event.data.apiKey);
});

function requestApiKey(): void {
  try {
    window.postMessage({ channel: CHANNEL, kind: 'request-apikey' }, window.location.origin);
  } catch {
    /* the page is mid-navigation; the next attempt will do */
  }
}

async function start(): Promise<void> {
  // A key captured on a previous visit is enough on its own — the page does not
  // have to make a Supabase call while this tab is open.
  const stored = await getParikshaaApiKey().catch(() => undefined);
  if (stored) await useApiKey(stored);

  // The MAIN-world observer starts before this script and may already have seen
  // the key, so ask for it rather than waiting for the next request. Retried a
  // few times because the page's first Supabase call can arrive after us.
  for (const delay of [0, 500, 1500, 4000, 10_000]) {
    setTimeout(() => {
      if (!apiKey) requestApiKey();
    }, delay);
  }
}

void start();

// supabase-js rotates the token roughly hourly and writes the new one to
// storage; a slow poll keeps the extension's copy fresh for as long as the tab
// is open, without watching every storage write.
setInterval(() => {
  if (!apiKey) requestApiKey();
  void publish();
}, 60_000);
window.addEventListener('focus', () => void publish());

// Independent of the credential bridge: due problems are marked in Parikshaa's
// own lists whether or not sync is switched on.
startHighlighting();

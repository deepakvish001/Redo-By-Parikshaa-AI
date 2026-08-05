/**
 * Runs on parikshaa.org and hands the extension the credentials it needs to
 * mark problems solved on the user's behalf.
 *
 * The session is read straight from the site's own `localStorage` entry, which
 * supabase-js keeps refreshed. Nothing is stolen and nothing is entered twice:
 * if the user is signed in to Parikshaa, sync works; if not, it does not.
 */

import { credentialsFromSession, readStoredSession } from '../core/parikshaa.ts';
import { send } from '../core/messages.ts';

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

window.addEventListener('message', (event: MessageEvent<{ channel?: string; apiKey?: string }>) => {
  if (event.source !== window || event.data?.channel !== CHANNEL) return;
  if (!event.data.apiKey) return;
  apiKey = event.data.apiKey;
  void publish();
});

// supabase-js rotates the token roughly hourly and writes the new one to
// storage; a slow poll keeps the extension's copy fresh for as long as the tab
// is open, without watching every storage write.
setInterval(() => void publish(), 60_000);
window.addEventListener('focus', () => void publish());
void publish();

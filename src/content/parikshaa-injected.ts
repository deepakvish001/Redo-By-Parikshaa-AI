/**
 * Runs in the page's MAIN world on parikshaa.org.
 *
 * Supabase requests carry the project's publishable key in an `apikey` header.
 * The key is public (it ships inside the site's own JavaScript bundle) but it
 * is not written to `localStorage`, so the only way to learn it without
 * hard-coding project details into this extension is to read it off a request
 * the page makes anyway.
 *
 * This observes; it never modifies, delays or blocks a request.
 */

const CHANNEL = 'dsa-revision-buddy-parikshaa';

/**
 * The last key seen, kept so it can be handed over on request.
 *
 * This script starts at `document_start` but the content script that consumes
 * the key only runs at `document_idle`, and the page's first Supabase call
 * usually lands in between. Broadcasting once would therefore lose the key to
 * an audience that does not exist yet, so the value is retained and replayed
 * whenever the other side asks for it.
 */
let lastKey = '';

function post(apiKey: string): void {
  try {
    window.postMessage({ channel: CHANNEL, kind: 'apikey', apiKey }, window.location.origin);
  } catch {
    /* never break the host page */
  }
}

function relay(apiKey: string): void {
  if (!apiKey) return;
  const changed = apiKey !== lastKey;
  lastKey = apiKey;
  if (changed) post(apiKey);
}

window.addEventListener('message', (event: MessageEvent<{ channel?: string; kind?: string }>) => {
  if (event.source !== window) return;
  if (event.data?.channel !== CHANNEL || event.data.kind !== 'request-apikey') return;
  if (lastKey) post(lastKey);
});

function readApiKey(headers: HeadersInit | undefined): string {
  if (!headers) return '';
  try {
    return new Headers(headers).get('apikey') ?? '';
  } catch {
    return '';
  }
}

const originalFetch = window.fetch;
window.fetch = function patchedFetch(
  this: unknown,
  ...args: Parameters<typeof fetch>
): Promise<globalThis.Response> {
  try {
    const [input, init] = args;
    if (typeof Request !== 'undefined' && input instanceof Request) {
      relay(input.headers.get('apikey') ?? '');
    }
    relay(readApiKey(init?.headers));
  } catch {
    /* observation only */
  }
  return originalFetch.apply(this as never, args);
};

const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(
  this: XMLHttpRequest,
  name: string,
  value: string,
) {
  if (name.toLowerCase() === 'apikey') relay(value);
  return originalSetRequestHeader.call(this, name, value);
};

// Marks this file as a module so its top-level names stay file-scoped.
export {};

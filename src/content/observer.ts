/**
 * Runs in the page's MAIN world on every supported judge.
 *
 * Judges report a verdict by polling their own API from the page, so the only
 * way to notice an accepted submission as it happens is to observe that
 * traffic. This wraps `fetch` and `XMLHttpRequest`, relays the request and
 * response bodies for a narrow set of URLs, and lets each platform adapter
 * decide what they mean.
 *
 * It never blocks, delays or rewrites a request. Any failure here must leave
 * the host page working exactly as it would without the extension.
 */

import { wrapFetch } from './wrap-fetch.ts';
import {
  OBSERVER_CHANNEL,
  isObserved,
  summarisePath,
  type DiagnosticsToggle,
  type EditorReply,
  type EditorRequest,
  type ObservedExchange,
  type ObservedGlimpse,
} from '../adapters/observed.ts';

/**
 * Off unless the user turns diagnostics on in Settings. When on, the observer
 * additionally reports the path of every request it sees — which is how a
 * judge that changed its endpoints gets identified instead of guessed at.
 */
let reportPaths = false;

window.addEventListener('message', (event: MessageEvent<DiagnosticsToggle>) => {
  if (event.source !== window) return;
  if (event.data?.channel !== OBSERVER_CHANNEL || event.data.kind !== 'diagnostics') return;
  reportPaths = event.data.enabled;
});

function glimpse(url: string, method: string, matched: boolean): void {
  if (!reportPaths) return;
  try {
    window.postMessage(
      {
        channel: OBSERVER_CHANNEL,
        kind: 'seen',
        method,
        path: summarisePath(url, window.location.href),
        matched,
        at: Date.now(),
      } satisfies ObservedGlimpse,
      window.location.origin,
    );
  } catch {
    /* observation only */
  }
}

/** Hands the editor's contents to the isolated world when it asks. */
window.addEventListener('message', (event: MessageEvent<EditorRequest>) => {
  if (event.source !== window) return;
  if (event.data?.channel !== OBSERVER_CHANNEL || event.data.kind !== 'request-editor') return;
  try {
    window.postMessage(
      {
        channel: OBSERVER_CHANNEL,
        kind: 'editor',
        id: event.data.id,
        code: readEditorCode(),
        language: readEditorLanguage(),
      } satisfies EditorReply,
      window.location.origin,
    );
  } catch {
    /* observation only */
  }
});

interface EditorLike {
  getValue?: () => string;
  getLanguageId?: () => string;
}

interface MonacoLike {
  editor?: { getModels?: () => EditorLike[] };
}

/** The language the editor is set to — free, and better than guessing. */
function readEditorLanguage(): string | undefined {
  try {
    const monaco = (window as unknown as { monaco?: MonacoLike }).monaco;
    return monaco?.editor?.getModels?.()[0]?.getLanguageId?.();
  } catch {
    return undefined;
  }
}

interface AceLike {
  edit?: (element: Element) => EditorLike;
}

/**
 * Best-effort read of whatever code editor the page is using. HackerRank,
 * CodeChef and GeeksforGeeks do not hand the source back in their APIs, so
 * without this there would be nothing to commit.
 */
function readEditorCode(): string | undefined {
  const scope = window as unknown as { monaco?: MonacoLike; ace?: AceLike };

  try {
    const value = scope.monaco?.editor?.getModels?.()[0]?.getValue?.();
    if (value && value.trim()) return value;
  } catch {
    /* the page may not use Monaco */
  }

  try {
    const host = document.querySelector('.ace_editor');
    const value = host ? scope.ace?.edit?.(host)?.getValue?.() : undefined;
    if (value && value.trim()) return value;
  } catch {
    /* the page may not use Ace */
  }

  return undefined;
}

function bodyToString(body: unknown): string | undefined {
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  return undefined;
}

function relay(exchange: Omit<ObservedExchange, 'channel'>): void {
  try {
    window.postMessage(
      { ...exchange, channel: OBSERVER_CHANNEL } satisfies ObservedExchange,
      window.location.origin,
    );
  } catch {
    /* postMessage must never break the host page */
  }
}

function publish(
  url: string,
  method: string,
  requestBody: string | undefined,
  responseBody: string,
): void {
  relay({
    url,
    method,
    requestBody,
    responseBody,
    href: window.location.href,
    editorCode: readEditorCode(),
  });
}

/* --- fetch --- */

wrapFetch(window, {
  onRequest: (url, method) => glimpse(url, method, isObserved(url)),
  watch: isObserved,
  onResponse: (url, method, init, response) => {
    // Cloning keeps the page's own copy of the body intact.
    response
      .clone()
      .text()
      .then((text) => publish(url, method, bodyToString(init?.body), text))
      .catch(() => undefined);
  },
});

/* --- XMLHttpRequest --- */

interface Pending {
  url: string;
  method: string;
  body?: string;
}

const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;
const pending = new WeakMap<XMLHttpRequest, Pending>();

XMLHttpRequest.prototype.open = function patchedOpen(
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  ...rest: unknown[]
) {
  pending.set(this, { url: String(url), method });
  return (originalOpen as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
};

XMLHttpRequest.prototype.send = function patchedSend(this: XMLHttpRequest, ...args: unknown[]) {
  const request = pending.get(this);
  if (request) glimpse(request.url, request.method, isObserved(request.url));
  if (request && isObserved(request.url)) {
    request.body = bodyToString(args[0]);
    this.addEventListener('load', () => {
      try {
        if (typeof this.responseText === 'string') {
          publish(request.url, request.method, request.body, this.responseText);
        }
      } catch {
        /* responseType may not be text */
      }
    });
  }
  return (originalSend as (...a: unknown[]) => void).apply(this, args);
};

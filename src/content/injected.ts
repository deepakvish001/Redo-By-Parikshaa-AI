/**
 * Runs in the page's MAIN world on LeetCode.
 *
 * LeetCode reports a verdict by polling `/submissions/detail/<id>/check/` from
 * the page itself, so the only way to learn about an accepted submission the
 * moment it happens is to observe that traffic. This script wraps `fetch` and
 * `XMLHttpRequest`, inspects those responses, and relays the outcome to the
 * isolated-world content script over `window.postMessage`.
 *
 * It never blocks, rewrites or delays a request — a failure here must not be
 * able to break the site.
 */

const CHANNEL = 'dsa-revision-buddy';
const CHECK_PATTERN = /\/submissions\/detail\/(\d+)\/check\/?/;

interface CheckPayload {
  state?: string;
  status_msg?: string;
  question_id?: string | number;
  submission_id?: string | number;
  lang?: string;
  pretty_lang?: string;
  status_runtime?: string;
  status_memory?: string;
  runtime_percentile?: number;
  memory_percentile?: number;
  code?: string;
}

type Relay =
  | {
      channel: typeof CHANNEL;
      kind: 'accepted';
      submissionId: string;
      questionId: string;
      language: string;
      runtimeNote?: string;
      memoryNote?: string;
      fallbackCode?: string;
      href: string;
    }
  | { channel: typeof CHANNEL; kind: 'attempt'; href: string; verdict: string };

const seen = new Set<string>();

/**
 * Best-effort read of the editor's current contents, used only when the
 * GraphQL lookup for the submission's source fails.
 */
function readEditorCode(): string | undefined {
  try {
    const monaco = (window as unknown as { monaco?: MonacoLike }).monaco;
    const model = monaco?.editor?.getModels?.()[0];
    const value = model?.getValue?.();
    return value && value.trim().length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

interface MonacoLike {
  editor?: { getModels?: () => Array<{ getValue?: () => string }> };
}

function relay(message: Relay): void {
  try {
    window.postMessage(message, window.location.origin);
  } catch {
    /* postMessage must never break the host page */
  }
}

function handleCheck(url: string, body: string): void {
  const match = CHECK_PATTERN.exec(url);
  if (!match) return;

  let payload: CheckPayload;
  try {
    payload = JSON.parse(body) as CheckPayload;
  } catch {
    return;
  }

  // The endpoint is polled until the judge finishes; ignore in-flight states.
  if (payload.state && payload.state !== 'SUCCESS') return;
  if (!payload.status_msg) return;

  const submissionId = String(payload.submission_id ?? match[1] ?? '');
  if (!submissionId || seen.has(submissionId)) return;
  seen.add(submissionId);

  if (payload.status_msg !== 'Accepted') {
    relay({
      channel: CHANNEL,
      kind: 'attempt',
      href: window.location.href,
      verdict: payload.status_msg,
    });
    return;
  }

  const runtimeNote = payload.status_runtime
    ? `Runtime ${payload.status_runtime}${
        payload.runtime_percentile ? ` (beats ${payload.runtime_percentile.toFixed(1)}%)` : ''
      }`
    : undefined;
  const memoryNote = payload.status_memory
    ? `Memory ${payload.status_memory}${
        payload.memory_percentile ? ` (beats ${payload.memory_percentile.toFixed(1)}%)` : ''
      }`
    : undefined;

  relay({
    channel: CHANNEL,
    kind: 'accepted',
    submissionId,
    questionId: String(payload.question_id ?? ''),
    language: payload.pretty_lang || payload.lang || '',
    runtimeNote,
    memoryNote,
    fallbackCode: payload.code ?? readEditorCode(),
    href: window.location.href,
  });
}

/* --- fetch --- */

const originalFetch = window.fetch;
window.fetch = async function patchedFetch(
  this: unknown,
  ...args: Parameters<typeof fetch>
): Promise<globalThis.Response> {
  const response = await originalFetch.apply(this as never, args);
  try {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request | URL).toString();
    if (CHECK_PATTERN.test(url)) {
      response
        .clone()
        .text()
        .then((body) => handleCheck(url, body))
        .catch(() => undefined);
    }
  } catch {
    /* observation only */
  }
  return response;
};

/* --- XMLHttpRequest --- */

const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;
const urlBySocket = new WeakMap<XMLHttpRequest, string>();

XMLHttpRequest.prototype.open = function patchedOpen(
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  ...rest: unknown[]
) {
  urlBySocket.set(this, String(url));
  return (originalOpen as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
};

XMLHttpRequest.prototype.send = function patchedSend(this: XMLHttpRequest, ...args: unknown[]) {
  const url = urlBySocket.get(this);
  if (url && CHECK_PATTERN.test(url)) {
    this.addEventListener('load', () => {
      try {
        if (typeof this.responseText === 'string') handleCheck(url, this.responseText);
      } catch {
        /* responseType may not be text */
      }
    });
  }
  return (originalSend as (...a: unknown[]) => void).apply(this, args);
};

// Marks this file as a module so its top-level names stay file-scoped.
export {};

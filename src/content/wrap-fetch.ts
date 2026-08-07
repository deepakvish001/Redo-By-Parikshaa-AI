/**
 * The shared, transparent `fetch` wrapper both MAIN-world scripts install.
 *
 * "Transparent" is the whole specification, and it is easy to get wrong. An
 * earlier version was written as
 *
 *     window.fetch = async (...args) => { const r = await original(...args); … }
 *
 * which hands the page a *different* promise from the one the network produced.
 * When one of the site's own requests failed — an analytics call blocked by an
 * extension, a flaky connection — the rejection was re-thrown out of that async
 * function, and Chrome reported "Uncaught (in promise) TypeError: Failed to
 * fetch" against `observer.js` instead of against the site's own code. The
 * failure was never ours; the wrapper simply put itself between the page and
 * its own error.
 *
 * So: call the original, hand its promise straight back, and hang the
 * observation off a separate branch that carries its own `catch`. A page that
 * ignores a failed request keeps exactly the behaviour it had before this
 * extension was installed.
 */

export interface FetchObserver {
  /**
   * Before the request goes out. Must not throw, and must not block.
   *
   * `input` comes through untouched because a `Request` carries its headers and
   * body on itself rather than in `init`, and some callers only ever use that
   * shape.
   */
  onRequest?(
    url: string,
    method: string,
    init: RequestInit | undefined,
    input: RequestInfo | URL,
  ): void;
  /**
   * Which URLs are worth reading the response of.
   *
   * This is not an optimisation, it is the safety boundary. Attaching a
   * reaction to the page's promise marks that promise as handled, so a request
   * the page fires and forgets would stop being reported in the console at
   * all — the extension would be hiding the site's own network errors from the
   * site's own developers. Keeping the branch off every URL but the few we act
   * on means the other 99% behave exactly as if the extension were not
   * installed.
   */
  watch?(url: string): boolean;
  /**
   * With the settled response, for requests worth reading. Only called when
   * the request succeeded — a failed request has no body to read.
   */
  onResponse?(
    url: string,
    method: string,
    init: RequestInit | undefined,
    response: Response,
  ): void;
}

/** The request's URL, whichever of the three shapes `fetch` was handed. */
export function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String(input);
}

export function methodOf(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method;
  return 'GET';
}

export function wrapFetch(scope: Window, observe: FetchObserver): void {
  const original = scope.fetch;
  if (typeof original !== 'function') return;

  function patchedFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Called first and returned unchanged: this is the page's promise, and
    // nothing below is allowed to replace it or to delay it.
    const promise = original.call(this as never, input, init);

    try {
      const url = urlOf(input);
      const method = methodOf(input, init);
      observe.onRequest?.(url, method, init, input);

      if (observe.onResponse && (observe.watch?.(url) ?? true)) {
        // A derived chain with its own rejection handler, so observing never
        // adds an unhandled rejection of its own. The cost — that a failure on
        // *this* URL stops being reported by the browser — is why `watch` keeps
        // it to the handful of endpoints the adapters actually read.
        void promise.then(
          (response) => {
            try {
              observe.onResponse?.(url, method, init, response);
            } catch {
              /* observation only */
            }
          },
          () => {
            // The judge's poll failed. The adapter surfaces that itself, with
            // more context than a console line would carry.
          },
        );
      }
    } catch {
      /* observation must never affect the request */
    }

    return promise;
  }

  // Generic code occasionally reads these off `fetch`; keeping them costs
  // nothing. `toString` is deliberately left alone — a wrapper claiming to be
  // native code would be lying to the page about what it is.
  Object.defineProperty(patchedFetch, 'name', { value: 'fetch', configurable: true });
  Object.defineProperty(patchedFetch, 'length', { value: original.length, configurable: true });

  scope.fetch = patchedFetch as typeof fetch;
}

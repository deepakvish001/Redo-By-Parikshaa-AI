import assert from 'node:assert/strict';
import test from 'node:test';

import { methodOf, urlOf, wrapFetch } from '../src/content/wrap-fetch.ts';

/** A stand-in for the page's `window`, with whatever fetch a test needs. */
function scope(fetchImpl) {
  return { fetch: fetchImpl };
}

test('the page gets back the very promise the network produced', async () => {
  const response = new Response('ok');
  const original = new Promise((resolve) => resolve(response));
  const page = scope(() => original);

  wrapFetch(page, { onRequest: () => {}, onResponse: () => {} });

  const returned = page.fetch('https://example.com/');
  assert.equal(returned, original, 'the wrapper must not substitute its own promise');
  assert.equal(await returned, response);
});

test('a failed request rejects with the original error, unchanged', async () => {
  const failure = new TypeError('Failed to fetch');
  const page = scope(() => Promise.reject(failure));
  wrapFetch(page, { onResponse: () => {} });

  await assert.rejects(
    () => page.fetch('https://example.com/'),
    (error) => {
      assert.equal(error, failure, 'the same error object, not a copy');
      return true;
    },
  );
});

/**
 * A promise that records whether anything attached a reaction to it.
 *
 * Whether a rejection reaches the console comes down to exactly that: attaching
 * a reaction marks the promise handled. Asserting on `.then` is the mechanism
 * itself, and unlike counting `unhandledRejection` events it does not require
 * letting a real one escape — which Node's test runner would (rightly) treat as
 * a failing test.
 */
function watched(settle) {
  const inner = settle();
  // The harness is not the subject under test; keep it from escaping.
  inner.catch(() => undefined);

  const record = { reactions: 0 };
  return {
    record,
    promise: {
      then(onFulfilled, onRejected) {
        record.reactions += 1;
        return inner.then(onFulfilled, onRejected);
      },
      catch: (onRejected) => inner.catch(onRejected),
    },
  };
}

test('a URL we do not watch is never touched', async () => {
  // The reported bug, and the trap on the other side of it. The site's
  // analytics call fails and the site ignores it: before, an `async` wrapper
  // re-threw it from the extension's frame so Chrome blamed observer.js.
  // Attaching a handler to every promise would fix the blame by hiding the
  // error entirely — worse. So an unwatched URL gets nothing attached, and the
  // page's own reporting is exactly what it was.
  const { record, promise } = watched(() => Promise.reject(new TypeError('Failed to fetch')));
  const page = scope(() => promise);
  wrapFetch(page, { watch: (url) => url.includes('/check/'), onResponse: () => {} });

  const returned = page.fetch('https://analytics.example.com/collect');
  assert.equal(returned, promise, 'and the page gets its own promise back');
  assert.equal(record.reactions, 0, 'nothing may attach to a promise we do not read');
});

test('a watched URL is read, and its rejection handled by us', async () => {
  // Reading a response means attaching, which marks the promise handled. That
  // is the deliberate cost, confined by `watch` to the judge's own poll — an
  // endpoint whose failure the adapter reports with far more context than a
  // console line would carry.
  const { record, promise } = watched(() => Promise.reject(new TypeError('Failed to fetch')));
  const page = scope(() => promise);
  wrapFetch(page, { watch: (url) => url.includes('/check/'), onResponse: () => {} });

  page.fetch('https://leetcode.com/submissions/detail/1/check/');
  assert.equal(record.reactions, 1);
});

test('with no onResponse, nothing is ever attached', async () => {
  // The Parikshaa injector only reads request headers, so it must leave every
  // promise on that site completely alone.
  const { record, promise } = watched(() => Promise.reject(new TypeError('Failed to fetch')));
  const page = scope(() => promise);
  wrapFetch(page, { onRequest: () => {} });

  page.fetch('https://parikshaa.org/anything');
  assert.equal(record.reactions, 0);
});

test('observation never delays or blocks the request', async () => {
  let observedAt = 0;
  const page = scope(async () => new Response('ok'));

  wrapFetch(page, {
    onRequest: () => {
      observedAt += 1;
      throw new Error('an observer that throws');
    },
    onResponse: () => {
      throw new Error('and one that throws on the way back');
    },
  });

  // Neither throw may reach the caller.
  const response = await page.fetch('https://example.com/');
  assert.equal(await response.text(), 'ok');
  assert.equal(observedAt, 1);
});

test('the observer sees the URL and method for all three input shapes', async () => {
  const calls = [];
  const page = scope(async () => new Response('ok'));
  wrapFetch(page, { onRequest: (url, method) => calls.push(`${method} ${url}`) });

  await page.fetch('https://example.com/a');
  await page.fetch('https://example.com/b', { method: 'POST' });
  await page.fetch(new Request('https://example.com/c', { method: 'PUT' }));
  await page.fetch(new URL('https://example.com/d'));

  assert.deepEqual(calls, [
    'GET https://example.com/a',
    'POST https://example.com/b',
    'PUT https://example.com/c',
    'GET https://example.com/d',
  ]);
});

test('a Request is handed through so its own headers can be read', async () => {
  let carried;
  const page = scope(async () => new Response('ok'));
  wrapFetch(page, { onRequest: (_url, _method, _init, input) => (carried = input) });

  const request = new Request('https://example.com/', { headers: { apikey: 'secret' } });
  await page.fetch(request);

  assert.equal(carried, request);
  assert.equal(carried.headers.get('apikey'), 'secret');
});

test('fetch still looks like fetch', () => {
  const original = async () => new Response('ok');
  const page = scope(original);
  wrapFetch(page, {});

  assert.equal(page.fetch.name, 'fetch');
  assert.equal(page.fetch.length, original.length);
  // Not spoofed as native: claiming to be something it is not would be a lie
  // to the page about what is installed.
  assert.doesNotMatch(String(page.fetch), /\[native code\]/);
});

test('a scope with no fetch is left alone', () => {
  const page = { fetch: undefined };
  wrapFetch(page, { onRequest: () => {} });
  assert.equal(page.fetch, undefined);
});

test('urlOf and methodOf agree with what fetch itself would do', () => {
  assert.equal(urlOf('https://example.com/x'), 'https://example.com/x');
  assert.equal(urlOf(new URL('https://example.com/y')), 'https://example.com/y');
  // `init.method` wins over the Request's, matching fetch's own precedence.
  assert.equal(methodOf(new Request('https://example.com/', { method: 'PUT' }), { method: 'PATCH' }), 'PATCH');
  assert.equal(methodOf('https://example.com/', undefined), 'GET');
});

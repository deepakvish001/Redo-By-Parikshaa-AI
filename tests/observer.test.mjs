import assert from 'node:assert/strict';
import test from 'node:test';

const HACKEREARTH_RESULT_URL =
  'https://www.hackerearth.com/response/submission-json/fixture-submission-id/AJAX/';
const EXCLUDED_HACKEREARTH_PAGES = [
  'https://www.hackerearth.com/practice/sql/example/',
  'https://www.hackerearth.com/practice/data-science/example/',
  'https://www.hackerearth.com/practice/file-upload/example/',
  'https://www.hackerearth.com/practice/algorithms/graphs/quiz/intro/',
];
const TRACKABLE_HACKEREARTH_PAGES = [
  'https://www.hackerearth.com/practice/algorithms/graphs/breadth-first-search/practice-problems/algorithm/monk-and-the-islands/',
  'https://www.hackerearth.com/community/problem/algorithm/make-an-array-85abd7ad/',
];

let observerImports = 0;

function installObserverPage(href) {
  const listeners = new Map();
  const messages = [];
  let editorReads = 0;

  class FakeXMLHttpRequest {
    #listeners = new Map();
    responseText = '{"status":"ok"}';

    open() {}

    send() {
      for (const listener of this.#listeners.get('load') ?? []) listener();
    }

    addEventListener(type, listener) {
      const handlers = this.#listeners.get(type) ?? [];
      handlers.push(listener);
      this.#listeners.set(type, handlers);
    }
  }

  const page = {
    location: new URL(href),
    fetch: async () => new Response('{"status":"ok"}'),
    monaco: {
      editor: {
        getModels: () => [{
          getValue: () => {
            editorReads += 1;
            return 'private editor source';
          },
        }],
      },
    },
    addEventListener(type, listener) {
      const handlers = listeners.get(type) ?? [];
      handlers.push(listener);
      listeners.set(type, handlers);
    },
    postMessage(message) {
      messages.push(message);
      for (const listener of listeners.get('message') ?? []) {
        listener({ source: page, data: message });
      }
    },
  };

  return { FakeXMLHttpRequest, page, messages, editorReads: () => editorReads };
}

function restoreGlobal(name, value) {
  if (value === undefined) delete globalThis[name];
  else globalThis[name] = value;
}

async function withObserver(href, run) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousXmlHttpRequest = globalThis.XMLHttpRequest;
  const harness = installObserverPage(href);

  globalThis.window = harness.page;
  globalThis.document = { querySelector: () => null };
  globalThis.XMLHttpRequest = harness.FakeXMLHttpRequest;

  try {
    await import(`../src/content/observer.ts?observer-test-${observerImports++}`);
    await run(harness);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return harness;
  } finally {
    restoreGlobal('window', previousWindow);
    restoreGlobal('document', previousDocument);
    restoreGlobal('XMLHttpRequest', previousXmlHttpRequest);
  }
}

function exchangeWasRelayed(harness) {
  return harness.messages.some((message) => message.url === HACKEREARTH_RESULT_URL);
}

test('excluded HackerEarth pages never read or relay editor source through fetch', async () => {
  for (const href of EXCLUDED_HACKEREARTH_PAGES) {
    const harness = await withObserver(href, async ({ page }) => page.fetch(HACKEREARTH_RESULT_URL));
    assert.equal(harness.editorReads(), 0, href);
    assert.equal(exchangeWasRelayed(harness), false, href);
  }
});

test('excluded HackerEarth pages never read or relay editor source through XMLHttpRequest', async () => {
  for (const href of EXCLUDED_HACKEREARTH_PAGES) {
    const harness = await withObserver(href, async () => {
      const request = new globalThis.XMLHttpRequest();
      request.open('GET', HACKEREARTH_RESULT_URL);
      request.send();
    });
    assert.equal(harness.editorReads(), 0, href);
    assert.equal(exchangeWasRelayed(harness), false, href);
  }
});

test('trackable HackerEarth problem pages still read and relay final results through fetch', async () => {
  for (const href of TRACKABLE_HACKEREARTH_PAGES) {
    const harness = await withObserver(href, async ({ page }) => page.fetch(HACKEREARTH_RESULT_URL));
    assert.equal(harness.editorReads(), 1, href);
    assert.equal(exchangeWasRelayed(harness), true, href);
  }
});

test('trackable HackerEarth problem pages still read and relay final results through XMLHttpRequest', async () => {
  for (const href of TRACKABLE_HACKEREARTH_PAGES) {
    const harness = await withObserver(href, async () => {
      const request = new globalThis.XMLHttpRequest();
      request.open('GET', HACKEREARTH_RESULT_URL);
      request.send();
    });
    assert.equal(harness.editorReads(), 1, href);
    assert.equal(exchangeWasRelayed(harness), true, href);
  }
});

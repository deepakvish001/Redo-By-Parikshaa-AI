import assert from 'node:assert/strict';
import test from 'node:test';

const HACKEREARTH_RESULT_URL =
  'https://www.hackerearth.com/response/submission-json/fixture-submission-id/AJAX/';

function installObserverPage(href) {
  const listeners = new Map();
  const messages = [];
  let editorReads = 0;

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

  return { page, messages, editorReads: () => editorReads };
}

function restoreGlobal(name, value) {
  if (value === undefined) delete globalThis[name];
  else globalThis[name] = value;
}

test('an allowlisted HackerEarth result on an excluded practice page never reads or relays editor source', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousXmlHttpRequest = globalThis.XMLHttpRequest;
  const harness = installObserverPage('https://www.hackerearth.com/practice/sql/');

  class FakeXMLHttpRequest {
    open() {}
    send() {}
  }

  globalThis.window = harness.page;
  globalThis.document = { querySelector: () => null };
  globalThis.XMLHttpRequest = FakeXMLHttpRequest;

  try {
    await import('../src/content/observer.ts?excluded-hackerearth-route');
    await harness.page.fetch(HACKEREARTH_RESULT_URL);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(harness.editorReads(), 0);
    assert.equal(
      harness.messages.some((message) => message.url === HACKEREARTH_RESULT_URL),
      false,
    );
  } finally {
    restoreGlobal('window', previousWindow);
    restoreGlobal('document', previousDocument);
    restoreGlobal('XMLHttpRequest', previousXmlHttpRequest);
  }
});

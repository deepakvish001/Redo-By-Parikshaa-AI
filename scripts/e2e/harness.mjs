import { chromium } from 'playwright';
import { globSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end harness: the built extension, loaded unpacked into Chromium, with
 * every outbound request answered by a stub.
 *
 * The judges are unreachable from CI and from the container this was written
 * in, and pointing the tests at the real ones would make them fail for reasons
 * that have nothing to do with the code. So every origin the extension talks to
 * is answered here, from fixtures shaped like the real responses. What this
 * proves is the wiring — that a message reaches its handler, that the handler
 * reads the response it is given, and that what comes back is what the panel
 * expects. What it cannot prove is that the judges still serve that shape.
 */

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const dist = resolve(root, 'dist');

/**
 * Playwright's own Chromium if it is where Playwright expects, and the one the
 * container pre-installs otherwise. An extension has to be loaded into a real
 * browser, so there is no headless-shell shortcut here.
 */
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root) return undefined;
  const candidates = globSync(join(root, 'chromium*', 'chrome-linux', 'chrome'));
  return candidates.sort().at(-1);
}

const CHROMIUM = findChromium();

/* --------------------------------------------------------------- results */

const results = [];
let currentGroup = 'general';

export function group(name) {
  currentGroup = name;
}

export async function check(name, fn) {
  try {
    await fn();
    results.push({ group: currentGroup, name, ok: true });
  } catch (error) {
    results.push({
      group: currentGroup,
      name,
      ok: false,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
}

export function report() {
  const failed = results.filter((entry) => !entry.ok);
  let group_ = null;
  for (const entry of results) {
    if (entry.group !== group_) {
      group_ = entry.group;
      console.log(`\n  ${group_}`);
    }
    console.log(`    ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}`);
    if (!entry.ok) console.log(`         ${entry.error.split('\n').slice(0, 6).join('\n         ')}`);
  }
  console.log(`\n  ${results.length - failed.length}/${results.length} passed\n`);
  return failed.length;
}

/* ----------------------------------------------------------------- stubs */

/**
 * Requests the stubs actually received, so a check can assert that the
 * extension called out at all — the difference between "the commit succeeded"
 * and "nothing was ever sent and the code reported success anyway".
 */
export const calls = [];

export function called(predicate) {
  return calls.filter(predicate);
}

export function clearCalls() {
  calls.length = 0;
}

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const html = (body, status = 200) => ({ status, contentType: 'text/html; charset=utf-8', body });

export { json, html };

/* ------------------------------------------------------------- launching */

export async function launch({ routes }) {
  const profile = mkdtempSync(join(tmpdir(), 'redo-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROMIUM,
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    viewport: { width: 1280, height: 900 },
  });

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.startsWith('chrome-extension://') || url.startsWith('devtools://')) {
      return route.continue();
    }

    let postData = null;
    try {
      postData = request.postData();
    } catch {
      postData = null;
    }
    calls.push({ url, method: request.method(), postData, headers: request.headers() });

    for (const [match, respond] of routes) {
      if (match(url, request)) {
        const answer = await respond(url, request);
        if (answer === undefined) continue;
        return route.fulfill(answer);
      }
    }

    // Anything unstubbed is a hole in the harness, not a pass. Failing loudly
    // here is what stops a check from quietly asserting against a 404.
    return route.fulfill({
      status: 599,
      contentType: 'text/plain',
      body: `UNSTUBBED ${request.method()} ${url}`,
    });
  });

  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 30_000 }));
  const id = new URL(worker.url()).host;

  // The worker registers its listeners as it evaluates; a message sent before
  // that resolves is dropped rather than answered.
  await new Promise((r) => setTimeout(r, 1200));

  /** An extension page is needed to send messages — the worker cannot message itself. */
  const driver = await context.newPage();
  const pageErrors = [];
  driver.on('pageerror', (error) => pageErrors.push(String(error)));
  await driver.goto(`chrome-extension://${id}/panel/index.html`);

  const send = async (request) => {
    const response = await driver.evaluate(
      (message) =>
        new Promise((resolve_) => {
          chrome.runtime.sendMessage(message, (answer) => {
            if (chrome.runtime.lastError) {
              resolve_({ ok: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve_(answer);
          });
        }),
      request,
    );
    return response;
  };

  /** Sends and throws on failure, so a check reads as a straight line. */
  const ask = async (request) => {
    const response = await send(request);
    if (!response?.ok) {
      throw new Error(`${request.type} failed: ${response?.error ?? 'no response'}`);
    }
    return response.data;
  };

  const storage = {
    get: (keys) => driver.evaluate((k) => chrome.storage.local.get(k), keys),
    set: (items) => driver.evaluate((i) => chrome.storage.local.set(i), items),
    clear: () => driver.evaluate(() => chrome.storage.local.clear()),
  };

  return { context, worker, id, driver, send, ask, storage, pageErrors, profile };
}

export async function shutdown(rig) {
  await rig.context.close();
  rmSync(rig.profile, { recursive: true, force: true });
}

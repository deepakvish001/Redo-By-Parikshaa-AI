import { chromium } from 'playwright';
import { globSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { routes } from '../e2e/stubs.mjs';
import { OVERLAY_CSS, drawAnnotations } from './annotate.mjs';
import { contests, daily, meta, problems, settings, sheets } from './seed.mjs';

/**
 * The Chrome Web Store screenshots, annotated.
 *
 * Rendered at exactly **1280×800**, which is what the store accepts — it is not
 * a minimum, and an upload at 2560×1600 is rejected. A second copy is written to
 * `2x/` for the README and anywhere else that wants a retina asset.
 *
 * The judges cannot be reached from CI, so the pages the extension decorates are
 * served by the same stubs the end-to-end suite uses. That keeps one set of
 * fixtures for both, and means a screenshot of the Codeforces workspace is a
 * screenshot of the real workspace, over a page shaped like the real one, rather
 * than a mock-up that can drift away from the product.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const dist = resolve(root, 'dist');
const out = resolve(root, 'docs/screenshots');

const WIDTH = 1280;
const HEIGHT = 800;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsers) return undefined;
  return globSync(join(browsers, 'chromium*', 'chrome-linux', 'chrome')).sort().at(-1);
}

/* ------------------------------------------------------------- the frame */

const FRAME_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; overflow: hidden;
    font-family: 'Manrope', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
  body { background: #060608; color: #fafafa; position: relative; }
  /* The same warm bloom the product uses, kept well behind the content. */
  body::before { content: ''; position: absolute; width: 1000px; height: 1000px; border-radius: 50%;
    left: -320px; top: -380px;
    background: radial-gradient(circle, rgba(249,115,22,.20) 0%, rgba(251,191,36,.07) 42%, transparent 68%); }
  body::after { content: ''; position: absolute; inset: 0;
    background: radial-gradient(circle at 84% 88%, rgba(251,191,36,.08) 0%, transparent 55%); }
  .head { position: absolute; left: 56px; top: 44px; z-index: 2; width: 356px; }
  .eyebrow { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 14px;
    padding: 5px 13px 5px 6px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,.13); background: rgba(255,255,255,.04);
    font-size: 12.5px; font-weight: 650; color: #e8e2d8; }
  .eyebrow b { width: 21px; height: 21px; border-radius: 7px; display: grid; place-items: center;
    background: linear-gradient(135deg,#f97316,#fbbf24); color: #1a1006; font-size: 12px; }
  h1 { font-size: 31px; line-height: 1.16; margin: 0; font-weight: 750; letter-spacing: -0.022em; }
  h1 em { font-style: normal; background: linear-gradient(135deg,#fb923c,#fbbf24);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .shot { position: absolute; border-radius: 16px; overflow: hidden; z-index: 1;
    box-shadow: 0 34px 80px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.09); background: #060608; }
  iframe { display: block; border: 0; }
</style></head><body>
  <div class="head"><span class="eyebrow"><b>&#8635;</b><span id="e"></span></span><h1 id="t"></h1></div>
  <div class="shot" id="shot"><iframe id="f"></iframe></div>
<script src="_frame.js"></script></body></html>`;

// Extension pages run under a CSP that blocks inline script, so the frame's
// few lines of setup have to be a file of their own.
const FRAME_JS = `const q = new URLSearchParams(location.search);
document.getElementById('e').textContent = q.get('eyebrow') || 'Redo';
document.getElementById('t').innerHTML = (q.get('title') || '')
  .replace(/\\*(.+?)\\*/g, '<em>$1</em>').replace(/\\n/g, '<br>');
const shot = document.getElementById('shot');
const f = document.getElementById('f');
f.style.width = q.get('w') + 'px';
f.style.height = q.get('h') + 'px';
shot.style.left = q.get('x') + 'px';
shot.style.top = q.get('y') + 'px';
f.src = q.get('page');`;

/* -------------------------------------------------------------- the shots */

/**
 * Every shot names its file, its headline, and the controls its callouts point
 * at. A selector that stops matching stops the render — a callout pointing at
 * nothing is worse than no callout.
 */
const SHOTS = [
  {
    file: '01-due-for-revision.png',
    eyebrow: 'Spaced repetition',
    title: 'You solved it once.\n*Now you keep it.*',
    page: 'panel/index.html',
    tab: 'Due',
    labels: [
      { at: '.duestat--due', title: 'Everything due, in one place', say: 'The toolbar badge carries this number, so you know without opening anything.' },
      { at: '.card__ratings', say: 'Re-solve it, then rate how it went. Good moves it up the ladder — 1, 3, 7, 21, 45, 90 days. Forgot sends it back to the start.' },
      { at: '.sessionstart', say: 'Nineteen due is nineteen decisions. A session makes it one, then hands you the problems one at a time.' },
    ],
  },
  {
    file: '02-practice-sheets.png',
    eyebrow: 'Sheets',
    title: 'Blind 75, NeetCode,\n*or your own list.*',
    page: 'panel/index.html',
    tab: 'Sheets',
    labels: [
      { at: '.card', title: 'What to do next, from one sheet', say: 'Drawn from the section closest to finished — finishing one beats starting a fourth.' },
      { at: '.sheet__bar', title: 'Tracked against what you have already solved', say: 'Blind 75 is built in; any other list is imported by pasting it. Problems you solved before importing already count.' },
      { at: '.sheet:nth-of-type(2) .sheet__meta', say: 'Sections are counted separately, and problems behind LeetCode Premium are marked rather than hidden.' },
    ],
  },
  {
    file: '03-search-your-own-code.png',
    eyebrow: 'Search',
    title: 'Where did I use a\n*monotonic stack?*',
    page: 'panel/index.html',
    tab: 'Solved',
    type: ['.search input', 'monotonic'],
    labels: [
      { at: '.search input', title: 'Searches the code, not just titles', say: 'The one question you could only answer by cloning the repo and grepping it.' },
      { at: '.row__snippet', say: 'The matching line itself, with its number — and where it matched: title, tag, note or code.' },
    ],
  },
  {
    file: '04-mock-interview.png',
    eyebrow: 'Mock interview',
    title: 'One problem.\n*Thirty-five minutes.*',
    page: 'panel/index.html',
    tab: 'Train',
    labels: [
      { at: '.mock__clock', title: 'A real clock', say: 'It runs from its end time, so closing the panel or sleeping the laptop does not reset it.' },
      { at: '.mock__problem', say: 'Drawn from what you solved at least a week ago — the things furthest from your fingertips.' },
      { at: '.mock__actions', say: 'Hints and your own old solution stay sealed until you stop the clock.' },
    ],
  },
  {
    file: '05-weak-topics.png',
    eyebrow: 'Analytics',
    title: 'Know which topics\n*are actually weak.*',
    page: 'panel/index.html',
    tab: 'Stats',
    scrollTo: 'Topics',
    labels: [
      { at: '.dough', title: 'What you actually practise', say: 'Every tag you have solved, weighted — not a list of what the judge happens to label things.' },
      { at: '.bar-row:has-text("Graph")', title: 'Mastery, from evidence', say: 'Built from lapses, attempts, hints taken and time spent — not from a solved count.' },
    ],
  },
  {
    file: '06-committed-to-github.png',
    eyebrow: 'GitHub sync',
    title: 'Every solution,\n*committed and annotated.*',
    page: 'panel/index.html',
    tab: 'Solved',
    labels: [
      { at: '.row', title: 'Your own repository', say: 'leetcode/medium/0011-.../solution.py, with a README carrying the link, tags, judge stats and your notes.' },
      { at: '.folder:has-text("Codeforces") .folder__head', say: 'Grouped by judge, and committed that way too — one repository for everything, or one per judge.' },
    ],
  },
  {
    file: '07-contest-radar.png',
    eyebrow: 'Contests',
    title: 'Four judges,\n*one contest list.*',
    page: 'panel/index.html',
    tab: 'Train',
    scrollTo: 'Codeforces Round 900',
    labels: [
      { at: '.card:has-text("Codeforces Round 900")', title: 'Codeforces, LeetCode, CodeChef and AtCoder', say: 'One list, with a countdown, a calendar link, and a notification before it starts.' },
    ],
  },
  {
    file: '08-settings.png',
    eyebrow: 'Private by construction',
    title: 'No server, no account,\n*no analytics.*',
    page: 'options/index.html',
    width: 760,
    height: 640,
    labels: [
      { at: '.settings__nav', title: 'Five groups, and a search across all of them', say: 'Nine sections of settings, without the hunt.' },
      { at: '#s-github-sync .field:has(input[type="password"])', say: 'A fine-grained GitHub token, scoped to the single repository you name, Contents only. It never leaves this browser.' },
    ],
  },
];

/** The shots taken on a judge's own page rather than inside the extension. */
const PAGE_SHOTS = [
  {
    file: '09-codeforces-workspace.png',
    url: 'https://codeforces.com/problemset/problem/1899/A',
    inject: 'workspace',
    labels: [
      { at: '#redo-workspace .cm-line', title: 'Statement and editor, side by side', say: 'No more scrolling between the problem and the box you type in. Your draft is kept per problem.' },
      { at: '#redo-workspace button:text-is("Run")', say: 'Run sends the code to Codeforces\u2019 own custom invocation and shows the output below.' },
      { at: '#redo-workspace textarea', say: 'The sample cases are lifted straight from the statement, so there is nothing to paste.' },
    ],
  },
  {
    file: '10-problem-of-the-day.png',
    url: 'https://codeforces.com/problemset',
    labelsFrom: 620,
    labels: [
      { at: 'tr.redo-potd', title: 'A problem a day, pinned to the top of the list', say: 'Picked from the problem set at your own rating, in Codeforces\u2019 own table markup. Skip it and you get another.' },
      { at: '#redo-mount-cf-daily .note', side: 'right', say: 'The streak calendar sits in the sidebar — every day you solved, at a glance.' },
    ],
  },
];

/* --------------------------------------------------------------- rendering */

async function render(scale) {
  const profile = mkdtempSync(join(tmpdir(), 'redo-shots-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: findChromium(),
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: scale,
  });

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.startsWith('chrome-extension://') || url.startsWith('devtools://')) return route.continue();
    for (const [match, respond] of routes) {
      if (match(url, request)) {
        const answer = await respond(url, request);
        if (answer !== undefined) return route.fulfill(answer);
      }
    }
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not stubbed' });
  });

  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 30_000 }));
  const id = new URL(worker.url()).host;
  await new Promise((r) => setTimeout(r, 1500));

  const folder = scale === 1 ? out : join(out, '2x');
  mkdirSync(folder, { recursive: true });

  // Seed, through the extension's own storage.
  const seeder = await context.newPage();
  await seeder.goto(`chrome-extension://${id}/panel/index.html`);
  await seeder.evaluate(
    async ([stored, patch]) => {
      await chrome.storage.local.set(stored);
      const current = await new Promise((done) =>
        chrome.runtime.sendMessage({ type: 'settings:get' }, (answer) => done(answer.data)),
      );
      await new Promise((done) =>
        chrome.runtime.sendMessage(
          { type: 'settings:save', patch: { github: { ...current.github, ...patch.github }, handles: { ...current.handles, ...patch.handles } } },
          done,
        ),
      );
    },
    [{ problems, meta, contests, sheets, daily }, settings],
  );
  // A round in progress, so the mock card shows a clock rather than its
  // starting state — the clock is the thing worth showing.
  await seeder.evaluate(
    () => new Promise((done) => chrome.runtime.sendMessage({ type: 'mock:start', minutes: 35 }, done)),
  );
  // The problem-of-the-day card has nothing to show until the Codeforces
  // mirror has been pulled — the pick comes out of the problem set.
  const ask = (message) =>
    seeder.evaluate((m) => new Promise((done) => chrome.runtime.sendMessage(m, done)), message);
  await ask({ type: 'cf:refresh' });
  await ask({ type: 'daily:get' });
  // Warmed here so the Train tab is not photographed saying "Loading rating…".
  await ask({ type: 'rating:profiles' });
  await ask({ type: 'contests:get' });
  await seeder.close();

  /** Measures each callout's target and draws the layer. */
  async function annotate(page, labels, locate, shotTop = 16) {
    const items = [];
    for (const label of labels) {
      const box = await locate(label.at);
      if (!box) throw new Error(`callout target not found: ${label.at}`);
      // An off-screen target draws an arrow into the void; better to stop and
      // be told which callout needs a different anchor.
      if (box.y + box.height < 0 || box.y > HEIGHT || box.x > WIDTH) {
        throw new Error(`callout target is outside the frame: ${label.at} at y=${Math.round(box.y)}`);
      }
      items.push({
        ...label,
        target: box,
        // The headline occupies the top-left; callouts start below it.
        column: { left: 56, right: WIDTH - 56, top: shotTop },
      });
    }
    await page.addStyleTag({ content: OVERLAY_CSS });
    await page.evaluate(
      ([drawn, source, viewport]) => {
        // eslint-disable-next-line no-new-func
        new Function(`return ${source}`)()(drawn, viewport);
      },
      [items, drawAnnotations.toString(), { width: WIDTH, height: HEIGHT }],
    );
  }

  /* ---- the extension's own pages, framed ---- */

  writeFileSync(resolve(dist, '_frame.html'), FRAME_HTML);
  writeFileSync(resolve(dist, '_frame.js'), FRAME_JS);

  for (const shot of SHOTS) {
    const page = await context.newPage();
    const width = shot.width ?? 424;
    const height = shot.height ?? 640;
    const x = WIDTH - width - 64;
    const y = Math.round((HEIGHT - height) / 2);

    const params = new URLSearchParams({
      page: `/${shot.page}`,
      eyebrow: shot.eyebrow,
      title: shot.title,
      w: String(width),
      h: String(height),
      x: String(x),
      y: String(y),
    });
    await page.goto(`chrome-extension://${id}/_frame.html?${params}`);
    await page.waitForTimeout(1400);

    const inner = page.frameLocator('#f');
    if (shot.tab) {
      await inner.getByRole('tab', { name: new RegExp(`^${shot.tab}`) }).click();
      // Long enough for the tab's own fetches to settle; a card caught saying
      // "Loading…" is a screenshot of the product looking broken.
      await page.waitForTimeout(2200);
    }
    if (shot.type) {
      await inner.locator(shot.type[0]).fill(shot.type[1]);
      await page.waitForTimeout(900);
    }
    if (shot.scrollTo) {
      await inner.getByText(shot.scrollTo, { exact: false }).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(1200);
    }

    // Below the headline, which ends around 210px in the framed shots.
    await annotate(page, shot.labels, async (selector) =>
      inner.locator(selector).first().boundingBox(), 214,
    );

    await page.screenshot({ path: join(folder, shot.file) });
    console.log(`  ${shot.file}`);
    await page.close();
  }

  /* ---- the judges' own pages, as they really appear ---- */

  for (const shot of PAGE_SHOTS) {
    const page = await context.newPage();
    await page.goto(shot.url);
    await page.waitForTimeout(2000);

    if (shot.inject === 'workspace') {
      await worker.evaluate(async (target) => {
        const [tab] = await chrome.tabs.query({ url: target });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['workspace.js'] });
      }, shot.url);
      await page.waitForTimeout(2000);
      await page.locator('#redo-workspace').locator('.cm-content').click();
      await page.keyboard.type('int main(){\n    puts("YES");\n}');
      await page.waitForTimeout(600);
    }

    // A judge's page has content everywhere, so the callouts sit low-left
    // where the statement runs out rather than over the toolbar.
    await annotate(page, shot.labels, async (selector) =>
      page.locator(selector).first().boundingBox(), shot.labelsFrom ?? 330,
    );

    await page.screenshot({ path: join(folder, shot.file) });
    console.log(`  ${shot.file}`);
    await page.close();
  }

  rmSync(resolve(dist, '_frame.html'), { force: true });
  rmSync(resolve(dist, '_frame.js'), { force: true });
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}

mkdirSync(out, { recursive: true });
console.log(`\nStore screenshots — ${WIDTH}x${HEIGHT}\n`);
await render(1);
console.log(`\nRetina copies — ${WIDTH * 2}x${HEIGHT * 2} (docs/screenshots/2x)\n`);
await render(2);
console.log('\ndone\n');

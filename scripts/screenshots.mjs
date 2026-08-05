import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Renders the Chrome Web Store screenshots at the 1280×800 the listing wants.
 *
 * The popup is 384px wide, so it is framed inside an extension-hosted page
 * rather than captured raw — an iframe of `chrome-extension://` only loads from
 * the same extension origin, which is why the frame lives in `dist/`.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const out = resolve(root, 'docs/screenshots');
const frame = resolve(dist, '_screenshot-frame.html');
const frameScript = resolve(dist, '_screenshot-frame.js');

const DAY = 86_400_000;
const now = Date.now();

const problem = (over) => ({
  platform: 'leetcode',
  language: 'Python3',
  code: 'class Solution:\n    def solve(self): ...',
  attempts: 1,
  github: { status: 'synced', path: 'leetcode/medium/x/solution.py', commitUrl: 'https://github.com/x' },
  parikshaa: { status: 'synced' },
  solvedAt: now - 6 * DAY,
  ...over,
  revision: { stage: 1, ease: 1, dueAt: now + DAY, reviewCount: 1, lapses: 0, hintsUsed: 0, ...(over.revision ?? {}) },
});

const problems = {
  'leetcode:two-sum': problem({
    id: 'leetcode:two-sum', problemId: '1', slug: 'two-sum', title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/', difficulty: 'easy',
    tags: ['Array', 'Hash Table'], solvedAt: now - 9 * DAY, solveTimeMs: 11 * 60_000,
    revision: { stage: 2, dueAt: now - 2 * DAY, reviewCount: 3, lapses: 1 },
  }),
  'leetcode:word-break': problem({
    id: 'leetcode:word-break', problemId: '139', slug: 'word-break', title: 'Word Break',
    url: 'https://leetcode.com/problems/word-break/', difficulty: 'medium',
    tags: ['Dynamic Programming', 'Hash Table'], attempts: 4, solveTimeMs: 52 * 60_000,
    revision: { stage: 0, dueAt: now - DAY, reviewCount: 2, lapses: 2, hintsUsed: 2 },
  }),
  'leetcode:trapping-rain-water': problem({
    id: 'leetcode:trapping-rain-water', problemId: '42', slug: 'trapping-rain-water',
    title: 'Trapping Rain Water', url: 'https://leetcode.com/problems/trapping-rain-water/',
    difficulty: 'hard', tags: ['Array', 'Two Pointers'], solveTimeMs: 38 * 60_000,
    solvedAt: now - DAY,
    revision: { stage: 3, dueAt: now + 11 * DAY, reviewCount: 4 },
  }),
  'leetcode:lru-cache': problem({
    id: 'leetcode:lru-cache', problemId: '146', slug: 'lru-cache', title: 'LRU Cache',
    url: 'https://leetcode.com/problems/lru-cache/', difficulty: 'medium',
    tags: ['Hash Table', 'Linked List'], solveTimeMs: 26 * 60_000, solvedAt: now,
    revision: { stage: 1, dueAt: now + 2 * DAY, reviewCount: 2 },
  }),
  'codeforces:1352A': problem({
    id: 'codeforces:1352A', platform: 'codeforces', problemId: '1352A', slug: '1352A',
    title: 'Sum of Round Numbers', url: 'https://codeforces.com/contest/1352/problem/A',
    difficulty: 'easy', tags: ['implementation', 'math'], language: 'GNU C++17',
    revision: { stage: 2, dueAt: now + 4 * DAY, reviewCount: 2 },
  }),
  'atcoder:abc390_c': problem({
    id: 'atcoder:abc390_c', platform: 'atcoder', problemId: 'abc390_c', slug: 'abc390_c',
    title: 'Paint to make a rectangle', url: 'https://atcoder.jp/contests/abc390/tasks/abc390_c',
    difficulty: 'unknown', tags: ['greedy'], language: 'C++ 20', solvedAt: now - 2 * DAY,
    revision: { stage: 1, dueAt: now + 6 * DAY, reviewCount: 1 },
  }),
};

const FRAME_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}
  body{display:flex;align-items:center;justify-content:center;gap:64px;
       background:linear-gradient(135deg,#1b1338 0%,#2b1c5c 45%,#3a2477 100%);color:#fff}
  .copy{max-width:430px}
  h1{font-size:38px;line-height:1.15;margin:0 0 16px;font-weight:680;letter-spacing:-0.02em}
  p{font-size:17px;line-height:1.55;margin:0;color:#c9c3e8}
  .shot{border-radius:16px;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,.45);
        border:1px solid rgba(255,255,255,.14);background:#fff;flex:none}
  iframe{display:block;border:0}
</style></head><body>
  <div class="copy"><h1 id="t"></h1><p id="s"></p></div>
  <div class="shot" id="shot"><iframe id="f"></iframe></div>
<script src="_screenshot-frame.js"></script></body></html>`;

// Extension pages run under a strict CSP that blocks inline scripts, so the
// frame's few lines of setup have to be a file of their own.
const FRAME_JS = `const q = new URLSearchParams(location.search);
document.getElementById('t').textContent = q.get('title') || '';
document.getElementById('s').textContent = q.get('sub') || '';
const f = document.getElementById('f');
f.style.width = (q.get('w') || 384) + 'px';
f.style.height = (q.get('h') || 552) + 'px';
f.src = q.get('page');`;

const SHOTS = [
  {
    file: '1-due.png',
    page: 'popup/index.html',
    title: 'Revise before you forget',
    sub: 'Every solved problem comes back on a spaced-repetition schedule. Rate how it went and the schedule adapts.',
    tab: 'Due',
  },
  {
    file: '2-stats.png',
    page: 'popup/index.html',
    title: 'Know which topics are actually weak',
    sub: 'Mastery is computed from your own history — lapses, attempts, hints and time, not just a solved count.',
    tab: 'Stats',
  },
  {
    file: '3-solved.png',
    page: 'popup/index.html',
    title: 'Every solution, committed and annotated',
    sub: 'Solutions land in your GitHub repo with your notes and complexity, and stay in sync with Parikshaa.',
    tab: 'Solved',
  },
  {
    file: '4-options.png',
    page: 'options/index.html',
    title: 'Yours, and only yours',
    sub: 'No server, no account, no analytics. Connect a repo you own — or use it entirely offline.',
    width: 720,
    height: 660,
  },
];

mkdirSync(out, { recursive: true });
writeFileSync(frame, FRAME_HTML);
writeFileSync(frameScript, FRAME_JS);

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'smriti-shots-')), {
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});

try {
  await new Promise((r) => setTimeout(r, 2500));
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(worker.url()).host;

  const seed = await context.newPage();
  await seed.goto(`chrome-extension://${id}/popup/index.html`);
  await seed.evaluate(([p]) => chrome.storage.local.set({ problems: p }), [problems]);
  await seed.close();

  for (const shot of SHOTS) {
    // The tab is chosen inside the popup, so it is clicked through the frame.
    const page = await context.newPage();
    const params = new URLSearchParams({
      page: `/${shot.page}`,
      title: shot.title,
      sub: shot.sub,
      w: String(shot.width ?? 384),
      h: String(shot.height ?? 552),
    });
    await page.goto(`chrome-extension://${id}/_screenshot-frame.html?${params}`);
    await page.waitForTimeout(900);

    if (shot.tab) {
      const inner = page.frameLocator('#f');
      await inner.getByRole('tab', { name: new RegExp(`^${shot.tab}`) }).click();
      await page.waitForTimeout(600);
    }

    await page.screenshot({ path: resolve(out, shot.file) });
    console.log(`wrote docs/screenshots/${shot.file}`);
    await page.close();
  }
} finally {
  rmSync(frame, { force: true });
  rmSync(frameScript, { force: true });
  await context.close();
}

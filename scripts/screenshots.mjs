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

/**
 * Representative contests for the listing image. The shapes come from the real
 * parsers; the entries are seeded rather than fetched because these renders run
 * without network access to the judges.
 */
const HOUR = 3_600_000;
const contests = {
  fetchedAt: now,
  failed: [],
  contests: [
    { id: 'codeforces:1990', platform: 'codeforces', name: 'Codeforces Round 990 (Div. 2)',
      url: 'https://codeforces.com/contests/1990', startAt: now + 6 * HOUR, durationMs: 2 * HOUR },
    { id: 'leetcode:weekly-contest-482', platform: 'leetcode', name: 'Weekly Contest 482',
      url: 'https://leetcode.com/contest/weekly-contest-482', startAt: now + 2 * DAY + 3 * HOUR,
      durationMs: 90 * 60_000 },
    { id: 'codechef:START178', platform: 'codechef', name: 'Starters 178 (Div. 2)',
      url: 'https://www.codechef.com/START178', startAt: now + 3 * DAY + HOUR, durationMs: 3 * HOUR },
    { id: 'atcoder:abc391', platform: 'atcoder', name: 'AtCoder Beginner Contest 391',
      url: 'https://atcoder.jp/contests/abc391', startAt: now + 4 * DAY + 9 * HOUR,
      durationMs: 100 * 60_000 },
    { id: 'codeforces:1991', platform: 'codeforces', name: 'Educational Round 178 (Div. 2)',
      url: 'https://codeforces.com/contests/1991', startAt: now + 6 * DAY + 5 * HOUR,
      durationMs: 2 * HOUR },
  ],
};

const FRAME_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;
    font-family:'Manrope',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}
  body{display:flex;align-items:center;justify-content:center;gap:72px;color:#fafafa;
       background:#030305;position:relative;overflow:hidden}
  /* The same orange bloom Parikshaa uses, kept well behind the content. */
  body::before{content:'';position:absolute;width:900px;height:900px;border-radius:50%;
    left:-260px;top:-320px;
    background:radial-gradient(circle,rgba(249,115,22,.20) 0%,rgba(251,191,36,.08) 42%,transparent 68%)}
  body::after{content:'';position:absolute;inset:0;
    background:radial-gradient(circle at 78% 82%,rgba(251,191,36,.09) 0%,transparent 55%)}
  .copy{max-width:452px;position:relative;z-index:1}
  .eyebrow{display:inline-flex;align-items:center;gap:8px;margin-bottom:20px;
    padding:5px 12px 5px 6px;border-radius:999px;border:1px solid rgba(255,255,255,.13);
    background:rgba(255,255,255,.04);font-size:12.5px;font-weight:650;color:#e8e2d8}
  .eyebrow b{width:20px;height:20px;border-radius:6px;display:grid;place-items:center;
    background:linear-gradient(135deg,#f97316,#fbbf24);color:#1a1006;font-size:12px}
  h1{font-size:40px;line-height:1.12;margin:0 0 18px;font-weight:750;letter-spacing:-0.025em}
  h1 em{font-style:normal;background:linear-gradient(135deg,#fb923c,#fbbf24);
    -webkit-background-clip:text;background-clip:text;color:transparent}
  p{font-size:17px;line-height:1.6;margin:0;color:#a0a0a0}
  .shot{border-radius:18px;overflow:hidden;position:relative;z-index:1;flex:none;
        box-shadow:0 40px 90px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.09);background:#030305}
  iframe{display:block;border:0}
</style></head><body>
  <div class="copy">
    <span class="eyebrow"><b>↻</b><span id="e"></span></span>
    <h1 id="t"></h1><p id="s"></p>
  </div>
  <div class="shot" id="shot"><iframe id="f"></iframe></div>
<script src="_screenshot-frame.js"></script></body></html>`;

// Extension pages run under a strict CSP that blocks inline scripts, so the
// frame's few lines of setup have to be a file of their own.
const FRAME_JS = `const q = new URLSearchParams(location.search);
document.getElementById('e').textContent = q.get('eyebrow') || 'Redo';
// The title may mark one phrase with *stars* to receive the accent gradient.
document.getElementById('t').innerHTML = (q.get('title') || '')
  .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
  .replace(/\\n/g, '<br>');
document.getElementById('s').textContent = q.get('sub') || '';
const f = document.getElementById('f');
f.style.width = (q.get('w') || 384) + 'px';
f.style.height = (q.get('h') || 552) + 'px';
f.src = q.get('page');`;

const SHOTS = [
  {
    file: '1-due.png',
    page: 'panel/index.html',
    eyebrow: 'Spaced repetition',
    title: 'You solved it once.\n*Now you keep it.*',
    sub: 'Every accepted problem comes back on a schedule — 1, 3, 7, 21, 45, 90 days. Rate how the revision went and the schedule adapts to you.',
    tab: 'Due',
  },
  {
    file: '2-hint.png',
    page: 'panel/index.html',
    eyebrow: 'Hint ladder',
    title: 'Stuck? Get a nudge,\n*not the answer.*',
    sub: 'Three rungs: a question about the shape of the problem, then the approach, then your own previous solution. Hints you take count against the topic.',
    tab: 'Due',
  },
  {
    file: '3-stats.png',
    page: 'panel/index.html',
    eyebrow: 'Weak-topic analytics',
    title: 'Know which topics\n*are actually weak.*',
    sub: 'Mastery per topic comes from your own history: lapses, attempts, hints taken and time spent — not a solved count.',
    tab: 'Stats',
  },
  {
    file: '4-solved.png',
    page: 'panel/index.html',
    eyebrow: 'GitHub sync',
    title: 'Every solution,\n*committed and annotated.*',
    sub: 'Solutions land in your own repo as leetcode/medium/0011-.../solution.py, with a README carrying the link, tags, judge stats, your notes and complexity.',
    tab: 'Solved',
  },
  {
    file: '5-contests.png',
    page: 'panel/index.html',
    eyebrow: 'Contest radar',
    title: 'Four judges,\n*one contest list.*',
    sub: 'Codeforces, LeetCode, CodeChef and AtCoder together, with countdowns, calendar links and a notification before the start.',
    tab: 'Contests',
  },
  {
    file: '6-platforms.png',
    page: 'panel/index.html',
    eyebrow: 'Six platforms',
    title: 'Wherever you grind,\n*it gets tracked.*',
    sub: 'LeetCode, Codeforces, AtCoder, CodeChef, HackerRank and GeeksforGeeks — one adapter each, all switchable.',
    tab: 'Solved',
  },
  {
    file: '7-options.png',
    page: 'options/index.html',
    eyebrow: 'Private by construction',
    title: 'No server, no account,\n*no analytics.*',
    sub: 'Everything is stored in your browser. The only data that leaves goes to the GitHub repo you name — or to your own Parikshaa account, if you use it.',
    width: 690,
    height: 660,
  },
  {
    file: '8-parikshaa.png',
    page: 'options/index.html',
    eyebrow: 'Parikshaa sync',
    title: 'Solved on LeetCode,\n*ticked on Parikshaa.*',
    sub: 'Matching problems are marked solved on your Parikshaa account automatically, and due ones get badged inside its own sheets.',
    width: 690,
    height: 660,
    scrollTo: 'Parikshaa sync',
  },
];

mkdirSync(out, { recursive: true });
writeFileSync(frame, FRAME_HTML);
writeFileSync(frameScript, FRAME_JS);

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'redo-shots-')), {
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
  await seed.goto(`chrome-extension://${id}/panel/index.html`);
  await seed.evaluate(
    ([p, c]) => chrome.storage.local.set({ problems: p, contests: c }),
    [problems, contests],
  );
  await seed.close();

  for (const shot of SHOTS) {
    // The tab is chosen inside the popup, so it is clicked through the frame.
    const page = await context.newPage();
    const params = new URLSearchParams({
      page: `/${shot.page}`,
      title: shot.title,
      sub: shot.sub,
      eyebrow: shot.eyebrow ?? 'Redo',
      w: String(shot.width ?? 392),
      h: String(shot.height ?? 620),
    });
    await page.goto(`chrome-extension://${id}/_screenshot-frame.html?${params}`);
    await page.waitForTimeout(900);

    const inner = page.frameLocator('#f');
    if (shot.tab) {
      await inner.getByRole('tab', { name: new RegExp(`^${shot.tab}`) }).click();
      await page.waitForTimeout(600);
    }
    if (shot.scrollTo) {
      await inner.getByRole('heading', { name: shot.scrollTo }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    }
    if (shot.file.startsWith('2-')) {
      // The hint ladder only exists once a due problem offers it.
      await inner.getByRole('button', { name: 'Open problem' }).first().waitFor();
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

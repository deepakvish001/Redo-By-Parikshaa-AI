import { json, html } from './harness.mjs';

/**
 * Stand-ins for every origin the extension talks to.
 *
 * Each fixture is shaped like the response the real service returns, down to
 * the envelope — Codeforces' `{status, result}`, GitHub's `Link` pagination
 * header, LeetCode's `{data}` — because the envelope is exactly the part the
 * parsers get wrong. A stub that hands back a bare array would let a parser
 * that never reads `.result` pass.
 */

const DAY = 86_400_000;
const now = Date.now();
const secs = (ms) => Math.floor(ms / 1000);

/* ---------------------------------------------------------------- GitHub */

export const REPOS = [
  { full_name: 'deepakvish001/dsa', name: 'dsa', private: false, default_branch: 'main', owner: { login: 'deepakvish001' } },
  { full_name: 'deepakvish001/leetcode', name: 'leetcode', private: true, default_branch: 'main', owner: { login: 'deepakvish001' } },
  { full_name: 'deepakvish001/codeforces', name: 'codeforces', private: false, default_branch: 'master', owner: { login: 'deepakvish001' } },
];

/**
 * A very small Git, because the extension commits through the Git Data API.
 *
 * It builds a tree, makes a commit and moves the ref — which is what lets one
 * solve land as a single commit carrying both the solution and its README. A
 * stub that only answered `PUT /contents` would never exercise that path, and
 * would also hide the case the code specifically handles: an unchanged tree,
 * where committing again would add an empty commit to somebody's repository.
 */
const repos = new Map();

function repoState(key) {
  if (!repos.has(key)) {
    repos.set(key, { head: undefined, trees: new Map(), commits: new Map(), commitCount: 0 });
  }
  return repos.get(key);
}

/** Content-addressed, so identical files really do produce an identical sha. */
function shaOf(entries) {
  const text = [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([p, c]) => `${p}\0${c}`).join('\n');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + text.charCodeAt(i) + 1, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16) + h2.toString(16)).padStart(40, '0').slice(0, 40);
}

/** The files on the branch tip of a repository, as { path: content }. */
export function filesIn(key = 'deepakvish001/dsa') {
  const state = repos.get(key);
  if (!state?.head) return new Map();
  const commit = state.commits.get(state.head);
  return state.trees.get(commit.tree) ?? new Map();
}

/** Every commit made to a repository, oldest first. */
export function commitsIn(key = 'deepakvish001/dsa') {
  const state = repos.get(key);
  if (!state) return [];
  const out = [];
  let sha = state.head;
  while (sha) {
    const commit = state.commits.get(sha);
    if (!commit) break;
    out.unshift({ sha, ...commit });
    sha = commit.parents[0];
  }
  return out;
}

export function resetRepo() {
  repos.clear();
}

const repoKeyOf = (url) => {
  const [, owner, repo] = /\/repos\/([^/]+)\/([^/]+)/.exec(new URL(url).pathname) ?? [];
  return `${owner}/${repo}`;
};

/* ------------------------------------------------------------ Codeforces */

const cfOk = (result) => json({ status: 'OK', result });

export const CF_USER = {
  handle: 'deepakvish001',
  rating: 1420,
  maxRating: 1502,
  rank: 'specialist',
  maxRank: 'expert',
  contribution: 0,
  avatar: 'https://userpic.codeforces.org/x.jpg',
};

export const CF_CONTESTS = [
  { id: 1900, name: 'Codeforces Round 900 (Div. 2)', phase: 'BEFORE', type: 'CF', startTimeSeconds: secs(now + 2 * DAY), durationSeconds: 7200 },
  { id: 1899, name: 'Codeforces Round 899 (Div. 1)', phase: 'FINISHED', type: 'CF', startTimeSeconds: secs(now - 3 * DAY), durationSeconds: 7200 },
];

export const CF_PROBLEMS = {
  problems: [
    { contestId: 1899, index: 'A', name: 'Game with Integers', type: 'PROGRAMMING', rating: 800, tags: ['games', 'math'] },
    { contestId: 1899, index: 'B', name: 'Two Out of Three', type: 'PROGRAMMING', rating: 900, tags: ['implementation'] },
    { contestId: 1899, index: 'C', name: 'Yarik and Array', type: 'PROGRAMMING', rating: 1200, tags: ['dp', 'greedy'] },
    { contestId: 1899, index: 'D', name: 'Yarik and Musical Notes', type: 'PROGRAMMING', rating: 1500, tags: ['math', 'number theory'] },
    { contestId: 1898, index: 'B', name: 'Milena and Admirer', type: 'PROGRAMMING', rating: 1300, tags: ['greedy', 'math'] },
    { contestId: 1898, index: 'C', name: 'Colorful Table', type: 'PROGRAMMING', rating: 1600, tags: ['data structures'] },
    { contestId: 1897, index: 'C', name: 'Salyg1n and the MEX Game', type: 'PROGRAMMING', rating: 1400, tags: ['games', 'interactive'] },
    { contestId: 1897, index: 'D', name: 'Cyclic Operations', type: 'PROGRAMMING', rating: 1900, tags: ['dfs and similar', 'graphs'] },
  ],
  problemStatistics: [
    { contestId: 1899, index: 'A', solvedCount: 12000 },
    { contestId: 1899, index: 'B', solvedCount: 9000 },
    { contestId: 1899, index: 'C', solvedCount: 4000 },
    { contestId: 1899, index: 'D', solvedCount: 1500 },
    { contestId: 1898, index: 'B', solvedCount: 3000 },
    { contestId: 1898, index: 'C', solvedCount: 1100 },
    { contestId: 1897, index: 'C', solvedCount: 2400 },
    { contestId: 1897, index: 'D', solvedCount: 800 },
  ],
};

export const CF_STATUS = [
  {
    id: 231000001,
    contestId: 1899,
    creationTimeSeconds: secs(now - 2 * DAY),
    problem: { contestId: 1899, index: 'A', name: 'Game with Integers', rating: 800, tags: ['games', 'math'] },
    author: { members: [{ handle: 'deepakvish001' }] },
    programmingLanguage: 'GNU C++17',
    verdict: 'OK',
  },
  {
    id: 231000002,
    contestId: 1899,
    creationTimeSeconds: secs(now - 2 * DAY),
    problem: { contestId: 1899, index: 'C', name: 'Yarik and Array', rating: 1200, tags: ['dp', 'greedy'] },
    author: { members: [{ handle: 'deepakvish001' }] },
    programmingLanguage: 'GNU C++17',
    verdict: 'WRONG_ANSWER',
  },
];

export const CF_RATING = [
  { contestId: 1897, contestName: 'Codeforces Round 897', handle: 'deepakvish001', rank: 2100, oldRating: 1350, newRating: 1402, ratingUpdateTimeSeconds: secs(now - 30 * DAY) },
  { contestId: 1899, contestName: 'Codeforces Round 899', handle: 'deepakvish001', rank: 1800, oldRating: 1402, newRating: 1420, ratingUpdateTimeSeconds: secs(now - 3 * DAY) },
];

/** A Codeforces page as served to a signed-in browser: the handle is in the header. */
const CF_PAGE_BODY = `
<div id="header">
  <div class="lang-chooser"></div>
  <div style="text-align:right">
    <a href="/profile/deepakvish001">deepakvish001</a> |
    <a href="/logout">Logout</a>
  </div>
</div>`;

const cfProblemPage = (contestId, index) =>
  html(`<html><head><title>Problem ${contestId}${index}</title></head><body>
${CF_PAGE_BODY}
<div class="problemindexholder" problemindex="${index}">
  <div class="header"><div class="title">${index}. Game with Integers</div>
    <div class="time-limit"><div class="property-title">time limit per test</div>1 second</div>
    <div class="memory-limit"><div class="property-title">memory limit per test</div>256 megabytes</div>
  </div>
  <div class="problem-statement">
    <div class="legend"><p>Alice and Bob play a game with an integer.</p></div>
    <div class="input-specification"><p>The first line contains one integer.</p></div>
    <div class="output-specification"><p>Print YES or NO.</p></div>
    <div class="sample-tests"><div class="sample-test">
      <div class="input"><div class="title">Input</div><pre>1\n5</pre></div>
      <div class="output"><div class="title">Output</div><pre>YES</pre></div>
    </div></div>
  </div>
</div></body></html>`);

/** The submit page, with the hidden fields the site's own JS fills in. */
const cfSubmitPage = html(`<html><body>
${CF_PAGE_BODY}
<form class="submit-form" method="post" action="?csrf_token=abc123">
  <input type="hidden" name="csrf_token" value="abc123">
  <input type="hidden" name="ftaa" value="a1b2c3d4e5f6g7h8i9">
  <input type="hidden" name="bfaa" value="0123456789abcdef0123456789abcdef">
  <input type="hidden" name="action" value="submitSolutionFormSubmitted">
  <input type="hidden" name="submittedProblemIndex" value="A">
  <select name="programTypeId"><option value="89">GNU G++17</option></select>
  <textarea name="source"></textarea>
  <input type="hidden" name="tabSize" value="4">
  <input type="hidden" name="sourceFile" value="">
</form></body></html>`);

const cfCustomTestPage = html(`<html><body>
${CF_PAGE_BODY}
<div class="caption">Custom invocation</div>
<form method="post" action="?csrf_token=abc123">
  <input type="hidden" name="csrf_token" value="abc123">
  <input type="hidden" name="ftaa" value="a1b2c3d4e5f6g7h8i9">
  <input type="hidden" name="bfaa" value="0123456789abcdef0123456789abcdef">
  <input type="hidden" name="action" value="customTest">
  <select name="programTypeId"><option value="89">GNU G++17</option></select>
  <textarea name="source"></textarea>
  <textarea name="input"></textarea>
  <input type="hidden" name="tabSize" value="4">
</form></body></html>`);

/** The same page after a run, carrying the invocation result. */
const cfCustomTestResult = html(`<html><body>
${CF_PAGE_BODY}
<div class="caption">Custom invocation</div>
<form method="post" action="?csrf_token=abc123">
  <input type="hidden" name="csrf_token" value="abc123">
  <input type="hidden" name="ftaa" value="a1b2c3d4e5f6g7h8i9">
  <input type="hidden" name="bfaa" value="0123456789abcdef0123456789abcdef">
  <input type="hidden" name="action" value="customTest">
  <textarea name="source">int main(){}</textarea>
  <textarea name="input">1 5</textarea>
</form>
<div class="roundbox">
  <div class="caption titled">Invocation result</div>
  <div class="text">Exit code: 0</div>
  <textarea readonly>YES</textarea>
</div></body></html>`);

const cfProfilePage = html(`<html><body>
${CF_PAGE_BODY}
<div class="userbox"><div class="user-rank"><span class="user-blue">Specialist</span></div>
<h1><a href="/profile/deepakvish001">deepakvish001</a></h1>
<ul><li><span class="user-blue">1420</span></li></ul></div></body></html>`);

const CF_ROWS = [
  ['1899', 'A', 'Game with Integers', ['games', 'math'], 800, '12k'],
  ['1899', 'B', 'Two Out of Three', ['implementation'], 900, '9k'],
  ['1899', 'C', 'Yarik and Array', ['dp', 'greedy'], 1200, '4k'],
  ['1899', 'D', 'Yarik and Musical Notes', ['math', 'number theory'], 1500, '1.5k'],
  ['1898', 'B', 'Milena and Admirer', ['greedy', 'math'], 1300, '3k'],
  ['1898', 'C', 'Colorful Table', ['data structures'], 1600, '1.1k'],
  ['1897', 'C', 'Salyg1n and the MEX Game', ['games', 'interactive'], 1400, '2.4k'],
  ['1897', 'D', 'Cyclic Operations', ['dfs and similar', 'graphs'], 1900, '800'],
];

/**
 * The problem set, laid out the way Codeforces lays it out: the table on the
 * left inside `#pageContent`, the sidebar on the right. The extension anchors
 * its problem-of-the-day card to that sidebar, so a fixture that put the two
 * in the wrong order would test — and photograph — the wrong thing.
 */
const cfProblemsetPage = html(`<html><head><title>Problemset - Codeforces</title>
<style>
  body { margin: 0; font: 13px/1.5 Verdana, Arial, sans-serif; color: #212121; background: #fff; }
  #header { padding: 6px 12px; border-bottom: 1px solid #ddd; text-align: right; font-size: 12px; }
  #pageContent { display: flex; gap: 22px; align-items: flex-start; padding: 16px 22px; }
  .main { flex: 1; min-width: 0; }
  #sidebar { width: 288px; flex: none; }
  h2 { font-size: 17px; margin: 0 0 10px; font-weight: 700; }
  table.problems { width: 100%; border-collapse: collapse; }
  table.problems th { text-align: left; font-size: 11px; color: #777; padding: 6px 8px; border-bottom: 1px solid #e1e1e1; }
  table.problems td { padding: 9px 8px; border-bottom: 1px solid #efefef; vertical-align: top; }
  table.problems tr:nth-child(odd) td { background: #fafafa; }
  td.id a { color: #0645ad; text-decoration: none; font-weight: 700; }
  .name a { color: #0645ad; text-decoration: none; font-weight: 600; }
  .notice a { color: #777; font-size: 11px; text-decoration: none; margin-right: 6px; }
  .ProblemRating { color: #444; font-weight: 700; }
  .solved { color: #777; font-size: 11px; white-space: nowrap; }
  .roundbox { border: 1px solid #ddd; border-radius: 6px; padding: 11px 13px; margin-bottom: 14px; background: #fff; }
  .roundbox .caption { font-weight: 700; margin-bottom: 7px; }
  .roundbox ul { margin: 0; padding-left: 17px; color: #444; }
</style></head><body>
<div id="header"><a href="/profile/deepakvish001">deepakvish001</a> | <a href="/logout">Logout</a></div>
<div id="pageContent">
  <div class="main">
    <h2>Problemset</h2>
    <table class="problems">
      <tr><th>#</th><th>Name</th><th></th><th>Solved</th></tr>
      ${CF_ROWS.map(([contest, index, name, tags, rating, solved]) => `
      <tr>
        <td class="id"><a href="/problemset/problem/${contest}/${index}">${contest}${index}</a></td>
        <td><div class="name"><a href="/problemset/problem/${contest}/${index}">${name}</a></div>
            <div class="notice">${tags.map((tag) => `<a href="/problemset/tags/${tag}">${tag}</a>`).join('')}</div></td>
        <td><span class="ProblemRating">${rating}</span></td>
        <td class="solved">x${solved}</td>
      </tr>`).join('')}
    </table>
  </div>
  <div id="sidebar">
    <div class="roundbox"><div class="caption">Pay attention</div>
      <ul><li>Codeforces Round 900 (Div. 2)</li><li>Starts in 2 days</li></ul></div>
    <div class="roundbox"><div class="caption">Top rated</div>
      <ul><li>tourist &mdash; 3800</li><li>jiangly &mdash; 3750</li></ul></div>
  </div>
</div></body></html>`);

/* -------------------------------------------------------------- LeetCode */

const LC_DAILY = {
  activeDailyCodingChallengeQuestion: {
    date: new Date(now).toISOString().slice(0, 10),
    link: '/problems/two-sum/',
    question: { title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy' },
  },
};

const LC_UPCOMING = {
  upcomingContests: [
    { title: 'Weekly Contest 500', titleSlug: 'weekly-contest-500', startTime: secs(now + DAY), duration: 5400 },
    { title: 'Biweekly Contest 160', titleSlug: 'biweekly-contest-160', startTime: secs(now + 4 * DAY), duration: 5400 },
  ],
};

const LC_RANKING = {
  userContestRanking: { attendedContestsCount: 6, rating: 1685.32, globalRanking: 91234, topPercentage: 22.4 },
  userContestRankingHistory: [
    { attended: true, rating: 1500, ranking: 9000, trendDirection: 'NONE', problemsSolved: 2, totalProblems: 4, finishTimeInSeconds: 3600, contest: { title: 'Weekly Contest 494', titleSlug: 'weekly-contest-494', startTime: secs(now - 42 * DAY) } },
    { attended: true, rating: 1548, ranking: 7400, trendDirection: 'UP', problemsSolved: 3, totalProblems: 4, finishTimeInSeconds: 4300, contest: { title: 'Weekly Contest 495', titleSlug: 'weekly-contest-495', startTime: secs(now - 35 * DAY) } },
    { attended: true, rating: 1596, ranking: 6800, trendDirection: 'UP', problemsSolved: 3, totalProblems: 4, finishTimeInSeconds: 4100, contest: { title: 'Weekly Contest 496', titleSlug: 'weekly-contest-496', startTime: secs(now - 28 * DAY) } },
    { attended: false, rating: 1596, ranking: 0, trendDirection: 'NONE', problemsSolved: 0, totalProblems: 4, finishTimeInSeconds: 0, contest: { title: 'Weekly Contest 497', titleSlug: 'weekly-contest-497', startTime: secs(now - 21 * DAY) } },
    { attended: true, rating: 1631, ranking: 6200, trendDirection: 'UP', problemsSolved: 3, totalProblems: 4, finishTimeInSeconds: 4200, contest: { title: 'Weekly Contest 498', titleSlug: 'weekly-contest-498', startTime: secs(now - 14 * DAY) } },
    { attended: true, rating: 1685, ranking: 5100, trendDirection: 'UP', problemsSolved: 3, totalProblems: 4, finishTimeInSeconds: 3900, contest: { title: 'Weekly Contest 499', titleSlug: 'weekly-contest-499', startTime: secs(now - 7 * DAY) } },
    // Ranked but not yet rated — the rating has not moved, which is how
    // LeetCode shows a contest it has scored but not yet applied.
    { attended: true, rating: 1685, ranking: 4300, trendDirection: 'NONE', problemsSolved: 3, totalProblems: 4, finishTimeInSeconds: 3700, contest: { title: 'Weekly Contest 500', titleSlug: 'weekly-contest-500', startTime: secs(now - 1 * DAY) } },
  ],
};

const lcProblemPage = html(`<html><head><title>Two Sum - LeetCode</title></head><body>
<div id="__next"><div data-track-load="description_content">
<div class="text-title-large">1. Two Sum</div>
<div class="elfjS">Given an array of integers, return indices of the two numbers.</div>
</div></div></body></html>`);

/* -------------------------------------------------------------- CodeChef */

const CODECHEF = {
  future_contests: [
    {
      contest_code: 'START100',
      contest_name: 'Starters 100',
      contest_start_date_iso: new Date(now + 2 * DAY).toISOString(),
      contest_end_date_iso: new Date(now + 2 * DAY + 3 * 3_600_000).toISOString(),
    },
  ],
};

/* --------------------------------------------------------------- AtCoder */

const atcoderStart = new Date(now + 3 * DAY);
const pad = (n) => String(n).padStart(2, '0');
const ATCODER = html(`<html><body>
<div id="contest-table-upcoming"><table><tbody>
  <tr>
    <td><time class="fixtime fixtime-full">${atcoderStart.getUTCFullYear()}-${pad(atcoderStart.getUTCMonth() + 1)}-${pad(atcoderStart.getUTCDate())} ${pad(atcoderStart.getUTCHours())}:00:00+0000</time></td>
    <td><a href="/contests/abc390"><span class="user-blue">&#9673;</span> AtCoder Beginner Contest 390</a></td>
    <td class="text-center">01:40</td>
  </tr>
</tbody></table></div>
<div id="contest-table-recent"><table><tbody>
  <tr><td><time class="fixtime">2020-01-01 21:00:00+0900</time></td>
  <td><a href="/contests/abc001">ABC 1</a></td><td>01:40</td></tr>
</tbody></table></div>
</body></html>`);

/* ------------------------------------------------------------- the table */

const has = (needle) => (url) => url.includes(needle);

export const routes = [
  /* ---- GitHub API ---- */
  [
    (url) => url.startsWith('https://api.github.com/user') && !url.includes('/repos'),
    () => json({ login: 'deepakvish001', id: 4242, type: 'User' }),
  ],
  [
    (url) => /^https:\/\/api\.github\.com\/user\/repos/.test(url),
    (url) => {
      const page = Number(new URL(url).searchParams.get('page') ?? '1');
      // A full first page and a short second one, which is the shape that makes
      // the pager keep going. An account whose repositories all fit on one page
      // would never exercise it, and the repository you want is the one you
      // pushed to least recently — page two.
      if (page === 1) {
        const filler = Array.from({ length: 100 }, (_, i) => ({
          full_name: `deepakvish001/filler-${i}`,
          name: `filler-${i}`,
          private: false,
          default_branch: 'main',
          owner: { login: 'deepakvish001' },
        }));
        return json(filler);
      }
      if (page === 2) return json(REPOS);
      return json([]);
    },
  ],
  [
    (url) => /\/repos\/[^/]+\/[^/]+\/branches/.test(url),
    () => json([{ name: 'main', commit: { sha: 'a'.repeat(40) } }, { name: 'dev', commit: { sha: 'b'.repeat(40) } }]),
  ],
  /* ---- GitHub Git Data API: ref, commit, tree, ref again ---- */
  [
    (url) => /\/git\/ref\/heads\//.test(url),
    (url) => {
      const state = repoState(repoKeyOf(url));
      if (!state.head) return json({ message: 'Not Found' }, 404);
      return json({ ref: 'refs/heads/main', object: { sha: state.head, type: 'commit' } });
    },
  ],
  [
    (url, request) => /\/git\/commits\//.test(url) && request.method() === 'GET',
    (url) => {
      const state = repoState(repoKeyOf(url));
      const sha = url.split('/git/commits/')[1];
      const commit = state.commits.get(sha);
      if (!commit) return json({ message: 'Not Found' }, 404);
      return json({ sha, message: commit.message, tree: { sha: commit.tree }, parents: commit.parents.map((p) => ({ sha: p })) });
    },
  ],
  [
    (url, request) => /\/git\/trees$/.test(new URL(url).pathname) && request.method() === 'POST',
    (url, request) => {
      const state = repoState(repoKeyOf(url));
      const body = JSON.parse(request.postData() ?? '{}');
      const base = body.base_tree ? new Map(state.trees.get(body.base_tree) ?? []) : new Map();
      for (const entry of body.tree ?? []) base.set(entry.path, entry.content ?? '');
      const sha = shaOf(base);
      state.trees.set(sha, base);
      return json({ sha, tree: [...base.keys()].map((path) => ({ path })) });
    },
  ],
  [
    (url, request) => /\/git\/commits$/.test(new URL(url).pathname) && request.method() === 'POST',
    (url, request) => {
      const key = repoKeyOf(url);
      const state = repoState(key);
      const body = JSON.parse(request.postData() ?? '{}');
      state.commitCount += 1;
      const sha = `commit${String(state.commitCount).padStart(34, '0')}`;
      state.commits.set(sha, { tree: body.tree, parents: body.parents ?? [], message: body.message });
      return json({ sha, html_url: `https://github.com/${key}/commit/${sha}` });
    },
  ],
  [
    (url, request) => /\/git\/refs/.test(url) && ['PATCH', 'POST'].includes(request.method()),
    (url, request) => {
      const state = repoState(repoKeyOf(url));
      state.head = JSON.parse(request.postData() ?? '{}').sha;
      return json({ ref: 'refs/heads/main', object: { sha: state.head } });
    },
  ],

  /* ---- GitHub contents, for single-file reads and writes ---- */
  [
    (url) => /\/repos\/[^/]+\/[^/]+\/contents\//.test(url),
    (url, request) => {
      const key = repoKeyOf(url);
      const state = repoState(key);
      const path = decodeURIComponent(new URL(url).pathname.split('/contents/')[1] ?? '');
      if (request.method() === 'PUT') {
        const body = JSON.parse(request.postData() ?? '{}');
        const tip = new Map(filesIn(key));
        tip.set(path, Buffer.from(body.content ?? '', 'base64').toString('utf8'));
        const treeSha = shaOf(tip);
        state.trees.set(treeSha, tip);
        state.commitCount += 1;
        const sha = `commit${String(state.commitCount).padStart(34, '0')}`;
        state.commits.set(sha, { tree: treeSha, parents: state.head ? [state.head] : [], message: body.message });
        state.head = sha;
        return json({ content: { path, sha: treeSha }, commit: { sha, html_url: `https://github.com/${key}/commit/${sha}` } });
      }
      const content = filesIn(key).get(path);
      if (content === undefined) return json({ message: 'Not Found' }, 404);
      return json({
        path,
        sha: shaOf([[path, content]]),
        content: Buffer.from(content, 'utf8').toString('base64'),
        encoding: 'base64',
      });
    },
  ],
  [
    (url) => /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(url),
    () => json({ full_name: 'deepakvish001/dsa', default_branch: 'main', permissions: { push: true } }),
  ],

  /* ---- GitHub device flow ---- */
  [has('github.com/login/device/code'), () => json({
    device_code: 'dev-code-123',
    user_code: 'ABCD-1234',
    verification_uri: 'https://github.com/login/device',
    expires_in: 900,
    interval: 5,
  })],
  [has('github.com/login/oauth/access_token'), (url, request) => {
    const body = request.postData() ?? '';
    // First poll pends, as the real flow does while the user is still typing.
    pollCount += 1;
    if (pollCount === 1) return json({ error: 'authorization_pending' });
    return json({ access_token: 'gho_stubbedtoken', token_type: 'bearer', scope: 'repo' });
  }],

  /* ---- Codeforces API ---- */
  [has('codeforces.com/api/user.info'), () => cfOk([CF_USER])],
  [has('codeforces.com/api/contest.list'), () => cfOk(CF_CONTESTS)],
  [has('codeforces.com/api/problemset.problems'), () => cfOk(CF_PROBLEMS)],
  [has('codeforces.com/api/user.status'), () => cfOk(CF_STATUS)],
  [has('codeforces.com/api/user.rating'), () => cfOk(CF_RATING)],
  [has('codeforces.com/api/contest.standings'), () => cfOk({ contest: CF_CONTESTS[1], problems: CF_PROBLEMS.problems, rows: [] })],
  [has('codeforces.com/api/'), () => cfOk([])],

  /* ---- Codeforces pages ---- */
  [has('codeforces.com/problemset/submit'), () => cfSubmitPage],
  [(url) => /codeforces\.com\/(contest|problemset)\/.*submit/.test(url), () => cfSubmitPage],
  [has('codeforces.com/problemset/customtest'), (url, request) =>
    request.method() === 'POST' ? cfCustomTestResult : cfCustomTestPage],
  [(url) => /codeforces\.com\/problemset\/problem\/(\d+)\/([A-Z]\d?)/.test(url), (url) => {
    const [, contestId, index] = /problem\/(\d+)\/([A-Z]\d?)/.exec(url) ?? [];
    return cfProblemPage(contestId, index);
  }],
  [(url) => /codeforces\.com\/contest\/\d+\/problem\/[A-Z]/.test(url), (url) => {
    const [, contestId, index] = /contest\/(\d+)\/problem\/([A-Z]\d?)/.exec(url) ?? [];
    return cfProblemPage(contestId, index);
  }],
  [has('codeforces.com/profile/'), () => cfProfilePage],
  [has('codeforces.com/problemset'), () => cfProblemsetPage],
  [has('codeforces.com'), () => html(`<html><body>${CF_PAGE_BODY}</body></html>`)],

  /* ---- LeetCode ---- */
  [has('leetcode.com/graphql'), (url, request) => {
    const body = request.postData() ?? '';
    if (body.includes('activeDailyCodingChallengeQuestion')) return json({ data: LC_DAILY });
    if (body.includes('upcomingContests')) return json({ data: LC_UPCOMING });
    if (body.includes('userContestRanking')) return json({ data: LC_RANKING });
    return json({ data: {} });
  }],
  [has('leetcode.com/problems/'), () => lcProblemPage],
  [has('leetcode.com'), () => html('<html><body><div id="__next"></div></body></html>')],

  /* ---- the other judges ---- */
  [has('codechef.com/api/list/contests'), () => json(CODECHEF)],
  [has('atcoder.jp/contests'), () => ATCODER],
  [has('codechef.com'), () => html('<html><body></body></html>')],
  [has('hackerrank.com'), () => html('<html><body></body></html>')],
  [has('geeksforgeeks.org'), () => html('<html><body></body></html>')],
  [has('cses.fi'), () => html('<html><body><main></main></body></html>')],
  [has('hackerearth.com'), () => html('<html><body></body></html>')],

  /* ---- Parikshaa and its Supabase backend ---- */
  [has('supabase.co'), () => json([])],
  [has('parikshaa.org'), () => html('<html><body><div id="root"></div></body></html>')],

  /* ---- an ordinary site, which is what focus mode is actually for ---- */
  [has('youtube.com'), () => html('<html><head><title>YouTube</title></head><body><h1>Watch</h1></body></html>')],
  [has('reddit.com'), () => html('<html><head><title>reddit</title></head><body><h1>Front page</h1></body></html>')],

  /* ---- Gemini, for translation ---- */
  [has('generativelanguage.googleapis.com'), (url, request) => {
    const body = JSON.parse(request.postData() ?? '{}');
    const text = body.contents?.[0]?.parts?.[0]?.text ?? '';
    // Echo each numbered line back "translated", keeping the placeholders.
    const lines = text.split('\n').filter((line) => /^\d+\./.test(line));
    const out = lines.map((line) => line.replace(/^(\d+)\.\s*/, '$1. ')).join('\n');
    return json({ candidates: [{ content: { parts: [{ text: out || '1. anuvaad' }] } }] });
  }],
];

let pollCount = 0;
export function resetPolls() {
  pollCount = 0;
}

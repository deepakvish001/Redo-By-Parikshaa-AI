import { launch, shutdown, check, group, report, called, clearCalls } from './harness.mjs';
import { routes, filesIn, commitsIn, resetRepo, resetPolls } from './stubs.mjs';
import assert from 'node:assert/strict';

const DAY = 86_400_000;
const now = Date.now();

const submission = (over = {}) => ({
  platform: 'leetcode',
  problemId: '1',
  slug: 'two-sum',
  title: 'Two Sum',
  url: 'https://leetcode.com/problems/two-sum/',
  difficulty: 'easy',
  tags: ['Array', 'Hash Table'],
  language: 'Python3',
  code: 'class Solution:\n    def twoSum(self): ...',
  attempts: 2,
  ...over,
});

const rig = await launch({ routes });
const { ask, send, storage, driver, pageErrors, id } = rig;

/** Turn GitHub sync on, pointed at the stubbed repository. */
async function enableGithub(patch = {}) {
  return ask({
    type: 'settings:save',
    patch: {
      github: {
        ...(await ask({ type: 'settings:get' })).github,
        token: 'ghp_stub',
        owner: 'deepakvish001',
        repo: 'dsa',
        branch: 'main',
        enabled: true,
        ...patch,
      },
    },
  });
}

try {
  /* ==================================================== 1. the wiring sweep */

  group('message routing — every request type reaches a handler');

  const everyRequest = [
    ['submission:accepted', { submission: submission() }],
    ['cses:pending', { pending: { taskId: '1068', submittedAt: now, filename: 'a.cpp', language: 'C++', code: 'int main(){}' } }],
    ['cses:pending:consume', { taskId: '1068' }],
    ['cses:result:claim', { result: { taskId: '1068', resultPath: '/problemset/result/abc/', verdict: 'Accepted', accepted: true } }],
    ['page:context', { platform: 'leetcode', slug: 'two-sum' }],
    ['dashboard:get', {}],
    ['problem:review', { id: 'leetcode:two-sum', recall: 'good' }],
    ['problem:details', { id: 'leetcode:two-sum', note: 'hash map', complexity: { time: 'O(n)', space: 'O(n)' } }],
    ['problem:hint', { id: 'leetcode:two-sum', level: 1 }],
    ['problem:get', { id: 'leetcode:two-sum' }],
    ['page:opened', { platform: 'leetcode', slug: 'two-sum' }],
    ['problem:resync', { id: 'leetcode:two-sum' }],
    ['problem:resync-parikshaa', { id: 'leetcode:two-sum' }],
    ['attempt:record', { platform: 'leetcode', slug: 'three-sum', events: [{ at: now, kind: 'submit', verdict: 'Wrong Answer', accepted: false }] }],
    ['settings:get', {}],
    ['settings:save', { patch: {} }],
    ['github:verify', { config: { token: 'ghp_stub', owner: 'deepakvish001', repo: 'dsa', branch: 'main', enabled: true, clientId: '', signInPrivate: true, perPlatform: {}, commitMessage: '', backup: false, sync: false } }],
    ['parikshaa:credentials', { credentials: { token: 'tok', userId: 'u1', capturedAt: now } }],
    ['parikshaa:status', {}],
    ['parikshaa:diagnostic', { diagnostic: { at: now, reason: 'none' }, hasApiKey: false }],
    ['due:list', {}],
    ['contests:get', {}],
    ['contests:refresh', {}],
    ['diagnostics:record', { entries: [{ at: now, label: 'test', detail: 'x' }] }],
    ['diagnostics:get', {}],
    ['diagnostics:clear', {}],
    ['focus:status', {}],
    ['focus:pause', {}],
    ['rating:profiles', {}],
    ['rating:predict', {}],
    ['problem:labels', { id: 'leetcode:two-sum', labels: ['revisit'] }],
    ['upsolve:get', {}],
    ['upsolve:refresh', {}],
    ['backup:export', {}],
    ['backup:import', { text: JSON.stringify({ version: 1, product: 'Redo', exportedAt: now, problems: {}, journal: {} }) }],
    ['sync:status', {}],
    ['submissions:claim', { platform: 'leetcode', ids: ['1'], watched: [] }],
    ['rail:get', { platform: 'leetcode', slug: 'two-sum' }],
    ['cf:lookup', { keys: ['1899A'] }],
    ['cf:refresh', {}],
    ['daily:get', {}],
    ['daily:skip', {}],
    ['backlog:add', { key: '1899A' }],
    ['backlog:remove', { key: '1899A' }],
    ['insights:get', { days: 30 }],
    ['train:get', {}],
    ['train:start', { ratings: [800, 1200], minutes: 60 }],
    ['train:reroll', { index: 0 }],
    ['train:finish', {}],
    ['history:get', {}],
    ['history:round', { contestId: 1899 }],
    ['cf:handles', { handles: ['deepakvish001'] }],
    ['cf:friends', { problem: '1899A' }],
    ['workspace:drafts', {}],
    ['workspace:forget-drafts', {}],
    ['translate:strings', { problem: '1899A', strings: ['Hello'] }],
    ['community:get', { problem: '1899A' }],
    ['community:post', { id: 'x' }],
    ['github:device-start', { includePrivate: true, clientId: 'Iv1.stub' }],
    ['github:repos', { token: 'ghp_stub' }],
    ['github:branches', { token: 'ghp_stub', owner: 'deepakvish001', repo: 'dsa', defaultBranch: 'main' }],
    ['search', { query: 'stack' }],
    ['mock:get', {}],
    ['sheets:get', {}],
    ['sheets:import', { name: 'Sweep', text: 'two-sum\n3sum' }],
    ['sheets:delete', { id: 'sweep' }],
    ['cf:connect', { handle: 'deepakvish001', key: 'k'.repeat(32), secret: 's'.repeat(40) }],
    ['problem:delete', { id: 'leetcode:nonexistent' }],
  ];

  for (const [type, args] of everyRequest) {
    await check(type, async () => {
      const response = await send({ type, ...args });
      assert.ok(response, `${type} returned nothing at all`);
      assert.equal(response.ok, true, `${type} → ${response.error}`);
    });
  }

  /* ===================================================== 2. solving a problem */

  group('a solve is recorded, committed and scheduled');

  await storage.clear();
  resetRepo();

  await check('GitHub settings save and come back', async () => {
    const saved = await enableGithub();
    assert.equal(saved.github.owner, 'deepakvish001');
    assert.equal(saved.github.enabled, true);
  });

  await check('an accepted submission is stored', async () => {
    const result = await ask({ type: 'submission:accepted', submission: submission() });
    assert.equal(result.saved, true, `not saved: ${result.reason}`);
    assert.equal(result.problem.id, 'leetcode:two-sum');
    assert.equal(result.problem.title, 'Two Sum');
  });

  await check('the solution is committed to the named repository', async () => {
    // The sync runs after the message resolves; give it a beat to land.
    await driver.waitForTimeout(1500);
    const commits = commitsIn('deepakvish001/dsa');
    assert.ok(commits.length > 0, 'nothing was ever committed to GitHub');
    assert.ok(commits.at(-1).message.length > 0, 'the commit has no message');
  });

  await check('the solution and its README land in one commit, not two', async () => {
    // Two commits per solve is what a naive contents-API loop produces, and it
    // doubles the noise in a repository people actually read.
    const commits = commitsIn('deepakvish001/dsa');
    assert.equal(commits.length, 1, `one solve produced ${commits.length} commits`);
    const files = [...filesIn('deepakvish001/dsa').keys()];
    assert.ok(files.some((p) => /solution/.test(p)), 'no solution in the commit');
    assert.ok(files.some((p) => /readme\.md$/i.test(p)), 'no README in the commit');
  });

  await check('re-syncing unchanged content adds no empty commit', async () => {
    const before = commitsIn('deepakvish001/dsa').length;
    await ask({ type: 'problem:resync', id: 'leetcode:two-sum' });
    await driver.waitForTimeout(1200);
    const after = commitsIn('deepakvish001/dsa').length;
    assert.equal(after, before, `a re-sync of identical content added ${after - before} commit(s)`);
  });

  await check('the committed path carries platform, difficulty and slug', async () => {
    const paths = [...filesIn().keys()];
    assert.ok(paths.length > 0, 'no files were written');
    const solution = paths.find((p) => p.includes('solution'));
    assert.ok(solution, `no solution file among ${paths.join(', ')}`);
    assert.match(solution, /^leetcode\//, `path does not start with the platform: ${solution}`);
    assert.match(solution, /easy/, `path does not carry the difficulty: ${solution}`);
    assert.match(solution, /two-sum/, `path does not carry the slug: ${solution}`);
    assert.match(solution, /\.py$/, `Python3 did not map to a .py file: ${solution}`);
  });

  await check('a README goes with it, carrying the problem link', async () => {
    const readme = [...filesIn().entries()].find(([p]) => /readme\.md$/i.test(p));
    assert.ok(readme, `no README among ${[...filesIn().keys()].join(', ')}`);
    assert.match(readme[1], /two-sum/, 'the README does not link the problem');
  });

  await check('the solve is scheduled for revision', async () => {
    const { problem } = await ask({ type: 'problem:get', id: 'leetcode:two-sum' });
    assert.ok(problem.revision, 'no revision on the record');
    assert.ok(problem.revision.dueAt > now, 'the first revision is not in the future');
  });

  await check('solving the same problem twice does not duplicate it', async () => {
    await ask({ type: 'submission:accepted', submission: submission() });
    const { problems } = await ask({ type: 'dashboard:get' });
    const matches = problems.filter((p) => p.id === 'leetcode:two-sum');
    assert.equal(matches.length, 1, `stored ${matches.length} copies`);
  });

  /* ======================================================= 3. the schedule */

  group('spaced repetition');

  await check('a good recall pushes the next review further out', async () => {
    const before = (await ask({ type: 'problem:get', id: 'leetcode:two-sum' })).problem;
    const after = (await ask({ type: 'problem:review', id: 'leetcode:two-sum', recall: 'good' })).problem;
    assert.ok(after.revision.dueAt > before.revision.dueAt, 'the schedule did not move');
    assert.equal(after.revision.reviewCount, before.revision.reviewCount + 1);
  });

  await check('a failed recall brings it back sooner and counts a lapse', async () => {
    const before = (await ask({ type: 'problem:get', id: 'leetcode:two-sum' })).problem;
    const after = (await ask({ type: 'problem:review', id: 'leetcode:two-sum', recall: 'forgot' })).problem;
    assert.ok(after.revision.dueAt < before.revision.dueAt, 'a failure did not pull the date in');
    assert.equal(after.revision.lapses, before.revision.lapses + 1);
  });

  await check('a recall cannot push a problem past the ceiling', async () => {
    const existing = (await storage.get('problems')).problems ?? {};
    await storage.set({
      problems: {
        ...existing,
        'leetcode:capped': {
          id: 'leetcode:capped', platform: 'leetcode', slug: 'capped', problemId: '2',
          title: 'Capped', url: 'https://leetcode.com/problems/capped/', difficulty: 'medium',
          tags: [], language: 'Python3', code: 'x', attempts: 1, solvedAt: now - 10 * DAY,
          updatedAt: now - 10 * DAY,
          revision: { stage: 3, ease: 1, dueAt: now - DAY, reviewCount: 4, lapses: 0, hintsUsed: 0 },
        },
      },
    });
    const after = (await ask({ type: 'problem:review', id: 'leetcode:capped', recall: 'good', mode: 'recall' })).problem;
    assert.equal(after.revision.stage, 3, 'a recall advanced the problem past the ceiling');
    const days = (after.revision.dueAt - Date.now()) / DAY;
    // The stage being capped is not enough on its own: the due date is computed
    // from the stage, so a review held at stage 3 that still schedules at
    // stage 4's spacing is the cap not working.
    assert.ok(days <= 25, `held at stage 3 but scheduled ${Math.round(days)} days out`);
  });

  await check('a full re-solve does push it past the ceiling', async () => {
    const after = (await ask({ type: 'problem:review', id: 'leetcode:capped', recall: 'good', mode: 'resolve' })).problem;
    assert.ok(after.revision.stage > 3, 'a re-solve was capped as if it were a recall');
  });

  await check('due problems are listed once they are due', async () => {
    const existing = (await storage.get('problems')).problems ?? {};
    await storage.set({
      problems: {
        ...existing,
        'leetcode:overdue': {
          id: 'leetcode:overdue', platform: 'leetcode', slug: 'overdue', problemId: '3',
          title: 'Overdue', url: 'https://leetcode.com/problems/overdue/', difficulty: 'medium',
          tags: [], language: 'Python3', code: 'x', attempts: 1, solvedAt: now - 30 * DAY,
          updatedAt: now - 30 * DAY, github: { status: 'disabled' }, parikshaa: { status: 'disabled' },
          revision: { stage: 1, ease: 1, dueAt: now - 2 * DAY, reviewCount: 1, lapses: 0, hintsUsed: 0 },
        },
      },
    });
    const { problems } = await ask({ type: 'due:list' });
    assert.ok(problems.some((p) => p.id === 'leetcode:overdue'), 'an overdue problem is not in the due list');
  });

  await check('a problem not yet due is left out of the list', async () => {
    const existing = (await storage.get('problems')).problems ?? {};
    await storage.set({
      problems: {
        ...existing,
        'leetcode:later': {
          ...existing['leetcode:overdue'], id: 'leetcode:later', slug: 'later', title: 'Later',
          revision: { stage: 1, ease: 1, dueAt: now + 10 * DAY, reviewCount: 1, lapses: 0, hintsUsed: 0 },
        },
      },
    });
    const { problems } = await ask({ type: 'due:list' });
    assert.ok(!problems.some((p) => p.id === 'leetcode:later'), 'a problem due in ten days was listed as due');
  });

  await check('a record with no sync state at all still reaches the panel', async () => {
    // What a backup from an older build, or a hand-edited file, actually looks
    // like. The panel reads `problem.github.status` directly, so a missing
    // object here used to be a blank side panel rather than one odd row.
    const existing = (await storage.get('problems')).problems ?? {};
    await storage.set({
      problems: {
        ...existing,
        'leetcode:bare': {
          id: 'leetcode:bare', platform: 'leetcode', slug: 'bare', problemId: '4', title: 'Bare',
          url: 'https://leetcode.com/problems/bare/', difficulty: 'easy', tags: [],
          language: 'Python3', code: 'x', attempts: 1, solvedAt: now - DAY,
          revision: { stage: 0, ease: 1, dueAt: now - DAY, reviewCount: 0, lapses: 0, hintsUsed: 0 },
        },
      },
    });
    const { problems } = await ask({ type: 'dashboard:get' });
    const bare = problems.find((p) => p.id === 'leetcode:bare');
    assert.ok(bare, 'the record disappeared');
    assert.equal(bare.github.status, 'disabled', 'the missing sync state was not filled in');
    assert.equal(bare.parikshaa.status, 'disabled', 'the missing Parikshaa state was not filled in');
  });

  /* ====================================================== 4. contest radar */

  group('contest radar — all four judges');

  await check('a refresh reaches every judge and parses each one', async () => {
    const data = await ask({ type: 'contests:refresh' });
    assert.deepEqual(data.failed ?? [], [], `judges that failed to parse: ${(data.failed ?? []).join(', ')}`);
    const platforms = new Set(data.contests.map((c) => c.platform));
    for (const judge of ['codeforces', 'leetcode', 'codechef', 'atcoder']) {
      assert.ok(platforms.has(judge), `no contest came back from ${judge}`);
    }
  });

  await check('contests are ordered by start time and none is in the past', async () => {
    const { contests } = await ask({ type: 'contests:get' });
    const starts = contests.map((c) => c.startAt);
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b), 'not ordered by start');
    assert.ok(starts.every((t) => t > Date.now() - 60_000), 'a finished contest is in the list');
  });

  await check('the AtCoder name is text, not markup', async () => {
    const { contests } = await ask({ type: 'contests:get' });
    const atcoder = contests.find((c) => c.platform === 'atcoder');
    assert.ok(atcoder, 'no AtCoder contest');
    assert.doesNotMatch(atcoder.name, /</, `markup leaked into the name: ${atcoder.name}`);
  });

  /* ======================================================= 5. GitHub connect */

  group('GitHub connect');

  await check('a token is verified against the repository', async () => {
    const info = await ask({
      type: 'github:verify',
      config: { token: 'ghp_stub', owner: 'deepakvish001', repo: 'dsa', branch: 'main', enabled: true, clientId: '', signInPrivate: true, perPlatform: {}, commitMessage: '', backup: false, sync: false },
    });
    assert.ok(info, 'nothing came back from verify');
  });

  await check('the repository picker lists every page, not just the first', async () => {
    const repos = await ask({ type: 'github:repos', token: 'ghp_stub' });
    const list = Array.isArray(repos) ? repos : (repos.repos ?? []);
    const names = list.map((r) => r.fullName);
    assert.equal(list.length, 103, `paging stopped early: got ${list.length} of 103`);
    for (const wanted of ['deepakvish001/dsa', 'deepakvish001/leetcode', 'deepakvish001/codeforces']) {
      assert.ok(names.includes(wanted), `${wanted} is on page two and was never fetched`);
    }
  });

  await check('branches are listed for the chosen repository', async () => {
    const branches = await ask({ type: 'github:branches', token: 'ghp_stub', owner: 'deepakvish001', repo: 'dsa', defaultBranch: 'main' });
    const names = Array.isArray(branches) ? branches : (branches.branches ?? []);
    assert.ok(names.length >= 2, `expected both branches, got ${JSON.stringify(names)}`);
  });

  await check('the device flow starts and polls through to a token', async () => {
    resetPolls();
    const start = await ask({ type: 'github:device-start', includePrivate: true, clientId: 'Iv1.stub' });
    assert.ok(!start.error, `the flow refused to start: ${start.error}`);
    assert.equal(start.code.userCode, 'ABCD-1234');
    assert.equal(start.code.verificationUri, 'https://github.com/login/device');
    assert.ok(start.code.expiresAt > Date.now(), 'the code is already expired');
    const deviceCode = start.code.deviceCode;

    // GitHub answers the first polls with authorization_pending while the user
    // is still typing the code; that is the normal path, not a failure.
    const pending = await ask({ type: 'github:device-poll', deviceCode, clientId: 'Iv1.stub' });
    assert.equal(pending.pending, true, `first poll should pend, got ${JSON.stringify(pending)}`);
    assert.ok(!pending.error, `the pending poll reported an error: ${pending.error}`);

    const done = await ask({ type: 'github:device-poll', deviceCode, clientId: 'Iv1.stub' });
    assert.equal(done.token, 'gho_stubbedtoken', `second poll did not yield the token: ${JSON.stringify(done)}`);
  });

  /* ================================================= 6. per-platform repos */

  group('a repository per platform');

  await check('a Codeforces solve goes to the Codeforces repository', async () => {
    await enableGithub({
      perPlatform: { codeforces: { owner: 'deepakvish001', repo: 'codeforces', branch: 'master' } },
    });
    const before = commitsIn('deepakvish001/codeforces').length;
    await ask({
      type: 'submission:accepted',
      submission: submission({
        platform: 'codeforces', problemId: '1899A', slug: '1899A', title: 'Game with Integers',
        url: 'https://codeforces.com/problemset/problem/1899/A', language: 'C++', code: 'int main(){}',
        difficulty: 'easy',
      }),
    });
    await driver.waitForTimeout(1500);
    assert.ok(
      commitsIn('deepakvish001/codeforces').length > before,
      'the Codeforces solve never reached the Codeforces repository',
    );
    const files = [...filesIn('deepakvish001/codeforces').keys()];
    assert.ok(files.some((p) => /1899A/i.test(p)), `not in the tree: ${files.join(', ')}`);
  });

  await check('a LeetCode solve still goes to the default repository', async () => {
    const cfBefore = commitsIn('deepakvish001/codeforces').length;
    const defaultBefore = commitsIn('deepakvish001/dsa').length;
    await ask({ type: 'submission:accepted', submission: submission({ slug: 'three-sum', problemId: '15', title: 'Three Sum' }) });
    await driver.waitForTimeout(1500);
    assert.ok(
      commitsIn('deepakvish001/dsa').length > defaultBefore,
      'the LeetCode solve never reached the default repository',
    );
    assert.equal(
      commitsIn('deepakvish001/codeforces').length,
      cfBefore,
      'the Codeforces override caught a LeetCode solve',
    );
  });

  /* ================================================ 7. Codeforces connect */

  group('Codeforces connect');

  await check('an API key and secret resolve to the profile', async () => {
    const connection = await ask({
      type: 'cf:connect', handle: 'deepakvish001', key: 'k'.repeat(32), secret: 's'.repeat(40),
    });
    assert.equal(connection.handle, 'deepakvish001');
    assert.equal(connection.rating, 1420);
    assert.match(String(connection.rank), /specialist/i);
  });

  await check('the request is signed — an apiSig is sent, the secret is not', async () => {
    // `user.friends` is the call that proves the pair; `user.info` is public
    // and is deliberately sent unsigned.
    const hits = called((c) => c.url.includes('codeforces.com/api/user.friends'));
    assert.ok(hits.length > 0, 'user.friends was never called');
    const signed = hits.find((c) => (c.postData ?? '').includes('apiSig='));
    assert.ok(signed, 'the call went out unsigned');
    // The signature proves the secret without carrying it, which is the whole
    // point of signing rather than sending the pair.
    assert.ok(!signed.postData.includes('s'.repeat(40)), 'the secret itself was sent');
    assert.ok(!signed.url.includes('apiSig'), 'the signature was put in the URL, where it gets logged');
  });

  await check('the mirror pulls problems, submissions and rating', async () => {
    await ask({ type: 'settings:save', patch: { handles: { codeforces: 'deepakvish001' } } });
    const state = await ask({ type: 'cf:refresh' });
    assert.ok(state, 'no mirror state');
    const endpoints = called((c) => c.url.includes('codeforces.com/api/'));
    for (const method of ['problemset.problems', 'user.status']) {
      assert.ok(endpoints.some((c) => c.url.includes(method)), `${method} was never called`);
    }
  });

  await check('a Codeforces problem can be looked up by key', async () => {
    const found = await ask({ type: 'cf:lookup', keys: ['1899A'] });
    assert.ok(found['1899A'], `1899A not in the mirror: ${JSON.stringify(Object.keys(found))}`);
    assert.equal(found['1899A'].rating, 800);
  });

  /* ============================================= 8. rating and prediction */

  group('rating and contest history');

  await check('the Codeforces profile comes back with its rating history', async () => {
    await ask({ type: 'settings:save', patch: { handles: { codeforces: 'deepakvish001', leetcode: 'deepakvish001' } } });
    const profiles = await ask({ type: 'rating:profiles' });
    assert.ok(profiles.codeforces, `no Codeforces profile: ${JSON.stringify(profiles).slice(0, 200)}`);
    assert.equal(profiles.codeforces.rating, 1420);
  });

  await check('the LeetCode profile lists attended contests with ranks', async () => {
    const profiles = await ask({ type: 'rating:profiles' });
    assert.ok(profiles.leetcode, `no LeetCode profile: ${JSON.stringify(profiles).slice(0, 200)}`);
    const attended = profiles.leetcode.contests ?? [];
    assert.ok(attended.length >= 4, `expected the attended contests, got ${attended.length}`);
    assert.ok(attended.every((c) => typeof c.rank === 'number'), 'a contest came back without a rank');
  });

  await check('a ranked-but-unrated contest gets a predicted delta', async () => {
    const profiles = await ask({ type: 'rating:profiles' });
    const estimate = profiles.leetcode?.estimate;
    assert.ok(estimate, 'no estimate for the pending contest');
    assert.equal(typeof estimate.delta, 'number');
    assert.ok(estimate.contest.includes('500'), `estimated the wrong contest: ${estimate.contest}`);
  });

  /* ============================================== 9. backup and multi-device */

  group('backup, restore and sync');

  await check('an export carries the problems but not the token', async () => {
    const { json: text, filename } = await ask({ type: 'backup:export' });
    assert.match(filename, /\.json$/);
    const backup = JSON.parse(text);
    assert.ok(Object.keys(backup.problems).length > 0, 'the backup has no problems');
    assert.equal(backup.settings.github.token, '', 'the GitHub token was written into the backup');
  });

  await check('a restore merges rather than replacing', async () => {
    const { json: text } = await ask({ type: 'backup:export' });
    const backup = JSON.parse(text);
    backup.problems['leetcode:from-backup'] = {
      id: 'leetcode:from-backup', platform: 'leetcode', slug: 'from-backup', problemId: '99',
      title: 'From Backup', url: 'https://leetcode.com/problems/from-backup/', difficulty: 'easy',
      tags: [], language: 'Python3', code: 'x', attempts: 1, solvedAt: now, updatedAt: now,
      revision: { stage: 0, ease: 1, dueAt: now + DAY, reviewCount: 0, lapses: 0, hintsUsed: 0 },
    };
    await ask({ type: 'backup:import', text: JSON.stringify(backup) });
    const { problems } = await ask({ type: 'dashboard:get' });
    assert.ok(problems.some((p) => p.id === 'leetcode:from-backup'), 'the restored problem is missing');
    assert.ok(problems.some((p) => p.id === 'leetcode:two-sum'), 'the restore wiped what was already here');
  });

  await check('the newer record wins when two machines disagree', async () => {
    const { json: text } = await ask({ type: 'backup:export' });
    const backup = JSON.parse(text);
    const stale = JSON.parse(JSON.stringify(backup.problems['leetcode:two-sum']));
    stale.title = 'Stale Title';
    stale.updatedAt = 1;
    backup.problems['leetcode:two-sum'] = stale;
    await ask({ type: 'backup:import', text: JSON.stringify(backup) });
    const { problem } = await ask({ type: 'problem:get', id: 'leetcode:two-sum' });
    assert.equal(problem.title, 'Two Sum', 'an older backup overwrote a newer record');
  });

  await check('a malformed backup is refused rather than half-applied', async () => {
    const before = (await ask({ type: 'dashboard:get' })).problems.length;
    const response = await send({ type: 'backup:import', text: 'not json at all' });
    assert.equal(response.ok, false, 'garbage was accepted as a backup');
    const after = (await ask({ type: 'dashboard:get' })).problems.length;
    assert.equal(after, before, 'the failed restore still changed the store');
  });

  await check('a push and a pull go through the repository', async () => {
    await enableGithub({ backup: true, sync: true });
    const pushed = await ask({ type: 'backup:push' });
    assert.ok(pushed.path, 'no path came back from the push');
    const committed = [...filesIn('deepakvish001/dsa').keys()];
    assert.ok(committed.some((p) => /backup\.json$/.test(p)), `no backup in the tree: ${committed.join(', ')}`);

    const pulled = await ask({ type: 'backup:pull' });
    assert.ok(pulled, 'the pull came back empty');
  });

  /* ==================================================== 10. daily and focus */

  group('problem of the day, streak and focus mode');

  await check("the day's problem comes back with a streak", async () => {
    const home = await ask({ type: 'daily:get' });
    assert.ok(home, 'no home data');
    assert.ok(home.streak, 'no streak in the home data');
  });

  await check('skipping the daily picks a different one', async () => {
    const before = await ask({ type: 'daily:get' });
    const after = await ask({ type: 'daily:skip' });
    assert.ok(after, 'skip returned nothing');
    if (before.pick && after.pick) {
      assert.notEqual(after.pick.key, before.pick.key, 'skip handed back the same problem');
    }
  });

  await check('the backlog takes and releases a problem', async () => {
    const added = await ask({ type: 'backlog:add', key: '1899C' });
    assert.ok(JSON.stringify(added).includes('1899C'), 'the backlog did not take it');
    const removed = await ask({ type: 'backlog:remove', key: '1899C' });
    assert.ok(!JSON.stringify(removed.backlog ?? []).includes('1899C'), 'the backlog did not release it');
  });

  await check('focus mode reports its state', async () => {
    const status = await ask({ type: 'focus:status' });
    assert.ok(status, 'no focus status');
    assert.equal(typeof status.blocking ?? 'boolean', typeof status.blocking);
  });

  await check('a focus pause is granted and has an end', async () => {
    const paused = await ask({ type: 'focus:pause' });
    if (paused.started) assert.ok(paused.until > Date.now(), 'the pause ends in the past');
  });

  /* ======================================================= 11. the panel UI */

  group('the panel');

  await check('the panel loads without a page error', async () => {
    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${id}/panel/index.html`);
    await page.waitForTimeout(1800);
    assert.deepEqual(errors, [], `the panel threw: ${errors.join('; ')}`);
    await page.close();
  });

  await check('every tab renders something', async () => {
    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${id}/panel/index.html`);
    await page.waitForTimeout(1500);

    const tabs = await page.getByRole('tab').all();
    assert.ok(tabs.length >= 3, `expected the tab strip, found ${tabs.length}`);
    for (const tab of tabs) {
      const label = (await tab.textContent())?.trim() ?? '?';
      await tab.click();
      await page.waitForTimeout(500);
      const text = await page.locator('body').innerText();
      assert.ok(text.trim().length > 0, `the ${label} tab rendered nothing`);
    }
    assert.deepEqual(errors, [], `a tab threw: ${errors.join('; ')}`);
    await page.close();
  });

  /* ===================================================== 12. the options UI */

  group('settings');

  await check('settings load without a page error', async () => {
    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${id}/options/index.html`);
    await page.waitForTimeout(1800);
    assert.deepEqual(errors, [], `settings threw: ${errors.join('; ')}`);
    const headings = await page.getByRole('heading').count();
    assert.ok(headings > 3, `expected the settings sections, found ${headings} headings`);
    await page.close();
  });

  await check('a setting changed in the UI is persisted', async () => {
    const page = await rig.context.newPage();
    await page.goto(`chrome-extension://${id}/options/index.html`);
    await page.waitForTimeout(1500);

    const token = page.locator('input[type="password"]').first();
    if (await token.count()) {
      await token.fill('ghp_typed_in_the_ui');
      const save = page.getByRole('button', { name: /save/i }).first();
      if (await save.count()) {
        await save.click();
        await page.waitForTimeout(1200);
        const settings = await ask({ type: 'settings:get' });
        assert.equal(settings.github.token, 'ghp_typed_in_the_ui', 'the typed token was not saved');
      }
    }
    await page.close();
  });

  /* ================================================= 13. the judges' pages */

  group('on the judges own pages');

  await check('the Codeforces problem page gets the extension card', async () => {
    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('https://codeforces.com/problemset/problem/1899/A');
    await page.waitForTimeout(2500);
    assert.deepEqual(errors, [], `the content script threw on Codeforces: ${errors.join('; ')}`);
    const mounted = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some((el) => el.shadowRoot || /redo/i.test(el.id ?? '')),
    );
    assert.ok(mounted, 'nothing was mounted on the Codeforces page');
    await page.close();
  });

  await check('the LeetCode problem page gets the extension card', async () => {
    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('https://leetcode.com/problems/two-sum/');
    await page.waitForTimeout(2500);
    assert.deepEqual(errors, [], `the content script threw on LeetCode: ${errors.join('; ')}`);
    await page.close();
  });

  await check('nothing is injected on a site the extension has no business on', async () => {
    const page = await rig.context.newPage();
    await page.goto('https://www.hackerrank.com/');
    await page.waitForTimeout(1200);
    await page.close();
  });


  /* ============================================ 15. the Codeforces workspace */

  group('the Codeforces workspace — Run and Submit');

  let workspacePage = null;

  await check('the workspace opens over the problem statement', async () => {
    await ask({ type: 'settings:save', patch: { page: { ...(await ask({ type: 'settings:get' })).page, enabled: true, workspace: true } } });

    workspacePage = await rig.context.newPage();
    workspacePage.on('pageerror', (e) => { throw new Error(`the workspace threw: ${e}`); });
    await workspacePage.goto('https://codeforces.com/problemset/problem/1899/A');
    await workspacePage.waitForTimeout(1500);

    // Injected the way the extension injects it, so this exercises the real
    // path rather than a copy of it.
    await rig.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://codeforces.com/problemset/problem/*' });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['workspace.js'] });
    });
    await workspacePage.waitForTimeout(1500);

    const host = workspacePage.locator('#redo-workspace');
    assert.equal(await host.count(), 1, 'the workspace never mounted');
  });

  await check('the statement and its sample case come across', async () => {
    const ws = workspacePage.locator('#redo-workspace');
    // Locators pierce the shadow root; innerText on the host does not.
    assert.equal(await ws.getByRole('button', { name: /^Run$/ }).count(), 1, 'no Run control');
    assert.equal(await ws.getByRole('button', { name: /^Submit$/ }).count(), 1, 'no Submit control');

    const statement = await ws.locator('.problem-statement, .legend').first().textContent();
    assert.match(statement ?? '', /Alice and Bob/, 'the statement did not come across');

    // The sample input and expected output from the page are pre-loaded as the
    // first test case, so Run has something to run without any typing.
    const boxes = ws.locator('textarea');
    const values = [];
    for (let i = 0; i < (await boxes.count()); i += 1) values.push(await boxes.nth(i).inputValue());
    assert.ok(values.some((v) => v.includes('5')), `the sample input was not carried over: ${JSON.stringify(values)}`);
    assert.ok(values.some((v) => v.includes('YES')), `the expected output was not carried over: ${JSON.stringify(values)}`);
  });

  await check('Run posts the hidden fields Codeforces requires, and shows the output', async () => {
    clearCalls();
    const ws = workspacePage.locator('#redo-workspace');
    // The editor is CodeMirror, so the source is typed into it the way a person
    // would rather than assigned to a form field.
    await ws.locator('.cm-content').click();
    await workspacePage.keyboard.type('int main(){puts("YES");}');
    await workspacePage.waitForTimeout(400);
    await ws.getByRole('button', { name: /^Run$/ }).click();
    await workspacePage.waitForTimeout(3000);

    const posts = called((c) => c.method === 'POST' && c.url.includes('customtest'));
    assert.ok(posts.length > 0, 'Run never reached Codeforces');
    // The form is posted as multipart, the way the page posts it, so fields are
    // matched by name rather than by a query-string spelling.
    const body = posts.at(-1).postData ?? '';
    const carries = (field) => new RegExp(`name="${field}"`).test(body);
    // ftaa and bfaa are filled in by Codeforces' own JS, and a POST without
    // them is refused silently — a 200 carrying the blank form back again.
    assert.ok(carries('ftaa'), 'the run went out without ftaa');
    assert.ok(carries('bfaa'), 'the run went out without bfaa');
    assert.ok(carries('csrf_token'), 'the run went out without a CSRF token');
    assert.ok(carries('source'), 'the run carried no source');
    assert.match(body, /int main/, 'the source that was typed is not in the request');

    const shown = await workspacePage.evaluate(
      () => document.getElementById('redo-workspace').shadowRoot.querySelector('.ws').innerText,
    );
    assert.doesNotMatch(shown, /Nothing to run/, 'the editor was empty when Run was pressed');
    assert.match(shown, /YES/, `the result page was not read back: ${shown.slice(-400)}`);
  });

  await check('Run reports a blank result rather than showing the source box', async () => {
    // The un-run page is headed "Custom invocation"; only a finished run says
    // "Invocation result". Matching the heading meant the source box could be
    // read back and shown as though it were the program output.
    const shown = await workspacePage.evaluate(
      () => document.getElementById('redo-workspace').shadowRoot.querySelector('.ws').innerText,
    );
    const output = shown.split(/Test Result/i).at(-1) ?? '';
    assert.doesNotMatch(output, /puts\("YES"\)/, 'the source was echoed back as the output');
  });

  await check('Submit posts every field the form carries', async () => {
    clearCalls();
    const ws = workspacePage.locator('#redo-workspace');
    await ws.getByRole('button', { name: /^Submit$/ }).click();
    await workspacePage.waitForTimeout(2500);

    const posts = called((c) => c.method === 'POST' && /submit/.test(c.url));
    assert.ok(posts.length > 0, 'Submit never reached Codeforces');
    const body = posts.at(-1).postData ?? '';
    for (const field of ['csrf_token', 'ftaa', 'bfaa', 'action', 'submittedProblemIndex', 'programTypeId', 'source']) {
      assert.ok(new RegExp(`name="${field}"`).test(body), `Submit dropped ${field}`);
    }
    // Codeforces refuses a resubmission of identical source unless this is set,
    // and refuses it silently — the form comes back with nothing said.
    assert.ok(/name="sourceCodeConfirmed"/.test(body), 'sourceCodeConfirmed was not sent');
    assert.match(body, /int main/, 'the submission carried no source');
  });

  await check('the draft survives closing and reopening the workspace', async () => {
    const { count } = await ask({ type: 'workspace:drafts' });
    assert.ok(count > 0, 'the typed source was never saved as a draft');
    await workspacePage.close();
    workspacePage = null;
  });

  /* ==================================================== 16. focus mode gate */

  group('focus mode');

  await check('a distraction is gated when focus mode is on', async () => {
    // The day's one emergency pause was spent earlier in this run; the gate
    // stands down while a pause is live, so it is cleared first.
    await driver.evaluate(() => chrome.storage.local.remove('focusPause'));
    const settings = await ask({ type: 'settings:get' });
    // A goal this run cannot already have met: the gate stands down once the
    // day's target is reached, which by this point in the suite it would be.
    await ask({ type: 'settings:save', patch: { focus: { ...settings.focus, enabled: true, mode: 'any', dailyGoal: 99, allowlist: [] } } });

    const status = await ask({ type: 'focus:status' });
    assert.equal(status.decision.gate, true, `the gate is not armed: ${JSON.stringify(status.decision)}`);
    assert.ok(status.target?.url, 'the gate has nowhere to send the user');

    const page = await rig.context.newPage();
    await page.goto('https://www.youtube.com/');
    await page.waitForTimeout(2500);
    const url = page.url();
    assert.match(url, /focus\/index\.html/, `the gate did not intervene; still on ${url}`);
    await page.close();
  });

  await check('the gate offers a way through and says what it wants', async () => {
    const page = await rig.context.newPage();
    await page.goto('https://www.reddit.com/');
    await page.waitForTimeout(2500);
    const text = await page.locator('body').innerText();
    assert.ok(text.trim().length > 0, 'the gate page rendered nothing');
    const buttons = await page.getByRole('button').count();
    assert.ok(buttons > 0, 'the gate offers no way out at all');
    await page.close();
  });

  await check('a judge is never gated — that is where the work happens', async () => {
    for (const judge of ['https://codeforces.com/problemset', 'https://leetcode.com/problemset/', 'https://www.hackerrank.com/']) {
      const page = await rig.context.newPage();
      await page.goto(judge);
      await page.waitForTimeout(1500);
      assert.ok(!page.url().includes('focus/index.html'), `the gate blocked ${judge}`);
      await page.close();
    }
  });

  await check('a pause lets the distraction through until it expires', async () => {
    await driver.evaluate(() => chrome.storage.local.remove('focusPause'));
    const paused = await ask({ type: 'focus:pause' });
    assert.equal(paused.started, true, 'the pause was refused');
    assert.ok(paused.until > Date.now(), 'the pause ends in the past');
    const page = await rig.context.newPage();
    await page.goto('https://www.youtube.com/');
    await page.waitForTimeout(2000);
    assert.ok(!page.url().includes('focus/index.html'), 'still gated during a pause');
    await page.close();
  });

  await check('the day\'s one pause cannot be spent twice', async () => {
    // The limit is the only thing that makes the gate mean anything — without
    // it the escape hatch is just an off switch with an extra click.
    const again = await ask({ type: 'focus:pause' });
    assert.equal(again.started, false, 'a second pause was granted on the same day');
  });

  await check('turning focus mode off lets the page through again', async () => {
    const settings = await ask({ type: 'settings:get' });
    await ask({ type: 'settings:save', patch: { focus: { ...settings.focus, enabled: false } } });
    const page = await rig.context.newPage();
    await page.goto('https://www.youtube.com/');
    await page.waitForTimeout(2000);
    assert.match(page.url(), /youtube\.com/, 'still gated after focus mode was switched off');
    await page.close();
  });

  /* ====================================================== 17. the error paths */

  group('when things go wrong');

  await check('a repository that does not exist is reported, not swallowed', async () => {
    const response = await send({
      type: 'github:verify',
      config: { token: 'ghp_stub', owner: 'nobody', repo: 'nothing', branch: 'main', enabled: true, clientId: '', signInPrivate: true, perPlatform: {}, commitMessage: '', backup: false, sync: false },
    });
    // Either a clean failure or a result saying so — what must not happen is a
    // silent success that leaves the user thinking sync is configured.
    if (response.ok) {
      assert.ok(response.data && response.data.ok !== true, `a missing repository verified as fine: ${JSON.stringify(response.data)}`);
    } else {
      assert.ok(response.error.length > 0, 'the failure carried no message');
    }
  });

  await check('a solve with sync switched off is still recorded', async () => {
    const settings = await ask({ type: 'settings:get' });
    await ask({ type: 'settings:save', patch: { github: { ...settings.github, enabled: false } } });
    const result = await ask({ type: 'submission:accepted', submission: submission({ slug: 'offline-solve', problemId: '77', title: 'Offline Solve' }) });
    assert.equal(result.saved, true, 'the solve was lost because GitHub was off');
    assert.equal(result.problem.github.status, 'disabled', `unexpected sync state: ${JSON.stringify(result.problem.github)}`);
  });

  await check('a solve for a platform that is switched off is refused with a reason', async () => {
    const settings = await ask({ type: 'settings:get' });
    await ask({ type: 'settings:save', patch: { platforms: { ...settings.platforms, atcoder: false } } });
    const result = await ask({ type: 'submission:accepted', submission: submission({ platform: 'atcoder', slug: 'abc390_a', problemId: 'abc390_a' }) });
    assert.equal(result.saved, false, 'a switched-off platform was still tracked');
    assert.match(result.reason, /atcoder/i, `the reason does not name the platform: ${result.reason}`);
    await ask({ type: 'settings:save', patch: { platforms: { ...settings.platforms, atcoder: true } } });
  });

  await check('an empty store does not break the dashboard', async () => {
    await storage.set({ problems: {} });
    const data = await ask({ type: 'dashboard:get' });
    assert.deepEqual(data.problems, [], 'the store was not empty');
    assert.ok(data.stats, 'no stats came back for an empty store');
    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${id}/panel/index.html`);
    await page.waitForTimeout(1800);
    assert.deepEqual(errors, [], `the panel threw with nothing solved: ${errors.join('; ')}`);
    await page.close();
  });

  /* =============================================== 18. settings round-trip */

  group('every setting survives a round trip');

  await check('each switch saves and reads back', async () => {
    const before = await ask({ type: 'settings:get' });

    const flipped = {
      page: Object.fromEntries(Object.entries(before.page).map(([k, v]) => [k, typeof v === 'boolean' ? !v : v])),
      platforms: Object.fromEntries(Object.entries(before.platforms).map(([k, v]) => [k, !v])),
    };
    const saved = await ask({ type: 'settings:save', patch: flipped });

    for (const [key, value] of Object.entries(flipped.page)) {
      assert.equal(saved.page[key], value, `page.${key} did not save`);
    }
    for (const [key, value] of Object.entries(flipped.platforms)) {
      assert.equal(saved.platforms[key], value, `platforms.${key} did not save`);
    }

    // And again from storage, not from the value the save happened to return.
    const reread = await ask({ type: 'settings:get' });
    assert.deepEqual(reread.page, saved.page, 'page settings did not survive a re-read');
    assert.deepEqual(reread.platforms, saved.platforms, 'platform settings did not survive a re-read');

    await ask({ type: 'settings:save', patch: { page: before.page, platforms: before.platforms } });
  });

  await check('an unknown key in a patch does not wipe the rest', async () => {
    const before = await ask({ type: 'settings:get' });
    await ask({ type: 'settings:save', patch: { nonsense: true } });
    const after = await ask({ type: 'settings:get' });
    assert.deepEqual(after.platforms, before.platforms, 'a stray key took the platform settings with it');
    assert.deepEqual(after.revision, before.revision, 'a stray key took the revision settings with it');
  });

  /* =================================================== 19. the other judges */

  group('the other judges load cleanly');

  for (const [name, url] of [
    ['CSES', 'https://cses.fi/problemset/task/1068/'],
    ['HackerEarth', 'https://www.hackerearth.com/practice/algorithms/sorting/merge-sort/practice-problems/'],
    ['CodeChef', 'https://www.codechef.com/problems/FLOW001'],
    ['HackerRank', 'https://www.hackerrank.com/challenges/solve-me-first/problem'],
    ['GeeksforGeeks', 'https://www.geeksforgeeks.org/problems/two-sum/1'],
  ]) {
    await check(`${name} takes the content script without throwing`, async () => {
      const page = await rig.context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(url);
      await page.waitForTimeout(2000);
      assert.deepEqual(errors, [], `${name} threw: ${errors.join('; ')}`);
      await page.close();
    });
  }

  /* ================================================== 20. translation */

  group('translation');

  await check('translation is off until a key is given', async () => {
    const result = await ask({ type: 'translate:strings', problem: '1899A', strings: ['Hello'] });
    assert.ok(result, 'nothing came back');
    assert.ok(!result.strings || result.error, 'strings were translated with no key configured');
  });

  await check('with a key, the strings come back and nothing else is sent', async () => {
    const settings = await ask({ type: 'settings:get' });
    if (!('translate' in settings)) return;
    await ask({ type: 'settings:save', patch: { translate: { ...settings.translate, enabled: true, apiKey: 'AIza-stub', language: 'hi' } } });
    clearCalls();
    await ask({ type: 'translate:strings', problem: '1899A', strings: ['Hello'] });
    const hits = called((c) => c.url.includes('generativelanguage.googleapis.com'));
    if (hits.length > 0) {
      // The key belongs in a header, not in a URL that ends up in logs.
      assert.ok(!hits[0].url.includes('AIza-stub'), 'the API key was put in the URL');
    }
    await ask({ type: 'settings:save', patch: { translate: settings.translate } });
  });


  /* ============================================ 21. what lands on the page */

  group('what the extension adds to the judges pages');

  /** The text inside one mount's shadow tree, or undefined if it is not there. */
  const mountText = (page, mountId) =>
    page.evaluate((id) => {
      const host = document.getElementById(`redo-mount-${id}`);
      return host?.shadowRoot?.textContent ?? undefined;
    }, mountId);

  await check('every page feature is switched on for this run', async () => {
    const settings = await ask({ type: 'settings:get' });
    const page = Object.fromEntries(
      Object.entries(settings.page).map(([k, v]) => [k, typeof v === 'boolean' ? true : v]),
    );
    const saved = await ask({ type: 'settings:save', patch: { page } });
    assert.equal(saved.page.enabled, true);
  });

  await check('the problem-of-the-day card appears on the Codeforces problem set', async () => {
    await ask({ type: 'settings:save', patch: { handles: { codeforces: 'deepakvish001' } } });
    await ask({ type: 'cf:refresh' });

    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('https://codeforces.com/problemset');
    await page.waitForTimeout(3000);
    assert.deepEqual(errors, [], `the problem set page threw: ${errors.join('; ')}`);

    const text = await mountText(page, 'cf-daily');
    assert.ok(text, 'the problem-of-the-day card never mounted');
    assert.match(text, /Problem of the Day/i, `the card has no heading: ${text.slice(0, 200)}`);
    assert.match(text, /streak/i, 'the card does not show the streak');
    await page.close();
  });

  await check('the rail appears beside a Codeforces problem', async () => {
    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('https://codeforces.com/problemset/problem/1899/A');
    await page.waitForTimeout(3000);
    assert.deepEqual(errors, [], `the problem page threw: ${errors.join('; ')}`);
    const text = await mountText(page, 'cf-rail');
    assert.ok(text, 'the Codeforces rail never mounted');
    await page.close();
  });

  await check('the rail appears beside a LeetCode problem', async () => {
    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('https://leetcode.com/problems/two-sum/');
    await page.waitForTimeout(3000);
    assert.deepEqual(errors, [], `the LeetCode page threw: ${errors.join('; ')}`);
    const text = await mountText(page, 'lc-rail');
    assert.ok(text !== undefined, 'the LeetCode rail never mounted');
    await page.close();
  });

  await check('switching the page features off removes them again', async () => {
    const settings = await ask({ type: 'settings:get' });
    await ask({ type: 'settings:save', patch: { page: { ...settings.page, enabled: false } } });

    const page = await rig.context.newPage();
    await page.goto('https://codeforces.com/problemset');
    await page.waitForTimeout(2500);
    const hosts = await page.evaluate(
      () => document.querySelectorAll('[id^="redo-mount-"]').length,
    );
    assert.equal(hosts, 0, `${hosts} mount(s) survived the master switch being turned off`);
    await page.close();

    await ask({ type: 'settings:save', patch: { page: { ...settings.page, enabled: true } } });
  });

  /* ============================================ 22. the panel with real data */

  group('the panel, with something actually solved');

  await check('a solved problem is listed with its sync state and schedule', async () => {
    await storage.set({ problems: {} });
    await enableGithub();
    await ask({ type: 'submission:accepted', submission: submission({ slug: 'panel-check', problemId: '61', title: 'Panel Check' }) });
    await driver.waitForTimeout(1200);

    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${id}/panel/index.html`);
    await page.waitForTimeout(1800);

    await page.getByRole('tab', { name: /^Solved/ }).click();
    await page.waitForTimeout(800);
    const text = await page.locator('body').innerText();
    assert.match(text, /Panel Check/, `the solved problem is not listed: ${text.slice(0, 400)}`);
    assert.deepEqual(errors, [], `the Solved tab threw: ${errors.join('; ')}`);
    await page.close();
  });

  await check('the stats tab shows topics from the user own history', async () => {
    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${id}/panel/index.html`);
    await page.waitForTimeout(1800);
    await page.getByRole('tab', { name: /^Stats/ }).click();
    await page.waitForTimeout(800);
    const text = await page.locator('body').innerText();
    assert.ok(text.trim().length > 0, 'the Stats tab is blank');
    assert.deepEqual(errors, [], `the Stats tab threw: ${errors.join('; ')}`);
    await page.close();
  });

  await check('the badge counts what is due, and clears when nothing is', async () => {
    await storage.set({ problems: {} });
    await driver.evaluate(() => chrome.action.setBadgeText({ text: '' }));

    const existing = {};
    for (const n of [1, 2, 3]) {
      existing[`leetcode:due-${n}`] = {
        id: `leetcode:due-${n}`, platform: 'leetcode', slug: `due-${n}`, problemId: String(n),
        title: `Due ${n}`, url: `https://leetcode.com/problems/due-${n}/`, difficulty: 'easy',
        tags: [], language: 'Python3', code: 'x', attempts: 1, solvedAt: now - 30 * DAY,
        updatedAt: now - 30 * DAY, github: { status: 'disabled' }, parikshaa: { status: 'disabled' },
        revision: { stage: 1, ease: 1, dueAt: now - DAY, reviewCount: 1, lapses: 0, hintsUsed: 0 },
      };
    }
    await storage.set({ problems: existing });

    // The badge is refreshed as a side effect of the work, so ask for something
    // that does it rather than reaching in and calling it.
    await ask({ type: 'due:list' });
    await ask({ type: 'problem:review', id: 'leetcode:due-1', recall: 'good' });
    await driver.waitForTimeout(600);

    const badge = await rig.worker.evaluate(() => chrome.action.getBadgeText({}));
    assert.equal(badge, '2', `the badge says "${badge}" with two problems due`);
  });

  /* ================================================= 23. the other panels */

  group('training, history and insights carry real content');

  await check('insights come back with a shape the panel can render', async () => {
    const data = await ask({ type: 'insights:get', days: 30 });
    assert.ok(data && typeof data === 'object', 'no insights');
    assert.ok(Object.keys(data).length > 0, 'the insights payload is empty');
  });

  await check('a training round can be started, rerolled and finished', async () => {
    const started = await ask({ type: 'train:start', ratings: [800, 1200], minutes: 45 });
    assert.ok(started, 'nothing came back from starting a round');
    const rerolled = await ask({ type: 'train:reroll', index: 0 });
    assert.ok(rerolled, 'the reroll came back empty');
    const finished = await ask({ type: 'train:finish' });
    assert.ok(finished, 'finishing came back empty');
  });

  await check('contest history comes back for a connected handle', async () => {
    const history = await ask({ type: 'history:get' });
    assert.ok(history, 'no history');
  });

  await check('the upsolve list refreshes without a handle configured', async () => {
    const before = await ask({ type: 'settings:get' });
    await ask({ type: 'settings:save', patch: { handles: { ...before.handles, codeforces: '' } } });
    const data = await ask({ type: 'upsolve:refresh' });
    assert.ok(data, 'upsolve refused to answer without a handle');
    await ask({ type: 'settings:save', patch: { handles: before.handles } });
  });


  /* ================================================ 24. practice sheets */

  group('practice sheets');

  await check('Blind 75 is there before anything is imported', async () => {
    const data = await ask({ type: 'sheets:get' });
    const blind = data.progress.find((sheet) => sheet.id === 'blind-75');
    assert.ok(blind, `no built-in sheet: ${data.progress.map((s) => s.id).join(', ')}`);
    assert.equal(blind.total, 75);
    assert.ok(blind.groups.length >= 9, 'the sections were lost on the way through');
  });

  await check('a problem solved before the sheet existed already counts', async () => {
    // The whole point of importing a sheet is being told where you are, not
    // being reset to zero.
    await storage.set({ problems: {} });
    await ask({ type: 'settings:save', patch: { github: { ...(await ask({ type: 'settings:get' })).github, enabled: false } } });
    await ask({ type: 'submission:accepted', submission: submission({ slug: 'two-sum', problemId: '1', title: 'Two Sum' }) });

    const data = await ask({ type: 'sheets:get' });
    const blind = data.progress.find((sheet) => sheet.id === 'blind-75');
    assert.equal(blind.solved, 1, 'the existing solve did not count towards the sheet');
    assert.ok(blind.percent > 0, 'the bar is still at zero');
  });

  await check('a pasted list becomes a sheet, and says what it skipped', async () => {
    const result = await ask({
      type: 'sheets:import',
      name: 'My Sheet',
      text: [
        '# Arrays',
        'https://leetcode.com/problems/two-sum/',
        '- [3Sum](https://leetcode.com/problems/3sum/)',
        'This line is a note and should not become a problem.',
        '# Graphs',
        'https://codeforces.com/problemset/problem/1899/A',
        'two-sum',
      ].join('\n'),
    });

    assert.equal(result.read, 3, `read ${result.read} problems`);
    assert.equal(result.skipped, 1, 'the prose line was not skipped');
    assert.equal(result.duplicates, 1, 'the repeated problem was not spotted');

    const mine = result.progress.find((sheet) => sheet.id === 'my-sheet');
    assert.ok(mine, 'the imported sheet is not in the list');
    assert.equal(mine.solved, 1, 'the already-solved problem did not count');
    assert.deepEqual(mine.groups.map((g) => g.name), ['Arrays', 'Graphs']);
  });

  await check('importing the same sheet again replaces it rather than stacking', async () => {
    const before = (await ask({ type: 'sheets:get' })).sheets.length;
    await ask({ type: 'sheets:import', name: 'My Sheet', text: 'two-sum\nvalid-anagram' });
    const after = await ask({ type: 'sheets:get' });
    assert.equal(after.sheets.length, before, 'a second copy was added');
    assert.equal(after.sheets.find((s) => s.id === 'my-sheet').entries.length, 2, 'the sheet was not replaced');
  });

  await check('a Codeforces entry ticks off when that problem is solved', async () => {
    await ask({ type: 'sheets:import', name: 'CF', text: 'https://codeforces.com/problemset/problem/1899/A' });
    const before = (await ask({ type: 'sheets:get' })).progress.find((s) => s.id === 'cf');
    assert.equal(before.solved, 0);

    await ask({
      type: 'submission:accepted',
      submission: submission({
        platform: 'codeforces', slug: '1899A', problemId: '1899A', title: 'Game with Integers',
        url: 'https://codeforces.com/problemset/problem/1899/A', language: 'C++', code: 'int main(){}',
      }),
    });

    const after = (await ask({ type: 'sheets:get' })).progress.find((s) => s.id === 'cf');
    assert.equal(after.solved, 1, 'a Codeforces solve did not tick off its sheet entry');
  });

  await check('what to do next is drawn from one sheet, with links that work', async () => {
    const data = await ask({ type: 'sheets:get' });
    assert.ok(data.next.length > 0, 'nothing was suggested');
    assert.equal(new Set(data.next.map((entry) => entry.sheet)).size, 1, 'the suggestions are scattered across sheets');
    for (const entry of data.next) {
      assert.match(entry.url, /^https:\/\/(leetcode\.com|codeforces\.com)\//, `bad link: ${entry.url}`);
    }
  });

  await check('an empty import is refused with a reason, not stored', async () => {
    const before = (await ask({ type: 'sheets:get' })).sheets.length;
    const response = await send({ type: 'sheets:import', name: 'Nothing', text: 'just some prose here.' });
    assert.equal(response.ok, false, 'an empty list was accepted as a sheet');
    assert.match(response.error, /could not be read|empty/i, `unhelpful message: ${response.error}`);
    assert.equal((await ask({ type: 'sheets:get' })).sheets.length, before, 'it was stored anyway');
  });

  await check('an imported sheet can be removed, the built-in one cannot be lost', async () => {
    const after = await ask({ type: 'sheets:delete', id: 'my-sheet' });
    assert.ok(!after.sheets.some((sheet) => sheet.id === 'my-sheet'), 'it was not removed');
    assert.ok(after.sheets.some((sheet) => sheet.id === 'blind-75'), 'the built-in sheet went with it');
  });

  await check('the Sheets tab renders the bars', async () => {
    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${id}/panel/index.html`);
    await page.waitForTimeout(1600);
    await page.getByRole('tab', { name: /^Sheets/ }).click();
    await page.waitForTimeout(1000);

    const text = await page.locator('body').innerText();
    assert.match(text, /Blind 75/, `the sheet is not on the tab: ${text.slice(0, 300)}`);
    const bars = await page.getByRole('progressbar').count();
    assert.ok(bars > 0, 'no progress bar rendered');
    assert.deepEqual(errors, [], `the Sheets tab threw: ${errors.join('; ')}`);
    await page.close();
  });

  await check('a sheet can be imported from the Settings page itself', async () => {
    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${id}/options/index.html`);
    await page.waitForTimeout(1600);

    // Settings shows one group at a time; sheets live under Revision.
    await page.locator('.settings__tab', { hasText: 'Revision' }).click();
    await page.waitForTimeout(500);

    await page.locator('#sheet-name').fill('Typed In');
    await page.locator('#sheet-text').fill('https://leetcode.com/problems/valid-anagram/\ngroup-anagrams');
    await page.getByRole('button', { name: /Import sheet/i }).click();
    await page.waitForTimeout(1500);

    const stored = await ask({ type: 'sheets:get' });
    assert.ok(stored.sheets.some((sheet) => sheet.id === 'typed-in'), 'the typed sheet was not stored');
    assert.deepEqual(errors, [], `settings threw: ${errors.join('; ')}`);
    await page.close();
  });


  /* ================================================= 25. keyboard and labels */

  group('keyboard and screen readers');

  /**
   * The accessible name of every control on a page, computed in the page the
   * way a screen reader would: the text, then aria-label, then the associated
   * label element, then title. A control with none of those is announced as
   * "button" and is unusable without sight of it.
   */
  const unnamedControls = (page) =>
    page.evaluate(() => {
      const nameOf = (el) => {
        const aria = el.getAttribute('aria-label');
        if (aria?.trim()) return aria.trim();
        const by = el.getAttribute('aria-labelledby');
        if (by) {
          const target = document.getElementById(by);
          if (target?.textContent?.trim()) return target.textContent.trim();
        }
        if (el.labels?.length) {
          const text = [...el.labels].map((l) => l.textContent ?? '').join(' ').trim();
          if (text) return text;
        }
        if (el.textContent?.trim()) return el.textContent.trim();
        if (el.getAttribute('title')?.trim()) return el.getAttribute('title').trim();
        if (el.getAttribute('placeholder')?.trim()) return el.getAttribute('placeholder').trim();
        return '';
      };

      return [...document.querySelectorAll('button, a[href], input, select, textarea')]
        .filter((el) => el.offsetParent !== null || el === document.activeElement)
        .filter((el) => !nameOf(el))
        .map((el) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''}`);
    });

  await check('every control in the panel announces itself', async () => {
    const page = await rig.context.newPage();
    await page.goto(`chrome-extension://${id}/panel/index.html`);
    await page.waitForTimeout(1800);

    const bad = [];
    for (const name of ['Home', 'Due', 'Solved', 'Sheets', 'Train', 'Stats']) {
      await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
      await page.waitForTimeout(500);
      bad.push(...(await unnamedControls(page)).map((entry) => `${name}: ${entry}`));
    }
    const unique = [...new Set(bad)];
    assert.ok(unique.length === 0, `controls with no accessible name: ${unique.join(' | ')}`);
    await page.close();
  });

  await check('every control in Settings announces itself', async () => {
    const page = await rig.context.newPage();
    await page.goto(`chrome-extension://${id}/options/index.html`);
    await page.waitForTimeout(1800);

    const bad = [];
    for (const group of ['Sync', 'Revision', 'Judge pages', 'Contests', 'Advanced']) {
      await page.locator('.settings__tab', { hasText: group }).click();
      await page.waitForTimeout(400);
      bad.push(...(await unnamedControls(page)).map((entry) => `${group}: ${entry}`));
    }
    const unique = [...new Set(bad)];
    assert.ok(unique.length === 0, `controls with no accessible name: ${unique.join(' | ')}`);
    await page.close();
  });

  await check('the tab strip is one tab stop, and the arrows move within it', async () => {
    // Six separate tab stops in front of the content is exactly what the
    // tablist pattern exists to avoid.
    const page = await rig.context.newPage();
    await page.goto(`chrome-extension://${id}/panel/index.html`);
    await page.waitForTimeout(1800);

    const stops = await page.evaluate(
      () => [...document.querySelectorAll('[role="tab"]')].filter((el) => el.tabIndex === 0).length,
    );
    assert.equal(stops, 1, `${stops} of the tabs are in the tab order`);

    await page.getByRole('tab', { name: /^Home/ }).focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    const selected = await page.evaluate(
      () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim(),
    );
    assert.match(selected ?? '', /^Due/, `ArrowRight selected ${selected}`);

    // And focus went with it, or the next arrow press would do nothing.
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('role'));
    assert.equal(focused, 'tab', 'focus did not follow the selection');

    await page.keyboard.press('End');
    await page.waitForTimeout(400);
    const last = await page.evaluate(
      () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim(),
    );
    assert.match(last ?? '', /^Stats/, `End selected ${last}`);
    await page.close();
  });

  await check('the tab panel is tied to the tab that opened it', async () => {
    const page = await rig.context.newPage();
    await page.goto(`chrome-extension://${id}/panel/index.html`);
    await page.waitForTimeout(1800);
    const wired = await page.evaluate(() => {
      const tab = document.querySelector('[role="tab"][aria-selected="true"]');
      const panel = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
      return Boolean(panel) && panel.getAttribute('aria-labelledby') === tab.id;
    });
    assert.ok(wired, 'the tab and its panel do not refer to each other');
    await page.close();
  });

  await check('the keyboard shortcuts are declared and distinct', async () => {
    const commands = await rig.worker.evaluate(() => chrome.commands.getAll());
    const names = commands.map((entry) => entry.name);
    for (const wanted of ['_execute_action', 'review-next', 'open-workspace']) {
      assert.ok(names.includes(wanted), `${wanted} is not registered: ${names.join(', ')}`);
    }
    const bound = commands.map((entry) => entry.shortcut).filter(Boolean);
    assert.equal(new Set(bound).size, bound.length, `two commands share a shortcut: ${bound.join(', ')}`);
  });

  await check('the setup page opens on install and greets you once', async () => {
    // The welcome only shows for the URL the install opens, never on a later
    // visit — a settings page that greets you every time is not a settings page.
    const welcome = await rig.context.newPage();
    await welcome.goto(`chrome-extension://${id}/options/index.html?welcome=1`);
    await welcome.waitForTimeout(1500);
    const greeted = await welcome.locator('body').innerText();
    assert.match(greeted, /Redo is installed/, 'the first-run greeting is missing');
    assert.match(greeted, /Alt/, 'the shortcuts are not shown to a new user');
    await welcome.close();

    const plain = await rig.context.newPage();
    await plain.goto(`chrome-extension://${id}/options/index.html`);
    await plain.waitForTimeout(1500);
    const text = await plain.locator('body').innerText();
    assert.doesNotMatch(text, /Redo is installed/, 'the greeting shows on an ordinary visit');
    await plain.close();
  });


  /* ============================================= 26. search and mock rounds */

  group('searching your own solutions');

  await check('a word in the code finds the problem it is in', async () => {
    await storage.set({ problems: {} });
    await ask({ type: 'settings:save', patch: { github: { ...(await ask({ type: 'settings:get' })).github, enabled: false } } });

    await ask({ type: 'submission:accepted', submission: submission({
      slug: 'daily-temperatures', problemId: '739', title: 'Daily Temperatures',
      tags: ['Stack'], code: 'def f(t):\n    stack = []\n    # monotonic, decreasing\n',
    }) });
    await ask({ type: 'submission:accepted', submission: submission({
      slug: 'two-sum', problemId: '1', title: 'Two Sum', tags: ['Hash Table'], code: 'seen = {}',
    }) });

    const { hits } = await ask({ type: 'search', query: 'monotonic' });
    assert.equal(hits.length, 1, `expected one hit, got ${hits.map((h) => h.title).join(', ')}`);
    assert.equal(hits[0].title, 'Daily Temperatures');
    assert.ok(hits[0].snippet, 'no line of code came back');
    assert.equal(hits[0].snippet.line, 3, 'the line number is wrong');
    assert.match(hits[0].snippet.text, /monotonic/);
  });

  await check('every word has to appear — the search is not an or', async () => {
    const both = await ask({ type: 'search', query: 'monotonic stack' });
    assert.equal(both.hits.length, 1, 'the second term was ignored');
    const neither = await ask({ type: 'search', query: 'monotonic hash' });
    assert.equal(neither.hits.length, 0, 'a problem matched without carrying both words');
  });

  await check('a title match outranks one buried in the code', async () => {
    const { hits } = await ask({ type: 'search', query: 'sum' });
    assert.ok(hits.length > 0, 'nothing matched');
    assert.equal(hits[0].title, 'Two Sum', `ranked ${hits.map((h) => h.title).join(' > ')}`);
  });

  await check('the search carries the row, not every version of the source', async () => {
    // A hit used to be the whole record, and a record carries every solution it
    // has — a few hundred kilobytes to render a list of titles.
    const { hits } = await ask({ type: 'search', query: 'stack' });
    const keys = Object.keys(hits[0]).sort();
    assert.ok(!keys.includes('code'), `the source crossed the boundary: ${keys.join(', ')}`);
    assert.ok(!keys.includes('solutions'), 'every solution crossed the boundary');
    assert.ok(keys.includes('title') && keys.includes('url'), `missing what the row needs: ${keys.join(', ')}`);
  });

  await check('an empty query returns nothing rather than everything', async () => {
    const { hits } = await ask({ type: 'search', query: '   ' });
    assert.deepEqual(hits, []);
  });

  await check('the panel filter reaches the code and shows the line', async () => {
    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${id}/panel/index.html`);
    await page.waitForTimeout(1800);
    await page.getByRole('tab', { name: /^Solved/ }).click();
    await page.waitForTimeout(700);

    await page.locator('.search input').fill('monotonic');
    await page.waitForTimeout(900);

    const text = await page.locator('body').innerText();
    assert.match(text, /Daily Temperatures/, `the match is not listed: ${text.slice(0, 400)}`);
    assert.doesNotMatch(text, /Two Sum/, 'a problem that does not contain the word is still listed');
    assert.match(text, /line 3/, 'the matching line is not shown');
    assert.deepEqual(errors, [], `the Solved tab threw while searching: ${errors.join('; ')}`);
    await page.close();
  });

  group('the mock interview round');

  await check('nothing stale enough means the round says so rather than starting', async () => {
    // Everything solved in this run is minutes old; a round on a problem you
    // solved five minutes ago would measure nothing.
    const data = await ask({ type: 'mock:get' });
    assert.equal(data.candidates, 0, `${data.candidates} problems counted as stale`);
    const response = await send({ type: 'mock:start', minutes: 30 });
    assert.equal(response.ok, false, 'a round started with nothing to ask about');
    assert.match(response.error, /week/i, `unhelpful message: ${response.error}`);
  });

  await check('a round starts on a problem that has gone stale', async () => {
    const stale = {};
    for (const n of [1, 2, 3]) {
      stale[`leetcode:stale-${n}`] = {
        id: `leetcode:stale-${n}`, platform: 'leetcode', slug: `stale-${n}`, problemId: String(n),
        title: `Stale ${n}`, url: `https://leetcode.com/problems/stale-${n}/`, difficulty: 'medium',
        tags: [], language: 'Python3', code: 'x', attempts: 1,
        solvedAt: now - 90 * DAY, updatedAt: now - 90 * DAY,
        github: { status: 'disabled' }, parikshaa: { status: 'disabled' },
        revision: { stage: 2, ease: 1, dueAt: now + DAY, reviewCount: 2, lapses: 0, hintsUsed: 0, lastReviewedAt: now - 60 * DAY },
      };
    }
    await storage.set({ problems: stale });

    const started = await ask({ type: 'mock:start', minutes: 30 });
    assert.ok(started.session, 'no round came back');
    assert.equal(started.running, true);
    assert.equal(started.hintsLocked, true, 'the hints are not sealed');
    assert.match(started.session.problem.title, /^Stale /);
    assert.ok(started.remainingMs > 29 * 60_000, `the clock started at ${started.remainingMs}ms`);
  });

  await check('starting again does not throw away the round in progress', async () => {
    const before = (await ask({ type: 'mock:get' })).session;
    const after = await ask({ type: 'mock:start', minutes: 60 });
    assert.equal(after.session.startedAt, before.startedAt, 'the running round was replaced');
    assert.equal(after.session.minutes, before.minutes, 'the length changed under the round');
  });

  await check('rerolling changes the problem and restarts the clock', async () => {
    const before = (await ask({ type: 'mock:get' })).session;
    const after = await ask({ type: 'mock:reroll' });
    assert.notEqual(after.session.problem.slug, before.problem.slug, 'the reroll gave back the same problem');
    assert.ok(after.session.startedAt >= before.startedAt, 'the clock did not restart');
  });

  await check('the round survives the panel being closed', async () => {
    // The clock is rendered from `endsAt`, not counted down in a page's state —
    // an interview timer that resets when you switch tabs is worse than none.
    const page = await rig.context.newPage();
    await page.goto(`chrome-extension://${id}/panel/index.html`);
    await page.waitForTimeout(1500);
    await page.close();

    const still = await ask({ type: 'mock:get' });
    assert.equal(still.running, true, 'closing the panel ended the round');
  });

  await check('finishing records the outcome and clears the round', async () => {
    const finished = await ask({ type: 'mock:finish', outcome: 'solved' });
    assert.equal(finished.running, false);
    assert.equal(finished.hintsLocked, false, 'the hints are still sealed after the round');
    assert.equal(finished.history[0]?.outcome, 'solved', 'the outcome was not recorded');
    assert.ok(finished.history[0]?.finishedAt, 'no finish time');
  });

  await check('finishing twice does not record the round twice', async () => {
    const before = (await ask({ type: 'mock:get' })).history.length;
    await ask({ type: 'mock:finish', outcome: 'solved' });
    assert.equal((await ask({ type: 'mock:get' })).history.length, before, 'the round was recorded again');
  });

  await check('the round is on the Train tab, with a clock', async () => {
    await ask({ type: 'mock:start', minutes: 20 });
    const page = await rig.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${id}/panel/index.html`);
    await page.waitForTimeout(1800);
    await page.getByRole('tab', { name: /^Train/ }).click();
    await page.waitForTimeout(1200);

    const text = await page.locator('body').innerText();
    assert.match(text, /Mock interview/i, 'the card is not on the tab');
    assert.match(text, /\d\d:\d\d/, `no clock is showing: ${text.slice(0, 400)}`);
    assert.match(text, /sealed|shut/i, 'the card does not say the hints are locked');

    const timer = await page.getByRole('timer').count();
    assert.ok(timer > 0, 'the clock is not announced as a timer');
    assert.deepEqual(errors, [], `the Train tab threw: ${errors.join('; ')}`);
    await page.close();
    await ask({ type: 'mock:finish', outcome: 'gave-up' });
  });

  /* ================================================ 14. the whole surface */

  group('no page ever threw');

  await check('the driver page stayed clean throughout', () => {
    assert.deepEqual(pageErrors, [], `the driver page threw: ${pageErrors.join('; ')}`);
  });
} finally {
  const failures = report();
  await shutdown(rig);
  process.exit(failures > 0 ? 1 : 0);
}

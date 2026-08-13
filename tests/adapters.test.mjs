import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { extractSource, isPending, parseSubmissionRow } from '../src/adapters/atcoder.ts';
import { readSubmission, readSubmittedCode } from '../src/adapters/hackerrank.ts';
import { readResult as readCodeChef, readSubmitted as readCodeChefSubmitted } from '../src/adapters/codechef.ts';
import {
  readDifficulty,
  readResult as readGfg,
  readSubmitted as readGfgSubmitted,
} from '../src/adapters/geeksforgeeks.ts';
import { readVerdict, submissionIdFromPath } from '../src/adapters/leetcode.ts';
import { isObserved, summarisePath } from '../src/adapters/observed.ts';
import { firstString, parseJson, pick } from '../src/adapters/exchange.ts';
import { CsesAdapter, languageFromFilename, parseCsesResult } from '../src/adapters/cses.ts';
import { HackerEarthAdapter, readHackerEarthResult } from '../src/adapters/hackerearth.ts';
import { adapterFor } from '../src/adapters/index.ts';
import {
  consumePendingCsesSubmission,
  storePendingCsesSubmission,
} from '../src/background/cses-pending.ts';
import {
  getFreshPendingCsesSubmission,
  isPendingCsesSubmissionFresh,
  savePendingCsesSubmission,
} from '../src/core/storage.ts';
import { computeStats } from '../src/core/analytics.ts';
import { PLATFORM_LABELS } from '../src/core/types.ts';

const STATS_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const STATS_INTERVALS = [1, 3, 7, 21, 45, 90];

function makeProblem(overrides = {}) {
  const { revision, ...rest } = overrides;
  return {
    id: `leetcode:${rest.slug ?? 'two-sum'}`,
    platform: 'leetcode',
    problemId: '1',
    slug: 'two-sum',
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'easy',
    tags: ['array'],
    language: 'Python3',
    code: 'print(1)',
    solvedAt: STATS_NOW,
    attempts: 1,
    github: { status: 'synced', path: 'leetcode/easy/0001-two-sum/solution.py' },
    ...rest,
    revision: { stage: 0, ease: 1, dueAt: STATS_NOW + 86_400_000, reviewCount: 0, lapses: 0, ...revision },
  };
}

function assertSanitisedCsesFixture(raw) {
  assert.doesNotMatch(raw, /<input[^>]*type=["']file["'][^>]*\bvalue=/i);
  assert.doesNotMatch(raw, /\b(?:user(?:name|[_-]?id)?|identity|filename)\s*(?:=|:)/i);
  assert.doesNotMatch(raw, /(?:data-)?(?:submission|result)[_-]?id\s*=/i);
  assert.doesNotMatch(raw, /\/problemset\/(?:result|submission)\/[^/"'<\s]+/i);
  assert.doesNotMatch(raw, /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}|\b1[5-9]\d{11,12}\b/);
  assert.doesNotMatch(raw, /name=["']csrf_token["'][^>]*\bvalue=/i);
  assert.doesNotMatch(raw, /(?:csrf|token|session|cookie|authorization|bearer)[^<\n]{0,32}(?:=|:)\s*[^\s<]+/i);
  assert.doesNotMatch(
    raw,
    /<(?:pre|code|textarea)\b|\b(?:source|code)\b\s*(?:=|:)|name=["'](?:source|code)["']/i,
  );
  assert.doesNotMatch(raw, /https?:\/\/[^\s"'<]*\?|\?[^\s"'<]+|(?:signature|sig|expires)=/i);
  assert.doesNotMatch(
    raw,
    />\s*(?:test\s+)?(?:input|output)\s*<|\btest\s*(?:input|output)\s*:|\b(?:input|output)\s*:/i,
  );
}

function assertSanitisedHackerEarthFixture(raw) {
  const response = JSON.parse(raw);
  assert.deepEqual(Object.keys(response), ['status', 'context', 'aggregated_data', 'message']);
  assert.deepEqual(Object.keys(response.context), ['is_practice', 'event', 'problem_score']);
  assert.deepEqual(Object.keys(response.aggregated_data), [
    'result',
    'result_status',
    'result_detail',
    'submission_score',
    'total_time_used',
    'max_memory_used',
    'lang',
  ]);
  assert.equal(response.message.length, 1);
  assert.deepEqual(
    Object.keys(response.message[0]),
    response.message[0].status === 'WA'
      ? ['status', 'status_detail', 'score', 'time_used', 'memory_used', 'diff_output_url']
      : ['status', 'status_detail', 'score', 'time_used', 'memory_used'],
  );
  assert.doesNotMatch(
    raw,
    /https?:\/\/[^\s"']*(?:\?|signature=|sig=|expires=)|\?[^\s"']+|(?:csrf|cookie|session|token|authorization|bearer|api[_-]?key|secret|password)/i,
  );
  assert.doesNotMatch(
    raw,
    /"(?:source|code|request(?:_|-)?(?:body|url|query)|response(?:_|-)?(?:url|query)|query(?:_|-)?(?:params?|string)|(?:submission|result)(?:_|-)?id|id)"\s*:/i,
  );
  assert.doesNotMatch(
    raw,
    /"(?:timestamp|submitted(?:_|-)?at|created(?:_|-)?at|updated(?:_|-)?at)"\s*:\s*/i,
  );
  assert.doesNotMatch(raw, /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}|\b1[5-9]\d{11,12}\b/);
}

function mutateJson(raw, mutate) {
  const value = JSON.parse(raw);
  mutate(value);
  return JSON.stringify(value);
}

/* --------------------------------------------------------- platform scope */

test('CSES and HackerEarth public practice routes are the only new adapter routes', () => {
  const csesTask = new URL('https://cses.fi/problemset/task/1193/');
  const csesContest = new URL('https://cses.fi/contest/123/task/1');
  const hackerEarthPractice = new URL('https://www.hackerearth.com/practice/algorithms/');
  const hackerEarthProblem = new URL(
    'https://www.hackerearth.com/practice/algorithms/graphs/breadth-first-search/practice-problems/algorithm/monk-and-the-islands/',
  );
  const hackerEarthPublicPractice = new URL(
    'https://www.hackerearth.com/community/problem/algorithm/make-an-array-85abd7ad/',
  );
  const hackerEarthChallenge = new URL('https://www.hackerearth.com/challenges/');
  const hackerEarthSql = new URL('https://www.hackerearth.com/practice/sql/');

  assert.equal(PLATFORM_LABELS.cses, 'CSES');
  assert.equal(PLATFORM_LABELS.hackerearth, 'HackerEarth');
  assert.equal(new CsesAdapter().matches(csesTask), true);
  assert.equal(new CsesAdapter().matches(csesContest), false);
  assert.equal(new CsesAdapter().currentSlug(csesTask), '1193');
  assert.equal(new CsesAdapter().currentSlug(csesContest), null);
  assert.equal(new HackerEarthAdapter().matches(hackerEarthPractice), true);
  assert.equal(new HackerEarthAdapter().matches(hackerEarthProblem), true);
  assert.equal(new HackerEarthAdapter().matches(hackerEarthPublicPractice), true);
  assert.equal(new HackerEarthAdapter().matches(hackerEarthChallenge), false);
  assert.equal(new HackerEarthAdapter().matches(hackerEarthSql), false);
  assert.equal(new HackerEarthAdapter().currentSlug(hackerEarthPractice), null);
  assert.equal(new HackerEarthAdapter().currentSlug(hackerEarthProblem), 'monk-and-the-islands');
  assert.equal(new HackerEarthAdapter().currentSlug(hackerEarthPublicPractice), 'make-an-array-85abd7ad');
  assert.equal(new HackerEarthAdapter().currentSlug(hackerEarthChallenge), null);
  assert.equal(adapterFor(csesTask)?.platform, 'cses');
  assert.equal(adapterFor(hackerEarthPractice)?.platform, 'hackerearth');
  assert.equal(adapterFor(hackerEarthPublicPractice)?.platform, 'hackerearth');
});

test('analytics counts CSES and HackerEarth solved records by platform', () => {
  assert.equal(
    computeStats([makeProblem({ platform: 'cses' })], STATS_INTERVALS, STATS_NOW).byPlatform.cses,
    1,
  );
  assert.equal(
    computeStats([makeProblem({ platform: 'hackerearth' })], STATS_INTERVALS, STATS_NOW).byPlatform.hackerearth,
    1,
  );
});

test('HackerEarth excludes nearby community and non-programming routes', () => {
  const adapter = new HackerEarthAdapter();
  const excluded = [
    'https://www.hackerearth.com/community/',
    'https://www.hackerearth.com/community/problem/data-science/example/',
    'https://www.hackerearth.com/community/problem/algorithm/example/extra/',
    'https://www.hackerearth.com/challenges/',
    'https://www.hackerearth.com/contests/',
    'https://www.hackerearth.com/hiring/',
    'https://www.hackerearth.com/assessment/',
    'https://www.hackerearth.com/recruitment/',
    'https://www.hackerearth.com/hackathons/',
    'https://www.hackerearth.com/projects/',
    'https://www.hackerearth.com/practice/sql/',
    'https://www.hackerearth.com/practice/data-science/',
    'https://www.hackerearth.com/practice/file-upload/',
  ];

  for (const href of excluded) {
    assert.equal(adapter.matches(new URL(href)), false, href);
    assert.equal(adapter.currentSlug(new URL(href)), null, href);
  }
});

test('the manifest declares only the two approved HackerEarth route families', () => {
  const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'));
  const expected = [
    'https://www.hackerearth.com/practice/*',
    'https://www.hackerearth.com/community/problem/algorithm/*',
  ];
  const hackerEarthMatches = (values) => values.filter((value) => value.includes('hackerearth.com'));

  assert.deepEqual(hackerEarthMatches(manifest.host_permissions), expected);
  assert.deepEqual(hackerEarthMatches(manifest.content_scripts[0].matches), expected);
  assert.deepEqual(hackerEarthMatches(manifest.content_scripts[1].matches), expected);
});

test('CSES submit fixture preserves the observed form contract without secret values', () => {
  const { document } = parseHTML(readFileSync('tests/fixtures/cses-submit-form.html', 'utf8'));
  const form = document.querySelector('form');

  assert.equal(form?.getAttribute('action'), '/course/send.php');
  assert.equal(form?.getAttribute('method'), 'post');
  assert.equal(form?.getAttribute('enctype'), 'multipart/form-data');
  assert.equal(form?.querySelector('input[type="hidden"][name="csrf_token"]')?.hasAttribute('value'), false);
  assert.equal(form?.querySelector('input[type="hidden"][name="task"]')?.getAttribute('value'), '1068');
  assert.ok(form?.querySelector('input[type="file"][name="file"]'));
  assert.ok(form?.querySelector('select[name="lang"]#lang'));
  assert.ok(form?.querySelector('select[name="option"]#option'));
  assert.ok(form?.querySelector('input[type="submit"]'));
  assert.ok(form?.querySelector('input[type="hidden"][name="type"]'));
  assert.ok(form?.querySelector('input[type="hidden"][name="target"]'));
  assert.equal(form?.querySelector('pre, textarea, code'), null);
});

test('CSES result fixtures retain only final verdict evidence and the public task link', () => {
  const accepted = parseHTML(readFileSync('tests/fixtures/cses-result-accepted.html', 'utf8')).document;
  const rejected = parseHTML(readFileSync('tests/fixtures/cses-result-rejected.html', 'utf8')).document;

  for (const [document, result] of [[accepted, 'ACCEPTED'], [rejected, 'OUTPUT LIMIT EXCEEDED']]) {
    assert.match(document.body.textContent ?? '', /Status:\s*READY/);
    assert.match(document.body.textContent ?? '', new RegExp(`Result:\\s*${result}`));
    assert.equal(document.querySelector('a[href]')?.getAttribute('href'), '/problemset/task/1068/');
    assert.ok(document.querySelector('table caption')?.textContent?.includes('Test results'));
    assert.equal(document.querySelector('input, pre, textarea, code'), null);
  }
});

test('CSES fixture privacy checks reject injected personal and submission data', () => {
  const submit = readFileSync('tests/fixtures/cses-submit-form.html', 'utf8');
  const accepted = readFileSync('tests/fixtures/cses-result-accepted.html', 'utf8');
  const rejected = readFileSync('tests/fixtures/cses-result-rejected.html', 'utf8');

  for (const fixture of [submit, accepted, rejected]) assertSanitisedCsesFixture(fixture);

  const unsafe = [
    submit.replace('name="file">', 'name="file" value="selected.cpp">'),
    accepted.replace('<main>', '<main><p>Username: fixture-user</p>'),
    accepted.replace('<main>', '<main><p>2026-08-14T12:00:00Z</p>'),
    accepted.replace('<main>', '<main data-submission-id="42">'),
    accepted.replace('/problemset/task/1068/', '/problemset/result/42/'),
    submit.replace('name="csrf_token">', 'name="csrf_token" value="secret">'),
    accepted.replace('<main>', '<main><p>session=secret</p>'),
    accepted.replace('</main>', '<textarea name="code">secret</textarea></main>'),
    accepted.replace('</main>', '<pre>source</pre></main>'),
    accepted.replace('</main>', '<input name="source" value="secret"></main>'),
    accepted.replace('/problemset/task/1068/', '/problemset/task/1068/?signature=secret'),
    rejected.replace('</table>', '</table><p>Test input: secret</p><p>Output: secret</p>'),
    rejected.replace('<td>Test</td>', '<td>Input</td>'),
  ];

  for (const fixture of unsafe) {
    assert.throws(() => assertSanitisedCsesFixture(fixture), { name: 'AssertionError' });
  }
});

/* -------------------------------------------------------------- CSES flow */

function installCsesStorage(initial = {}) {
  const values = structuredClone(initial);
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: values[key] };
        },
        async set(patch) {
          Object.assign(values, structuredClone(patch));
        },
        async remove(key) {
          delete values[key];
        },
      },
    },
    runtime: {
      async sendMessage(request) {
        return { ok: true, data: { stored: true, request } };
      },
    },
  };
  return values;
}

function installRacingCsesStorage(initial = {}) {
  const values = structuredClone(initial);
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          // The old unlocked implementation lets both calls snapshot this
          // value before either writes. A serialized implementation starts
          // the second read only after the first write updates `values`.
          const snapshot = structuredClone(values[key]);
          await new Promise((resolve) => setTimeout(resolve, 0));
          return { [key]: snapshot };
        },
        async set(patch) {
          Object.assign(values, structuredClone(patch));
        },
        async remove(key) {
          delete values[key];
        },
      },
    },
    runtime: { async sendMessage() { return { ok: true, data: { stored: true } }; } },
  };
  return values;
}

async function settleCsesAdapter() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('CSES: a selected cpp file is saved for its task for fifteen minutes', async () => {
  const stored = installCsesStorage({
    pendingCsesSubmissions: {
      stale: {
        taskId: 'stale', submittedAt: -16 * 60_000, filename: 'old.py', language: 'Python', code: 'old source',
      },
    },
  });
  const pending = {
    taskId: '1068', submittedAt: 10, filename: 'labyrinth.cpp', language: 'C++', code: 'captured source',
  };

  assert.equal(languageFromFilename('labyrinth.cpp'), 'C++');
  assert.equal(isPendingCsesSubmissionFresh({ submittedAt: 10 }, 10 + 14 * 60_000), true);
  assert.equal(isPendingCsesSubmissionFresh({ submittedAt: 10 }, 10 + 16 * 60_000), false);

  await savePendingCsesSubmission(pending, 10);
  assert.deepEqual(await getFreshPendingCsesSubmission('1068', 10 + 14 * 60_000), pending);
  assert.equal(await getFreshPendingCsesSubmission('1068', 10 + 16 * 60_000), undefined);
  assert.deepEqual(stored.pendingCsesSubmissions, {});
});

test('CSES: concurrent pending saves for different tasks keep both selected files', async () => {
  const stored = installRacingCsesStorage();
  const first = { taskId: '1068', submittedAt: 10, filename: 'first.cpp', language: 'C++', code: 'first source' };
  const second = { taskId: '1193', submittedAt: 10, filename: 'second.py', language: 'Python', code: 'second source' };

  await Promise.all([savePendingCsesSubmission(first, 10), savePendingCsesSubmission(second, 10)]);

  assert.deepEqual(stored.pendingCsesSubmissions, { 1068: first, 1193: second });
});

test('CSES: worker consumption of task 1068 keeps a concurrent task 1193 capture', async () => {
  const now = Date.now();
  const first = { taskId: '1068', submittedAt: now, filename: 'first.cpp', language: 'C++', code: 'first source' };
  const second = { taskId: '1193', submittedAt: now, filename: 'second.py', language: 'Python', code: 'second source' };
  const stored = installRacingCsesStorage({ pendingCsesSubmissions: { 1068: first } });

  const [consumed] = await Promise.all([
    consumePendingCsesSubmission('1068'),
    storePendingCsesSubmission(second),
  ]);

  assert.deepEqual(consumed.pending, first);
  assert.deepEqual(stored.pendingCsesSubmissions, { 1193: second });
});

test('CSES: malformed pending worker payloads reject without storing source', async () => {
  const stored = installCsesStorage();

  await assert.rejects(
    storePendingCsesSubmission({ taskId: ' ', submittedAt: NaN, filename: '', language: '', code: '' }),
    /malformed/i,
  );
  assert.deepEqual(stored, {});
});

test('CSES: a ready accepted result is final and names its task', () => {
  const { document } = parseHTML(readFileSync('tests/fixtures/cses-result-accepted.html', 'utf8'));

  assert.deepEqual(parseCsesResult(document, 'https://cses.fi/problemset/result/1/'), {
    taskId: '1068', verdict: 'Accepted', accepted: true,
  });
  assert.equal(parseCsesResult(document, 'https://cses.fi/problemset/task/1068/'), undefined);
});

test('CSES: a ready rejected result is final and malformed result markup is ignored', () => {
  const rejected = parseHTML(readFileSync('tests/fixtures/cses-result-rejected.html', 'utf8')).document;
  const unfinished = parseHTML(readFileSync('tests/fixtures/cses-result-rejected.html', 'utf8').replace('READY', 'JUDGING')).document;

  assert.deepEqual(parseCsesResult(rejected, 'https://cses.fi/problemset/result/2/'), {
    taskId: '1068', verdict: 'Output Limit Exceeded', accepted: false,
  });
  assert.equal(parseCsesResult(unfinished, 'https://cses.fi/problemset/result/2/'), undefined);
});

test('CSES: the selected file is captured before the unchanged native form replays once', async () => {
  const { document, window } = parseHTML(readFileSync('tests/fixtures/cses-submit-form.html', 'utf8'));
  const form = document.querySelector('form');
  const file = form.querySelector('input[type="file"]');
  const submitter = form.querySelector('input[type="submit"]');
  const messages = [];
  let replays = 0;
  const originalForm = form.outerHTML;

  Object.defineProperty(file, 'files', {
    value: [{ name: 'labyrinth.cpp', text: async () => 'captured source' }],
  });
  form.requestSubmit = (nextSubmitter) => {
    replays += 1;
    assert.equal(nextSubmitter, submitter);
  };
  globalThis.document = document;
  globalThis.window = { location: new URL('https://cses.fi/problemset/submit/1068/') };
  globalThis.chrome = {
    runtime: {
      async sendMessage(request) {
        messages.push(request);
        return { ok: true, data: { stored: true } };
      },
    },
    storage: { local: { async get() { return {}; }, async set() {}, async remove() {} } },
  };

  new CsesAdapter().start({ onAccepted() {}, onAttempt() {}, onEvent() {}, onError() {} });
  const first = new window.Event('submit', { cancelable: true });
  Object.defineProperty(first, 'submitter', { value: submitter });
  form.dispatchEvent(first);
  await settleCsesAdapter();

  assert.equal(first.defaultPrevented, true);
  assert.equal(replays, 1);
  assert.equal(form.outerHTML, originalForm);
  assert.deepEqual(messages, [{
    type: 'cses:pending',
    pending: {
      taskId: '1068', submittedAt: messages[0].pending.submittedAt,
      filename: 'labyrinth.cpp', language: 'C++', code: 'captured source',
    },
  }]);

  const replay = new window.Event('submit', { cancelable: true });
  form.dispatchEvent(replay);
  assert.equal(replay.defaultPrevented, false);
  assert.equal(replays, 1);
});

for (const [name, failure] of [
  ['file reading fails', () => Promise.reject(new Error('file unavailable'))],
  ['pending persistence fails', () => Promise.resolve('captured source')],
]) {
  test(`CSES: ${name} still replays the original native form exactly once`, async () => {
    const { document, window } = parseHTML(readFileSync('tests/fixtures/cses-submit-form.html', 'utf8'));
    const form = document.querySelector('form');
    const file = form.querySelector('input[type="file"]');
    const submitter = form.querySelector('input[type="submit"]');
    const errors = [];
    let replays = 0;

    Object.defineProperty(file, 'files', { value: [{ name: 'labyrinth.cpp', text: failure }] });
    form.requestSubmit = () => { replays += 1; };
    globalThis.document = document;
    globalThis.window = { location: new URL('https://cses.fi/problemset/submit/1068/') };
    globalThis.chrome = {
      runtime: {
        async sendMessage() {
          if (name === 'pending persistence fails') throw new Error('worker unavailable');
          return { ok: true, data: { stored: true } };
        },
      },
      storage: { local: { async get() { return {}; }, async set() {}, async remove() {} } },
    };

    new CsesAdapter().start({ onAccepted() {}, onAttempt() {}, onEvent() {}, onError(message) { errors.push(message); } });
    const event = new window.Event('submit', { cancelable: true });
    Object.defineProperty(event, 'submitter', { value: submitter });
    form.dispatchEvent(event);
    await settleCsesAdapter();

    assert.equal(event.defaultPrevented, true);
    assert.equal(replays, 1);
    assert.equal(errors.length, 1);
  });
}

test('CSES: rapid submit events cause one capture and one native replay', async () => {
  const { document, window } = parseHTML(readFileSync('tests/fixtures/cses-submit-form.html', 'utf8'));
  const form = document.querySelector('form');
  const file = form.querySelector('input[type="file"]');
  const submitter = form.querySelector('input[type="submit"]');
  let resolveText;
  const text = new Promise((resolve) => { resolveText = resolve; });
  const messages = [];
  let replays = 0;

  Object.defineProperty(file, 'files', { value: [{ name: 'labyrinth.cpp', text: () => text }] });
  form.requestSubmit = () => { replays += 1; };
  globalThis.document = document;
  globalThis.window = { location: new URL('https://cses.fi/problemset/submit/1068/') };
  globalThis.chrome = {
    runtime: { async sendMessage(request) { messages.push(request); return { ok: true, data: { stored: true } }; } },
    storage: { local: { async get() { return {}; }, async set() {}, async remove() {} } },
  };

  new CsesAdapter().start({ onAccepted() {}, onAttempt() {}, onEvent() {}, onError() {} });
  const first = new window.Event('submit', { cancelable: true });
  const second = new window.Event('submit', { cancelable: true });
  Object.defineProperty(first, 'submitter', { value: submitter });
  Object.defineProperty(second, 'submitter', { value: submitter });
  form.dispatchEvent(first);
  form.dispatchEvent(second);
  resolveText('captured source');
  await settleCsesAdapter();

  assert.equal(first.defaultPrevented, true);
  assert.equal(second.defaultPrevented, true);
  assert.equal(messages.length, 1);
  assert.equal(replays, 1);
});

test('CSES: duplicate final result renders create one rejection and one accepted record', async () => {
  const rejected = readFileSync('tests/fixtures/cses-result-rejected.html', 'utf8');
  const accepted = readFileSync('tests/fixtures/cses-result-accepted.html', 'utf8');
  const events = [];
  const attempts = [];
  const solved = [];
  const stored = installCsesStorage({
    pendingCsesSubmissions: {
      1068: {
        taskId: '1068', submittedAt: Date.now(), filename: 'solution.cpp', language: 'C++', code: 'captured source',
      },
    },
  });
  globalThis.chrome.runtime.sendMessage = async (request) => {
    if (request.type !== 'cses:pending:consume') return { ok: true, data: { stored: true } };
    const pending = stored.pendingCsesSubmissions[request.taskId];
    delete stored.pendingCsesSubmissions[request.taskId];
    return { ok: true, data: { pending } };
  };
  const context = {
    onAccepted(submission) { solved.push(submission); },
    onAttempt(problemKey) { attempts.push(problemKey); },
    onEvent(slug, event) { events.push({ slug, event }); },
    onError(message) { throw new Error(message); },
  };
  const adapter = new CsesAdapter();

  for (const html of [rejected, rejected, accepted, accepted]) {
    const { document } = parseHTML(html);
    globalThis.document = document;
    globalThis.window = { location: new URL('https://cses.fi/problemset/result/fixture/') };
    adapter.start(context);
    await settleCsesAdapter();
  }

  assert.deepEqual(attempts, ['cses:1068']);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(({ event }) => event.accepted), [false, true]);
  assert.equal(events[1].event.language, 'C++');
  assert.deepEqual(solved.map(({ attempts: count, title, url, code }) => ({ attempts: count, title, url, code })), [{
    attempts: 2,
    title: 'Weird Algorithm',
    url: 'https://cses.fi/problemset/task/1068/',
    code: 'captured source',
  }]);
  assert.deepEqual(stored.pendingCsesSubmissions, {});
});

test('HackerEarth fixtures preserve the public-practice response contract without sensitive data', () => {
  const paths = readFileSync('tests/fixtures/hackerearth-diagnostic-paths.txt', 'utf8')
    .trim()
    .split('\n');
  const acceptedRaw = readFileSync('tests/fixtures/hackerearth-accepted.json', 'utf8');
  const rejectedRaw = readFileSync('tests/fixtures/hackerearth-rejected.json', 'utf8');
  const accepted = JSON.parse(acceptedRaw);
  const rejected = JSON.parse(rejectedRaw);

  assert.deepEqual(paths, [
    'PAGE /community/problem/algorithm/make-an-array-85abd7ad/',
    'POST /submit/AJAX/',
    'GET /response/submission-json/:submissionId/AJAX/',
  ]);

  for (const [response, result] of [[accepted, 'AC'], [rejected, 'WA']]) {
    assertSanitisedHackerEarthFixture(JSON.stringify(response));
    assert.equal(typeof response.status, 'string');
    assert.equal(typeof response.context.is_practice, 'number');
    assert.equal(typeof response.context.event, 'number');
    assert.equal(typeof response.context.problem_score, 'number');
    assert.equal(response.aggregated_data.result, result);
    assert.equal(typeof response.aggregated_data.result_status, 'string');
    assert.equal(typeof response.aggregated_data.result_detail, 'string');
    assert.equal(typeof response.aggregated_data.submission_score, 'number');
    assert.equal(typeof response.aggregated_data.total_time_used, 'number');
    assert.equal(typeof response.aggregated_data.max_memory_used, 'number');
    assert.equal(typeof response.aggregated_data.lang, 'string');
    assert.equal(response.message.length, 1);
    assert.equal(typeof response.message[0].status, 'string');
    assert.equal(typeof response.message[0].status_detail, 'string');
    assert.equal(typeof response.message[0].score, 'number');
    assert.equal(typeof response.message[0].time_used, 'number');
    assert.equal(typeof response.message[0].memory_used, 'number');
  }

  assert.equal(accepted.message[0].diff_output_url, undefined);
  assert.equal(rejected.message[0].diff_output_url, '<redacted>');
});

test('HackerEarth fixture privacy checks reject injected request and result data', () => {
  const accepted = readFileSync('tests/fixtures/hackerearth-accepted.json', 'utf8');
  const rejected = readFileSync('tests/fixtures/hackerearth-rejected.json', 'utf8');

  assertSanitisedHackerEarthFixture(accepted);
  assertSanitisedHackerEarthFixture(rejected);

  const unsafe = [
    mutateJson(accepted, (value) => { value.source = 'secret'; }),
    mutateJson(accepted, (value) => { value.aggregated_data.code = 'secret'; }),
    mutateJson(accepted, (value) => { value.request_query = 'page=1'; }),
    mutateJson(accepted, (value) => { value.response_url = '/response/?signature=secret'; }),
    mutateJson(accepted, (value) => { value.context.session_token = 'secret'; }),
    mutateJson(accepted, (value) => { value.submissionId = '42'; }),
    mutateJson(accepted, (value) => { value.timestamp = '2026-08-14T12:00:00Z'; }),
    mutateJson(rejected, (value) => { value.message[0].diff_output_url = 'https://example.test/diff?sig=secret'; }),
  ];

  for (const fixture of unsafe) {
    assert.throws(() => assertSanitisedHackerEarthFixture(fixture), { name: 'AssertionError' });
  }
});

/* ---------------------------------------------------------- HackerEarth */

const HACKEREARTH_RESULT_URL =
  'https://www.hackerearth.com/response/submission-json/fixture-submission-id/AJAX/';

function publishHackerEarthExchange(listener, exchange) {
  listener({
    source: globalThis.window,
    data: {
      channel: 'redo-observer',
      method: 'GET',
      href: 'https://www.hackerearth.com/community/problem/algorithm/make-an-array-85abd7ad/',
      ...exchange,
    },
  });
}

function installHackerEarthPage() {
  const listeners = new Set();
  const page = {
    location: new URL('https://www.hackerearth.com/community/problem/algorithm/make-an-array-85abd7ad/'),
    addEventListener(type, listener) {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'message') listeners.delete(listener);
    },
  };
  globalThis.window = page;
  globalThis.document = { title: 'Make an Array | HackerEarth' };
  return (exchange) => {
    for (const listener of listeners) publishHackerEarthExchange(listener, exchange);
  };
}

test('HackerEarth: a public-practice acceptance carries its final response details', () => {
  const accepted = readFileSync('tests/fixtures/hackerearth-accepted.json', 'utf8');
  const result = readHackerEarthResult(HACKEREARTH_RESULT_URL, accepted);

  assert.equal(result?.accepted, true);
  assert.equal(result?.submissionId, 'fixture-submission-id');
  assert.equal(result?.status, 'fixture-accepted');
  assert.equal(result?.language, 'fixture-language');
  assert.equal(result?.testsPassed, 1);
  assert.equal(result?.testsTotal, 1);
  assert.equal(result?.runtime, '1');
  assert.equal(result?.memory, '1');
});

test('HackerEarth: an AC final response survives null and absent metrics', () => {
  const accepted = readFileSync('tests/fixtures/hackerearth-accepted.json', 'utf8');
  const withoutMetrics = mutateJson(accepted, (value) => {
    value.context.problem_score = null;
    value.aggregated_data.submission_score = null;
    delete value.aggregated_data.total_time_used;
    value.aggregated_data.max_memory_used = null;
    value.message[0].score = null;
    delete value.message[0].time_used;
    value.message[0].memory_used = null;
  });

  assert.deepEqual(readHackerEarthResult(HACKEREARTH_RESULT_URL, withoutMetrics), {
    accepted: true,
    submissionId: 'fixture-submission-id',
    status: 'fixture-accepted',
    language: 'fixture-language',
    testsPassed: 1,
    testsTotal: 1,
  });
});

test('HackerEarth: a WA final response survives null and absent metrics', () => {
  const rejected = readFileSync('tests/fixtures/hackerearth-rejected.json', 'utf8');
  const withoutMetrics = mutateJson(rejected, (value) => {
    delete value.context.problem_score;
    delete value.aggregated_data.submission_score;
    value.aggregated_data.total_time_used = null;
    delete value.aggregated_data.max_memory_used;
    delete value.message[0].score;
    value.message[0].time_used = null;
    delete value.message[0].memory_used;
  });

  assert.deepEqual(readHackerEarthResult(HACKEREARTH_RESULT_URL, withoutMetrics), {
    accepted: false,
    submissionId: 'fixture-submission-id',
    status: 'fixture-rejected',
    language: 'fixture-language',
    testsPassed: 0,
    testsTotal: 1,
    errorText: 'sanitized',
  });
});

test('HackerEarth: accepted events omit unavailable runtime and memory', () => {
  const accepted = readFileSync('tests/fixtures/hackerearth-accepted.json', 'utf8');
  const withoutTiming = mutateJson(accepted, (value) => {
    value.aggregated_data.total_time_used = null;
    delete value.aggregated_data.max_memory_used;
  });
  const publish = installHackerEarthPage();
  const events = [];

  new HackerEarthAdapter().start({
    onAccepted() {},
    onAttempt() {},
    onEvent(_slug, event) { events.push(event); },
    onError(message) { throw new Error(message); },
  });
  publish({
    url: HACKEREARTH_RESULT_URL,
    responseBody: withoutTiming,
    editorCode: 'editor snapshot',
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].accepted, true);
  assert.equal(events[0].verdict, 'fixture-accepted');
  assert.equal(Object.hasOwn(events[0], 'runtime'), false);
  assert.equal(Object.hasOwn(events[0], 'memory'), false);
});

test('HackerEarth: assessment routes and non-final or non-practice responses are ignored', () => {
  const accepted = readFileSync('tests/fixtures/hackerearth-accepted.json', 'utf8');
  const pending = mutateJson(accepted, (value) => { value.status = 'queued'; });
  const nonPractice = mutateJson(accepted, (value) => { value.context.is_practice = 0; });
  const unrecognised = mutateJson(accepted, (value) => { value.aggregated_data.result = 'TLE'; });

  assert.equal(new HackerEarthAdapter().matches(new URL('https://www.hackerearth.com/assessment/test/')), false);
  assert.equal(readHackerEarthResult(HACKEREARTH_RESULT_URL, pending), undefined);
  assert.equal(readHackerEarthResult(HACKEREARTH_RESULT_URL, nonPractice), undefined);
  assert.equal(readHackerEarthResult(HACKEREARTH_RESULT_URL, unrecognised), undefined);
});

test('HackerEarth: final result polls record one failure and one editor-backed acceptance', () => {
  const rejected = readFileSync('tests/fixtures/hackerearth-rejected.json', 'utf8');
  const accepted = readFileSync('tests/fixtures/hackerearth-accepted.json', 'utf8');
  const publish = installHackerEarthPage();
  const attempts = [];
  const events = [];
  const solved = [];
  const timeline = [];
  const adapter = new HackerEarthAdapter();

  adapter.start({
    onAccepted(submission) {
      timeline.push('accepted');
      solved.push(submission);
    },
    onAttempt(problemKey) { attempts.push(problemKey); },
    onEvent(slug, event) {
      timeline.push(`event:${event.accepted}`);
      events.push({ slug, event });
    },
    onError(message) { throw new Error(message); },
  });

  const rejectedExchange = {
    url: HACKEREARTH_RESULT_URL.replace('fixture-submission-id', 'fixture-rejected-id'),
    responseBody: rejected,
  };
  publish(rejectedExchange);
  publish(rejectedExchange);
  const acceptedExchange = {
    url: HACKEREARTH_RESULT_URL,
    // The result observer is never allowed to recover code from a request body.
    requestBody: 'source=must-not-be-used',
    responseBody: accepted,
    editorCode: 'editor snapshot',
  };
  publish(acceptedExchange);
  publish(acceptedExchange);

  assert.deepEqual(attempts, ['hackerearth:make-an-array-85abd7ad']);
  assert.deepEqual(events.map(({ event }) => ({
    accepted: event.accepted,
    verdict: event.verdict,
    language: event.language,
    testsPassed: event.testsPassed,
    testsTotal: event.testsTotal,
  })), [
    { accepted: false, verdict: 'fixture-rejected', language: 'fixture-language', testsPassed: 0, testsTotal: 1 },
    { accepted: true, verdict: 'fixture-accepted', language: 'fixture-language', testsPassed: 1, testsTotal: 1 },
  ]);
  assert.deepEqual(timeline, ['event:false', 'event:true', 'accepted']);
  assert.deepEqual(solved.map(({ attempts: count, code, language, title, url }) => ({
    attempts: count, code, language, title, url,
  })), [{
    attempts: 2,
    code: 'editor snapshot',
    language: 'fixture-language',
    title: 'Make an Array',
    url: 'https://www.hackerearth.com/community/problem/algorithm/make-an-array-85abd7ad/',
  }]);
});

test('HackerEarth: an accepted result without an editor snapshot stays unsolved', () => {
  const accepted = readFileSync('tests/fixtures/hackerearth-accepted.json', 'utf8');
  const publish = installHackerEarthPage();
  const errors = [];
  const solved = [];
  const adapter = new HackerEarthAdapter();

  adapter.start({
    onAccepted(submission) { solved.push(submission); },
    onAttempt() {},
    onEvent() {},
    onError(message) { errors.push(message); },
  });
  publish({
    url: HACKEREARTH_RESULT_URL,
    requestBody: 'source=must-not-be-used',
    responseBody: accepted,
  });

  assert.deepEqual(solved, []);
  assert.deepEqual(errors, ['Accepted on HackerEarth, but the solution source could not be read.']);
});

/* --------------------------------------------------------- shared observer */

test('only submission endpoints are observed', () => {
  assert.equal(isObserved('https://leetcode.com/submissions/detail/12345/check/'), true);
  assert.equal(
    isObserved('https://www.hackerrank.com/rest/contests/master/challenges/solve-me-first/submissions/99'),
    true,
  );
  assert.equal(isObserved('https://www.codechef.com/api/ide/submit?solution_id=1'), true);
  assert.equal(
    isObserved('https://practiceapi.geeksforgeeks.org/api/v1/problems/submission/result/'),
    true,
  );

  // Request bodies are relayed, so unrelated traffic must not be.
  assert.equal(isObserved('https://leetcode.com/graphql/'), false);
  assert.equal(isObserved('https://www.hackerrank.com/rest/hackers/me'), false);
  assert.equal(isObserved('https://www.codechef.com/api/user/profile'), false);
  assert.equal(isObserved('https://analytics.example.com/track'), false);
  assert.equal(isObserved('https://www.hackerearth.com/submit/AJAX/'), false);
  assert.equal(
    isObserved('https://www.hackerearth.com/response/submission-json/fixture-submission-id/AJAX/'),
    true,
  );
  assert.equal(isObserved('https://www.hackerearth.com/response/submission-json/AJAX/'), false);
  assert.equal(isObserved('https://www.hackerearth.com/response/submission-json/fixture-submission-id/'), false);
});

test('payload helpers survive junk without throwing', () => {
  assert.equal(parseJson('not json'), undefined);
  assert.equal(parseJson(undefined), undefined);
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  assert.equal(pick({ a: { b: 'c' } }, 'a', 'b'), 'c');
  assert.equal(pick({ a: null }, 'a', 'b'), undefined);
  assert.equal(pick(undefined, 'a'), undefined);
  assert.equal(firstString({ b: 'x' }, [['a'], ['b']]), 'x');
  assert.equal(firstString({ a: '   ' }, [['a']]), undefined);
  assert.equal(firstString({ a: 42 }, [['a']]), '42');
});

/* ---------------------------------------------------------------- LeetCode */

const CHECK_URL = 'https://leetcode.com/submissions/detail/1234567/check/';

test('LeetCode: a still-running poll produces nothing', () => {
  assert.equal(
    readVerdict(CHECK_URL, JSON.stringify({ state: 'PENDING' }), 'https://leetcode.com/problems/two-sum/'),
    undefined,
  );
  assert.equal(readVerdict(CHECK_URL, JSON.stringify({ state: 'STARTED' }), ''), undefined);
  assert.equal(readVerdict(CHECK_URL, 'not json', ''), undefined);
  assert.equal(readVerdict('https://leetcode.com/graphql/', '{}', ''), undefined);
});

test('LeetCode: an accepted verdict carries the judge stats', () => {
  const result = readVerdict(
    CHECK_URL,
    JSON.stringify({
      state: 'SUCCESS',
      status_msg: 'Accepted',
      question_id: '1',
      submission_id: 1234567,
      pretty_lang: 'Python3',
      status_runtime: '52 ms',
      runtime_percentile: 91.234,
      status_memory: '17.2 MB',
      memory_percentile: 44.5,
    }),
    'https://leetcode.com/problems/two-sum/',
    'print(1)',
  );

  assert.equal(result.kind, 'accepted');
  assert.equal(result.verdict.submissionId, '1234567');
  assert.equal(result.verdict.language, 'Python3');
  assert.equal(result.verdict.runtimeNote, 'Runtime 52 ms (beats 91.2%)');
  assert.equal(result.verdict.memoryNote, 'Memory 17.2 MB (beats 44.5%)');
  // The editor snapshot is the fallback when the payload omits the source.
  assert.equal(result.verdict.fallbackCode, 'print(1)');
});

test('LeetCode: a failing verdict is reported as an attempt', () => {
  const result = readVerdict(
    CHECK_URL,
    JSON.stringify({ state: 'SUCCESS', status_msg: 'Wrong Answer' }),
    'https://leetcode.com/problems/two-sum/',
  );
  assert.equal(result.kind, 'failed');
  assert.equal(result.verdict, 'Wrong Answer');
});

/* ----------------------------------------------------------------- AtCoder */

const ATCODER_ROW = `<table><tbody>
<tr>
  <td>2026-01-15 21:00:00</td>
  <td><a href="/contests/abc300/tasks/abc300_c">C - Cross</a></td>
  <td><a href="/users/deepak">deepak</a></td>
  <td>C++ 20 (gcc 12.2)</td>
  <td>400</td>
  <td>1234 Byte</td>
  <td><span class="label label-success" id="judge-status-1">AC</span></td>
  <td>52 ms</td>
  <td>3456 KB</td>
  <td><a href="/contests/abc300/submissions/40000001">Detail</a></td>
</tr>
</tbody></table>`;

test('AtCoder: an accepted row yields the task, language and title', () => {
  const { document } = parseHTML(ATCODER_ROW);
  const row = parseSubmissionRow(document.querySelector('tr'));

  assert.equal(row.contestId, 'abc300');
  assert.equal(row.taskId, 'abc300_c');
  assert.equal(row.submissionId, '40000001');
  assert.equal(row.accepted, true);
  assert.equal(row.language, 'C++ 20 (gcc 12.2)');
  // "C - Cross" keeps only the name.
  assert.equal(row.title, 'Cross');
});

test('AtCoder: a rejected row is parsed but not accepted', () => {
  const { document } = parseHTML(ATCODER_ROW.replace('>AC<', '>WA<'));
  const row = parseSubmissionRow(document.querySelector('tr'));
  assert.equal(row.accepted, false);
  assert.equal(row.verdict, 'WA');
});

test('AtCoder: rows without a task or submission link are ignored', () => {
  const { document } = parseHTML('<table><tbody><tr><td>nothing here</td></tr></tbody></table>');
  assert.equal(parseSubmissionRow(document.querySelector('tr')), undefined);
});

test('AtCoder: in-progress verdicts are not final', () => {
  assert.equal(isPending('WJ'), true);
  assert.equal(isPending('WR'), true);
  assert.equal(isPending('3/12'), true);
  assert.equal(isPending('AC'), false);
  assert.equal(isPending('TLE'), false);
});

test('AtCoder: the source is read from the submission page', () => {
  const { document } = parseHTML(
    '<pre id="submission-code">int main() { return 0; }</pre>',
  );
  assert.equal(extractSource(document), 'int main() { return 0; }');
  assert.equal(extractSource(parseHTML('<p>no code</p>').document), null);
});

/* -------------------------------------------------------------- HackerRank */

const HR_URL =
  'https://www.hackerrank.com/rest/contests/master/challenges/solve-me-first/submissions/77';

test('HackerRank: an accepted poll is recognised in the nested model', () => {
  const result = readSubmission(
    HR_URL,
    JSON.stringify({ model: { id: 77, status: 'Accepted', status_code: 2, language: 'python3', code: 'print(1)' } }),
  );
  assert.equal(result.slug, 'solve-me-first');
  assert.equal(result.accepted, true);
  assert.equal(result.language, 'python3');
  assert.equal(result.code, 'print(1)');
});

test('HackerRank: a still-processing poll produces nothing', () => {
  assert.equal(readSubmission(HR_URL, JSON.stringify({ model: { status: 'Processing' } })), undefined);
  assert.equal(readSubmission(HR_URL, JSON.stringify({ model: {} })), undefined);
  assert.equal(readSubmission('https://www.hackerrank.com/rest/hackers/me', '{}'), undefined);
});

test('HackerRank: a wrong answer is parsed as not accepted', () => {
  const result = readSubmission(HR_URL, JSON.stringify({ model: { status: 'Wrong Answer', status_code: 4 } }));
  assert.equal(result.accepted, false);
  assert.equal(result.status, 'Wrong Answer');
});

test('HackerRank: the submitted source is read from either body encoding', () => {
  assert.deepEqual(readSubmittedCode(JSON.stringify({ code: 'x=1', language: 'python3' })), {
    code: 'x=1',
    language: 'python3',
  });
  const form = readSubmittedCode('code=x%3D1&language=python3');
  assert.equal(form.code, 'x=1');
  assert.equal(form.language, 'python3');
  assert.deepEqual(readSubmittedCode(undefined), { code: undefined, language: undefined });
});

/* ---------------------------------------------------------------- CodeChef */

test('CodeChef: result_code drives the verdict', () => {
  const accepted = readCodeChef(JSON.stringify({ result: { data: { result_code: 'accepted', problemCode: 'FLOW001', language: 'C++17' } } }));
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.problemCode, 'FLOW001');

  const wrong = readCodeChef(JSON.stringify({ result_code: 'wrong' }));
  assert.equal(wrong.accepted, false);
  assert.equal(wrong.resultCode, 'wrong');
});

test('CodeChef: a judging response produces nothing', () => {
  assert.equal(readCodeChef(JSON.stringify({ result_code: 'wait' })), undefined);
  assert.equal(readCodeChef(JSON.stringify({ result_code: 'running' })), undefined);
  assert.equal(readCodeChef('{}'), undefined);
  assert.equal(readCodeChef('nonsense'), undefined);
});

test('CodeChef: the submit body supplies the source', () => {
  const parsed = readCodeChefSubmitted(
    JSON.stringify({ sourceCode: 'main(){}', language: '54', problemCode: 'FLOW001' }),
  );
  assert.equal(parsed.code, 'main(){}');
  assert.equal(parsed.problemCode, 'FLOW001');
});

/* ----------------------------------------------------------- GeeksforGeeks */

test('GeeksforGeeks: an explicit success status counts as accepted', () => {
  const result = readGfg(JSON.stringify({ result: { status: 'Correct', problem_slug: 'subarray-with-given-sum' } }));
  assert.equal(result.accepted, true);
  assert.equal(result.slug, 'subarray-with-given-sum');
});

test('GeeksforGeeks: all test cases passing counts as accepted', () => {
  const result = readGfg(JSON.stringify({ testcases_passed: 12, total_testcases: 12 }));
  assert.equal(result.accepted, true);
});

test('GeeksforGeeks: a partial pass is not accepted', () => {
  const result = readGfg(JSON.stringify({ status: 'Wrong Answer', testcases_passed: 5, total_testcases: 12 }));
  assert.equal(result.accepted, false);
});

test('GeeksforGeeks: pending and unrecognised payloads produce nothing', () => {
  assert.equal(readGfg(JSON.stringify({ status: 'Pending' })), undefined);
  assert.equal(readGfg(JSON.stringify({ status: 'Compiling' })), undefined);
  assert.equal(readGfg('{}'), undefined);
  // Zero of zero test cases must not read as success.
  assert.equal(readGfg(JSON.stringify({ testcases_passed: 0, total_testcases: 0 })), undefined);
});

test('GeeksforGeeks: difficulty is read from the header text', () => {
  assert.equal(readDifficulty('Difficulty: Easy  Accuracy: 45%'), 'easy');
  assert.equal(readDifficulty('School level problem'), 'easy');
  assert.equal(readDifficulty('Difficulty: Medium'), 'medium');
  assert.equal(readDifficulty('Difficulty: Hard'), 'hard');
  assert.equal(readDifficulty('no difficulty mentioned'), 'unknown');
});

test('GeeksforGeeks: the submit body supplies the source', () => {
  assert.equal(readGfgSubmitted(JSON.stringify({ code: 'def f(): pass' })).code, 'def f(): pass');
  assert.equal(readGfgSubmitted('code=x%3D1').code, 'x=1');
});

/* ------------------------------------------------------- diagnostic paths */

test('the diagnostic report keeps the path and drops the query', () => {
  // A query string can carry session ids and submission payloads, so only the
  // origin and path may travel into a log the user is asked to share.
  assert.equal(
    summarisePath('https://leetcode.com/submissions/detail/9/check/?token=secret', 'https://leetcode.com/'),
    'https://leetcode.com/submissions/detail/9/check/',
  );
  assert.equal(
    summarisePath('/graphql/?opname=submit&sid=abc', 'https://leetcode.com/problems/two-sum/'),
    'https://leetcode.com/graphql/',
  );
  // A relative path still resolves against the page it was requested from.
  assert.equal(
    summarisePath('/api/ide/submit', 'https://www.codechef.com/problems/FLOW001'),
    'https://www.codechef.com/api/ide/submit',
  );
  // Junk must not throw — this runs inside the page's own fetch.
  assert.equal(summarisePath('::::', 'not a url'), '::::');
});

test('LeetCode: the submission id is read from the URL after a submit', () => {
  // LeetCode navigates here once the verdict is in, which is cheaper and more
  // reliable than asking the API which submission was the accepted one.
  assert.equal(
    submissionIdFromPath('/problems/two-sum/submissions/2095756933/'),
    '2095756933',
  );
  assert.equal(submissionIdFromPath('/problems/two-sum/submissions/123'), '123');

  // A plain problem page carries no id, and neither does the submissions list.
  assert.equal(submissionIdFromPath('/problems/two-sum/'), null);
  assert.equal(submissionIdFromPath('/submissions/'), null);
  assert.equal(submissionIdFromPath('/problems/two-sum/submissions/'), null);
});

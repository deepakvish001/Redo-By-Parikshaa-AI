import assert from 'node:assert/strict';
import test from 'node:test';

import { readAttempt, readVerdict } from '../src/adapters/leetcode.ts';
import { looksLikeLanguage } from '../src/adapters/codeforces.ts';
import { isObserved } from '../src/adapters/observed.ts';
import { appendEvent, describeStruggle, struggleScore, summarise } from '../src/core/journal.ts';
import { initialRevision, targetReviewsFor } from '../src/core/srs.ts';

const RUN_URL = 'https://leetcode.com/submissions/detail/runcode_1785956329.612122_JxwFLKOc3o/check/';
const SUBMIT_URL = 'https://leetcode.com/submissions/detail/2095811307/v2/check/';

const ACCEPTED_RUN = JSON.stringify({
  state: 'SUCCESS',
  status_msg: 'Accepted',
  status_runtime: '0 ms',
  code_answer: ['3'],
  expected_code_answer: ['3'],
  total_correct: 3,
  total_testcases: 3,
});

const ACCEPTED_SUBMIT = JSON.stringify({
  state: 'SUCCESS',
  status_msg: 'Accepted',
  submission_id: 2095811307,
  question_id: 3,
  lang: 'java',
  pretty_lang: 'Java',
  status_runtime: '79 ms',
  status_memory: '47.6 MB',
  total_correct: 987,
  total_testcases: 987,
});

test('a passing Run is not an accepted submission', () => {
  // The Run panel says "Accepted" when the sample cases pass. Treating that as
  // a solve recorded the problem the moment the user pressed Run, and the
  // dedupe then swallowed the real submission that followed.
  assert.equal(readVerdict(RUN_URL, ACCEPTED_RUN, 'https://leetcode.com/problems/two-sum/'), undefined);

  const submit = readVerdict(SUBMIT_URL, ACCEPTED_SUBMIT, 'https://leetcode.com/problems/two-sum/');
  assert.equal(submit?.kind, 'accepted');
});

test('the v2 check path is still recognised as a submission', () => {
  // LeetCode moved from /check/ to /v2/check/ without changing the payload;
  // the old pattern silently stopped matching.
  assert.equal(isObserved(SUBMIT_URL), true);
  assert.equal(isObserved(RUN_URL), true);
});

test('a run is journalled as a run, a submit as a submit', () => {
  const run = readAttempt(RUN_URL, ACCEPTED_RUN, 1000);
  assert.equal(run?.kind, 'run');
  assert.equal(run?.accepted, true);
  assert.equal(run?.submissionId, undefined);

  const submit = readAttempt(SUBMIT_URL, ACCEPTED_SUBMIT, 2000);
  assert.equal(submit?.kind, 'submit');
  assert.equal(submit?.submissionId, '2095811307');
  assert.equal(submit?.runtime, '79 ms');
  assert.equal(submit?.language, 'Java');
});

test('a wrong answer keeps the failing case', () => {
  const event = readAttempt(
    SUBMIT_URL,
    JSON.stringify({
      state: 'SUCCESS',
      status_msg: 'Wrong Answer',
      submission_id: 5,
      total_correct: 41,
      total_testcases: 987,
      last_testcase: '"abcabcbb"',
      expected_output: '3',
      code_output: '2',
    }),
    3000,
  );

  assert.equal(event?.accepted, false);
  assert.equal(event?.verdict, 'Wrong Answer');
  assert.equal(event?.testsPassed, 41);
  assert.equal(event?.testsTotal, 987);
  assert.equal(event?.failedInput, '"abcabcbb"');
  assert.equal(event?.expectedOutput, '3');
  assert.equal(event?.actualOutput, '2');
});

test('a compile error is journalled with its message', () => {
  const event = readAttempt(
    SUBMIT_URL,
    JSON.stringify({
      state: 'SUCCESS',
      status_msg: 'Compile Error',
      submission_id: 6,
      full_compile_error: "Line 4: error: ';' expected\n        int i = 0\n                 ^",
    }),
    4000,
  );

  assert.equal(event?.verdict, 'Compile Error');
  assert.match(event?.errorText ?? '', /';' expected/);
});

test('an in-flight poll produces nothing', () => {
  assert.equal(
    readAttempt(SUBMIT_URL, JSON.stringify({ state: 'PENDING' }), 5000),
    undefined,
  );
});

test('the same submission reported twice is one attempt', () => {
  // The API poll and the rendered verdict both report the accepted submission.
  const fromApi = readAttempt(SUBMIT_URL, ACCEPTED_SUBMIT, 1000);
  const fromDom = {
    at: 40_000,
    kind: 'submit',
    verdict: 'Accepted',
    accepted: true,
    submissionId: '2095811307',
  };

  let events = appendEvent([], fromApi);
  events = appendEvent(events, fromDom);
  assert.equal(events.length, 1, 'matching submission ids collapse however far apart they arrive');
});

test('repeated polls of the same verdict collapse, distinct runs do not', () => {
  const poll = readAttempt(RUN_URL, ACCEPTED_RUN, 1000);
  let events = appendEvent([], poll);
  events = appendEvent(events, { ...poll, at: 1400 });
  assert.equal(events.length, 1);

  events = appendEvent(events, { ...poll, at: 60_000 });
  assert.equal(events.length, 2, 'a run a minute later is a new run');
});

test('the journal rolls up runs, submits and verdicts', () => {
  const summary = summarise([
    { at: 1, kind: 'run', verdict: 'Wrong Answer', accepted: false },
    { at: 2, kind: 'run', verdict: 'Accepted', accepted: true },
    { at: 3, kind: 'submit', verdict: 'Wrong Answer', accepted: false },
    { at: 4, kind: 'submit', verdict: 'Wrong Answer', accepted: false },
    { at: 5, kind: 'submit', verdict: 'Time Limit Exceeded', accepted: false },
    { at: 6, kind: 'submit', verdict: 'Accepted', accepted: true },
  ]);

  assert.equal(summary.runs, 2);
  assert.equal(summary.submits, 4);
  assert.equal(summary.failedSubmits, 3);
  assert.equal(summary.acceptedAt, 6);
  assert.equal(summary.spanMs, 5);
  assert.deepEqual(summary.verdicts[0], { verdict: 'Wrong Answer', count: 3 });
});

test('a problem walked through scores near zero, a fought one scores high', () => {
  const easy = struggleScore({
    events: [{ at: 1, kind: 'submit', verdict: 'Accepted', accepted: true }],
    attempts: 1,
    solveTimeMs: 4 * 60_000,
    difficulty: 'medium',
  });
  assert.ok(easy < 0.15, `expected a walk-through to score low, got ${easy}`);

  const fought = struggleScore({
    events: [
      { at: 1, kind: 'run', verdict: 'Wrong Answer', accepted: false },
      { at: 2, kind: 'run', verdict: 'Wrong Answer', accepted: false },
      { at: 3, kind: 'run', verdict: 'Wrong Answer', accepted: false },
      { at: 4, kind: 'run', verdict: 'Accepted', accepted: true },
      { at: 5, kind: 'submit', verdict: 'Wrong Answer', accepted: false },
      { at: 6, kind: 'submit', verdict: 'Time Limit Exceeded', accepted: false },
      { at: 7, kind: 'submit', verdict: 'Wrong Answer', accepted: false },
      { at: 8, kind: 'submit', verdict: 'Wrong Answer', accepted: false },
      { at: 9, kind: 'submit', verdict: 'Accepted', accepted: true },
    ],
    attempts: 5,
    solveTimeMs: 95 * 60_000,
    difficulty: 'medium',
  });
  assert.ok(fought > 0.7, `expected a fight to score high, got ${fought}`);
  assert.equal(describeStruggle(fought), 'fought for it');
});

test('struggle still works from attempts alone when no journal was captured', () => {
  // Not every judge gives us a per-attempt feed; the adapter's own count has to
  // be enough on its own.
  const score = struggleScore({ attempts: 5, difficulty: 'medium' });
  assert.ok(score > 0, 'four failed submits must register even with an empty journal');
});

test('a hard-won problem comes back sooner and more often', () => {
  const intervals = [1, 3, 7, 21];
  const now = 1_700_000_000_000;

  const easy = initialRevision(intervals, now, 0);
  const fought = initialRevision(intervals, now, 1);

  assert.ok(
    fought.dueAt <= easy.dueAt,
    'a problem that fought back must not be scheduled later than one that did not',
  );
  assert.ok(fought.ease < easy.ease);
  assert.equal(easy.targetReviews, 4);
  assert.equal(fought.targetReviews, 7);
  assert.equal(targetReviewsFor(0.5, intervals), 6);
});

test('the schedule stays compressed at later stages, not just the first', () => {
  const intervals = [1, 3, 7, 21];
  const now = 0;
  const fought = initialRevision(intervals, now, 1);

  // ease 0.6 against a 21-day stage is what keeps the problem coming back —
  // the first interval is floored at a day either way, so stage 0 alone would
  // not prove anything.
  assert.equal(fought.ease, 0.6);
  assert.equal(Math.round(21 * fought.ease), 13);
});

test('Codeforces language detection does not read problem titles', () => {
  // "Threshold" ends in a "d", which an earlier `D\b` pattern matched, so the
  // title cell was returned as the language.
  assert.equal(looksLikeLanguage('2250A - Threshold Movement'), false);
  assert.equal(looksLikeLanguage('You Delete, I Delete'), false);
  assert.equal(looksLikeLanguage('Sum of Round Numbers'), false);

  assert.equal(looksLikeLanguage('C++17 (GCC 7-32)'), true);
  assert.equal(looksLikeLanguage('GNU C++20 (64)'), true);
  assert.equal(looksLikeLanguage('Python 3.8.10'), true);
  assert.equal(looksLikeLanguage('PyPy 3-64 (7.3.15)'), true);
  assert.equal(looksLikeLanguage('Java 21 64bit'), true);
  assert.equal(looksLikeLanguage('D'), true);
});

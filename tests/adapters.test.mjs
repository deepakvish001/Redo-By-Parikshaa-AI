import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { extractSource, isPending, parseSubmissionRow } from '../src/adapters/atcoder.ts';
import { readSubmission, readSubmittedCode } from '../src/adapters/hackerrank.ts';
import { readResult as readCodeChef, readSubmitted as readCodeChefSubmitted } from '../src/adapters/codechef.ts';
import {
  readDifficulty,
  readResult as readGfg,
  readSubmitted as readGfgSubmitted,
} from '../src/adapters/geeksforgeeks.ts';
import { readVerdict } from '../src/adapters/leetcode.ts';
import { isObserved, summarisePath } from '../src/adapters/observed.ts';
import { firstString, parseJson, pick } from '../src/adapters/exchange.ts';

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

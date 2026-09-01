import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  extractSource,
  isPending,
  parseResultPage,
  parseSubmissionRow,
  taskIdFrom,
} from '../src/adapters/cses.ts';

const parse = (html) => new JSDOM(html).window.document;

const RESULT = (over = {}) => {
  const { status = 'READY', result = '<span class="verdict accepted">ACCEPTED</span>', code = 'print(1)' } = over;
  return `<!doctype html><html><body>
    <table class="summary-table">
      <tr><td>Task:</td><td><a href="/problemset/task/1068">Weird Algorithm</a></td></tr>
      <tr><td>Sender:</td><td><a href="/user/1">tester</a></td></tr>
      <tr><td>Submission time:</td><td>2026-09-01 12:00:00</td></tr>
      <tr><td>Language:</td><td>CPython3</td></tr>
      <tr><td>Status:</td><td>${status}</td></tr>
      ${result === null ? '' : `<tr><td>Result:</td><td>${result}</td></tr>`}
    </table>
    ${code === null ? '' : `<pre class="prettyprint">${code}</pre>`}
  </body></html>`;
};

/* ------------------------------------------------------------------- urls */

test('a task id is read out of a task URL', () => {
  assert.equal(taskIdFrom('/problemset/task/1068'), '1068');
  assert.equal(taskIdFrom('/problemset/task/1068/'), '1068');
});

test('a page that is not a task has no task id', () => {
  assert.equal(taskIdFrom('/problemset/'), null);
  assert.equal(taskIdFrom('/problemset/result/999/'), null);
});

/* --------------------------------------------------------------- pending */

test('the judge still working is not a verdict', () => {
  for (const status of ['PENDING', 'COMPILING', 'RUNNING', 'Testing 3/12']) {
    assert.equal(isPending(status), true, status);
  }
  assert.equal(isPending('READY'), false);
});

/* ---------------------------------------------------------- result pages */

test('a finished result reads as one submission', () => {
  const found = parseResultPage(parse(RESULT()), 'https://cses.fi/problemset/result/12345/');
  assert.equal(found.submissionId, '12345');
  assert.equal(found.taskId, '1068');
  assert.equal(found.title, 'Weird Algorithm');
  assert.equal(found.language, 'CPython3');
  assert.equal(found.verdict, 'ACCEPTED');
  assert.equal(found.accepted, true);
});

test('the fields are found by their labels, not by column position', () => {
  // Reading "the fourth row" would break the first time CSES inserts one, and
  // it would break silently — filing every solve under the wrong language.
  const shuffled = `<!doctype html><html><body><table class="summary-table">
    <tr><td>Status:</td><td>READY</td></tr>
    <tr><td>Result:</td><td><span class="verdict accepted">ACCEPTED</span></td></tr>
    <tr><td>Language:</td><td>C++17</td></tr>
    <tr><td>Task:</td><td><a href="/problemset/task/2205">Gray Code</a></td></tr>
  </table></body></html>`;

  const found = parseResultPage(parse(shuffled), 'https://cses.fi/problemset/result/7/');
  assert.equal(found.language, 'C++17');
  assert.equal(found.taskId, '2205');
});

test('a rejected verdict is not an accepted one', () => {
  const found = parseResultPage(
    parse(RESULT({ result: '<span class="verdict rejected">WRONG ANSWER</span>' })),
    'https://cses.fi/problemset/result/1/',
  );
  assert.equal(found.accepted, false);
  assert.equal(found.verdict, 'WRONG ANSWER');
});

test('a submission still judging has a status and no verdict', () => {
  const found = parseResultPage(
    parse(RESULT({ status: 'RUNNING', result: null })),
    'https://cses.fi/problemset/result/2/',
  );
  assert.equal(found.verdict, '');
  assert.equal(isPending(found.status), true);
});

test('a page that is not a result page is not a submission', () => {
  assert.equal(parseResultPage(parse(RESULT()), 'https://cses.fi/problemset/'), undefined);
  assert.equal(
    parseResultPage(parse('<p>nothing</p>'), 'https://cses.fi/problemset/result/3/'),
    undefined,
  );
});

/* --------------------------------------------------------------- sources */

test('the source comes off the result page', () => {
  assert.equal(extractSource(parse(RESULT({ code: 'int main(){}' }))), 'int main(){}');
});

test('no code block means no source, rather than an empty file', () => {
  // Somebody else's result page has no code on it at all. Committing an empty
  // file would be worse than committing nothing.
  assert.equal(extractSource(parse(RESULT({ code: null }))), null);
  assert.equal(extractSource(parse(RESULT({ code: '   \n ' }))), null);
});

/* ------------------------------------------------------------------ rows */

test('a submission row on a task page reads as a submission', () => {
  const row = parse(`<table><tr>
    <td>2026-09-01 12:00:00</td><td>CPython3</td>
    <td><a href="/problemset/result/9182/">details</a></td>
    <td><span class="verdict accepted">ACCEPTED</span></td>
  </tr></table>`).querySelector('tr');

  const found = parseSubmissionRow(row, '1068');
  assert.equal(found.submissionId, '9182');
  assert.equal(found.taskId, '1068');
  assert.equal(found.language, 'CPython3');
  assert.equal(found.accepted, true);
});

test('a row with no result link is not a submission', () => {
  const row = parse('<table><tr><td>header</td></tr></table>').querySelector('tr');
  assert.equal(parseSubmissionRow(row, '1068'), undefined);
});

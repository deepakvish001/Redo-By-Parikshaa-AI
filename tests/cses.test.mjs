import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { languageFromFilename, parseCsesResult } from '../src/adapters/cses.ts';

/**
 * This file replaces an older one that tested a CSES adapter which no longer
 * exists. That adapter was rewritten to capture results durably across the
 * service worker, and its twelve parsing tests went with it — so the parsing
 * behaviour they covered is re-asserted here against the API that survived.
 */

const RESULT = 'https://cses.fi/problemset/result/abc123/';

const page = (body) => new JSDOM(`<html><body>${body}</body></html>`).window.document;

const ready = (verdict, taskId = '1068', title = 'Weird Algorithm') =>
  page(`<main>
    <a href="/problemset/task/${taskId}/">${title}</a>
    <p>Status: READY</p>
    <p>Result: ${verdict}</p>
    <table><caption>Test results</caption><tr><td>1</td></tr></table>
  </main>`);

/* ------------------------------------------------------------- the verdict */

test('an accepted result is read with its task and title', () => {
  const result = parseCsesResult(ready('ACCEPTED'), RESULT);
  assert.equal(result.taskId, '1068');
  assert.equal(result.verdict, 'Accepted');
  assert.equal(result.accepted, true);
});

test('a failing verdict is read and is not accepted', () => {
  // The whole point of reading the verdict is to tell these apart; a parser
  // that reported every finished run as a solve would poison the schedule.
  for (const raw of ['WRONG ANSWER', 'TIME LIMIT EXCEEDED', 'RUNTIME ERROR', 'COMPILE ERROR']) {
    const result = parseCsesResult(ready(raw), RESULT);
    assert.equal(result.accepted, false, raw);
    assert.ok(result.verdict.length > 0, raw);
  }
});

test('the verdict is title-cased, not shouted', () => {
  assert.equal(parseCsesResult(ready('WRONG ANSWER'), RESULT).verdict, 'Wrong Answer');
});

/* ----------------------------------------------------- still being judged */

test('a run that has not finished yields nothing', () => {
  // CSES serves the result page while the judge is still working, with the
  // status saying so. Reading a verdict off it would record whatever partial
  // state happened to be on screen.
  const pending = page(`<main>
    <a href="/problemset/task/1068/">Weird Algorithm</a>
    <p>Status: PENDING</p>
    <table><caption>Test results</caption></table>
  </main>`);

  assert.equal(parseCsesResult(pending, RESULT), undefined);
});

test('a page with no verdict at all yields nothing', () => {
  const empty = page(`<main>
    <a href="/problemset/task/1068/">Weird Algorithm</a>
    <p>Status: READY</p>
    <table><caption>Test results</caption></table>
  </main>`);

  assert.equal(parseCsesResult(empty, RESULT), undefined);
});

test('a page without the results table is not a result page', () => {
  const other = page(`<main>
    <a href="/problemset/task/1068/">Weird Algorithm</a>
    <p>Status: READY</p>
    <p>Result: ACCEPTED</p>
  </main>`);

  assert.equal(parseCsesResult(other, RESULT), undefined);
});

/* ----------------------------------------------------------- the addresses */

test('only a CSES result URL is parsed', () => {
  // Being handed the right-shaped markup from the wrong page is exactly how a
  // scraper files somebody else's data under your account.
  assert.equal(parseCsesResult(ready('ACCEPTED'), 'https://cses.fi/problemset/task/1068/'), undefined);
  assert.equal(parseCsesResult(ready('ACCEPTED'), 'https://notcses.fi/problemset/result/abc/'), undefined);
  assert.equal(parseCsesResult(ready('ACCEPTED'), 'not a url'), undefined);
});

test('a result with no task link is not attributed to a guess', () => {
  const orphan = page(`<main>
    <p>Status: READY</p>
    <p>Result: ACCEPTED</p>
    <table><caption>Test results</caption></table>
  </main>`);

  assert.equal(parseCsesResult(orphan, RESULT), undefined);
});

/* ------------------------------------------------------------- the language */

test('the language comes from the file you submitted', () => {
  assert.equal(languageFromFilename('solution.cpp'), 'C++');
  assert.equal(languageFromFilename('main.py'), 'Python');
  assert.equal(languageFromFilename('Solution.java'), 'Java');
  assert.equal(languageFromFilename('a.RS'), 'Rust', 'extensions are not case-sensitive');
});

test('an unknown extension is unknown rather than a guess', () => {
  // Filing a solve under the wrong language puts the file in the wrong place
  // in the repository and never gets noticed.
  assert.equal(languageFromFilename('solution.zig'), 'Unknown');
  assert.equal(languageFromFilename('solution'), 'Unknown');
  assert.equal(languageFromFilename(''), 'Unknown');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  completeFields,
  fingerprints,
  orderLanguages,
  readCsrf,
  readFormFields,
  readLanguages,
  readLatestVerdict,
  readSamples,
  readSubmitError,
} from '../src/workspace/codeforces.ts';
import { readSubmissions } from '../src/workspace/codeforces.ts';
import { readRunOutcome, runFields } from '../src/workspace/customtest.ts';
import { MAX_DRAFTS, draftKey, putDraft, readDraft } from '../src/workspace/drafts.ts';
import { grammarFor } from '../src/workspace/editor.ts';
import { parseProblem, shouldAutoOpenWorkspace } from '../src/core/cf-url.ts';

const parse = (html) => new JSDOM(html).window.document;

/* ------------------------------------------------------------- languages */

const SUBMIT_FORM = `
<form>
  <input type="hidden" name="csrf_token" value="form-token">
  <select name="programTypeId">
    <option value="7">Delphi 7</option>
    <option value="89">GNU G++20 13.2 (64 bit, winlibs)</option>
    <option value="70">Python 3.8.10</option>
    <option value="54">GNU G++17 7.3.0</option>
    <option value="87">Befunge</option>
    <option value="36">Java 8 32bit</option>
  </select>
</form>`;

test('every compiler on the form is offered', () => {
  const options = readLanguages(parse(SUBMIT_FORM));
  assert.equal(options.length, 6);
  assert.deepEqual(options[0], { id: '7', name: 'Delphi 7' });
});

test('the compilers people use come first', () => {
  // Codeforces' own list is fifty deep with Delphi near the top, and hunting
  // for C++20 in it every time is the friction worth removing.
  const ordered = orderLanguages(readLanguages(parse(SUBMIT_FORM)));
  assert.match(ordered[0].name, /G\+\+20/);
  assert.match(ordered[1].name, /G\+\+17/);
  assert.match(ordered[2].name, /Python 3/);
});

test('an unpinned compiler keeps its place at the back', () => {
  const ordered = orderLanguages(readLanguages(parse(SUBMIT_FORM)));
  const names = ordered.map((option) => option.name);
  assert.ok(names.indexOf('Delphi 7') < names.indexOf('Befunge'), 'original order is kept');
  assert.ok(names.indexOf('Delphi 7') > names.indexOf('Python 3.8.10'));
});

test('a page with no form offers nothing rather than throwing', () => {
  assert.deepEqual(readLanguages(parse('<p>nothing here</p>')), []);
});

/* ------------------------------------------------------------------ csrf */

test('the form’s own token beats the meta tag', () => {
  // The meta tag is stale on a page served from the back-forward cache.
  const document_ = parse(`<meta name="X-Csrf-Token" content="stale">${SUBMIT_FORM}`);
  assert.equal(readCsrf(document_), 'form-token');
});

test('the meta tag is used when there is no form', () => {
  assert.equal(readCsrf(parse('<meta name="X-Csrf-Token" content="meta-token">')), 'meta-token');
});

test('no token anywhere reports none rather than an empty string', () => {
  assert.equal(readCsrf(parse('<p>x</p>')), undefined);
});

/* --------------------------------------------------------------- samples */

test('sample cases come out of the statement', () => {
  const document_ = parse(`
    <div class="sample-test">
      <div class="input"><div class="title">Input</div><pre>3
1 2 3</pre></div>
      <div class="output"><div class="title">Output</div><pre>6</pre></div>
    </div>`);

  assert.deepEqual(readSamples(document_), [{ input: '3\n1 2 3', output: '6' }]);
});

test('the line-wrapped form does not run its lines together', () => {
  // Newer statements wrap each line in its own div so the site can offer a copy
  // button, and textContent would join them with nothing between.
  const document_ = parse(`
    <div class="sample-test">
      <div class="input"><pre><div>3</div><div>1 2 3</div></pre></div>
      <div class="output"><pre><div>6</div></pre></div>
    </div>`);

  assert.deepEqual(readSamples(document_), [{ input: '3\n1 2 3', output: '6' }]);
});

test('several cases in one block are several cases', () => {
  const document_ = parse(`
    <div class="sample-test">
      <div class="input"><pre>a</pre></div>
      <div class="output"><pre>1</pre></div>
      <div class="input"><pre>b</pre></div>
      <div class="output"><pre>2</pre></div>
    </div>`);

  assert.deepEqual(readSamples(document_), [
    { input: 'a', output: '1' },
    { input: 'b', output: '2' },
  ]);
});

test('trailing whitespace is trimmed but inner blank lines survive', () => {
  const document_ = parse(`
    <div class="sample-test">
      <div class="input"><pre>1

2
</pre></div>
      <div class="output"><pre>ok
</pre></div>
    </div>`);

  assert.deepEqual(readSamples(document_), [{ input: '1\n\n2', output: 'ok' }]);
});

test('a statement with no samples yields none', () => {
  assert.deepEqual(readSamples(parse('<div class="problem-statement"></div>')), []);
});

/* --------------------------------------------------------- refused posts */

test('a refusal is read as a refusal, not as a success', () => {
  // Codeforces answers a rejected submission with a 200 and the form again;
  // reporting "submitted" because the request succeeded would be the worst
  // possible outcome.
  const document_ = parse(`<span class="error">You have submitted exactly the same code before</span>`);
  assert.match(readSubmitError(document_), /same code before/);
});

test('the form coming back at all counts as a refusal', () => {
  assert.match(readSubmitError(parse(SUBMIT_FORM)), /without saying why/);
});

test('a redirect away from the form is not an error', () => {
  assert.equal(readSubmitError(parse('<table class="status-frame-datatable"></table>')), undefined);
});

/* ------------------------------------------------------------ form fields */

test('every hidden field on the form is carried back', () => {
  const fields = readFormFields(parse(`
    <form class="submit-form">
      <input type="hidden" name="csrf_token" value="form-token">
      <input type="hidden" name="ftaa" value="abc123">
      <input type="hidden" name="bfaa" value="deadbeef">
      <input type="hidden" name="action" value="submitSolutionFormSubmitted">
      <input type="file" name="sourceFile">
      <input type="submit" name="submit" value="Submit">
      <select name="programTypeId"><option value="89">GNU G++20</option></select>
    </form>`));

  assert.equal(fields.ftaa, 'abc123');
  assert.equal(fields.bfaa, 'deadbeef');
  assert.equal(fields.csrf_token, 'form-token');
  assert.equal(fields.sourceFile, undefined, 'a file input has no value to carry');
  assert.equal(fields.submit, undefined, 'a button’s value is its label, not data');
});

test('the form is found even when it carries no class', () => {
  // The submit page and the custom invocation page do not name their form the
  // same way; the language select is on both.
  const fields = readFormFields(parse(`
    <div><form><input type="hidden" name="ftaa" value="xyz">
      <select name="programTypeId"><option value="89">G++</option></select>
    </form></div>`));

  assert.equal(fields.ftaa, 'xyz');
});

test('only the blank fingerprints are filled in', () => {
  // The page's JavaScript computes these, and a content script in the isolated
  // world cannot see what it computed — so a well-formed value is generated for
  // whichever one arrived empty, and never for one that arrived filled.
  const filled = completeFields({ ftaa: 'already-here', bfaa: '' });

  assert.equal(filled.ftaa, 'already-here');
  assert.equal(filled.bfaa, fingerprints().bfaa);
  assert.equal(filled.action, 'submitSolutionFormSubmitted', 'a blank action gets the default');
});

test('the fingerprints stay the same for the life of the tab', () => {
  // One browser per session rather than a new one per submission.
  assert.deepEqual(fingerprints(), fingerprints());
});

/* --------------------------------------------------------------- verdicts */

const STATUS = (verdict, waiting) => `
<table>
  <tr data-submission-id="999">
    <td><a href="/contest/2000/problem/C">2000C</a></td>
    <td class="status-verdict-cell" waiting="${waiting}" submissionverdict="OK">${verdict}</td>
  </tr>
  <tr data-submission-id="998">
    <td><a href="/contest/2000/problem/A">2000A</a></td>
    <td class="status-verdict-cell" waiting="false">Accepted</td>
  </tr>
</table>`;

test('the verdict read is the one for this problem', () => {
  const found = readLatestVerdict(parse(STATUS('Accepted', 'false')), 'C');
  assert.equal(found.id, '999');
  assert.equal(found.verdict, 'Accepted');
  assert.equal(found.waiting, false);
});

test('a judging submission reports that it is still judging', () => {
  assert.equal(readLatestVerdict(parse(STATUS('In queue', 'true')), 'C').waiting, true);
});

test('a problem with no submission yet has no verdict', () => {
  assert.equal(readLatestVerdict(parse(STATUS('Accepted', 'false')), 'Z'), undefined);
});

test('the problem index matches case-insensitively', () => {
  assert.ok(readLatestVerdict(parse(STATUS('Accepted', 'false')), 'c'));
});

/* ----------------------------------------------------------- submissions */

const MY_STATUS = `
<table>
  <tr data-submission-id="991">
    <td><a href="/contest/2000/submission/991">991</a></td>
    <td>2 minutes ago</td>
    <td><a href="/contest/2000/problem/F">2000F</a></td>
    <td>GNU G++20 13.2</td>
    <td class="status-verdict-cell" waiting="false">Accepted</td>
    <td>140 ms</td><td>8200 KB</td>
  </tr>
  <tr data-submission-id="980">
    <td><a href="/contest/2000/submission/980">980</a></td>
    <td>1 hour ago</td>
    <td><a href="/contest/2000/problem/A">2000A</a></td>
    <td>Python 3.8</td>
    <td class="status-verdict-cell" waiting="false">Accepted</td>
    <td>15 ms</td><td>100 KB</td>
  </tr>
</table>`;

test('only this problem’s submissions are listed', () => {
  const rows = readSubmissions(parse(MY_STATUS), 'F');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, '991');
});

test('the language read is the cell before the verdict, not the first that looks like one', () => {
  // The problem cell comes first, and Codeforces has a language called
  // Secret_171 — which is how "Secret Santa" once became its own language.
  const rows = readSubmissions(parse(MY_STATUS), 'F');
  assert.equal(rows[0].language, 'GNU G++20 13.2');
  assert.equal(rows[0].time, '140 ms');
  assert.equal(rows[0].memory, '8200 KB');
});

test('a problem with no submissions lists none', () => {
  assert.deepEqual(readSubmissions(parse(MY_STATUS), 'Z'), []);
});

/* ------------------------------------------------------- custom invocation */

test('the run posts exactly the fields Codeforces’ own form posts', () => {
  const fields = runFields({ csrf: 't', programTypeId: '89', source: 'x', input: '3\n1 2 3' });
  assert.equal(fields.action, 'submitSolutionFormSubmitted');
  assert.equal(fields.csrf_token, 't');
  assert.equal(fields.programTypeId, '89');
  assert.equal(fields.input, '3\n1 2 3');
});

test('the run carries the fingerprint fields the page would have carried', () => {
  // Their absence is the whole bug: Codeforces answers a run without `ftaa` and
  // `bfaa` by handing the form back with no result and no error, which reached
  // the user as "Redo could not read the result page".
  const fields = runFields({ csrf: 't', programTypeId: '89', source: 'x', input: '' });
  assert.match(fields.ftaa, /^[a-z0-9]{18}$/);
  assert.match(fields.bfaa, /^[0-9a-f]{32}$/);
});

test('the run keeps the values the page actually sent', () => {
  const fields = runFields({
    csrf: 't',
    programTypeId: '89',
    source: 'x',
    input: '',
    fields: { ftaa: 'from-the-page', action: 'someOtherAction', tabSize: '8' },
  });

  assert.equal(fields.ftaa, 'from-the-page', 'a filled field is never overwritten');
  assert.equal(fields.action, 'someOtherAction', 'the page knows its own action better than we do');
  assert.equal(fields.tabSize, '8');
});

test('an invocation result is read out of the page', () => {
  const document_ = parse(`
    <div class="roundbox customtest-results">
      <div class="caption">Invocation result</div>
      <table><tr><td class="verdict">Ok</td><td>31 ms</td><td>1200 KB</td></tr></table>
      <div><pre>3
1 2 3</pre></div>
      <div><pre>6</pre></div>
    </div>`);

  const outcome = readRunOutcome(document_);
  assert.equal(outcome.verdict, 'Ok');
  assert.equal(outcome.output, '6', 'the last pre is the output; the first is the echoed input');
  assert.equal(outcome.time, '31 ms');
  assert.equal(outcome.memory, '1200 KB');
});

test('a block that only says what it is still counts', () => {
  // Nothing on this page carries a stable class name, so the parser falls back
  // to the box that names itself.
  const outcome = readRunOutcome(parse(`
    <div class="roundbox">Invocation result<pre>hello</pre></div>`));
  assert.equal(outcome.output, 'hello');
});

test('the form before a run is not read as a run that printed nothing', () => {
  // "Custom invocation" is the page's own heading, so it is on the page before
  // anything has run. Matching it used to hand the *source box* back as the
  // program's output; now only a real result counts.
  const empty = parse(`
    <div class="roundbox">
      <div class="caption">Custom invocation</div>
      <form>
        <textarea name="source">int main(){}</textarea>
        <textarea name="input">3</textarea>
        <textarea name="output"></textarea>
      </form>
    </div>`);

  assert.equal(readRunOutcome(empty), undefined);
});

test('the output box is read even when the source sits below it', () => {
  const outcome = readRunOutcome(parse(`
    <div class="roundbox">
      <div class="caption">Invocation result</div>
      <textarea name="output">6</textarea>
      <textarea name="source">int main(){}</textarea>
    </div>`));

  assert.equal(outcome.output, '6', 'the box named output beats "the last box"');
});

test('a compilation error is a verdict, not an output', () => {
  const outcome = readRunOutcome(parse(`
    <div class="customtest-results">Invocation result: Compilation error<br>main.cpp:3:1 error</div>`));
  assert.equal(outcome.verdict, 'Compilation error');
  assert.match(outcome.error, /main\.cpp/);
});

test('a page with no result at all reports none rather than an empty run', () => {
  // `undefined` is what makes the caller offer a real Codeforces tab instead of
  // inventing an output, so it matters that this is not `{}`.
  assert.equal(readRunOutcome(parse('<div>Custom invocation</div>')), undefined);
  assert.equal(readRunOutcome(parse('<p>signed out</p>')), undefined);
});

/* ------------------------------------------------------------------- urls */

test('all three ways Codeforces spells a problem are read the same', () => {
  assert.deepEqual(parseProblem('/contest/1352/problem/A'), {
    contestId: '1352',
    index: 'A',
    gym: false,
  });
  assert.deepEqual(parseProblem('/problemset/problem/1352/A'), {
    contestId: '1352',
    index: 'A',
    gym: false,
  });
});

test('a gym problem is marked as one, because it submits elsewhere', () => {
  assert.deepEqual(parseProblem('/gym/102253/problem/A'), {
    contestId: '102253',
    index: 'A',
    gym: true,
  });
});

test('a page that is not a problem is not a problem', () => {
  assert.equal(parseProblem('/contest/1352/standings'), null);
  assert.equal(parseProblem('/profile/tourist'), null);
});

/* -------------------------------------------------------------- auto-open */

const ON = { enabled: true, workspace: true, workspaceAuto: true };

test('all three switches on, and a problem page, opens by itself', () => {
  assert.equal(shouldAutoOpenWorkspace(ON, '/contest/2000/problem/C'), true);
  assert.equal(shouldAutoOpenWorkspace(ON, '/problemset/problem/2000/C'), true);
});

test('a page that is not a problem never opens the workspace', () => {
  // Injecting a two-hundred-kilobyte editor into a listing would be pure waste,
  // and it would have nothing to show.
  assert.equal(shouldAutoOpenWorkspace(ON, '/problemset'), false);
  assert.equal(shouldAutoOpenWorkspace(ON, '/contest/2000/standings'), false);
  assert.equal(shouldAutoOpenWorkspace(ON, '/profile/tourist'), false);
});

test('every switch above it can veto', () => {
  const page = '/contest/2000/problem/C';
  assert.equal(shouldAutoOpenWorkspace({ ...ON, workspaceAuto: false }, page), false);
  assert.equal(shouldAutoOpenWorkspace({ ...ON, workspace: false }, page), false);
  // The master switch means the page is left exactly as the judge built it.
  assert.equal(shouldAutoOpenWorkspace({ ...ON, enabled: false }, page), false);
});

/* ----------------------------------------------------------------- drafts */

const draft = (source, at = 1) => ({ source, at });

test('a draft comes back under the key the problem is stored by', () => {
  const map = putDraft({}, draftKey('1352', 'a'), draft('int main(){}'));
  assert.ok(readDraft(map, 'codeforces:1352A'));
});

test('clearing the editor forgets the problem rather than storing nothing', () => {
  // Otherwise every problem ever opened holds a slot forever, and the thing
  // being held is a copy of the user's source code.
  const key = draftKey('1352', 'A');
  const stored = putDraft({}, key, draft('x'));
  assert.deepEqual(putDraft(stored, key, draft('   \n ')), {});
});

test('the language is remembered with the code', () => {
  const map = putDraft({}, 'k', { source: 'x', languageId: '89', at: 1 });
  assert.equal(readDraft(map, 'k').languageId, '89');
});

test('the oldest drafts are the ones dropped when there are too many', () => {
  let map = {};
  for (let index = 0; index < 5; index += 1) {
    map = putDraft(map, `p${index}`, draft('code', index), 3);
  }

  assert.deepEqual(Object.keys(map).sort(), ['p2', 'p3', 'p4']);
});

test('the cap is a real number rather than unbounded', () => {
  assert.ok(MAX_DRAFTS > 0 && MAX_DRAFTS <= 200);
});

/* --------------------------------------------------------------- grammars */

test('the compiler name picks the grammar', () => {
  assert.ok(grammarFor('GNU G++20 13.2 (64 bit, winlibs)'));
  assert.ok(grammarFor('Python 3.8.10'));
  assert.ok(grammarFor('Java 21 64bit'));
  assert.ok(grammarFor('Node.js 15.8.0'));
});

test('an unknown compiler gets no grammar rather than the wrong one', () => {
  // Highlighting Rust as C++ is worse than not highlighting: it marks the
  // wrong words as keywords and reads as a bug in the editor.
  assert.equal(grammarFor('Rust 1.75.0'), undefined);
  assert.equal(grammarFor('Befunge'), undefined);
  assert.equal(grammarFor(''), undefined);
});

test('JavaScript is not filed as Java', () => {
  // `java(?!script)` and not `java`, which is the same substring trap that
  // once filed "Secret Santa" under a language called Secret_171.
  assert.notEqual(grammarFor('JavaScript V8 4.8.0'), grammarFor('Java 8 32bit'));
});

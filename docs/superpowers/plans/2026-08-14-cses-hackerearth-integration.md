# CSES and HackerEarth Public-Practice Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track CSES Problem Set and HackerEarth public-practice programming submissions with Redo's existing GitHub, journal, analytics, and spaced-repetition flow.

**Architecture:** CSES uses a native form lifecycle: capture the file selected in its normal submit form, persist it before navigation, then parse the final result DOM. HackerEarth uses the existing passive MAIN-world observer, limited to confirmed public-practice submission endpoints. Both adapters emit the existing `AcceptedSubmission` and `AttemptEvent` shapes.

**Tech Stack:** TypeScript, Chrome Manifest V3, React 19, Vite 7, Node test runner, linkedom.

**Spec:** `docs/superpowers/specs/2026-08-14-cses-hackerearth-integration-design.md`

## Global Constraints

- Support CSES Problem Set only; do not track CSES contests.
- Support only `https://www.hackerearth.com/practice/` programming-problem pages.
- Never track HackerEarth assessments, private tests, contests, hackathons, projects, SQL, data-science, file-upload, or non-programming questions.
- Never generate, paste, or submit code. The extension observes a submission initiated by the user.
- A CSES form may be held only until selected-file capture is durably acknowledged, then the unchanged form must be re-submitted exactly once.
- The observer may relay source-bearing request bodies only for exact, fixture-verified HackerEarth submission endpoints.
- CSES and HackerEarth Parikshaa state must be `skipped` with the generic LeetCode-only matching reason.
- Preserve existing platform behavior; run `npm test`, `npm run typecheck`, and `npm run build` before completion.

---

## File structure

- `src/core/types.ts` — extends the platform model and defines the temporary CSES source record.
- `src/core/storage.ts` — stores, reads, and expires pending CSES source records.
- `src/core/messages.ts` and `src/background/index.ts` — accept trusted CSES capture messages before page navigation.
- `src/adapters/cses.ts` — contains only CSES route/form/result behavior.
- `src/adapters/hackerearth.ts` — contains only public-practice endpoint parsing and deduplication.
- `src/adapters/observed.ts` — contains only confirmed HackerEarth submission endpoint patterns.
- `src/adapters/index.ts`, `src/manifest.json`, `src/background/parikshaa-sync.ts` — register and scope the platforms.
- `tests/adapters.test.mjs` and `tests/parikshaa.test.mjs` — fixture and scope coverage.
- `README.md` — documents the two detection mechanisms accurately.

## Task 1: Establish platform wiring and a safe fixture-discovery build

**Files:**
- Create: `src/adapters/cses.ts`
- Create: `src/adapters/hackerearth.ts`
- Modify: `src/core/types.ts`
- Modify: `src/adapters/index.ts`
- Modify: `src/manifest.json`
- Modify: `src/background/parikshaa-sync.ts`
- Modify: `tests/adapters.test.mjs`
- Modify: `tests/parikshaa.test.mjs`

**Interfaces:**
- Produces: `Platform` values `'cses' | 'hackerearth'` and labels `CSES` / `HackerEarth`.
- Produces: registered `CsesAdapter` and `HackerEarthAdapter`, each with strict `matches(url)` and `currentSlug(url)` routing.
- Produces: a platform-neutral Parikshaa unsupported reason.

- [ ] **Step 1: Write the failing platform and scope tests**

  Add assertions for the new labels, strict routes, and neutral Parikshaa copy:

  ```js
  test('CSES and HackerEarth public practice routes are the only new adapter routes', () => {
    assert.equal(new CsesAdapter().matches(new URL('https://cses.fi/problemset/task/1193/')), true);
    assert.equal(new CsesAdapter().matches(new URL('https://cses.fi/contest/123/task/1')), false);
    assert.equal(new HackerEarthAdapter().matches(new URL('https://www.hackerearth.com/practice/algorithms/')), true);
    assert.equal(new HackerEarthAdapter().matches(new URL('https://www.hackerearth.com/challenges/')), false);
  });
  ```

- [ ] **Step 2: Run the focused tests to verify they fail**

  Run: `node --test tests/adapters.test.mjs tests/parikshaa.test.mjs`

  Expected: FAIL because the adapters and platform values do not exist.

- [ ] **Step 3: Implement the minimal model, adapter registration, and route scopes**

  Extend the union and ordered constants exactly as follows:

  ```ts
  export type Platform =
    | 'leetcode' | 'codeforces' | 'atcoder' | 'codechef'
    | 'hackerrank' | 'geeksforgeeks' | 'cses' | 'hackerearth';

  export const PLATFORM_LABELS: Record<Platform, string> = {
    // existing labels
    cses: 'CSES',
    hackerearth: 'HackerEarth',
  };
  ```

  Add scope-only adapters now so diagnostics can run on their allowed pages;
  their `start()` methods return a no-op teardown until their capture tasks
  implement site-specific observation. Register both adapters. Add CSES
  problem-set and HackerEarth `/practice/*` content-script matches; do not add
  any HackerEarth wildcard that includes assessments or challenges. Replace the
  Codeforces-specific unsupported message with:

  ```ts
  reason: 'Parikshaa problems are matched by LeetCode slug, so this platform is not synced.'
  ```

- [ ] **Step 4: Run the focused tests to verify they pass**

  Run: `node --test tests/adapters.test.mjs tests/parikshaa.test.mjs`

  Expected: PASS.

- [ ] **Step 5: Build an unpacked diagnostic fixture build**

  Run: `npm run build`

  Load `dist/` in Chrome, enable Diagnostics, and use only public practice:

  - CSES: open a Problem Set task, open its normal Submit page, select a tiny source file, and submit it yourself.
  - HackerEarth: open a public `/practice/` programming problem, run and submit a solution yourself.

  Save only these non-sensitive artifacts under `tests/fixtures/`:

  - CSES submit-form outer HTML with the chosen filename removed;
  - CSES final result-page outer HTML with username and timestamps removed;
  - HackerEarth diagnostics paths; and
  - HackerEarth final JSON response with source, cookies, tokens, usernames, and query values removed.

  Do not store a HAR, request body, cookie, token, or real solution source in the repository.

- [ ] **Step 6: Commit**

  ```bash
  git add src/core/types.ts src/adapters/cses.ts src/adapters/hackerearth.ts src/adapters/index.ts src/manifest.json src/background/parikshaa-sync.ts tests/adapters.test.mjs tests/parikshaa.test.mjs
  git commit -m "feat: register CSES and HackerEarth platforms"
  ```

## Task 2: Add durable CSES source capture and result parsing

**Files:**
- Modify: `src/adapters/cses.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/storage.ts`
- Modify: `src/core/messages.ts`
- Modify: `src/background/index.ts`
- Modify: `src/adapters/index.ts`
- Modify: `tests/adapters.test.mjs`
- Test fixture: `tests/fixtures/cses-submit-form.html`
- Test fixture: `tests/fixtures/cses-result-accepted.html`
- Test fixture: `tests/fixtures/cses-result-rejected.html`

**Interfaces:**
- Produces: `PendingCsesSubmission { taskId, submittedAt, filename, language, code }`.
- Produces: `savePendingCsesSubmission(pending)`, `getFreshPendingCsesSubmission(taskId, now)`, and `clearPendingCsesSubmission(taskId)`.
- Consumes: `send({ type: 'cses:pending', pending })` before native form navigation.
- Produces: `parseCsesResult(document, url)` returning `{ taskId, verdict, accepted, title?, runtimeNote?, memoryNote? } | undefined`.

- [ ] **Step 1: Write failing storage and parser tests from the sanitized fixtures**

  Cover language derivation, expiry, duplicate render handling, and both final verdicts:

  ```js
  test('CSES: a selected cpp file is saved for its task for fifteen minutes', () => {
    assert.equal(languageFromFilename('labyrinth.cpp'), 'C++');
    assert.equal(isPendingCsesSubmissionFresh({ submittedAt: 10 }, 10 + 14 * 60_000), true);
    assert.equal(isPendingCsesSubmissionFresh({ submittedAt: 10 }, 10 + 16 * 60_000), false);
  });

  test('CSES: an accepted result is final and names its task', () => {
    const { document } = parseHTML(readFileSync('tests/fixtures/cses-result-accepted.html', 'utf8'));
    assert.deepEqual(parseCsesResult(document, 'https://cses.fi/problemset/result/1/'), {
      taskId: '1193', verdict: 'Accepted', accepted: true,
    });
  });
  ```

- [ ] **Step 2: Run the CSES-focused test to verify it fails**

  Run: `node --test tests/adapters.test.mjs`

  Expected: FAIL because CSES helpers, message, and storage functions do not exist.

- [ ] **Step 3: Implement pending-source storage and its typed message**

  Store records under one `pendingCsesSubmissions` key keyed by task id. Remove records older than 15 minutes whenever reading or writing. The worker message must acknowledge only after `chrome.storage.local.set` resolves:

  ```ts
  | { type: 'cses:pending'; pending: PendingCsesSubmission }

  'cses:pending': { stored: true };
  ```

  In the background handler, reject malformed values (blank task id, blank filename, blank language, blank code, or non-finite timestamp) with an error. Do not put the source in diagnostics or activity history.

- [ ] **Step 4: Implement `CsesAdapter` without modifying native form data**

  Add a submit listener on the verified CSES submit form. On its first invocation, call `preventDefault()`, read only `input[type=file].files[0]`, await `file.text()`, derive the language from its extension, and await the `cses:pending` acknowledgement. In `finally`, set a one-shot replay guard and call `form.requestSubmit(submitter)`.

  On a result-page render, parse only fixture-verified result markup. Keep an
  adapter-local `Map<string, number>` of failed final submits. For a final
  rejected result, increment it, call `context.onAttempt('cses:' + taskId)`,
  and call:

  ```ts
  context.onEvent(taskId, { at: Date.now(), kind: 'submit', verdict, accepted: false });
  ```

  For a final accepted result, first call `context.onEvent(taskId, { at:
  Date.now(), kind: 'submit', verdict, accepted: true, language })`; then read
  the matching fresh pending record, emit `context.onAccepted(...)` with
  `attempts: (attempts.get(taskId) ?? 0) + 1`, delete that counter, and clear
  the pending source. If capture is absent or expired, show `Accepted on CSES,
  but the selected source file could not be captured.` and never create a
  solved record.

- [ ] **Step 5: Run the CSES tests to verify they pass**

  Run: `node --test tests/adapters.test.mjs`

  Expected: PASS, including captured source, expiry, accepted/rejected result, and duplicate-render assertions.

- [ ] **Step 6: Commit**

  ```bash
  git add src/adapters/cses.ts src/core/types.ts src/core/storage.ts src/core/messages.ts src/background/index.ts src/adapters/index.ts tests/adapters.test.mjs tests/fixtures/cses-submit-form.html tests/fixtures/cses-result-accepted.html tests/fixtures/cses-result-rejected.html
  git commit -m "feat(cses): track problem set submissions"
  ```

## Task 3: Add HackerEarth public-practice endpoint parsing

**Files:**
- Modify: `src/adapters/hackerearth.ts`
- Modify: `src/adapters/observed.ts`
- Modify: `src/adapters/index.ts`
- Modify: `tests/adapters.test.mjs`
- Test fixture: `tests/fixtures/hackerearth-accepted.json`
- Test fixture: `tests/fixtures/hackerearth-rejected.json`

**Interfaces:**
- Produces: `readHackerEarthResult(url, responseBody)` returning a final result or `undefined` while judging.
- Produces: `HackerEarthAdapter` emitting `AcceptedSubmission` and `AttemptEvent` only from a public-practice route.
- Consumes: explicit HackerEarth patterns appended to `OBSERVED_URLS` after fixture confirmation.

- [ ] **Step 1: Write failing public-practice and response-parser tests**

  Use the sanitized fixture payloads to assert exact final behaviour:

  ```js
  test('HackerEarth: a public practice acceptance carries the submission id', () => {
    const result = readHackerEarthResult(PRACTICE_RESULT_URL, acceptedFixture);
    assert.equal(result.accepted, true);
    assert.equal(result.submissionId, 'fixture-submission-id');
  });

  test('HackerEarth: assessment routes and non-final payloads are ignored', () => {
    assert.equal(new HackerEarthAdapter().matches(new URL('https://www.hackerearth.com/assessment/test/')), false);
    assert.equal(readHackerEarthResult(PRACTICE_RESULT_URL, pendingFixture), undefined);
  });
  ```

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `node --test tests/adapters.test.mjs`

  Expected: FAIL because `readHackerEarthResult` and the exact observed pattern do not exist.

- [ ] **Step 3: Implement the narrow observer pattern and parser**

  Add only the sanitized fixture's origin-and-path pattern to `OBSERVED_URLS`; do not match all HackerEarth API traffic. Parse explicit status, task id, language, submission id, test counts, runtime, memory, and error text only when present. Return `undefined` for queued, compiling, running, or structurally unrecognised results.

  Maintain a `Set<string>` of final submission IDs and a `Map<string, number>`
  of failed submissions per slug. For a rejection, increment the counter, call
  `context.onAttempt('hackerearth:' + slug)`, and emit one `AttemptEvent`. For
  an acceptance, emit its accepted `AttemptEvent` before calling
  `context.onAccepted` with `attempts: (attempts.get(slug) ?? 0) + 1`; then
  delete that counter. Source precedence is response, submit body, then
  `exchange.editorCode`. If source is unavailable, show an error and do not
  emit `AcceptedSubmission`.

- [ ] **Step 4: Run the focused tests to verify they pass**

  Run: `node --test tests/adapters.test.mjs`

  Expected: PASS, including route exclusion, pending result, duplicate poll, failure event, accepted record, and source fallback assertions.

- [ ] **Step 5: Commit**

  ```bash
  git add src/adapters/hackerearth.ts src/adapters/observed.ts src/adapters/index.ts tests/adapters.test.mjs tests/fixtures/hackerearth-accepted.json tests/fixtures/hackerearth-rejected.json
  git commit -m "feat(hackerearth): track public practice submissions"
  ```

## Task 4: Document behaviour and run complete verification

**Files:**
- Modify: `README.md`
- Modify: `tests/adapters.test.mjs`
- Modify: `tests/parikshaa.test.mjs`

**Interfaces:**
- Consumes: the completed CSES form adapter and HackerEarth observer adapter.
- Produces: accurate user-facing platform coverage documentation and a verified extension build.

- [ ] **Step 1: Add analytics and unsupported-sync regression assertions**

  Add assertions that platform counters include both new platforms and that
  unsupported Parikshaa wording does not name Codeforces:

  ```js
  assert.equal(computeStats([makeProblem({ platform: 'cses' })], intervals, now).byPlatform.cses, 1);
  assert.equal(computeStats([makeProblem({ platform: 'hackerearth' })], intervals, now).byPlatform.hackerearth, 1);
  assert.doesNotMatch(unsupportedReason, /Codeforces/);
  ```

- [ ] **Step 2: Run the focused tests to verify they pass**

  Run: `node --test tests/adapters.test.mjs tests/parikshaa.test.mjs`

  Expected: PASS.

- [ ] **Step 3: Update the README detection table and safety documentation**

  Add these rows and text:

  ```markdown
  | CSES | native submit form + result page | selected submission file | — | — |
  | HackerEarth | public-practice verdict endpoint | response, request, else editor | from page when available | from page when available |
  ```

  State that CSES briefly waits for a selected file to be captured before re-submitting the unchanged form, and that HackerEarth tracking excludes assessments, private tests, contests, and hackathons.

- [ ] **Step 4: Run complete automated verification**

  Run:

  ```bash
  npm ci
  npm test
  npm run typecheck
  npm run build
  ```

  Expected: all tests pass, TypeScript emits no errors, and `dist/` contains the extension artifacts.

- [ ] **Step 5: Perform manual public-practice smoke tests**

  In Chrome with the unpacked `dist/` extension:

  1. Submit one CSES Problem Set source file yourself; verify one accepted record, correct code path, and a revision due date.
  2. Run and submit one HackerEarth public-practice programming solution yourself; verify one journal event per final result and one accepted record.
  3. Open a HackerEarth assessment, challenge, or contest page; verify no adapter toast, journal event, or tracked record is created.

- [ ] **Step 6: Commit**

  ```bash
  git add README.md tests/adapters.test.mjs tests/parikshaa.test.mjs
  git commit -m "docs: explain CSES and HackerEarth tracking"
  ```

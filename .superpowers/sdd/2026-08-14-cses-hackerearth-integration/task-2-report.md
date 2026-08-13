# Task 2 report — durable CSES source capture and result parsing

## Status

Implemented Task 2 on `codex/cses-hackerearth`. The CSES integration remains
limited to `cses.fi/problemset/`; contest routes are not observed or parsed.

## Implementation

- Added the temporary `PendingCsesSubmission` model and a single
  `pendingCsesSubmissions` storage record keyed by task id. Reads and writes
  prune captures older than 15 minutes; accepted captures are consumed.
- Added the typed `cses:pending` worker message. The worker rejects blank
  fields and invalid timestamps, then acknowledges only after local storage
  has written the pending record. Source is not written to diagnostics or
  activity history.
- Added fixture-bound CSES result parsing: only a public Problem Set result
  page with `Status: READY`, a task link, and a `Test results` table is final.
- Added native submit handling for the verified CSES form. It prevents only
  the first submit, reads only the already selected file, waits for durable
  acknowledgement, and replays the unchanged form once from `finally`.
- Added final-result event handling, failed-submit counting, accepted-source
  consumption, and duplicate render suppression. An accepted result without
  a fresh capture reports the required error and creates no solved record.

## TDD evidence

### RED

`node --test tests/adapters.test.mjs` failed because
`getFreshPendingCsesSubmission` did not exist. This proved the tests were
exercising the new storage contract rather than existing behaviour.

### GREEN

`node --test tests/adapters.test.mjs` then passed with 38 tests and no
failures. The focused tests cover extension-language derivation, 15-minute
expiry and cleanup, accepted/rejected final result parsing, unchanged native
form replay, captured-file message contents, and duplicate final results.

## Verification

`npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` all
passed. The full suite reported 269 passing tests; TypeScript completed
without errors; the extension build completed; and the diff has no whitespace
errors.

## Privacy

No actual source, user data, filename from a real submission, CSRF value,
result id, or raw page capture was added. The tests use only the pre-existing
sanitized CSES fixtures and synthetic placeholder text.

## Fix round 1 — submit overlap and pending-storage safety

### Review findings addressed

- The native form listener now keeps an in-flight capture guard. A second
  submit event while the first file read or persistence acknowledgement is
  pending is prevented from navigating, but does not read the file, persist a
  second source record, or schedule another `requestSubmit`. The first flow
  still reaches its one native replay from `finally`.
- CSES pending-record reads, writes, and clears now share a serialized queue.
  This protects the single `pendingCsesSubmissions` map from concurrent
  read-modify-write replacement in the service worker.
- The worker pending-message boundary is factored into
  `storePendingCsesSubmission`. It rejects blank task, filename, language, or
  source values and non-finite timestamps before storage is accessed; storage
  enforces the same validation as a defensive boundary.

### TDD evidence

The focused adapter suite was deliberately run after adding the regressions
and before the fixes. It failed in three targeted ways: an interleaved pair of
different task saves dropped task `1068`; malformed data did not reject; and
two rapid form submits made two capture messages/replays. The file-read and
worker-failure replay regressions already passed, confirming the existing
`finally` guarantee.

After the fixes, `node --test tests/adapters.test.mjs` reported 43 passing
tests and zero failures. New coverage proves that:

- rejected `file.text()` and rejected pending persistence each replay once;
- two rapid submit events send one pending message and call native
  `requestSubmit` once;
- concurrent saves for task `1068` and `1193` keep both records; and
- malformed worker payloads reject without storing data.

### Verification

`npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`
passed after the fix. The full suite reported 274 passing tests.

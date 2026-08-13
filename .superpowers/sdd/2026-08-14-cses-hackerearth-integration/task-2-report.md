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

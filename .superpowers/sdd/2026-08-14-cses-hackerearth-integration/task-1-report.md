# Task 1 report — CSES and HackerEarth platform wiring

## Status

Implemented the Task 1 scope-only platform wiring on `codex/cses-hackerearth`.
No submission capture, source handling, endpoint observation, fixture parsing,
code generation, pasting, or submission automation was added.

## Implementation

- Added `CsesAdapter`, scoped to the `cses.fi/problemset/` family. It derives a
  task id only from the normal Problem Set task and submit routes and returns a
  no-op teardown.
- Added `HackerEarthAdapter`, scoped to `www.hackerearth.com` public
  programming-practice categories only (`algorithms`, `data-structures`,
  `basic-programming`, and `maths`). It derives a slug only from a
  `practice-problems` programming route and returns a no-op teardown.
- Registered both adapters and added the `cses` and `hackerearth` platform
  values, ordered settings/stat entries, and labels `CSES` / `HackerEarth`.
- Added CSES Problem Set and HackerEarth `/practice/*` match patterns to the
  host permissions, MAIN-world observer, and content script. No HackerEarth
  assessment, challenge, contest, hackathon, project, SQL, data-science, or
  other broad wildcard was added.
- Replaced the Codeforces-specific Parikshaa unsupported reason with the
  required platform-neutral LeetCode-only wording.

## TDD evidence

### RED

Command:

```sh
node --test tests/adapters.test.mjs tests/parikshaa.test.mjs
```

Output (exit 1):

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/adapters/cses.ts'
✖ tests/adapters.test.mjs
✖ unsupported platforms receive the neutral LeetCode-only sync reason
actual reason:   Parikshaa problems are matched by LeetCode slug, so Codeforces is not synced.
expected reason: Parikshaa problems are matched by LeetCode slug, so this platform is not synced.
ℹ tests 14
ℹ pass 12
ℹ fail 2
```

The test names the guarded behaviour: missing adapters, missing registration
and labels, an overly broad/non-programming HackerEarth route, incorrect slug
routing, or a platform-specific unsupported reason all fail it.

### GREEN

Command:

```sh
node --test tests/adapters.test.mjs tests/parikshaa.test.mjs
```

Output (exit 0):

```text
✔ CSES and HackerEarth public practice routes are the only new adapter routes
✔ unsupported platforms receive the neutral LeetCode-only sync reason
ℹ tests 39
ℹ pass 39
ℹ fail 0
ℹ duration_ms 302.781625
```

## Verification

Command:

```sh
npm run typecheck
```

Output (exit 0):

```text
> redo@1.0.0 typecheck
> tsc --noEmit
```

Command:

```sh
npm test
```

Output (exit 0):

```text
> redo@1.0.0 test
> node --test tests/*.test.mjs
ℹ tests 257
ℹ pass 257
ℹ fail 0
ℹ duration_ms 2766.893458
```

Command:

```sh
npm run build
```

Output (exit 0):

```text
> redo@1.0.0 build
> npm run clean && npm run build:pages && npm run build:scripts && npm run build:assets
✓ built in 552ms
built background.js
built content.js
built observer.js
built parikshaa.js
built parikshaa-injected.js
copied manifest.json and icons/
```

Command:

```sh
node --input-type=module -e "import { readFileSync } from 'node:fs'; const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8')); console.log(JSON.stringify({ hostPermissions: manifest.host_permissions.filter((value) => value.includes('cses.fi') || value.includes('hackerearth.com')), observerMatches: manifest.content_scripts[0].matches.filter((value) => value.includes('cses.fi') || value.includes('hackerearth.com')), contentMatches: manifest.content_scripts[1].matches.filter((value) => value.includes('cses.fi') || value.includes('hackerearth.com')) }, null, 2));"
```

Output (exit 0):

```json
{
  "hostPermissions": [
    "https://cses.fi/problemset/*",
    "https://www.hackerearth.com/practice/*"
  ],
  "observerMatches": [
    "https://cses.fi/problemset/*",
    "https://www.hackerearth.com/practice/*"
  ],
  "contentMatches": [
    "https://cses.fi/problemset/*",
    "https://www.hackerearth.com/practice/*"
  ]
}
```

`git diff --check` also exited 0 before staging.

## Changed files

- `src/adapters/cses.ts`
- `src/adapters/hackerearth.ts`
- `src/adapters/index.ts`
- `src/background/parikshaa-sync.ts`
- `src/core/types.ts`
- `src/manifest.json`
- `tests/adapters.test.mjs`
- `tests/parikshaa.test.mjs`

## Self-review

- The two new adapters have no imports that can observe page traffic, inspect
  forms, or read editor/source data; both `start()` methods only return a
  no-op teardown.
- CSES uses the exact `cses.fi` hostname and the `/problemset/` path family,
  excluding contest routes.
- HackerEarth uses the exact `www.hackerearth.com` hostname and an allowlist
  of public programming-practice route families, excluding SQL and all routes
  outside those families.
- The built manifest contains the same two narrowly scoped paths in all three
  relevant locations.
- The new platform values flow through the existing platform-order driven
  settings and stats logic without any unrelated refactor.

## Concerns

- Authenticated fixture capture and public-practice smoke submissions were not
  performed: the task context expressly defers real fixtures and prohibits
  submission capture in this task. Task 2/3 must use user-provided, sanitised
  fixtures before adding CSES form/result handling or HackerEarth observed
  endpoints.
- The HackerEarth programming-category allowlist is deliberately conservative;
  any additional public programming category needs fixture-backed confirmation
  before it is expanded.

## Fix round — fixture-capture review finding

### Finding assessment

The review finding is valid against the task brief: the required sanitised
artifacts are absent from `tests/fixtures/`. A read-only workspace check found
no CSES or HackerEarth fixture files. The connected Chrome profile has only
`about:blank`, so there is no authenticated public-practice session from which
to inspect a real submission flow.

### External requirement

Completion requires an account holder to use a real authenticated browser
session and personally perform the permitted public-practice actions:

1. CSES: open a Problem Set task, open its normal Submit page, select a tiny
   source file, and submit it. Provide the submit-form outer HTML with the
   filename removed and the final result-page outer HTML with username and
   timestamps removed.
2. HackerEarth: open a public `/practice/` programming problem, run and submit
   a solution. Provide diagnostics paths and the final JSON response after
   removing source, request bodies, cookies, tokens, usernames, and query
   values.

The repository must not receive a HAR, request body, cookie, token, or real
solution source. These artifacts cannot be truthfully recreated from public
documentation or inferred routes without violating the requirement not to
invent markup, endpoints, or payloads.

### Fix-round action

No code, test, fixture, or manifest changes were made. The existing commit
remains unchanged. This finding is blocked pending the real, sanitised fixture
evidence described above.

## Fix round 1 — authenticated CSES fixtures

### Evidence incorporated

Read-only authenticated evidence for the public CSES Problem Set problem
**Weird Algorithm** (task `1068`) is now available. It establishes the normal
submit form contract as `POST /course/send.php` with
`multipart/form-data`, hidden `csrf_token` and `task` inputs, file input
`file`, selects `#lang`/`#option`, a submit input, and hidden `type`/`target`
inputs. It also establishes final result paths as `/problemset/result/:id/`
and final text as `Status: READY` with either `Result: ACCEPTED` or
`Result: OUTPUT LIMIT EXCEEDED`.

### Added files

- `tests/fixtures/cses-submit-form.html`
- `tests/fixtures/cses-result-accepted.html`
- `tests/fixtures/cses-result-rejected.html`

The submit fixture preserves the observed structural contract while omitting
the CSRF value. The result fixtures contain only the public Weird Algorithm
task link, final status/result text, and one verdict-table row. They omit the
username, CSRF token, source, timestamps, submission IDs, result/test URLs,
and all test input/output. No HackerEarth fixture, endpoint, or payload was
added.

### TDD and verification

The fixture-contract tests were written before the fixtures.

```sh
node --test tests/adapters.test.mjs
```

RED output (exit 1): two expected `ENOENT` failures for
`tests/fixtures/cses-submit-form.html` and
`tests/fixtures/cses-result-accepted.html`; 26 passed, 2 failed.

The three files were then added from the supplied authenticated observation.

```sh
node --test tests/adapters.test.mjs
```

GREEN output (exit 0): 28 passed, 0 failed.

```sh
npm test
npm run typecheck
```

Output (exit 0): 259 tests passed, 0 failed; `tsc --noEmit` completed without
diagnostics. A fixture safety scan found no CSRF value, username, submission,
result/test URL, external URL, source container, or test source/output marker.

### Remaining blocker

HackerEarth diagnostic paths and final sanitised JSON remain blocked pending
separate authenticated public-practice evidence. No endpoint or payload has
been inferred or invented.

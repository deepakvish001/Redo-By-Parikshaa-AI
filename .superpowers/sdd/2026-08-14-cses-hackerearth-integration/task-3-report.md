# Task 3 Report: HackerEarth Public-Practice Tracking

## Scope

Implemented HackerEarth public-practice final-result tracking from the
sanitized response fixtures. The observer remains restricted to the exact
fixture-confirmed result route:

`https://www.hackerearth.com/response/submission-json/:submissionId/AJAX/`

The source-bearing `/submit/AJAX/` route remains excluded. The adapter never
reads `exchange.requestBody`; accepted source recovery uses only the existing
editor snapshot fallback.

## TDD evidence

Initial Task 3 implementation added fixture-backed parser and tracking tests,
then ran:

```sh
node --test tests/adapters.test.mjs
```

The first red run failed for the intended missing parser, adapter flow, and
result-route allowlist behavior. After implementing the narrow parser and
result-only observer pattern, the focused suite passed, followed by type
checking and the full project verification.

Fix round 1 identified that `readHackerEarthResult` incorrectly required
aggregate and per-test numeric metrics in order to recognize a final AC or WA
result. Two fixture mutations were added before the fix:

- AC with every aggregate/per-test metric null or absent;
- WA with every aggregate/per-test metric null or absent.

The red command was:

```sh
node --test tests/adapters.test.mjs
```

It produced two expected failures: both valid final responses returned
`undefined`. The parser was then changed so final verdict/status recognition
is independent of metrics. Finite timing and memory values are included only
when available; unavailable values are omitted from `AttemptEvent` and the
accepted submission metadata. The focused green run reported 51 passing tests
and TypeScript type checking passed.

## Final verification

Run after the fix:

```sh
npm test
npm run typecheck
npm run build
git diff --check
```

The full test suite, type check, production build, and whitespace check passed.

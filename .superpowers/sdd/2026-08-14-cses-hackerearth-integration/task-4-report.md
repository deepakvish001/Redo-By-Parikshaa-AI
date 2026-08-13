# Task 4 report — CSES and HackerEarth documentation and verification

## Documentation completed

- Updated the README platform coverage from six to eight judges and added CSES
  and HackerEarth public-practice detection rows.
- Documented the verified CSES flow: Redo reads only the user-selected file,
  waits only for durable local capture, replays the unchanged native form once,
  and accepts only fixture-confirmed final Problem Set result markup. Pending
  source captures expire after 15 minutes; no solved record is created without
  a fresh capture.
- Documented HackerEarth's result-only policy: only the fixture-confirmed final
  public-practice result poll is observed; `/submit/AJAX/` remains excluded.
  The result supplies verdict details, while an accepted record requires the
  current editor snapshot for source. Missing editor source leaves the final
  attempt recorded but does not create a solved record.
- Documented scope boundaries: CSES contests are excluded; HackerEarth is
  limited to `/practice/*` and canonical
  `/community/problem/algorithm/*` public programming pages. Assessments,
  private/recruitment tests, contests, challenges, hiring, hackathons,
  projects, SQL, data-science, file-upload, and non-programming routes are
  excluded.
- Clarified that CSES and HackerEarth are skipped for Parikshaa sync because
  only LeetCode slugs can match there.
- Added the manual smoke-test checklist and its privacy requirements: use an
  authenticated Chrome profile and the unpacked `dist/` extension, personally
  submit the listed CSES and HackerEarth cases, verify an excluded HackerEarth
  route remains inert, and never share source, credentials, queries, or HARs.

## Regression coverage

- Added assertions that `computeStats` counts `cses` and `hackerearth` records
  in their platform counters.
- Added an assertion that the generic unsupported Parikshaa reason does not
  name Codeforces.

## Automated verification

All commands were run in
`/Users/deepakvish001/Downloads/Parikshaa/New-Repo/.worktrees/codex-cses-hackerearth`:

```sh
node --test tests/adapters.test.mjs tests/parikshaa.test.mjs
# 65 passing, 0 failing

npm ci
npm test
# 283 passing, 0 failing

npm run typecheck
# tsc --noEmit completed without diagnostics

npm run build
# built pages, background.js, content.js, observer.js, parikshaa.js,
# parikshaa-injected.js, manifest.json, icons, and panel/focus/options assets
```

`npm ci` completed successfully. Its audit output reported one high-severity
dependency advisory and pending install-script approval warnings; Task 4 made
no dependency or runtime changes to address them.

## Manual verification status

The authenticated public-site smoke tests require the account holder to submit
their own CSES and HackerEarth solutions in Chrome. They were not automated or
performed by this documentation-only task. The README now records the exact
three checks required before release and the data that must not be captured or
shared.

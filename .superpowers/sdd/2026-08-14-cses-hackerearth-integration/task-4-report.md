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

## Fix round 1 — observer route privacy and documentation correction

### Root cause and fix

The MAIN-world observer previously applied the global endpoint allowlist before
the HackerEarth adapter could reject an excluded page. Because HackerEarth's
final-result endpoint is shared, an allowlisted result response on an excluded
`/practice/sql/`, data-science, file-upload, or non-programming page could be
relayed and cause an editor-source read before adapter-level route validation.

`isObservedOnPage(url, pageHref)` now requires the shared
`isHackerEarthPublicPracticePage` route predicate for HackerEarth's
fixture-confirmed result endpoint. The predicate permits only the public
programming categories and canonical `/community/problem/algorithm/*` pages;
the adapter consumes the same predicate. The fetch and XHR observers apply it
before attaching response observation, and `publish` applies it again directly
before reading editor code or emitting an exchange.

### Regression coverage

Added an MAIN-world observer regression that loads the observer on
`https://www.hackerearth.com/practice/sql/`, issues an otherwise allowlisted
HackerEarth final-result request, and proves that Monaco editor source is not
read and no exchange is posted.

### Documentation correction

The README now says that CSES does not initiate an independent submission: it
replays the unchanged user-initiated native form once after local persistence.
It also records HackerEarth's implemented metadata boundary: title, canonical
URL, language, verdict, and available runtime/memory; difficulty remains
unknown and tags are not recorded.

### Fix-round verification

The new observer regression first failed as intended against the prior
endpoint-only gate: it recorded one Monaco editor read on the excluded SQL
page (`1 !== 0`). After the page-aware gate, the focused observer and adapter
run passed (53 passing, 0 failing), followed by:

```sh
npm ci
npm test
# 284 passing, 0 failing

npm run typecheck
# tsc --noEmit completed without diagnostics

npm run build
# rebuilt manifest, all extension scripts, icons, and panel/focus/options assets
```

The build artifact check confirmed `dist/manifest.json`, `background.js`,
`content.js`, `observer.js`, `parikshaa.js`, and `parikshaa-injected.js`.
`git diff --check` also passed. As before, `npm ci` reported one existing
high-severity dependency advisory and pending install-script approval warnings;
this fix round did not change dependencies.

## Fix round 2 — exact trackable HackerEarth route gating

### Root cause and fix

Fix round 1 made the observer page-aware but authorised all pages under an
eligible programming category prefix. That still included nested quiz and
other non-problem pages even though `HackerEarthAdapter.currentSlug()` could
not derive a stable slug for them.

The strict route grammar that produces a slug is now shared in
`hackerEarthTrackableProblemSlug`. It accepts only a canonical
`/community/problem/algorithm/:slug/` page or an exact public-practice
`.../practice-problems/(algorithm|data-structure)/:slug/` page. The observer
uses that trackable-page predicate before response observation, source reads,
and exchange emission. Category-prefix matching remains only in the adapter's
navigation `matches()` method; `currentSlug()` uses the shared strict parser.

### Regression coverage

Real MAIN-world observer tests exercise both `fetch` and `XMLHttpRequest`.
They prove no editor read or exchange on SQL, data-science, file-upload, and a
nested quiz route below `/practice/algorithms/`; they also prove final-result
observation still occurs on an exact public-practice problem URL and a
canonical community algorithm URL.

### Fix-round verification

The new observer tests were red against the category-prefix gate: the nested
`/practice/algorithms/.../quiz/...` page read editor source through both fetch
and XHR (`1 !== 0`). With the shared strict slug predicate, the focused
observer plus adapter run passed (56 passing, 0 failing), followed by:

```sh
npm ci
npm test
# 287 passing, 0 failing

npm run typecheck
# tsc --noEmit completed without diagnostics

npm run build
# rebuilt manifest, all extension scripts, icons, and panel/focus/options assets
```

The artifact check confirmed the manifest and all five extension scripts in
`dist/`; the built `observer.js` contains the exact strict route predicate.
`git diff --check` passed. `npm ci` again reported the existing high-severity
dependency advisory and pending install-script approval warnings; this fix
round made no dependency changes.

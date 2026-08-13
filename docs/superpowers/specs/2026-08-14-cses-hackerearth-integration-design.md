# CSES and HackerEarth Public-Practice Integrations

## Purpose

Add CSES and HackerEarth public-practice support to Redo with the same
local-first tracking flow as the existing judges: capture a user's solved
source code and attempt history, then use the existing GitHub sync, revision,
and analytics systems.

## Goals

- Track accepted CSES problem-set submissions.
- Track accepted HackerEarth public-practice programming submissions.
- Record submissions, verdicts, source, language, and available runtime or
  memory details; record Runs where a platform exposes that action.
- Deduplicate repeated result polls.
- Make the new platforms opt-out toggles with the same default as existing
  platforms.
- Show due-problem revision prompts on supported public problem pages.

## Hard scope boundaries

- HackerEarth support has exactly two public route families:
  `www.hackerearth.com/practice/*` for practice listing and navigation, and
  `www.hackerearth.com/community/problem/algorithm/*` for canonical public
  programming-problem pages. The canonical route is required because public
  practice problems resolve there after navigation from the practice surface.
- All other HackerEarth `/community/` routes, assessments, recruitment tests,
  private links, contests, hiring, hackathons, projects, SQL, data-science,
  file-upload, and non-programming question types are ignored.
- CSES support is limited to the public problem set and its normal submission
  flow; CSES contests are ignored.
- The extension does not solve, generate, paste, or submit code. It only
  observes a submission the user initiates.
- Neither platform syncs to Parikshaa because matching is supported only for
  LeetCode slugs.

## Architecture

### Platform model

Extend the `Platform` union, platform order, labels, settings defaults, and
platform-oriented paths and tests with `cses` and `hackerearth`. Existing
generic analytics, spaced repetition, GitHub writing, labels, backups, and
the side panel consume `Platform` and therefore require no feature-specific
data store.

### Manifest and route isolation

Add CSES and HackerEarth host permissions. The manifest injects content and
MAIN-world scripts across the approved public route families so practice
navigation and canonical pages can initialise normally:

- CSES: the problem-set and normal submission pages required to associate a
  submitted solution with `/problemset/task/<id>`.
- HackerEarth: exactly `https://www.hackerearth.com/practice/*` and
  `https://www.hackerearth.com/community/problem/algorithm/*`. The first
  scope covers public practice listing/navigation; the second is the canonical
  public programming-problem route reached from that surface.

No script will be declared for any other HackerEarth `/community/` route, or
for assessment, contest, hiring, hackathon, project, SQL, data-science,
file-upload, or recruitment routes. Manifest injection is not tracking
authorisation: at runtime the observer and adapter both require an exact,
stable public programming-problem slug before they read a result response,
read editor contents, relay an exchange, or create data. Category pages and
non-problem nested pages under the broadly injected `/practice/*` family are
therefore inert.

### CSES form lifecycle

CSES uses a native file-upload submit form at
`/problemset/submit/<task-id>/`, rather than a fetch/XHR request that the
shared observer can read. `CsesAdapter` therefore uses a separate lifecycle:

1. On an eligible form submit, briefly hold that one native submission while
   reading only the source file the user selected and saving a temporary
   `PendingCsesSubmission` record. After storage acknowledges the record,
   re-submit the same untouched form exactly once before page navigation:

   ```ts
   interface PendingCsesSubmission {
     taskId: string;
     submittedAt: number;
     filename: string;
     language: string;
     code: string;
   }
   ```

   The language is derived from the selected filename extension. Pending
   records are one per task and expire after 15 minutes, preventing an old
   source file from being attached to a later result.
2. On the normal CSES result page, parse the final DOM verdict and its task
   identifier. The worker atomically claims the final result using an opaque
   fingerprint, accumulates rejected attempts by task, and consumes any fresh
   pending record only for a newly claimed acceptance. This state is serialized
   in the worker, so it survives separate content-page adapters and reloads;
   raw result paths and source never enter this result state.
3. Record a newly claimed rejected final verdict as one submit attempt. On a
   newly claimed accepted verdict, emit `AcceptedSubmission` with its source,
   language, title, canonical task URL, and the worker's accumulated count.

This reads no arbitrary local file: it accesses only the file already selected
by the user in CSES's own submission form. It never changes the selected file,
form fields, or destination. The short capture wait exists only to guarantee
that native navigation cannot lose the user's source before it reaches local
extension storage.

### HackerEarth adapter

`HackerEarthAdapter` implements `PlatformAdapter` through the existing passive
network observer. It owns:

- route matching and stable problem-slug generation;
- public page metadata extraction (title, difficulty when available, tags when
  available, and canonical URL);
- parsing the fixture-confirmed final-result response only;
- source recovery from the current editor only;
- per-problem attempt counts and result deduplication; and
- mapping the site’s wording to `AttemptEvent` without inventing unavailable
  judge statistics.

### Shared platform wiring

The shared observer remains passive across supported judges. For HackerEarth,
it allows only the fixture-confirmed final-result poll and never the
source-bearing Run/Submit request. The HackerEarth adapter does not read a
request body: accepted source recovery falls back only to the current editor.
The observer never delays, rewrites, or submits page traffic. Exact endpoint
patterns are confirmed with a logged-in public-practice smoke session before
they enter `OBSERVED_URLS`; diagnostics report only origin and path, never
query strings or source code.

## Data flow

1. A user opens an eligible public-practice problem. The adapter derives its
   slug and requests existing problem context; due records can show the
   current revision panel.
2. CSES briefly holds a native submit only until it persists the user-selected
   source file, re-submits the untouched form once, then reads the final
   verdict from the result-page DOM. HackerEarth observes its allowlisted
   final-result poll and parses that response without inspecting a Run or
   Submit request body.
3. The platform records an `AttemptEvent` for a final result. Pending results
   are ignored; duplicate HackerEarth result polls and duplicate CSES result
   page renders are recorded once.
4. On accepted submission, the adapter requires source and language. It emits
   `AcceptedSubmission`, which uses the existing local storage, GitHub sync,
   revision scheduling, journal, and analytics flow.
5. Parikshaa state is `skipped` with the generic reason that only LeetCode
   slug matching is supported.

## Failure handling

- An unrecognised CSES result DOM, unknown HackerEarth endpoint or payload,
  missing source, expired pending CSES source, or missing stable problem
  identifier never creates an accepted record.
- The user gets a short actionable toast for an accepted result whose source
  cannot be captured; optional diagnostics enable maintainer troubleshooting.
- A changed HackerEarth endpoint must first be observed through diagnostics
  and tested with a fixture before it becomes allowlisted.
- No network request or content data from an excluded HackerEarth route is
  observed or persisted.

## Tests and verification

- Unit tests cover CSES form capture, file-extension language mapping, pending
  record expiry, separate-adapter result claims, failed-attempt carryover, and
  duplicate result-page reloads. HackerEarth tests cover URL scoping, metadata
  extraction, accepted and terminal rejected verdicts (WA, TLE, RE, CE, MLE),
  pending/unknown responses, duplicates, editor source fallback, missing
  source, and unavailable judge metrics.
- Observer tests assert that only confirmed public-practice HackerEarth
  endpoints are relayed.
- Tests assert that assessment, contest, and other excluded HackerEarth paths
  cannot match either adapter.
- Existing Parikshaa tests change the unsupported-platform message to be
  platform-neutral.
- Verify with `npm test`, `npm run typecheck`, and `npm run build`.
- Perform one manual accepted-submission smoke test on a CSES problem-set task
  and one HackerEarth public-practice programming problem before release.

## Acceptance criteria

1. A CSES public problem-set acceptance saves the correct code and creates a
   single scheduled record.
2. A HackerEarth public-practice programming acceptance does the same.
3. Failed and duplicate results produce accurate, non-duplicated journals.
4. HackerEarth assessments, contests, hackathons, private tests, and
   non-programming routes remain untracked.
5. Existing judges retain their current behaviour and all automated
   verification passes.

# CSES and HackerEarth Public-Practice Integrations

## Purpose

Add CSES and HackerEarth public-practice support to Redo with the same
local-first tracking flow as the existing judges: capture a user's solved
source code and attempt history, then use the existing GitHub sync, revision,
and analytics systems.

## Goals

- Track accepted CSES problem-set submissions.
- Track accepted HackerEarth public-practice programming submissions.
- Record runs, submissions, verdicts, source, language, and available runtime
  or memory details.
- Deduplicate repeated result polls.
- Make the new platforms opt-out toggles with the same default as existing
  platforms.
- Show due-problem revision prompts on supported public problem pages.

## Hard scope boundaries

- HackerEarth support is limited to public `www.hackerearth.com/practice/`
  programming-problem routes.
- HackerEarth assessments, recruitment tests, private links, contests,
  hackathons, projects, SQL, data-science, file-upload, and non-programming
  question types are ignored.
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

Add CSES and HackerEarth host permissions. Content scripts and the MAIN-world
observer will be scoped narrowly:

- CSES: the problem-set and normal submission pages required to associate a
  submitted solution with `/problemset/task/<id>`.
- HackerEarth: `https://www.hackerearth.com/practice/*` only.

No script will be declared for HackerEarth assessment, contest, hackathon, or
recruitment routes. Each adapter also verifies the active route before it
processes any observed request, so a broad host permission cannot accidentally
turn into tracking outside the declared scope.

### Adapters

Create `CsesAdapter` and `HackerEarthAdapter` implementing `PlatformAdapter`.
Each adapter owns:

- route matching and stable problem-slug generation;
- public page metadata extraction (title, difficulty when available, tags when
  available, and canonical URL);
- parsing its own submit/run request and verdict response;
- source and language recovery from the request body or editor fallback;
- per-problem attempt counts and result deduplication; and
- mapping the site’s wording to `AttemptEvent` without inventing unavailable
  judge statistics.

The shared observer remains passive: it only clones and relays responses for
explicitly allowlisted platform endpoints. It never delays, rewrites, or
submits page traffic. Exact endpoint patterns are confirmed with a logged-in
public-practice smoke session before they enter `OBSERVED_URLS`; diagnostics
report only origin and path, never query strings or source code.

## Data flow

1. A user opens an eligible public-practice problem.
2. The adapter derives its slug and requests existing problem context; due
   records can show the current revision panel.
3. A user-initiated Run or Submit reaches an allowlisted platform endpoint.
4. The MAIN-world observer relays the request/response pair to the isolated
   content script, which gives it only to the matching adapter.
5. The adapter records an `AttemptEvent` for a final result. Pending results
   are ignored; duplicate submission IDs or equivalent final responses are
   recorded once.
6. On accepted submission, the adapter requires source and language. It emits
   `AcceptedSubmission`, which uses the existing local storage, GitHub sync,
   revision scheduling, journal, and analytics flow.
7. Parikshaa state is `skipped` with the generic reason that only LeetCode
   slug matching is supported.

## Failure handling

- An unknown endpoint, unrecognised payload, missing source, or missing stable
  problem identifier never creates an accepted record.
- The user gets a short actionable toast for an accepted result whose source
  cannot be captured; optional diagnostics enable maintainer troubleshooting.
- A changed endpoint must first be observed through diagnostics and tested
  with a fixture before it becomes allowlisted.
- No network request or content data from an excluded HackerEarth route is
  observed or persisted.

## Tests and verification

- Unit tests cover URL scoping, metadata extraction, accepted and rejected
  verdicts, pending responses, duplicates, editor source fallback, missing
  source, and unavailable judge metrics for both adapters.
- Observer tests assert that only the confirmed CSES and public-practice
  HackerEarth endpoints are relayed.
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

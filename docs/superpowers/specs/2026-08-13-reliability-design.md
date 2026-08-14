# Phase 1: Data Reliability Design

## Purpose

Redo records source code, attempt history, revision state, and remote-sync state.
This phase makes those records durable under concurrent extension activity,
temporary network failures, browser service-worker restarts, and growing local
data. It prioritises correctness before new platforms or UI work.

## Goals

- Prevent one local update from overwriting another update made concurrently.
- Retry transient GitHub and Parikshaa failures without requiring a manual
  resync.
- Keep retry work across service-worker restarts and browser restarts.
- Remove the default Chrome local-storage quota as a practical limit for saved
  solutions and journals.
- Reject malformed backups without partially applying them.
- Make retry and storage behaviour covered by automated tests.

## Non-goals

- Moving data to IndexedDB in this phase.
- Changing the UI design or adding a platform.
- Changing GitHub authentication or adding a backend.
- Claiming that local extension storage survives extension removal; the
  existing GitHub and file backups remain the recovery path for that event.

## Approach

The extension will remain local-first and use `chrome.storage.local`. The
manifest will request `unlimitedStorage`, and the storage area will be limited
to trusted extension contexts during background-worker setup. Content scripts
already communicate through typed runtime messages and do not read storage
directly.

An IndexedDB migration is intentionally deferred. It would scale further, but
would add a migration and two storage implementations before the current
read-modify-write correctness issue is solved. Unlimited local storage plus
bounded histories is sufficient for this phase.

## Storage consistency

All writes to logical collections will go through a small storage mutation
layer:

- `problems`, `journal`, `meta`, `upsolve`, and sync work each have a named
  mutation path.
- A serial executor sequences read-modify-write operations in a live service
  worker, so a solve, review, journal flush, and retry cannot write stale
  snapshots over one another.
- Every existing direct collection write will be migrated to that layer.
- Remote work is never performed while holding the local mutation executor.
  First record the intended work; then run the network call; then perform a
  fresh mutation to record its result.

Chrome runs one service-worker JavaScript event loop, so the executor resolves
interleaving between async event handlers. If the worker stops, no operation is
in progress; durable work records ensure unfinished remote work is resumed.

## Durable sync outbox

A new `syncOutbox` storage record contains one coalesced entry per
`<problem-id, destination>`:

```ts
type SyncDestination = 'github' | 'parikshaa';

interface SyncWorkItem {
  id: string;
  destination: SyncDestination;
  queuedAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
}
```

Recording an accepted solution first saves the problem locally, then upserts
GitHub and Parikshaa work items. A resync action also upserts the same items;
it never creates duplicates.

The background worker processes due items on startup, after relevant settings
or Parikshaa credentials arrive, and from a five-minute alarm. It reads the
latest problem immediately before each remote request. A successful result is
written to the problem and removes the item atomically through the mutation
layer.

Transient failures (network errors, 409 conflicts, 429 responses, and 5xx
responses) retry with capped exponential delays of 5 minutes, 15 minutes, 1
hour, and 6 hours. Invalid configuration and authentication/authorisation
errors stay visible as `error` and wait for an explicit user retry or a
relevant settings/credential change. This avoids repeatedly sending a known
bad token while preserving the work item.

Remote writes remain idempotent: GitHub's tree comparison already avoids an
empty duplicate commit, while Parikshaa sync merges the existing solution.

## State and user-visible behaviour

- `pending` means a durable sync item is scheduled.
- `synced` means the most recent request succeeded.
- `error` means user action is needed; its reason is retained on both the
  problem state and outbox item.
- Existing panel resync actions become safe retries and may trigger all due
  work. No new product surface is required in this phase.

## Backup validation and recovery

Backup format advances to version 2 while retaining reads of version 1.
Validation will check the shapes needed by the scheduler and analytics, not
only presence of an id: timestamps must be finite, revision fields valid, and
arrays/maps must have valid entry shapes. Invalid records are reported and
skipped; an entirely invalid import is rejected before any local write.

The outbox is not backed up. It is derived from the stored problem sync state:
after a restore, any `pending` or retriable `error` destination is rebuilt into
the outbox. This prevents stale retry timestamps from a different browser from
delaying recovery and avoids persisting transient error detail as source data.

## Security and capacity

- Add the `unlimitedStorage` permission because complete code and journals can
  exceed Chrome's default 10 MB local-storage limit.
- Call `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`
  at worker initialisation. Extension pages and the worker retain access;
  injected content scripts continue to use runtime messages.
- The GitHub token remains local-only and is still redacted from file and
  repository backups.

## Test and verification strategy

- Install locked dependencies and run the full existing test suite.
- Add unit tests for serial collection mutation, simultaneous solve/review and
  journal writes, and no stale overwrite after a sync result.
- Add outbox tests for coalescing, restart recovery, retry timing, terminal
  errors, success cleanup, and reading the latest problem before a retry.
- Add backup tests for v1 compatibility, v2 validation, fully invalid imports,
  and outbox reconstruction.
- Run `npm test`, `npm run typecheck`, and `npm run build` after implementation.

## Acceptance criteria

1. A failed transient remote sync eventually retries after a restart without
   a manual button press.
2. Parallel messages cannot lose a journal event, review, or solved record.
3. Thousands of saved solutions are not blocked by the standard local-storage
   quota.
4. Bad backup records cannot leave the stored state half-restored.
5. Full test, typecheck, and production build succeed.

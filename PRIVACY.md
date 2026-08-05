# Privacy Policy — Redo

_Last updated: 5 August 2026_

Redo is a browser extension that records the competitive-programming problems you solve, so it
can schedule them for revision. This policy describes exactly what it stores and what leaves your
browser.

## The short version

Redo has no server, no account and no analytics. Everything it records is kept in your own
browser. The only data that leaves your machine goes directly to services **you** connect —
your GitHub repository and, optionally, your Parikshaa account — and nothing is sent anywhere
else, ever.

## What is stored, and where

All of the following lives in `chrome.storage.local`, on your device:

| Data | Why |
| --- | --- |
| Problem title, URL, difficulty, tags, platform | To identify and schedule the problem |
| Your accepted source code | To commit it, and to show it back as the final hint |
| Number of attempts, time spent, hints revealed | To score how well you know each topic |
| Your notes and complexity analysis | To keep your reasoning with the solution |
| Revision schedule (next due date, stage) | To decide what to show you and when |
| Your GitHub personal access token | To commit on your behalf |
| Your Parikshaa session token and its public API key | To mark problems solved on your account |
| Upcoming contest listings | To show the contest list and send reminders |

## What is sent, and to whom

Redo makes network requests to exactly these places:

1. **The judge you are on** (LeetCode, Codeforces, AtCoder, CodeChef, HackerRank,
   GeeksforGeeks) — to read the problem's own details and your own submission's source. These
   are the same requests the page itself makes, and they carry only your existing session with
   that site.
2. **api.github.com** — only if you turn GitHub sync on, and only to the repository you name.
   It receives your solution, your notes, and the problem metadata listed above.
3. **Your Parikshaa project's API** — only if you turn Parikshaa sync on. It receives your
   solution and a record that you solved the problem, written to your own account.
4. **Contest listings** — `codeforces.com`, `leetcode.com`, `codechef.com` and `atcoder.jp`
   public schedule endpoints. These requests contain no personal data.

There is no fourth party. No usage data, telemetry, crash reporting or identifier of any kind is
collected, and nothing is sold, shared or transferred to anyone.

## Credentials

Your GitHub token and Parikshaa session are stored unencrypted in extension storage, which is
the only storage a Chrome extension has. Anyone with access to your browser profile can read
them. For that reason:

- Use a **fine-grained** GitHub token scoped to the single repository you sync to, with the
  `Contents: read and write` permission and nothing else.
- The Parikshaa session is read from the site's own storage — it is the session you are already
  signed in with, not a new credential — and Redo never refreshes or extends it.
- Turn either integration off, and Redo stops using that credential.

## Reading your pages

Redo observes network requests on the supported judges to learn when a submission is accepted.
The observed URLs are restricted to each judge's submission endpoints. It never modifies,
blocks or delays a request, and it does not read pages on any other site.

## Diagnostics (off by default)

If a solved problem is not detected, you can turn on **Diagnostics** in options. While it is on,
Redo records a log of the requests the judge's page made and whether any of them matched what it
watches for. The log holds **only the origin and path** of each request — never a query string, a
request body, a response, or your source code — plus the events the extension itself produced.
It lives in your browser, is shown in options with a Copy button so you choose whether to share
it, and can be cleared at any time. It is not sent anywhere automatically.

## Deleting your data

- Remove a single problem with **Remove** in the extension popup.
- Remove everything by uninstalling the extension — Chrome deletes its storage with it.
- Anything already committed to your GitHub repository is yours; delete it there if you want it
  gone.

## Children

Redo is not directed at children under 13 and collects no information from anyone.

## Changes

Any change to this policy will be published in this file in the extension's public repository,
with the date above updated.

## Contact

Questions or requests: open an issue at
<https://github.com/deepakvish001/New-Repo/issues>.

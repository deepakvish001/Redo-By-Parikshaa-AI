# Privacy Policy — Redo

_Last updated: 5 August 2026_

Redo is a browser extension that records the competitive-programming problems you solve, so it
can schedule them for revision. This policy describes exactly what it stores and what leaves your
browser.

## The short version

Redo has no server, no account and no analytics. Everything it records is kept in your own
browser. The only data that leaves your machine goes directly to services **you** connect — your
GitHub repository, optionally your Parikshaa account, and — only if you switch translation on and
supply your own key — Google's Gemini API. Nothing is sent anywhere else, ever.

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
| Labels you add to problems | To group and filter your own list |
| Unsolved problems from your recent Codeforces contests | To build the upsolve queue |
| Your Codeforces handle and LeetCode username | To read your public contest rating |
| Your Google Gemini key, if you add one | To translate statements when you press Translate |
| Unfinished code and test cases you type in the workspace | To give them back when you reopen the problem |

## What is sent, and to whom

Redo makes network requests to exactly these places:

1. **The judge you are on** (LeetCode, Codeforces, AtCoder, CodeChef, HackerRank,
   GeeksforGeeks, CSES) — to read the problem's own details and your own submission's source. These
   are the same requests the page itself makes, and they carry only your existing session with
   that site.
2. **api.github.com** — only if you turn GitHub sync on, and only to the repository you name.
   It receives your solution, your notes, and the problem metadata listed above.
3. **Your Parikshaa project's API** — only if you turn Parikshaa sync on. It receives your
   solution and a record that you solved the problem, written to your own account.
4. **Contest listings** — `codeforces.com`, `leetcode.com`, `codechef.com` and `atcoder.jp`
   public schedule endpoints. These requests contain no personal data.
5. **Codeforces' and LeetCode's public rating APIs** — only if you enter a handle. Each receives
   only the handle you gave it, and only the one that belongs to it.

## Community threads

Off by default. With it on and a repository named, opening a problem's thread reads **issues** in
that repository through the GitHub API, and **Post my solution** opens an issue or adds a comment
to it. Posting is **public, under your own GitHub account, in the repository you chose** — the
button says so, with the repository's name on it, rather than asking you to confirm a dialog.

Redo does not hold any of it: the threads are GitHub's, readable and deletable by you there, and
they outlive the extension. Reading uses the same token as the sync; posting additionally needs
that token to have `Issues: read and write` on the community repository, which is a permission
your solutions repository does not need — so use a separate repository if you would rather not
grant it on the one holding your code.

Other people's posts are shown as plain text, never rendered as markdown or HTML.

## Translation

This is **the only part of Redo that sends anything to a third party**, and it is off until you
switch it on and paste in a key of your own. With it on, pressing **Translate** on a Codeforces
problem sends that statement's prose to **Google's Gemini API** using your key.

What is sent is deliberately less than the statement. Formulas, code spans, sample inputs and
outputs are replaced by numbered markers before anything leaves the machine, so Google receives
"Alice and Bob play a game with ⟦0⟧ stones" and never the formula itself. Nothing is sent until
you press the button, a translation is kept locally for a day so re-reading costs nothing, and a
translation that came back with a marker moved, dropped or duplicated is discarded rather than
shown — a formula silently missing from a sentence changes what the problem is asking.

Your Gemini key is stored in this browser like the GitHub token and is used only from the
extension's background worker, so it never enters a judge's page. It is sent as a request header
rather than in the URL, because keys in URLs end up in logs and referrers. Redo has no key of its
own and no server to hold one.

Google's handling of what it receives is governed by
[Google's terms](https://ai.google.dev/gemini-api/terms), not by this policy.

## The workspace

If you turn the workspace on, both of its buttons send your code to **Codeforces** and nowhere else:

- **Submit** posts through Codeforces' own submit form — your source and the compiler id, with the
  CSRF token that page issued to your signed-in session.
- **Run** posts your source, the compiler id and the input of the case you are looking at to
  Codeforces' **custom invocation** page, which is the site's own feature for running code.

Both are byte for byte the requests the site makes when you press its own buttons; the only
difference is which element you clicked. There is no third-party compiler, runner or judge involved
at any point, and nothing in the workspace is sent to any server other than Codeforces.

What you type is saved on your own machine as you type it, so that closing a tab does not lose a
solution. Drafts for the sixty most recently touched problems are kept; older ones are dropped as
newer ones arrive, and clearing the editor deletes that problem's draft outright. Settings shows how
many are stored and has a **Forget them** button that deletes all of them at once.

## Backups

If you use **Back up now** or leave the daily backup on, Redo writes `.redo/backup.json` into the
same repository you sync solutions to. It contains everything in the table above **except your
GitHub token**, which is stripped out deliberately: a backup is a file people commit, mail
themselves and drop in cloud storage, and a repository-scoped write token inside one would be a
credential leak with a very long tail. Re-pasting a token takes ten seconds.

The same file is what **Download a backup** saves to your computer. Nothing is uploaded anywhere
else, and the daily backup can be turned off in Settings.

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
  gone. That includes `.redo/backup.json` if you enabled backups.

## Children

Redo is not directed at children under 13 and collects no information from anyone.

## Changes

Any change to this policy will be published in this file in the extension's public repository,
with the date above updated.

## Contact

Questions or requests: open an issue at
<https://github.com/deepakvish001/New-Repo/issues>.

# Chrome Web Store submission

Everything the listing form asks for, ready to paste. Keep this file in step with
`src/manifest.json` — the store rejects mismatches between the described and requested
permissions.

Regenerate the screenshots with `npm run screenshots`, then upload the package produced by
`npm run package` (`dist.zip`).

---

## Listing

**Name** (45 characters max)

```
Redo — DSA revision that sticks
```

**Short description** (132 characters max — this is the manifest `description`)

```
Commit your accepted DSA solutions to GitHub, then actually remember them with spaced repetition and weak-topic analytics.
```

**Category:** Developer Tools
**Language:** English

**Detailed description**

```
You solved 300 problems. Three months later you can do maybe 100 of them.

Redo fixes the part everyone skips: revision.

When a submission is accepted on LeetCode, Codeforces, AtCoder, CodeChef, HackerRank,
GeeksforGeeks, CSES or HackerEarth, Redo does three things automatically:

• Commits the solution to your own GitHub repository — organised as
  leetcode/medium/0011-container-with-most-water/solution.py, with a README holding the link,
  tags, difficulty, judge stats, your notes and your complexity analysis.
• Schedules the problem for spaced repetition — 1, 3, 7, 21, 45, 90 days by default. The
  toolbar badge tells you how many are due.
• Ticks it off on parikshaa.org, if you use it, so your sheets stay in sync.

OPENS IN THE SIDE PANEL
Click the toolbar icon, or press Alt+R, and Redo docks to the right of the page — your due
list stays visible while you solve, instead of a popup that closes the moment you click into
the editor.

WHEN A PROBLEM COMES BACK
Open it and a panel appears on the page itself. Re-solve it, then rate how it went — Good
moves it up the ladder, Forgot sends it back to the start. No time for a full re-solve? A
30-second recall check is offered beside it: write the approach from memory, then check it
against your own note. It counts for less, and says so — a recall can carry a problem to a
three-week interval and no further.

PRACTICE SHEETS, TRACKED AGAINST WHAT YOU HAVE SOLVED
Blind 75 is built in. Any other list — NeetCode 150, Striver's A2Z, your college's sheet —
is imported by pasting it: URLs, slugs, a markdown list, or a JSON export. Problems you
solved months before importing already count; nothing resets to zero. Sections are tracked
separately, and the handful behind LeetCode Premium are marked rather than hidden.

MOCK INTERVIEW
One problem you solved a while ago, a clock, and the hints sealed until it stops. The gap
between "I know this one" and "I can write this one in thirty-five minutes with someone
watching" is the thing an interview actually measures.

SEARCH YOUR OWN CODE
"Where did I use a monotonic stack?" The Solved tab searches the source, not just titles and
tags, and shows the line it matched with its number.

KNOW WHICH TOPICS ARE ACTUALLY WEAK
Mastery per topic is computed from your own history: how far each problem has climbed the
ladder, how often you forgot it, how many attempts it took, how many hints you needed, and
how long it took relative to the difficulty. "Dynamic programming: 34" is a claim backed by
evidence, not a guess.

A CODEFORCES WORKSPACE
Statement and editor side by side, with the sample cases already loaded. Run sends your code
to Codeforces' own custom invocation; Submit posts Codeforces' own form, with its own token,
from your own session. Nothing is bypassed and nothing is compiled in the browser.

CONTEST RADAR
Upcoming contests from Codeforces, LeetCode, CodeChef and AtCoder in one list, with a
countdown, a calendar link, and a notification before the start.

FOCUS MODE
Optional, off by default. With it on, browsing anywhere outside the judges lands on a page
pointing you at one problem. One emergency pause a day buys three hours.

KEYBOARD
Alt+R opens the panel. Alt+Shift+R opens the problem that has been waiting longest.
Alt+W opens the workspace on a Codeforces problem. Rebind them at chrome://extensions/shortcuts.

PRIVATE BY CONSTRUCTION
No server, no account, no analytics, no telemetry. Everything is stored in your browser. The
only data that leaves your machine goes to the GitHub repository you name and, optionally,
your own Parikshaa account. Open source.

Requires a GitHub fine-grained token scoped to a single repository if you want the sync;
everything else works without it.
```

---

## Screenshots

Ten are rendered; the store shows **five**, in the order you upload them. The recommended five
are marked ★ — they cover the three things nothing else does (revision, sheets, code search)
plus the two that look best.

All are exactly **1280×800**, which is what the store accepts. It is not a minimum: an upload
at 2560×1600 is rejected. Retina copies live in `docs/screenshots/2x/` for the README and the
site — do **not** upload those.

| # | File | Caption to use | Points at |
| --- | --- | --- | --- |
| ★1 | `01-due-for-revision.png` | You solved it once. Now you keep it. | The due count, the four rating buttons, and starting a session |
| ★2 | `02-practice-sheets.png` | Blind 75, NeetCode, or your own list. | What to do next, the progress bar, sections and Premium marks |
| ★3 | `03-search-your-own-code.png` | Where did I use a monotonic stack? | The search box, the matched line and its number |
| ★4 | `04-mock-interview.png` | One problem. Thirty-five minutes. | The clock, the problem, the sealed hints |
| ★5 | `05-weak-topics.png` | Know which topics are actually weak. | The topic donut and the "needs work" mastery bars |
| 6 | `06-committed-to-github.png` | Every solution, committed and annotated. | The per-judge grouping and a problem's sync state |
| 7 | `07-contest-radar.png` | Four judges, one contest list. | A contest with its countdown and calendar link |
| 8 | `08-settings.png` | No server, no account, no analytics. | The settings groups and the fine-grained token field |
| 9 | `09-codeforces-workspace.png` | Statement and editor, side by side. | The editor, Run, and the loaded sample case |
| 10 | `10-problem-of-the-day.png` | A problem a day, at your level. | The pinned rows in Codeforces' own table, and the streak calendar |

Every callout is anchored to a real element by selector and measured from the live page, so a
callout cannot drift away from what it describes. A selector that stops matching fails the
render rather than pointing at empty space.

---

## Privacy tab

**Single purpose**

```
Records the competitive-programming problems you solve and schedules them for spaced-repetition
revision, optionally backing each solution up to a GitHub repository you own.
```

**Are you using remote code?** No — all code is bundled in the package.

**Data usage.** Declare *Personally identifiable information* (the GitHub token and Parikshaa
session count as authentication information) and *Website content* (the problem pages and your
own submitted source). Tick all three certifications: data is not sold, is not used for
purposes unrelated to the single purpose, and is not used for creditworthiness or lending.

**Privacy policy URL**

```
https://github.com/deepakvish001/Redo-By-Parikshaa-AI/blob/main/PRIVACY.md
```

---

## Permission justifications

| Permission | Justification to paste |
| --- | --- |
| `storage` | Stores solved problems, their revision schedule, imported practice sheets, and the user's settings and tokens locally. The extension has no server, so this is its only persistence. |
| `unlimitedStorage` | A few years of solutions, each with its source in every language it was solved in, exceeds the default 10 MB quota. Nothing is stored anywhere but this browser. |
| `alarms` | Wakes the service worker periodically to recompute how many problems are due, refresh the contest list, and send reminders. |
| `sidePanel` | The whole interface is a side panel, opened by clicking the toolbar icon, so it can stay open beside the problem being solved. |
| `notifications` | Notifies the user when problems are due for revision and before a contest they follow starts. Both are user-configurable and can be turned off. |
| `tabs` | Reads the address of the active tab to show the right problem's card, and opens problems the user chooses from the panel. Page contents are never read through this permission. |
| `scripting` | Injects the Codeforces workspace into the problem page, on the user's click or keyboard shortcut. |
| `https://leetcode.com/*`, `https://leetcode.cn/*` | Detects an accepted submission and reads the problem's metadata and the user's own source code from LeetCode's API, and shows the revision panel on the problem page. |
| `https://codeforces.com/*`, `https://*.codeforces.com/*` | Reads accepted verdicts from the submissions table, fetches the user's own submitted source, and reads the problem page for tags and rating. Also used for the public contest schedule and for the workspace's Run and Submit, which post Codeforces' own forms from the user's own session. The subdomain pattern covers Codeforces' own official mirrors (m1, m2, m3). |
| `https://atcoder.jp/*` | Reads accepted verdicts from the submissions table and fetches the user's own submitted source. Also used for the public contest schedule. |
| `https://www.codechef.com/*` | Detects an accepted submission through the editor's own API and reads the submitted source. Also used for the public contest schedule. |
| `https://www.hackerrank.com/*` | Detects an accepted submission through the challenge submissions endpoint and reads the submitted source. |
| `https://www.geeksforgeeks.org/*`, `https://practiceapi.geeksforgeeks.org/*` | Detects an accepted practice submission and reads the submitted source. |
| `https://cses.fi/problemset/*` | Reads the final result page of a Problem Set submission and the source file the user selected, to record the solve. Limited to the problem set. |
| `https://www.hackerearth.com/practice/*`, `https://www.hackerearth.com/community/problem/algorithm/*` | Reads the final result of a public practice submission and the current editor source. Assessments, contests and hiring routes are excluded. |
| `https://api.github.com/*` | Commits the user's solutions and notes to the repository they configured. Only used when GitHub sync is enabled. |
| `https://parikshaa.org/*`, `https://www.parikshaa.org/*` | Reads the user's existing signed-in session so matching problems can be marked solved on their own account, and marks due problems in Parikshaa's own lists. Only used when Parikshaa sync is enabled. |
| `https://*.supabase.co/*` | Parikshaa's backend. Used only to write the user's own solved record to their own Parikshaa account. |
| `https://generativelanguage.googleapis.com/*` | Translates a problem statement, using the user's own Gemini API key, only when they turn translation on and press the button. Off by default. |
| `https://github.com/*` (optional) | Requested on click for "Sign in with GitHub", and released afterwards. |
| `http://127.0.0.1/*` (optional) | Requested on click for the local editor bridge, and released afterwards. |

---

## Assets checklist

| Asset | Size | Where |
| --- | --- | --- |
| Icon | 128×128 | `public/icons/icon-128.png` |
| Screenshots (5 shown; 10 rendered so you can pick) | 1280×800 | `docs/screenshots/` |
| Retina copies — **not** for upload | 2560×1600 | `docs/screenshots/2x/` |
| Small promo tile (optional) | 440×280 | not generated yet |

---

## Before each submission

- [ ] Bump `version` in **both** `src/manifest.json` and `package.json`
- [ ] `npm run verify` — typecheck, unit tests, end-to-end
- [ ] `npm run screenshots` if any of the pictured surfaces changed
- [ ] `npm run package` and upload `dist.zip`
- [ ] Confirm this file's permission table still matches the manifest

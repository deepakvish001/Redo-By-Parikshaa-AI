# Chrome Web Store submission

Everything the listing form asks for, ready to paste. Keep this file in step with
`src/manifest.json` — the store rejects mismatches between the described and requested
permissions.

## Listing

**Name**
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

When a submission is accepted on LeetCode, Codeforces, AtCoder, CodeChef, HackerRank or
GeeksforGeeks, Redo does three things automatically:

• Commits the solution to your own GitHub repository — organised as
  leetcode/medium/0011-container-with-most-water/solution.py, with a README holding the link,
  tags, difficulty, judge stats, your notes and your complexity analysis.
• Schedules the problem for spaced repetition — 1, 3, 7, 21, 45, 90 days by default. The
  toolbar badge tells you how many are due.
• Ticks it off on parikshaa.org, if you use it, so your sheets stay in sync.

OPENS IN THE SIDE PANEL
Click the toolbar icon and Redo docks to the right of the page — your due list stays visible
while you solve, instead of a popup that closes the moment you click into the editor.

WHEN A PROBLEM COMES BACK
Open it and a panel appears on the page itself. Re-solve it, then rate how it went — Good moves
it up the ladder, Forgot sends it back to the start. Stuck? The hint ladder gives you a nudge,
then the approach, then your own previous solution — one rung at a time, so you still do the
work.

KNOW WHICH TOPICS ARE ACTUALLY WEAK
Mastery per topic is computed from your own history: how far each problem has climbed the
ladder, how often you forgot it, how many attempts it took, how many hints you needed, and how
long it took relative to the difficulty. "Dynamic programming: 34" is a claim backed by
evidence, not a guess.

CONTEST RADAR
Upcoming contests from Codeforces, LeetCode, CodeChef and AtCoder in one list, with a countdown,
a calendar link, and a notification before the start.

PRIVATE BY CONSTRUCTION
No server, no account, no analytics, no telemetry. Everything is stored in your browser. The
only data that leaves your machine goes to the GitHub repository you name and, optionally, your
own Parikshaa account. Open source.

Requires a GitHub fine-grained token scoped to a single repository if you want the sync;
everything else works without it.
```

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
https://github.com/deepakvish001/New-Repo/blob/main/PRIVACY.md
```

## Permission justifications

| Permission | Justification to paste |
| --- | --- |
| `storage` | Stores solved problems, their revision schedule, and the user's settings and tokens locally. The extension has no server, so this is its only persistence. |
| `alarms` | Wakes the service worker periodically to recompute how many problems are due, refresh the contest list, and send reminders. |
| `sidePanel` | The whole interface is a side panel, opened by clicking the toolbar icon, so it can stay open beside the problem being solved. |
| `notifications` | Notifies the user when problems are due for revision and before a contest they follow starts. Both are user-configurable and can be turned off. |
| `https://leetcode.com/*`, `https://leetcode.cn/*` | Detects an accepted submission and reads the problem's metadata and the user's own source code from LeetCode's API, and shows the revision panel on the problem page. |
| `https://codeforces.com/*` | Reads accepted verdicts from the submissions table, fetches the user's own submitted source, and reads the problem page for tags and rating. Also used for the public contest schedule. |
| `https://atcoder.jp/*` | Reads accepted verdicts from the submissions table and fetches the user's own submitted source. Also used for the public contest schedule. |
| `https://www.codechef.com/*` | Detects an accepted submission through the editor's own API and reads the submitted source. Also used for the public contest schedule. |
| `https://www.hackerrank.com/*` | Detects an accepted submission through the challenge submissions endpoint and reads the submitted source. |
| `https://www.geeksforgeeks.org/*`, `https://practiceapi.geeksforgeeks.org/*` | Detects an accepted practice submission and reads the submitted source. |
| `https://api.github.com/*` | Commits the user's solutions and notes to the repository they configured. Only used when GitHub sync is enabled. |
| `https://parikshaa.org/*`, `https://www.parikshaa.org/*` | Reads the user's existing signed-in session so matching problems can be marked solved on their own account, and marks due problems in Parikshaa's own lists. Only used when Parikshaa sync is enabled. |
| `https://*.supabase.co/*` | Parikshaa's backend. Used only to write the user's own solved record to their own Parikshaa account. |

## Assets checklist

| Asset | Size | Where |
| --- | --- | --- |
| Icon | 128×128 | `public/icons/icon-128.png` |
| Screenshots (up to 5 shown; 8 rendered so you can pick) | 1280×800 | `docs/screenshots/` |
| Small promo tile (optional) | 440×280 | `docs/screenshots/promo-440x280.png` |

Generate the screenshots with `npm run screenshots`, then upload the package produced by
`npm run package` (`dist.zip`).

## Before each submission

- [ ] Bump `version` in **both** `src/manifest.json` and `package.json`
- [ ] `npm test && npm run typecheck && npm run build`
- [ ] `npm run package` and upload `dist.zip`
- [ ] Confirm this file's permission table still matches the manifest

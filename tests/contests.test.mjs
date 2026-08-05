import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import {
  calendarUrl,
  dueReminders,
  formatDuration,
  formatStartsIn,
  parseAtCoder,
  parseCodeChef,
  parseCodeforces,
  parseLeetCode,
  upcoming,
} from '../src/core/contests.ts';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const HOUR = 3_600_000;

/* ------------------------------------------------------------ Codeforces */

test('Codeforces: only contests that have not started are taken', () => {
  const contests = parseCodeforces(
    JSON.stringify({
      status: 'OK',
      result: [
        { id: 1900, name: 'Round 900 (Div. 2)', phase: 'BEFORE', startTimeSeconds: NOW / 1000 + 7200, durationSeconds: 7200 },
        { id: 1899, name: 'Round 899', phase: 'FINISHED', startTimeSeconds: NOW / 1000 - 7200, durationSeconds: 7200 },
      ],
    }),
  );

  assert.equal(contests.length, 1);
  assert.equal(contests[0].id, 'codeforces:1900');
  assert.equal(contests[0].name, 'Round 900 (Div. 2)');
  assert.equal(contests[0].url, 'https://codeforces.com/contests/1900');
  assert.equal(contests[0].durationMs, 2 * HOUR);
});

test('Codeforces: a failed or malformed response yields nothing, not a throw', () => {
  assert.deepEqual(parseCodeforces(JSON.stringify({ status: 'FAILED' })), []);
  assert.deepEqual(parseCodeforces('<html>502</html>'), []);
  assert.deepEqual(parseCodeforces('{}'), []);
});

/* -------------------------------------------------------------- LeetCode */

test('LeetCode: upcoming contests are read from the GraphQL payload', () => {
  const contests = parseLeetCode(
    JSON.stringify({
      data: {
        upcomingContests: [
          { title: 'Weekly Contest 500', titleSlug: 'weekly-contest-500', startTime: NOW / 1000 + 3600, duration: 5400 },
        ],
      },
    }),
  );

  assert.equal(contests[0].id, 'leetcode:weekly-contest-500');
  assert.equal(contests[0].url, 'https://leetcode.com/contest/weekly-contest-500');
  assert.equal(contests[0].durationMs, 5400_000);
});

test('LeetCode: an error payload yields nothing', () => {
  assert.deepEqual(parseLeetCode(JSON.stringify({ errors: [{ message: 'nope' }] })), []);
  assert.deepEqual(parseLeetCode('not json'), []);
});

/* -------------------------------------------------------------- CodeChef */

test('CodeChef: future contests carry ISO start and end times', () => {
  const contests = parseCodeChef(
    JSON.stringify({
      future_contests: [
        {
          contest_code: 'START100',
          contest_name: 'Starters 100',
          contest_start_date_iso: '2026-01-16T14:30:00+05:30',
          contest_end_date_iso: '2026-01-16T17:30:00+05:30',
        },
      ],
    }),
  );

  assert.equal(contests[0].id, 'codechef:START100');
  assert.equal(contests[0].url, 'https://www.codechef.com/START100');
  assert.equal(contests[0].durationMs, 3 * HOUR);
});

test('CodeChef: entries without a parseable start are dropped', () => {
  const contests = parseCodeChef(
    JSON.stringify({
      future_contests: [
        { contest_code: 'BAD', contest_start_date_iso: 'sometime soon' },
        { contest_name: 'No code', contest_start_date_iso: '2026-01-16T14:30:00Z' },
      ],
    }),
  );
  assert.deepEqual(contests, []);
});

/* --------------------------------------------------------------- AtCoder */

const ATCODER_HTML = `
<div id="contest-table-upcoming"><table><tbody>
  <tr>
    <td><time class="fixtime">2026-01-17 21:00:00+0900</time></td>
    <td><a href="/contests/abc390">AtCoder Beginner Contest 390</a></td>
    <td>01:40</td>
  </tr>
</tbody></table></div>`;

test('AtCoder: the upcoming table yields contests with an absolute start time', () => {
  const { document } = parseHTML(ATCODER_HTML);
  const contests = parseAtCoder(document);

  assert.equal(contests.length, 1);
  assert.equal(contests[0].id, 'atcoder:abc390');
  assert.equal(contests[0].name, 'AtCoder Beginner Contest 390');
  assert.equal(contests[0].url, 'https://atcoder.jp/contests/abc390');
  // The +0900 offset is what makes the rendered time unambiguous.
  assert.equal(contests[0].startAt, Date.parse('2026-01-17T12:00:00Z'));
  assert.equal(contests[0].durationMs, 100 * 60_000);
});

test('AtCoder: a page without the table yields nothing', () => {
  assert.deepEqual(parseAtCoder(parseHTML('<p>maintenance</p>').document), []);
});

/* ---------------------------------------------------------------- shared */

const contest = (id, startAt) => ({
  id,
  platform: 'codeforces',
  name: id,
  url: 'https://example.com',
  startAt,
  durationMs: 2 * HOUR,
});

test('past contests are dropped and the rest ordered by start time', () => {
  const list = upcoming(
    [
      contest('c', NOW + 3 * HOUR),
      contest('a', NOW - HOUR),
      contest('b', NOW + HOUR),
    ],
    NOW,
  );
  assert.deepEqual(list.map((entry) => entry.id), ['b', 'c']);
});

test('contests beyond the horizon are left out', () => {
  const list = upcoming([contest('far', NOW + 60 * 24 * HOUR)], NOW, 30);
  assert.deepEqual(list, []);
});

test('the same contest arriving twice is listed once', () => {
  const list = upcoming([contest('dup', NOW + HOUR), contest('dup', NOW + HOUR)], NOW);
  assert.equal(list.length, 1);
});

test('countdowns read naturally at every scale', () => {
  assert.equal(formatStartsIn(NOW + 2 * 24 * HOUR + 4 * HOUR, NOW), 'in 2d 4h');
  assert.equal(formatStartsIn(NOW + 3 * HOUR + 30 * 60_000, NOW), 'in 3h 30m');
  assert.equal(formatStartsIn(NOW + 45 * 60_000, NOW), 'in 45m');
  assert.equal(formatStartsIn(NOW, NOW), 'starting now');
});

test('durations are formatted without empty parts', () => {
  assert.equal(formatDuration(2 * HOUR), '2h');
  assert.equal(formatDuration(100 * 60_000), '1h 40m');
  assert.equal(formatDuration(30 * 60_000), '30m');
  assert.equal(formatDuration(0), '');
});

test('the calendar link spans the contest and carries its URL', () => {
  const url = new URL(calendarUrl(contest('cf', NOW)));
  assert.equal(url.searchParams.get('text'), 'cf');
  assert.equal(url.searchParams.get('dates'), '20260115T120000Z/20260115T140000Z');
  assert.equal(url.searchParams.get('details'), 'https://example.com');
});

test('a contest with no known duration still gets a sensible calendar block', () => {
  const url = new URL(calendarUrl({ ...contest('x', NOW), durationMs: 0 }));
  assert.equal(url.searchParams.get('dates'), '20260115T120000Z/20260115T140000Z');
});

test('reminders fire once, only inside the lead window', () => {
  const soon = contest('soon', NOW + 30 * 60_000);
  const later = contest('later', NOW + 5 * HOUR);

  assert.deepEqual(dueReminders([soon, later], [], 60, NOW).map((c) => c.id), ['soon']);
  // Already reminded, so it does not fire again on the next tick.
  assert.deepEqual(dueReminders([soon, later], ['soon'], 60, NOW), []);
  // A contest that already started is not a reminder.
  assert.deepEqual(dueReminders([contest('gone', NOW - 60_000)], [], 60, NOW), []);
});

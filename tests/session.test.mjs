import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SESSION_CAP,
  describeProgress,
  isStale,
  markDone,
  progress,
  remaining,
  startSession,
} from '../src/core/session.ts';

const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);
const DAY = 86_400_000;

const problem = (id, dueAt) => ({
  id,
  slug: id,
  platform: 'leetcode',
  title: id,
  difficulty: 'medium',
  solvedAt: NOW - 30 * DAY,
  revision: { stage: 2, ease: 2.5, dueAt, reviewCount: 1, lapses: 0, hintsUsed: 0 },
});

const index = (problems) => new Map(problems.map((p) => [p.id, p]));

test('a session takes the due list in the order it was given', () => {
  // Most overdue first, which is the order the due list already comes in and
  // the right order to spend a limited sitting in.
  const due = [problem('a', NOW - 5 * DAY), problem('b', NOW - DAY), problem('c', NOW)];
  assert.deepEqual(startSession(due, NOW).ids, ['a', 'b', 'c']);
});

test('a session is capped, so it can actually be finished', () => {
  // Somebody back from a fortnight away has ninety due. A session that cannot
  // end is a list with extra steps.
  const due = Array.from({ length: 90 }, (_, i) => problem(`p${i}`, NOW - DAY));
  assert.equal(startSession(due, NOW).ids.length, SESSION_CAP);
});

test('the set is fixed at the start, so rating does not reshuffle it', () => {
  // Rating changes when a problem is next due. If the session re-read the due
  // list each time, "3 of 8" would mean nothing halfway through.
  const due = [problem('a', NOW - DAY), problem('b', NOW - DAY)];
  const session = startSession(due, NOW);

  // 'a' is rated and pushed a week out; the session still knows it was in it.
  const after = index([problem('a', NOW + 7 * DAY), problem('b', NOW - DAY)]);
  assert.equal(progress(session, after, NOW).total, 2);
  assert.equal(progress(session, after, NOW).done, 1);
});

test('a problem rated somewhere else counts as done here too', () => {
  // On the judge's page, in the Due list, or on another machine that synced.
  // Offering it again because this session did not witness the rating would be
  // pedantic.
  const session = startSession([problem('a', NOW - DAY), problem('b', NOW - DAY)], NOW);
  const after = index([problem('a', NOW + 7 * DAY), problem('b', NOW - DAY)]);

  assert.deepEqual(remaining(session, after, NOW).map((p) => p.id), ['b']);
});

test('a deleted problem does not stall the session', () => {
  const session = startSession([problem('a', NOW - DAY), problem('b', NOW - DAY)], NOW);
  assert.deepEqual(
    remaining(session, index([problem('b', NOW - DAY)]), NOW).map((p) => p.id),
    ['b'],
  );
});

test('skipping marks it off without rating it', () => {
  // Some days a problem is not going to happen, and forcing a "forgot" onto it
  // would put a lie into the schedule.
  const due = [problem('a', NOW - DAY), problem('b', NOW - DAY)];
  const session = markDone(startSession(due, NOW), 'a');

  assert.deepEqual(remaining(session, index(due), NOW).map((p) => p.id), ['b']);
  assert.equal(index(due).get('a').revision.stage, 2, 'and the schedule is untouched');
});

test('marking the same one twice does not double-count it', () => {
  const session = markDone(markDone(startSession([problem('a', NOW - DAY)], NOW), 'a'), 'a');
  assert.equal(session.done.length, 1);
});

test('progress counts up and ends with no current problem', () => {
  const due = [problem('a', NOW - DAY), problem('b', NOW - DAY)];
  let session = startSession(due, NOW);

  assert.equal(describeProgress(progress(session, index(due), NOW)), '1 of 2');
  session = markDone(session, 'a');
  assert.equal(describeProgress(progress(session, index(due), NOW)), '2 of 2');
  session = markDone(session, 'b');

  const finished = progress(session, index(due), NOW);
  assert.equal(finished.current, undefined);
  assert.equal(describeProgress(finished), 'All 2 done.');
});

test("yesterday's session is stale", () => {
  // Tuesday has its own due list; resuming Monday's half-finished set would be
  // resuming a set that is now wrong.
  const session = startSession([problem('a', NOW - DAY)], NOW);
  assert.equal(isStale(session, NOW + 3 * 3_600_000), false, 'later the same day is fine');
  assert.equal(isStale(session, NOW + DAY), true);
});

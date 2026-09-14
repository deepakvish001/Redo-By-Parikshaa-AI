// Fixed before anything reads a Date: this file exists to prove a bug that only
// appears where the local day and the UTC day disagree, and the machine running
// the suite is on UTC, where they never can.
process.env.TZ = 'Asia/Kolkata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { canPause, dayKey } from '../src/core/focus.ts';

test('a pause is spent on the local day, not the UTC one', () => {
  // The gate page used to disable its own escape hatch with
  // `pause.day === new Date().toISOString().slice(0, 10)` — UTC — while a pause
  // is *spent* against `dayKey`, which is local. East of Greenwich those
  // disagree through the small hours: at 01:00 in Delhi it is still yesterday
  // in UTC, so a pause used yesterday looked like one used today and the button
  // sat disabled with a fresh pause available. `canPause` is now the single
  // answer both sides ask.
  const at = Date.parse('2026-09-02T01:00:00+05:30');

  assert.equal(dayKey(at), '2026-09-02', 'the local day, which is the one a person is having');
  assert.equal(
    new Date(at).toISOString().slice(0, 10),
    '2026-09-01',
    'the same instant, a different day in UTC — which is what made the two disagree',
  );

  // Spent on the previous local day: today's is still available.
  assert.equal(canPause({ day: '2026-09-01', until: at - 3_600_000 }, at), true);
  // Spent today: it is not.
  assert.equal(canPause({ day: '2026-09-02', until: at + 3_600_000 }, at), false);
});

test('the day rolls at local midnight', () => {
  // 23:59 and 00:01 local are different days even though they are 2 minutes
  // apart, and both are the same UTC day here.
  const before = Date.parse('2026-09-02T23:59:00+05:30');
  const after = Date.parse('2026-09-03T00:01:00+05:30');

  assert.equal(dayKey(before), '2026-09-02');
  assert.equal(dayKey(after), '2026-09-03');
  assert.equal(canPause({ day: dayKey(before) }, after), true, 'midnight refills the pause');
});

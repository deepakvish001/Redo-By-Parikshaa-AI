import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFailureReport,
  classify,
  countOpenAttempts,
  describeHeadline,
  failureLabel,
  strugglingTopics,
} from '../src/core/patterns.ts';

function submit(verdict, accepted = false, at = 0) {
  return { at, kind: 'submit', verdict, accepted };
}

function problem(id, tags, events, extra = {}) {
  return {
    id,
    platform: 'leetcode',
    problemId: id,
    slug: id,
    title: id,
    url: `https://leetcode.com/problems/${id}/`,
    difficulty: 'medium',
    tags,
    language: 'python',
    code: '',
    solvedAt: 0,
    attempts: 1,
    events,
    github: { status: 'disabled' },
    parikshaa: { status: 'disabled' },
    revision: { stage: 0, ease: 1, dueAt: 0, reviewCount: 0, lapses: 0, hintsUsed: 0 },
    ...extra,
  };
}

test('each judge wording lands in the same bucket', () => {
  assert.equal(classify('Wrong Answer'), 'wrong');
  assert.equal(classify('Wrong answer on test 4'), 'wrong');
  assert.equal(classify('Time Limit Exceeded'), 'slow');
  assert.equal(classify('TLE on test 12'), 'slow');
  assert.equal(classify('Runtime Error'), 'crash');
  assert.equal(classify('Memory limit exceeded'), 'crash');
  assert.equal(classify('Compilation error'), 'compile');
});

test('Codeforces russian verdicts classify too', () => {
  // The site localises, and an accepted submission read as a failure was a real
  // bug once already.
  assert.equal(classify('Превышено ограничение времени'), 'slow');
  assert.equal(classify('Превышено ограничение памяти'), 'crash');
  assert.equal(classify('Ошибка компиляции'), 'compile');
  assert.equal(classify('Неправильный ответ'), 'wrong');
});

test('a verdict nothing recognises is left alone rather than guessed', () => {
  // The judge breaking is not a rejected answer, and counting it as one would
  // put noise straight into the headline.
  assert.equal(classify('Judgement Failed'), undefined);
  assert.equal(classify('Accepted'), undefined);
});

test('accepted submissions are not counted as failures', () => {
  const report = buildFailureReport([
    problem('a', ['arrays'], [submit('Accepted', true), submit('Accepted', true)]),
  ]);
  assert.equal(report.failures, 0);
  assert.equal(report.submits, 2);
});

test('failures are grouped by kind and by topic', () => {
  const report = buildFailureReport([
    problem('a', ['dp'], [submit('Time Limit Exceeded'), submit('Accepted', true)]),
    problem('b', ['dp'], [submit('Time Limit Exceeded'), submit('Wrong Answer'), submit('Accepted', true)]),
  ]);

  assert.equal(report.failures, 3);
  assert.equal(report.byKind.slow, 2);
  assert.equal(report.byKind.wrong, 1);
  assert.equal(report.headline?.kind, 'slow');
  assert.equal(report.headline?.tag, 'dp');
});

test('a topic with too few submits does not get a rate computed for it', () => {
  // Three submits with one failure is not "33% wrong answers", it is noise.
  const report = buildFailureReport([
    problem('a', ['graphs'], [submit('Wrong Answer'), submit('Accepted', true)]),
  ]);
  assert.deepEqual(report.topics, []);
});

test('the headline says what goes wrong and where', () => {
  const events = [submit('Time Limit Exceeded'), submit('Time Limit Exceeded'), submit('Wrong Answer'), submit('Accepted', true)];
  const report = buildFailureReport([
    problem('a', ['dp'], events),
    problem('b', ['dp'], events),
  ]);

  const text = describeHeadline(report);
  assert.match(text, /too slow/);
  assert.match(text, /dp/);
  assert.match(text, /^\d+%/);
});

test('there is no headline until there is something to say', () => {
  assert.equal(describeHeadline(buildFailureReport([])), undefined);
  assert.equal(
    describeHeadline(buildFailureReport([problem('a', ['dp'], [submit('Wrong Answer')])])),
    undefined,
  );
});

test('struggling topics are the ones costing more tries than usual', () => {
  const hard = Array.from({ length: 8 }, () => submit('Wrong Answer'));
  const report = buildFailureReport([
    problem('a', ['dp'], [...hard, submit('Accepted', true)]),
    problem('b', ['arrays'], [submit('Wrong Answer'), ...Array.from({ length: 4 }, () => submit('Accepted', true))]),
  ]);

  const worst = strugglingTopics(report);
  assert.equal(worst[0]?.tag, 'dp');
  assert.ok(worst.every((topic) => topic.tag !== 'arrays'));
});

test('first-try misses are listed newest first with their verdict', () => {
  const report = buildFailureReport([
    problem('a', [], [submit('Wrong Answer', false, 1), submit('Accepted', true, 2)]),
    problem('b', [], [submit('Runtime Error', false, 3), submit('Accepted', true, 4)]),
    problem('c', [], [submit('Accepted', true, 5)]),
  ]);

  assert.deepEqual(
    report.firstFailures.map((entry) => entry.title),
    ['b', 'a'],
  );
  assert.equal(report.firstFailures[0].verdict, 'Runtime Error');
});

test('a run is never mistaken for a submit', () => {
  const report = buildFailureReport([
    problem('a', [], [{ at: 0, kind: 'run', verdict: 'Wrong Answer', accepted: false }]),
  ]);
  assert.equal(report.submits, 0);
  assert.equal(report.failures, 0);
});

test('unsolved problems still contribute their attempt count', () => {
  const open = {
    'leetcode:x': [submit('Wrong Answer'), submit('Time Limit Exceeded')],
    'leetcode:y': [{ at: 0, kind: 'run', verdict: 'Accepted', accepted: true }],
  };
  assert.equal(countOpenAttempts(open), 2);
});

test('every kind has a label to print', () => {
  for (const kind of ['wrong', 'slow', 'crash', 'compile']) {
    assert.ok(failureLabel(kind).length > 0);
  }
});

import type { MockData, SearchResult } from '../core/messages.ts';
import { getMock, getProblemList, saveMock } from '../core/storage.ts';
import {
  finishMock,
  mockCandidates,
  mockState,
  pickMock,
  startMock,
  type MockOutcome,
} from '../core/mock.ts';
import { searchSolutions } from '../core/search.ts';

async function build(now = Date.now()): Promise<MockData> {
  const [store, problems] = await Promise.all([getMock(), getProblemList()]);
  const state = mockState(store.active, now);

  return {
    ...state,
    candidates: mockCandidates(problems, now).length,
    history: store.history,
  };
}

export async function getMockData(): Promise<MockData> {
  return build();
}

export async function beginMock(minutes: number): Promise<MockData> {
  const now = Date.now();
  const store = await getMock();

  // A round already running is not replaced. Starting a second one silently
  // would throw away the first one's clock, which is the only thing it has.
  if (store.active && !store.active.finishedAt && store.active.endsAt > now) {
    return build(now);
  }

  const candidates = mockCandidates(await getProblemList(), now);
  const pick = pickMock(candidates, String(now));
  if (!pick) {
    throw new Error(
      'Nothing to ask about yet — a round draws on problems you solved at least a week ago.',
    );
  }

  await saveMock({ ...store, active: startMock(pick, minutes, now) });
  return build(now);
}

/**
 * A different problem, same clock length, clock restarted.
 *
 * Only before the round has really begun in the user's head — which in practice
 * means it is always allowed, because the alternative is somebody staring at a
 * problem they have decided not to do while the timer runs.
 */
export async function rerollMock(): Promise<MockData> {
  const now = Date.now();
  const store = await getMock();
  if (!store.active || store.active.finishedAt) return build(now);

  const candidates = mockCandidates(await getProblemList(), now).filter(
    (problem) => problem.id !== store.active?.problem.id,
  );
  const pick = pickMock(candidates, `${now}:reroll`);
  if (!pick) return build(now);

  await saveMock({ ...store, active: startMock(pick, store.active.minutes, now) });
  return build(now);
}

export async function endMock(outcome: MockOutcome): Promise<MockData> {
  const now = Date.now();
  const store = await getMock();
  if (!store.active || store.active.finishedAt) return build(now);

  const result = finishMock(store.active, outcome, now);
  await saveMock({
    active: undefined,
    history: [result.session, ...store.history],
  });
  return build(now);
}

/**
 * Search, flattened for the wire.
 *
 * The hits carry whole problem records, and a problem record carries every
 * version of its source — a few hundred kilobytes to render a list of titles.
 * Only the row's own fields cross the boundary.
 */
export async function searchProblems(
  query: string,
): Promise<{ hits: SearchResult[]; searched: number }> {
  const problems = await getProblemList();
  const hits = searchSolutions(problems, query);

  return {
    searched: problems.length,
    hits: hits.map((hit) => ({
      id: hit.problem.id,
      title: hit.problem.title,
      url: hit.problem.url,
      platform: hit.problem.platform,
      difficulty: hit.problem.difficulty,
      tags: hit.problem.tags ?? [],
      solvedAt: hit.problem.solvedAt,
      fields: hit.fields,
      snippet: hit.snippet,
    })),
  };
}

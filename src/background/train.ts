import { tagCounts } from '../core/insights.ts';
import { readiness, recommend, type Readiness, type Suggestion } from '../core/recommend.ts';
import { buildRoadmap, type Roadmap } from '../core/roadmap.ts';
import { getSettings, getUpsolve } from '../core/storage.ts';
import { getTraining, saveTraining } from '../core/storage.ts';
import {
  buildContest,
  isRunning,
  remainingMs,
  reroll,
  score,
  slotStates,
  suggestedLadder,
  unfilled,
  type SlotState,
  type TrainingContest,
  type TrainingScore,
} from '../core/training.ts';
import { cfState } from './cf-state.ts';

/**
 * The Train tab: a round you set yourself, and what to do when you are not in
 * one.
 */

export interface TrainData {
  contest?: TrainingContest;
  states: SlotState[];
  score: TrainingScore;
  running: boolean;
  remainingMs: number;
  /** Ratings the round asked for that had nothing left. */
  unfilled: number[];

  /** Finished rounds, newest first, with how each went. */
  history: Array<{ contest: TrainingContest; score: TrainingScore; states: SlotState[] }>;

  band: number;
  ladder: number[];
  growth: Suggestion[];
  stretch: Suggestion[];
  readiness?: Readiness;
  /** An ordered plan from the weak bands and tags, against the goal. */
  roadmap?: Roadmap;

  reason?: string;
  now: number;
}

const EMPTY = {
  states: [] as SlotState[],
  score: { solved: 0, attempted: 0, total: 0, elapsedMinutes: 0 },
  running: false,
  remainingMs: 0,
  unfilled: [] as number[],
  history: [] as TrainData['history'],
  band: 800,
  ladder: suggestedLadder(800),
  growth: [] as Suggestion[],
  stretch: [] as Suggestion[],
};

export async function buildTrain(now = Date.now()): Promise<TrainData> {
  const [state, store, settings, upsolve] = await Promise.all([
    cfState(),
    getTraining(),
    getSettings(),
    getUpsolve(),
  ]);

  if (!state.ok) {
    return { ...EMPTY, reason: state.reason, now };
  }

  const { solved, attempted, candidates, band, problemset } = state;
  const tags = tagCounts(solved, attempted, problemset);

  // A round whose clock has run out is filed on the next read rather than by a
  // timer: the service worker sleeps, and a round should not stay "running"
  // until something happens to wake it.
  let active = store.active;
  if (active && !isRunning(active, now) && !active.finishedAt) {
    const filed = { ...active, finishedAt: active.startedAt + active.durationMs };
    await saveTraining({ history: [filed, ...store.history], active: undefined });
    store.history = [filed, ...store.history];
    active = undefined;
  }

  const states = active ? slotStates(active, solved, attempted) : [];

  const growth = recommend(candidates, solved, tags, { rating: band, limit: 4 });
  // The stretch bucket avoids the tags growth already covered, so the two lists
  // are two different pieces of advice rather than the same one twice.
  const stretch = recommend(candidates, solved, tags, {
    rating: Math.min(3500, band + 200),
    limit: 3,
    exclude: new Set(growth.flatMap((entry) => entry.tags)),
  });

  // The goal you named, or the next band up — which is what almost everybody
  // is actually working towards.
  const target =
    settings.handles.goal > 0 ? settings.handles.goal : Math.min(3500, band + 200);

  const ready = readiness(target, solved, attempted, (key) => problemset[key]?.rating);

  return {
    contest: active,
    states,
    score: active ? score(active, states, now) : EMPTY.score,
    running: active ? isRunning(active, now) : false,
    remainingMs: active ? remainingMs(active, now) : 0,
    unfilled: active ? unfilled(active) : [],
    history: store.history.slice(0, 8).map((contest) => {
      const past = slotStates(contest, solved, attempted);
      return { contest, states: past, score: score(contest, past, now) };
    }),
    band,
    ladder: suggestedLadder(band),
    growth,
    stretch,
    readiness: ready,
    roadmap: buildRoadmap({
      target,
      band,
      bands: ready.bands,
      tags,
      upsolve: upsolve.filter((item) => item.state !== 'done'),
      // The roadmap decides *what* to practise; the recommender decides which.
      pick: (rating, wanted, limit) =>
        recommend(candidates, solved, tags, { rating, limit, only: wanted, attempted }),
    }),
    now,
  };
}

export async function startContest(
  ratings: number[],
  minutes: number,
  now = Date.now(),
): Promise<TrainData> {
  const [state, store] = await Promise.all([cfState(), getTraining()]);
  if (!state.ok) return buildTrain(now);

  // An unfinished round is filed rather than discarded — you started it, and
  // what happened to it is part of the record.
  const history = store.active
    ? [{ ...store.active, finishedAt: now }, ...store.history]
    : store.history;

  const contest = buildContest(
    state.candidates,
    ratings,
    state.solved,
    minutes,
    now,
    '',
    state.attempted,
  );
  await saveTraining({ active: contest, history });
  return buildTrain(now);
}

export async function rerollSlot(index: number, now = Date.now()): Promise<TrainData> {
  const [state, store] = await Promise.all([cfState(), getTraining()]);
  if (!store.active || !state.ok) return buildTrain(now);

  await saveTraining({
    ...store,
    active: reroll(store.active, index, state.candidates, state.solved),
  });
  return buildTrain(now);
}

export async function finishContest(now = Date.now()): Promise<TrainData> {
  const store = await getTraining();
  if (!store.active) return buildTrain(now);

  await saveTraining({
    active: undefined,
    history: [{ ...store.active, finishedAt: now }, ...store.history],
  });
  return buildTrain(now);
}

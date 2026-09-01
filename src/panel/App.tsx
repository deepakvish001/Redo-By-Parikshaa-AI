import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  calendarUrl,
  formatDuration,
  formatStartsIn,
  type Contest,
} from '../core/contests.ts';
// `formatDuration` also exists in contests.ts for contest lengths; this one
// phrases a solve time, so it is aliased rather than shadowing the other.
import {
  activityLabel,
  countActivity,
  describeStruggle,
  formatDuration as formatSpan,
  summarise,
} from '../core/journal.ts';
import { PARIKSHAA_URL, parikshaaProblemUrl } from '../core/brand.ts';
import {
  MAX_LABELS,
  addLabels,
  countLabels,
  removeLabel,
  suggestionsFor,
  withLabel,
} from '../core/labels.ts';
import {
  buildFailureReport,
  describeHeadline,
  failureLabel,
  strugglingTopics,
  type FailureKind,
} from '../core/patterns.ts';
import { summariseUpsolve, type UpsolveItem } from '../core/upsolve.ts';
import { buildWrappedSvg, summariseWeek, wrappedCaption } from '../core/wrapped.ts';
import {
  send,
  type ContestsResponse,
  type DashboardData,
  type RatingProfiles,
  type HomeData,
  type UpsolveResponse,
} from '../core/messages.ts';
import { bandFloor, type RatingGoal } from '../core/rating.ts';
import { problemUrl } from '../core/daily.ts';
import { heatmapGrid, type Bin, type HeatDay, type TagCount } from '../core/insights.ts';
import type { InsightsData } from '../background/insights.ts';
import { ratingColour } from '../content/mounts/cf-rail.ts';
import type { Prediction } from '../background/rating.ts';
import { dueProblems, formatDueIn, upcomingProblems } from '../core/srs.ts';
import { PLATFORM_LABELS, type Difficulty, type Recall, type SolvedProblem, type TopicStat } from '../core/types.ts';
import {
  AlertIcon,
  ChevronRight,
  ClockIcon,
  FlameIcon,
  GearIcon,
  PlatformMark,
  RefreshIcon,
  SearchIcon,
  SparkIcon,
  TagIcon,
  TargetIcon,
  TrophyIcon,
} from './icons.tsx';
import { copyPng, downloadPng } from './share.ts';

type Tab = 'home' | 'due' | 'all' | 'contests' | 'stats';

const PLATFORM_SHORT: Record<string, string> = {
  codeforces: 'CF',
  leetcode: 'LC',
  codechef: 'CC',
  atcoder: 'AC',
};

const RECALLS: Array<{ recall: Recall; label: string; primary?: boolean }> = [
  { recall: 'forgot', label: 'Forgot' },
  { recall: 'hard', label: 'Hard' },
  { recall: 'good', label: 'Good', primary: true },
  { recall: 'easy', label: 'Easy' },
];

function openUrl(url: string): void {
  void chrome.tabs.create({ url });
}

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  unknown: '',
};

function DifficultyChip({ difficulty }: { difficulty: Difficulty }) {
  if (difficulty === 'unknown') return null;
  return <span className={`chip chip--${difficulty}`}>{DIFFICULTY_LABEL[difficulty]}</span>;
}

/** `12 Aug 14:03` — a date only where it is not today. */
function stamp(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const sameDay =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function SyncChip({ problem }: { problem: SolvedProblem }) {
  const { status, commitUrl, error } = problem.github;
  if (status === 'synced') {
    return (
      <span className="chip chip--ok" title={commitUrl || undefined}>
        Synced
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="chip chip--overdue" title={error}>
        Sync failed
      </span>
    );
  }
  return <span className="chip">{status === 'pending' ? 'Syncing' : 'Local only'}</span>;
}

function ParikshaaChip({ problem }: { problem: SolvedProblem }) {
  const state = problem.parikshaa;
  // Older records predate Parikshaa sync and simply have nothing to show.
  if (!state || state.status === 'disabled') return null;

  if (state.status === 'synced') {
    return (
      <span className="chip chip--ok" title={state.url}>
        Parikshaa ✓
      </span>
    );
  }
  if (state.status === 'error') {
    return (
      <span className="chip chip--overdue" title={state.error}>
        Parikshaa failed
      </span>
    );
  }
  if (state.status === 'skipped') {
    // "Not on Parikshaa" is the common case and is not a failure, so it says so
    // rather than hiding behind an "n/a" whose reason lives in a tooltip.
    const notThere = /no parikshaa problem uses this slug/i.test(state.reason ?? '');
    return (
      <span className="chip" title={state.reason}>
        {notThere ? 'Not on Parikshaa' : 'Parikshaa n/a'}
      </span>
    );
  }
  return (
    <span className="chip" title={state.reason}>
      Parikshaa queued
    </span>
  );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__title">{title}</div>
      <div>{children}</div>
    </div>
  );
}

/**
 * Notes and complexity live with the problem and travel into its committed
 * README, so the repository ends up holding the reasoning and not just the
 * code that happened to pass.
 */
function DetailsEditor({
  problem,
  onSave,
}: {
  problem: SolvedProblem;
  onSave: (
    id: string,
    note: string,
    complexity: { time?: string; space?: string },
  ) => Promise<void>;
}) {
  const [note, setNote] = useState(problem.note ?? '');
  const [time, setTime] = useState(problem.complexity?.time ?? '');
  const [space, setSpace] = useState(problem.complexity?.space ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty =
    note !== (problem.note ?? '') ||
    time !== (problem.complexity?.time ?? '') ||
    space !== (problem.complexity?.space ?? '');

  return (
    <div className="editor">
      <textarea
        rows={3}
        value={note}
        placeholder="How did you approach it? What tripped you up?"
        onChange={(event) => {
          setNote(event.target.value);
          setSaved(false);
        }}
      />
      <div className="editor__row">
        {/* Labelled rather than placeholder-only: once both hold "O(n)" the
            placeholders are gone and the fields become indistinguishable. */}
        <label className="editor__field">
          <span>Time</span>
          <input
            type="text"
            value={time}
            placeholder="O(n)"
            onChange={(event) => {
              setTime(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <label className="editor__field">
          <span>Space</span>
          <input
            type="text"
            value={space}
            placeholder="O(1)"
            onChange={(event) => {
              setSpace(event.target.value);
              setSaved(false);
            }}
          />
        </label>
      </div>
      <div className="editor__actions">
        <button
          type="button"
          className="primary"
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(problem.id, note, { time: time.trim(), space: space.trim() });
              setSaved(true);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? 'Saving…' : 'Save notes'}
        </button>
        <span className="editor__hint">
          {saved ? 'Saved, and pushed if GitHub sync is on.' : 'Goes into the problem’s README.'}
        </span>
      </div>
    </div>
  );
}

/**
 * Labels, as chips with an input.
 *
 * Deliberately not a dropdown of a fixed vocabulary: the whole value of the
 * feature is that people invent their own words for how they study, and a
 * dropdown would quietly tell them their word is not one of the allowed ones.
 */
function LabelEditor({
  problem,
  suggestions,
  onSave,
}: {
  problem: SolvedProblem;
  suggestions: string[];
  onSave: (id: string, labels: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const labels = problem.labels ?? [];

  const commit = (text: string) => {
    const next = addLabels(labels, text);
    setDraft('');
    if (next.join() !== labels.join()) onSave(problem.id, next);
  };

  return (
    <div className="labels">
      {labels.map((label) => (
        <button
          key={label}
          type="button"
          className="label"
          title={`Remove "${label}"`}
          onClick={() => onSave(problem.id, removeLabel(labels, label))}
        >
          <TagIcon size={10} />
          {label}
          <span className="label__x" aria-hidden="true">
            ×
          </span>
        </button>
      ))}
      <input
        className="labels__input"
        value={draft}
        placeholder={labels.length >= MAX_LABELS ? 'Label limit reached' : 'Add a label…'}
        disabled={labels.length >= MAX_LABELS}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(draft);
          // Backspace on an empty box takes the last chip off, which is what
          // every other chip input in the world does.
          if (event.key === 'Backspace' && draft === '' && labels.length > 0) {
            onSave(problem.id, labels.slice(0, -1));
          }
        }}
        onBlur={() => draft && commit(draft)}
      />
      {draft === '' &&
        suggestions.slice(0, 3).map((label) => (
          <button
            key={label}
            type="button"
            className="label label--suggest"
            onClick={() => commit(label)}
          >
            + {label}
          </button>
        ))}
    </div>
  );
}

function ProblemCard({
  problem,
  now,
  onReview,
  onResync,
  onResyncParikshaa,
  onDelete,
  onSaveDetails,
  onSaveLabels,
  labelSuggestions = [],
  showRecall,
  collapsible = false,
  defaultOpen = false,
}: {
  problem: SolvedProblem;
  now: number;
  onReview: (id: string, recall: Recall) => void;
  onResync: (id: string) => void;
  onResyncParikshaa: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveDetails: (
    id: string,
    note: string,
    complexity: { time?: string; space?: string },
  ) => Promise<void>;
  onSaveLabels: (id: string, labels: string[]) => void;
  labelSuggestions?: string[];
  showRecall: boolean;
  /**
   * Collapsed cards show only what identifies the problem and when it is next
   * due. Everything else is a click away — with a few hundred problems, an
   * always-expanded list is unreadable however well it scrolls.
   */
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [showAttempts, setShowAttempts] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  const overdue = problem.revision.dueAt <= now;
  const events = problem.events ?? [];
  const journal = summarise(events);
  const history = problem.history ?? [];
  const counts = countActivity(history);
  const struggle = problem.revision.struggle;

  if (collapsible && !open) {
    return (
      <button type="button" className="row" onClick={() => setOpen(true)}>
        <span className={`row__dot row__dot--${problem.difficulty}`} />
        <span className="row__title">{problem.title}</span>
        {(problem.labels ?? []).length > 0 && (
          <span className="row__labels" title={(problem.labels ?? []).join(', ')}>
            <TagIcon size={10} />
            {problem.labels![0]}
            {problem.labels!.length > 1 && `+${problem.labels!.length - 1}`}
          </span>
        )}
        {problem.github.status === 'error' && (
          <span className="row__warn" title={problem.github.error}>
            <AlertIcon size={12} />
          </span>
        )}
        <span className={`row__due ${overdue ? 'is-overdue' : ''}`}>
          {formatDueIn(problem.revision.dueAt, now)}
        </span>
        <ChevronRight size={12} className="row__chevron" />
      </button>
    );
  }

  return (
    <div className="card">
      <div className="card__top">
        {collapsible && (
          <button
            type="button"
            className="card__collapse"
            onClick={() => setOpen(false)}
            aria-label="Collapse"
          >
            <ChevronRight size={12} className="is-open" />
          </button>
        )}
        <div className="card__title">{problem.title}</div>
        <DifficultyChip difficulty={problem.difficulty} />
      </div>

      <div className="card__meta">
        <span className={`chip ${overdue ? 'chip--overdue' : ''}`}>
          {sentence(formatDueIn(problem.revision.dueAt, now))}
        </span>
        <SyncChip problem={problem} />
        <ParikshaaChip problem={problem} />
        <span className="card__facts">
          {[
            problem.platform,
            `stage ${problem.revision.stage + 1}`,
            problem.revision.targetReviews &&
              `${problem.revision.reviewCount}/${problem.revision.targetReviews} reviews`,
            problem.revision.lapses > 0 &&
              `${problem.revision.lapses} lapse${problem.revision.lapses === 1 ? '' : 's'}`,
            problem.solveTimeMs && formatSpan(problem.solveTimeMs),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      {!showRecall && (
        <LabelEditor
          problem={problem}
          suggestions={labelSuggestions}
          onSave={onSaveLabels}
        />
      )}

      {(events.length > 0 || struggle !== undefined) && (
        <button
          type="button"
          className="journal__toggle"
          onClick={() => setShowAttempts((open) => !open)}
        >
          {[
            struggle !== undefined && describeStruggle(struggle),
            journal.submits > 0 && `${journal.submits} submit${journal.submits === 1 ? '' : 's'}`,
            journal.runs > 0 && `${journal.runs} run${journal.runs === 1 ? '' : 's'}`,
          ]
            .filter(Boolean)
            .join(' · ')}
          {events.length > 0 && <span aria-hidden="true">{showAttempts ? ' ▾' : ' ▸'}</span>}
        </button>
      )}

      {history.length > 0 && (
        <button
          type="button"
          className="journal__toggle"
          onClick={() => setShowHistory((value) => !value)}
        >
          {[
            counts.opened > 0 && `opened ${counts.opened}×`,
            counts.review > 0 && `revised ${counts.review}×`,
            counts.hint > 0 && `hints ${counts.hint}×`,
            counts.github > 0 && `synced ${counts.github}×`,
          ]
            .filter(Boolean)
            .join(' · ') || `${history.length} events`}
          <span aria-hidden="true">{showHistory ? ' ▾' : ' ▸'}</span>
        </button>
      )}

      {showHistory && (
        <div className="journal">
          {/* Newest first: what happened last is what you came to check. */}
          {[...history].reverse().map((event, index) => (
            <div className="journal__row journal__row--wide" key={`${event.at}-${index}`}>
              <span className="journal__when">{stamp(event.at)}</span>
              <span className="journal__verdict">{activityLabel(event.kind)}</span>
              <span className="journal__detail">
                {[event.outcome, event.reason].filter(Boolean).join(' — ')}
              </span>
            </div>
          ))}
        </div>
      )}

      {showAttempts && events.length > 0 && (
        <div className="journal">
          {events.map((event, index) => (
            <div className="journal__row" key={`${event.at}-${index}`}>
              <span className={`journal__dot ${event.accepted ? 'is-ok' : 'is-bad'}`} />
              <span className="journal__kind">{event.kind}</span>
              <span className="journal__verdict">{event.verdict}</span>
              <span className="journal__detail">
                {[
                  event.testsTotal && `${event.testsPassed ?? 0}/${event.testsTotal}`,
                  event.runtime,
                  event.errorText?.split('\n')[0],
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          ))}
        </div>
      )}

      {!showRecall && problem.parikshaa && problem.parikshaa.status !== 'disabled' &&
        problem.parikshaa.status !== 'synced' && (
          <div className="card__hint">
            {problem.parikshaa.status === 'skipped' &&
            /no parikshaa problem uses this slug/i.test(problem.parikshaa.reason ?? '')
              ? 'This problem is not on Parikshaa yet. When it is added, press "Parikshaa sync".'
              : problem.parikshaa.reason ?? problem.parikshaa.error ?? 'Waiting to sync to Parikshaa.'}
          </div>
        )}

      {showRecall && (
        <div className="card__ratings">
          {RECALLS.map(({ recall, label, primary }) => (
            <button
              key={recall}
              type="button"
              className={primary ? 'primary' : undefined}
              onClick={() => onReview(problem.id, recall)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="card__actions">
        <button type="button" onClick={() => openUrl(problem.url)}>
          Open problem
        </button>
        {/* Only when we know the problem is there — a guessed URL that 404s is
            worse than no link at all. */}
        {problem.parikshaa?.status === 'synced' && (
          <button
            type="button"
            className="iconbtn"
            onClick={() =>
              openUrl(problem.parikshaa?.url ?? parikshaaProblemUrl(problem.slug))
            }
          >
            <SparkIcon size={12} />
            On Parikshaa
          </button>
        )}
        {!showRecall && (
          <>
            <button type="button" onClick={() => setEditing((open) => !open)}>
              {problem.note || problem.complexity?.time ? 'Edit notes' : 'Add notes'}
            </button>
            {problem.github.commitUrl && (
              <button type="button" onClick={() => openUrl(problem.github.commitUrl as string)}>
                Commit
              </button>
            )}
            <button type="button" onClick={() => onResync(problem.id)}>
              {problem.github.status === 'synced' ? 'Re-sync' : 'Sync now'}
            </button>
            {problem.parikshaa && problem.parikshaa.status !== 'disabled' && (
              <button type="button" onClick={() => onResyncParikshaa(problem.id)}>
                {problem.parikshaa.status === 'synced' ? 'Re-tick Parikshaa' : 'Parikshaa sync'}
              </button>
            )}
            <button type="button" className="ghost danger" onClick={() => onDelete(problem.id)}>
              Remove
            </button>
          </>
        )}
      </div>

      {editing && !showRecall && <DetailsEditor problem={problem} onSave={onSaveDetails} />}
    </div>
  );
}

const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'medium', 'hard', 'unknown'];

/**
 * One judge's problems, as a folder.
 *
 * Grouping is by platform rather than by topic or difficulty because that is
 * the axis the repository already uses, so what the panel shows and what got
 * committed line up.
 */
function PlatformFolder({
  platform,
  problems,
  now,
  defaultOpen,
  children,
}: {
  platform: string;
  problems: SolvedProblem[];
  now: number;
  defaultOpen: boolean;
  children: (problem: SolvedProblem) => React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const due = problems.filter((problem) => problem.revision.dueAt <= now).length;
  const failed = problems.filter((problem) => problem.github.status === 'error').length;

  const counts = DIFFICULTY_ORDER.map((difficulty) => ({
    difficulty,
    count: problems.filter((problem) => problem.difficulty === difficulty).length,
  })).filter((entry) => entry.count > 0);

  return (
    <section className={`folder ${open ? 'is-open' : ''}`}>
      <button type="button" className="folder__head" onClick={() => setOpen((value) => !value)}>
        <ChevronRight size={12} className={`folder__chevron ${open ? 'is-open' : ''}`} />
        <PlatformMark platform={platform} />
        <span className="folder__name">
          {(PLATFORM_LABELS as Record<string, string>)[platform] ?? platform}
        </span>
        {due > 0 && <span className="tag tag--due">{due} due</span>}
        {failed > 0 && (
          <span className="tag tag--bad" title="Not committed to GitHub">
            {failed}
          </span>
        )}
        <span className="folder__count">{problems.length}</span>
      </button>

      {/* The proportions read at a glance in a way four numbers do not. */}
      <div className="folder__bar" aria-hidden="true">
        {counts.map(({ difficulty, count }) => (
          <span
            key={difficulty}
            className={`folder__seg folder__seg--${difficulty}`}
            style={{ flexGrow: count }}
          />
        ))}
      </div>

      {open && (
        <div className="folder__body">
          {problems.length === 0 ? (
            <div className="folder__empty">Nothing here yet.</div>
          ) : (
            problems.map((problem) => children(problem))
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The week's recap, as a card that leaves the browser.
 *
 * This is the one thing here designed to be seen by people who have not
 * installed the extension, so the export has to be one click and the result has
 * to be an image — a screenshot of a side panel is not something anyone posts.
 */
function WrappedCard({
  problems,
  now,
  streak,
}: {
  problems: SolvedProblem[];
  now: number;
  streak: number;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const recap = useMemo(() => summariseWeek(problems, now, streak), [problems, now, streak]);
  // The preview animates; the export does not, because a rasteriser catches the
  // first frame and a bar mid-animation is invisible.
  const preview = useMemo(() => buildWrappedSvg(recap, { animate: true }), [recap]);
  const exportable = useMemo(() => buildWrappedSvg(recap, { animate: false }), [recap]);

  const filename = `week-in-code-${new Date(now).toISOString().slice(0, 10)}`;

  const run = async (label: string, action: () => Promise<void> | void) => {
    setBusy(true);
    setStatus(null);
    try {
      await action();
      setStatus(label);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="wrapped">
      <div className="wrapped__head">
        <SparkIcon size={13} />
        <span>Your week</span>
        <span className="wrapped__range">{recap.range.label}</span>
      </div>

      <img
        className="wrapped__card"
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview)}`}
        alt={wrappedCaption(recap)}
      />

      <div className="wrapped__actions">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void run('Copied — paste it into a post.', () => copyPng(exportable))}
        >
          Copy image
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run('Saved to Downloads.', () => downloadPng(exportable, `${filename}.png`))}
        >
          Download PNG
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run('Caption copied.', () => navigator.clipboard.writeText(wrappedCaption(recap)))
          }
        >
          Copy caption
        </button>
      </div>

      {status && <div className="wrapped__status">{status}</div>}
    </section>
  );
}

/**
 * Contest rating, and what the next one does to it.
 *
 * Codeforces publishes enough to run its own rating system, so the number here
 * is that algorithm on the real standings — not a heuristic. LeetCode publishes
 * a rating but not the field, so it can only be reported, never predicted; the
 * card says so rather than inventing a figure.
 */
/**
 * How far the next band is, at the rate the last few contests set.
 *
 * The bar is drawn from the bottom of the current band to the top, so it moves
 * a visible amount after a single good round — a bar scaled from zero to 1600
 * barely twitches, and a progress bar that never moves is worse than none.
 */
function GoalBar({ goal }: { goal: RatingGoal }) {
  const floor = bandFloor(goal.current);
  const span = Math.max(1, goal.target - floor);
  const filled = Math.max(0, Math.min(1, (goal.current - floor) / span));

  return (
    <div className="goal">
      <div className="goal__head">
        <TargetIcon size={12} />
        <span className="goal__title">
          {goal.gap > 0 ? `${goal.gap} to ${goal.title}` : `${goal.title} reached`}
        </span>
        <span className={`goal__rate ${goal.perContest >= 0 ? 'is-up' : 'is-down'}`}>
          {goal.perContest >= 0 ? '+' : ''}
          {goal.perContest}/contest
        </span>
      </div>
      <div className="goal__track" aria-hidden="true">
        <span className="goal__fill" style={{ width: `${filled * 100}%` }} />
      </div>
      <div className="goal__note">
        {goal.gap <= 0
          ? 'Already there — the next band is what the bar tracks from here.'
          : goal.contests
            ? `About ${goal.contests} contest${goal.contests === 1 ? '' : 's'} at your recent pace` +
              (goal.etaDays ? `, roughly ${goal.etaDays} days.` : '.')
            : 'Your last few contests are flat or down, so there is no honest estimate to give.'}
      </div>
    </div>
  );
}

/**
 * What the last few contests left behind.
 *
 * The problems worth returning to are the ones that were attempted and not
 * passed — those are gaps in technique, not in time — so they are listed first
 * and marked differently from the ones that were never opened.
 */
function UpsolveCard() {
  const [state, setState] = useState<UpsolveResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    setBusy(true);
    try {
      setState(await send(refresh ? { type: 'upsolve:refresh' } : { type: 'upsolve:get' }));
    } catch (error) {
      setState({
        items: [],
        summary: summariseUpsolve([]),
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const pending = (state?.items ?? []).filter((item) => item.state !== 'done');
  const order: Record<UpsolveItem['state'], number> = { failed: 0, untouched: 1, done: 2 };

  return (
    <section className="upsolve">
      <div className="upsolve__head">
        <TargetIcon size={13} />
        <span className="upsolve__title">Upsolve queue</span>
        {state && state.summary.done > 0 && (
          <span className="tag tag--ok">{state.summary.done} done</span>
        )}
        <button
          type="button"
          className="iconbtn"
          disabled={busy}
          onClick={() => void load(true)}
        >
          <RefreshIcon size={12} />
          {busy ? 'Reading…' : 'Read my contests'}
        </button>
      </div>

      {state?.error && <div className="banner banner--error">{state.error}</div>}

      {state && !state.error && pending.length === 0 && (
        <div className="upsolve__empty">
          {state.items.length === 0
            ? 'Nothing here yet. "Read my contests" pulls the problems your last three rated Codeforces rounds left unsolved.'
            : 'Every problem from your recent contests is solved. That is the whole point.'}
        </div>
      )}

      {[...pending].sort((a, b) => order[a.state] - order[b.state] || b.contestId - a.contestId)
        .slice(0, 12)
        .map((item) => (
          <button
            key={item.id}
            type="button"
            className="upsolve__row"
            onClick={() => openUrl(item.url)}
          >
            <span className={`upsolve__state upsolve__state--${item.state}`}>
              {item.state === 'failed' ? `${item.attempts}×` : '—'}
            </span>
            <span className="upsolve__name">
              {item.index}. {item.name}
            </span>
            <span className="upsolve__contest">{item.contestName}</span>
          </button>
        ))}

      {pending.length > 0 && (
        <div className="upsolve__note">
          A number means you submitted that many times during the round and none passed. A dash
          means you never opened it.
        </div>
      )}
    </section>
  );
}

function RatingCard() {
  const [profiles, setProfiles] = useState<RatingProfiles | null>(null);
  const [prediction, setPrediction] = useState<Prediction | undefined>();
  const [predictError, setPredictError] = useState<string | null>(null);
  const [predicting, setPredicting] = useState(false);

  useEffect(() => {
    void send({ type: 'rating:profiles' })
      .then(setProfiles)
      .catch(() => setProfiles({ errors: {} }));
  }, []);

  if (!profiles) return <div className="empty">Loading rating…</div>;

  const { codeforces, leetcode, errors } = profiles;
  if (!codeforces && !leetcode && !errors.codeforces && !errors.leetcode) {
    return (
      <div className="banner">
        Add your Codeforces handle or LeetCode username in Settings to see your contest rating —
        and, on Codeforces, what the last contest will do to it.
      </div>
    );
  }

  const predicted = prediction?.prediction;

  return (
    <section className="ratings">
      {codeforces && (
        <div className="rating">
          <div className="rating__head">
            <PlatformMark platform="codeforces" size={22} />
            <span className="rating__handle">{codeforces.handle}</span>
            <span className="rating__band" style={{ color: codeforces.colour }}>
              {codeforces.rank}
            </span>
          </div>

          <div className="rating__value">
            {codeforces.rating ?? '—'}
            {predicted && (
              <span className={`rating__delta ${predicted.delta >= 0 ? 'is-up' : 'is-down'}`}>
                {predicted.delta >= 0 ? '+' : ''}
                {predicted.delta} → <strong>{predicted.newRating}</strong>
              </span>
            )}
          </div>

          <div className="rating__facts">
            {[
              codeforces.maxRating && `peak ${codeforces.maxRating}`,
              codeforces.last && `last: ${codeforces.last.name} — rank ${codeforces.last.rank}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>

          {codeforces.goal && <GoalBar goal={codeforces.goal} />}

          {predicted && prediction && (
            <div className="card__hint">
              <strong>{prediction.contestName}</strong> — rank {predicted.rank} of{' '}
              {prediction.participants}, seeded {Math.round(predicted.seed)}. Codeforces' own
              algorithm on the real standings; the official figure lands when they apply ratings.
            </div>
          )}

          {prediction === undefined && !predicting && !predictError && (
            <div className="rating__note">
              No unrated contest found — nothing to predict right now.
            </div>
          )}
          {predictError && <div className="rating__note is-bad">{predictError}</div>}

          <div className="card__actions">
            <button
              type="button"
              disabled={predicting}
              onClick={async () => {
                setPredicting(true);
                setPredictError(null);
                try {
                  const result = await send({ type: 'rating:predict' });
                  setPrediction(result.prediction);
                  setPredictError(result.error ?? null);
                } finally {
                  setPredicting(false);
                }
              }}
            >
              {predicting ? 'Working — this takes a moment…' : 'Predict the last contest'}
            </button>
          </div>
        </div>
      )}

      {leetcode && (
        <div className="rating">
          <div className="rating__head">
            <PlatformMark platform="leetcode" size={22} />
            <span className="rating__handle">{leetcode.username}</span>
            <span className="rating__band">{leetcode.attended} contests</span>
          </div>

          <div className="rating__value">
            {leetcode.rating !== undefined ? Math.round(leetcode.rating) : '—'}
          </div>

          <div className="rating__facts">
            {[
              leetcode.globalRanking && `global #${leetcode.globalRanking.toLocaleString()}`,
              leetcode.topPercentage !== undefined && `top ${leetcode.topPercentage.toFixed(1)}%`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>

          {leetcode.last && (
            <div className="rating__note">
              {leetcode.last.rated
                ? `${leetcode.last.title}: rank ${leetcode.last.ranking.toLocaleString()}, rating applied.`
                : `${leetcode.last.title}: rank ${leetcode.last.ranking.toLocaleString()} — rating usually lands a day later.`}
            </div>
          )}

          <div className="card__hint">
            LeetCode publishes your rating but not the other entrants', so a prediction cannot be
            computed here. Doing it would mean sending your username to somebody else's server,
            which this extension does not do.
          </div>
        </div>
      )}

      {errors.codeforces && <div className="banner banner--error">Codeforces: {errors.codeforces}</div>}
      {errors.leetcode && <div className="banner banner--error">LeetCode: {errors.leetcode}</div>}
    </section>
  );
}

function ContestRow({ contest, now }: { contest: Contest; now: number }) {
  const start = new Date(contest.startAt);
  return (
    <div className="card">
      <div className="card__top">
        <div className="card__title">{contest.name}</div>
        <span className="chip">{PLATFORM_SHORT[contest.platform] ?? contest.platform}</span>
      </div>
      <div className="card__meta">
        <span className="chip chip--ok">{formatStartsIn(contest.startAt, now)}</span>
        <span>
          {start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
          {', '}
          {start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </span>
        {contest.durationMs > 0 && (
          <>
            <span>·</span>
            <span>{formatDuration(contest.durationMs)}</span>
          </>
        )}
      </div>
      <div className="card__actions">
        <button type="button" onClick={() => openUrl(contest.url)}>
          Open
        </button>
        <button type="button" onClick={() => openUrl(calendarUrl(contest))}>
          Add to calendar
        </button>
      </div>
    </div>
  );
}

/**
 * Why submissions get rejected, from the attempt journal.
 *
 * Every other tracker can tell somebody how many problems they have solved.
 * Only this one kept the verdict of each failed submission, so only this one
 * can say the thing that is actually useful: what goes wrong, and where.
 */
function FailureReport({ problems }: { problems: SolvedProblem[] }) {
  const report = useMemo(() => buildFailureReport(problems), [problems]);
  const headline = describeHeadline(report);
  const struggling = useMemo(() => strugglingTopics(report), [report]);

  if (report.failures === 0) {
    return (
      <>
        <div className="section-title">Why submissions fail</div>
        <div className="empty">
          {report.submits === 0
            ? 'Nothing recorded yet. Every run and submit gets journalled from the next problem you open.'
            : 'No rejected submissions on record — every submit so far has passed.'}
        </div>
      </>
    );
  }

  const kinds = (Object.entries(report.byKind) as Array<[FailureKind, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="section-title">Why submissions fail</div>
      {headline && <div className="insight">{headline}</div>}

      {kinds.map(([kind, count]) => (
        <div className="bar-row" key={kind}>
          <div>
            <div className="bar-row__label bar-row__label--exact">{failureLabel(kind)}</div>
            <div className="bar">
              <div
                className={`bar__fill bar__fill--${kind}`}
                style={{ width: `${(count / report.failures) * 100}%` }}
              />
            </div>
          </div>
          <div className="bar-row__value">{count}</div>
        </div>
      ))}

      {struggling.length > 0 && (
        <>
          <div className="section-title">Costs you the most tries</div>
          {struggling.map((topic) => (
            <div className="bar-row" key={topic.tag}>
              <div>
                <div className="bar-row__label" title={`${topic.submits} submits over ${topic.solved} problems`}>
                  {topic.tag}
                </div>
                <div className="bar">
                  <div
                    className="bar__fill bar__fill--wrong"
                    style={{ width: `${Math.min(100, topic.submitsPerSolve * 25)}%` }}
                  />
                </div>
              </div>
              <div className="bar-row__value">{topic.submitsPerSolve.toFixed(1)}×</div>
            </div>
          ))}
          <div className="insight insight--quiet">
            Submissions per accepted problem. 1.0 would be first time, every time.
          </div>
        </>
      )}

      {report.firstFailures.length > 0 && (
        <>
          <div className="section-title">Recent first-try misses</div>
          {report.firstFailures.slice(0, 5).map((entry) => (
            <button
              key={entry.url}
              type="button"
              className="upsolve__row"
              onClick={() => openUrl(entry.url)}
            >
              <span className="upsolve__state upsolve__state--failed">{entry.verdict}</span>
              <span className="upsolve__name">{entry.title}</span>
            </button>
          ))}
        </>
      )}
    </>
  );
}

/** The signals behind a topic's score, so the number is never a black box. */
function describeTopic(topic: TopicStat): string {
  const parts = [
    `${topic.solved} solved`,
    `${topic.lapses} forgotten on review`,
    `${topic.totalAttempts} total attempts`,
  ];
  if (topic.hintsUsed > 0) parts.push(`${topic.hintsUsed} hints used`);
  if (topic.medianSolveMs) {
    parts.push(`median ${Math.max(1, Math.round(topic.medianSolveMs / 60_000))} min`);
  }
  return parts.join(' · ');
}

function TopicBars({ topics, title }: { topics: TopicStat[]; title: string }) {
  if (topics.length === 0) return null;
  return (
    <>
      <div className="section-title">{title}</div>
      {topics.map((topic) => (
        <div className="bar-row" key={topic.tag}>
          <div>
            <div className="bar-row__label" title={describeTopic(topic)}>
              {topic.tag}
            </div>
            <div className="bar">
              <div className="bar__fill" style={{ width: `${topic.mastery}%` }} />
            </div>
          </div>
          <div className="bar-row__value">{topic.mastery}</div>
        </div>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ charts */

/** Solved problems per rating, in Codeforces' own rank colours. */
function Histogram({ bins, onPick }: { bins: Bin[]; onPick: (bin: Bin) => void }) {
  if (bins.length === 0) return null;
  const peak = Math.max(...bins.map((bin) => bin.count));

  return (
    <div className="hist">
      {bins.map((bin) => (
        <button
          key={bin.rating}
          type="button"
          className="hist__col"
          title={`${bin.count} solved at ${bin.rating}`}
          onClick={() => onPick(bin)}
        >
          <span className="hist__count">{bin.count}</span>
          <span
            className="hist__bar"
            style={{
              height: `${Math.max(3, (bin.count / peak) * 100)}%`,
              background: ratingColour(bin.rating),
            }}
          />
          <span className="hist__label">{bin.rating}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The tag breakdown, as a doughnut.
 *
 * Drawn with `stroke-dasharray` on one circle per slice rather than with arc
 * paths — the maths is a running offset instead of trigonometry, and it stays
 * readable.
 */
function Doughnut({ tags }: { tags: TagCount[] }) {
  const top = tags.slice(0, 10);
  const total = top.reduce((sum, entry) => sum + entry.solved, 0);
  if (total === 0) return null;

  const R = 42;
  const CIRC = 2 * Math.PI * R;
  let offset = 0;

  // Ten steps around the accent's hue, so slices are distinguishable without
  // introducing a second palette.
  const colourFor = (index: number) => `hsl(${(22 + index * 34) % 360} 70% 58%)`;

  return (
    <div className="dough">
      <svg viewBox="0 0 100 100" className="dough__svg" aria-hidden="true">
        {top.map((entry, index) => {
          const length = (entry.solved / total) * CIRC;
          const dash = `${length} ${CIRC - length}`;
          const slice = (
            <circle
              key={entry.tag}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={colourFor(index)}
              strokeWidth="14"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            />
          );
          offset += length;
          return slice;
        })}
      </svg>
      <ul className="dough__key">
        {top.map((entry, index) => (
          <li key={entry.tag}>
            <span className="dough__dot" style={{ background: colourFor(index) }} />
            <span className="dough__tag">{entry.tag}</span>
            <span className="dough__n mono">{entry.solved}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A year of days, coloured by the hardest problem solved on each.
 *
 * Codeforces' own heatmap counts problems, so a day of ten 800s outshines a day
 * with one 2400 — which is backwards as a picture of progress.
 */
function Heatmap({ heat, years }: { heat: Record<string, HeatDay>; years: number[] }) {
  const [year, setYear] = useState(years[0] ?? new Date().getUTCFullYear());
  const grid = useMemo(() => heatmapGrid(year), [year]);

  if (years.length === 0) return null;

  return (
    <>
      <div className="heat__head">
        <span className="faint">Colour is the hardest problem that day</span>
        <select
          className="heat__year"
          value={year}
          onChange={(event) => setYear(Number(event.target.value))}
        >
          {years.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <div className="heat">
        <div className="heat__grid">
          {grid.map((column, index) => (
            <div className="heat__col" key={index}>
              {column.map((day, row) => {
                const entry = day ? heat[day] : undefined;
                return (
                  <span
                    key={day || `${index}-${row}`}
                    className={`heat__day ${day ? '' : 'is-blank'}`}
                    style={entry ? { background: ratingColour(entry.peak || undefined) } : undefined}
                    title={
                      entry
                        ? `${day} — ${entry.count} solved, hardest ${entry.peak || 'unrated'}`
                        : day || undefined
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Solved against abandoned, per tag or per band. */
function OutcomeBars({
  rows,
}: {
  rows: Array<{ label: string; solved: number; unsolved: number }>;
}) {
  if (rows.length === 0) return null;

  return (
    <>
      {rows.map((row) => {
        const total = row.solved + row.unsolved;
        return (
          <div className="bar-row" key={row.label}>
            <div>
              <div className="bar-row__label">{row.label}</div>
              <div className="bar bar--split">
                <span
                  className="bar__seg bar__seg--ok"
                  style={{ width: `${(row.solved / total) * 100}%` }}
                />
                <span
                  className="bar__seg bar__seg--bad"
                  style={{ width: `${(row.unsolved / total) * 100}%` }}
                />
              </div>
            </div>
            <div className="bar-row__value">{Math.round((row.unsolved / total) * 100)}%</div>
          </div>
        );
      })}
      <div className="insight insight--quiet">
        Green is solved, red is attempted and never accepted. The number is how often it beat you.
      </div>
    </>
  );
}

/**
 * The Codeforces half of the Stats tab.
 *
 * Loaded on its own rather than with the dashboard: it needs the mirror, which
 * may have to be fetched, and the rest of the tab should not wait for it.
 */
function CodeforcesInsights() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [opened, setOpened] = useState<Bin | null>(null);

  useEffect(() => {
    void send({ type: 'insights:get' })
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) return <div className="empty">Reading your Codeforces history…</div>;
  if (data.reason) return <div className="banner">{data.reason}</div>;

  return (
    <>
      <div className="section-title">Activity</div>
      <Heatmap heat={data.heat} years={data.years} />

      <div className="section-title">Solved by rating ({data.solvedCount})</div>
      <Histogram bins={data.histogram} onPick={(bin) => setOpened(bin === opened ? null : bin)} />
      {opened && (
        <div className="bin">
          <div className="faint">
            {opened.count} at {opened.rating}
          </div>
          {opened.keys.slice(0, 24).map((key) => (
            <button
              key={key}
              type="button"
              className="label"
              onClick={() => openUrl(problemUrl(key))}
            >
              {key}
            </button>
          ))}
        </div>
      )}

      <div className="section-title">Topics</div>
      <Doughnut tags={data.tags} />

      {data.weakTags.length > 0 && (
        <>
          <div className="section-title">Where you give up</div>
          <OutcomeBars
            rows={data.weakTags.map((entry) => ({
              label: entry.tag,
              solved: entry.solved,
              unsolved: entry.unsolved,
            }))}
          />
        </>
      )}

      {data.weakBands.length > 0 && (
        <>
          <div className="section-title">Hardest bands</div>
          <OutcomeBars
            rows={data.weakBands.map((entry) => ({
              label: String(entry.rating),
              solved: entry.solved,
              unsolved: entry.unsolved,
            }))}
          />
        </>
      )}

      {data.unsolved.length > 0 && (
        <>
          <div className="section-title">Attempted, never solved ({data.unsolved.length})</div>
          {data.unsolved.slice(0, 12).map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="upsolve__row"
              onClick={() => openUrl(problemUrl(entry.key))}
            >
              <span className="upsolve__state mono" style={{ color: ratingColour(entry.rating) }}>
                {entry.rating ?? '—'}
              </span>
              <span className="upsolve__name">{entry.name}</span>
              <span className="upsolve__contest">{entry.tags[0] ?? ''}</span>
            </button>
          ))}
        </>
      )}
    </>
  );
}

/**
 * Home: what to do in the next hour.
 *
 * Deliberately the first tab. Every other one answers a question you have to
 * think to ask — what have I solved, how am I doing, what is coming up. This
 * one answers the question you already had when you opened the panel.
 */
function HomeTab({ onOpenDue }: { onOpenDue: () => void }) {
  const [data, setData] = useState<HomeData | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (action?: () => Promise<HomeData>) => {
    setBusy(true);
    try {
      setData(await (action ? action() : send({ type: 'daily:get' })));
    } catch {
      // The mirror or the service worker being cold is not worth an error
      // screen on the tab that is meant to get you started.
      setData((current) => current);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return <div className="empty">Loading…</div>;

  const { streak, daily, dailyState } = data;
  const pick = daily?.main;

  return (
    <>
      <section className="home__streak">
        <div className="home__flame">
          <FlameIcon size={17} />
          <span className="home__count">{streak.current}</span>
          <span className="home__unit">day{streak.current === 1 ? '' : 's'}</span>
        </div>
        <div className="home__facts">
          <span>{data.solvedToday} solved today</span>
          {streak.longest > streak.current && <span>best {streak.longest}</span>}
          {data.solveStreak > 0 && <span>{data.solveStreak}-day solving streak</span>}
        </div>
      </section>

      {data.calendar.length > 0 && (
        <div className="cal" role="img" aria-label="The last five weeks">
          {data.calendar.map((cell) => (
            <span key={cell.day} className={`cal__day cal__day--${cell.state}`} title={cell.day} />
          ))}
        </div>
      )}

      <div className="section-title">Today&rsquo;s problem</div>

      {data.reason && <div className="banner">{data.reason}</div>}

      {pick && (
        <div className={`daily ${dailyState === 'done' ? 'is-done' : ''}`}>
          <div className="daily__top">
            <span className="daily__key mono">{pick.key}</span>
            <span className="daily__rating" style={{ color: ratingColour(pick.rating) }}>
              {pick.rating || '—'}
            </span>
            {dailyState === 'done' && <span className="chip chip--ok">Solved</span>}
            {dailyState === 'skipped' && <span className="chip">Skipped</span>}
          </div>
          <div className="daily__name">{pick.name}</div>
          {pick.tags.length > 0 && (
            <div className="daily__tags">{pick.tags.slice(0, 4).join(' · ')}</div>
          )}
          <div className="card__actions">
            <button type="button" className="primary" onClick={() => openUrl(pick.url)}>
              Open
            </button>
            {dailyState === 'open' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void load(() => send({ type: 'backlog:add', key: pick.key }))}
                >
                  Keep for later
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  title="Ends the streak — use “Keep for later” if you mean to come back to it"
                  onClick={() => void load(() => send({ type: 'daily:skip' }))}
                >
                  Skip
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {daily && (daily.easy || daily.hard) && (
        <>
          <div className="section-title">Or pick a different one</div>
          <div className="trio">
            {[daily.easy, daily.medium, daily.hard]
              .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
              .map((entry) => (
                <button key={entry.key} type="button" className="trio__cell" onClick={() => openUrl(entry.url)}>
                  {/* The coloured rating already says how hard it is — in
                      Codeforces' own rank colours — so the label carries the
                      other thing worth knowing. "Easier / A reach" would also
                      be a lie whenever the search had to walk up past a band
                      you have finished. */}
                  <span className="trio__label">{entry.tags[0] ?? 'untagged'}</span>
                  <span className="trio__rating" style={{ color: ratingColour(entry.rating) }}>
                    {entry.rating}
                  </span>
                  <span className="trio__name">{entry.name}</span>
                </button>
              ))}
          </div>
        </>
      )}

      <div className="section-title">
        Due now {data.dueTotal > 0 && <span className="tag tag--due">{data.dueTotal}</span>}
      </div>
      {data.due.length === 0 ? (
        <div className="empty">Nothing due. The next one appears when its interval comes round.</div>
      ) : (
        <>
          {data.due.map((problem) => (
            <button key={problem.id} type="button" className="upsolve__row" onClick={onOpenDue}>
              <span className="upsolve__state">{PLATFORM_SHORT[problem.platform] ?? '··'}</span>
              <span className="upsolve__name">{problem.title}</span>
              <span className={`upsolve__contest ${problem.dueAt <= data.now ? 'is-overdue' : ''}`}>
                {formatDueIn(problem.dueAt, data.now)}
              </span>
            </button>
          ))}
          {data.dueTotal > data.due.length && (
            <button type="button" className="ghost" style={{ marginTop: 8 }} onClick={onOpenDue}>
              See all {data.dueTotal}
            </button>
          )}
        </>
      )}

      {data.backlog.length > 0 && (
        <>
          <div className="section-title">Kept for later</div>
          {data.backlog.map((entry) => (
            <div key={entry.key} className="upsolve__row" style={{ cursor: 'default' }}>
              <span className="upsolve__state mono" style={{ color: ratingColour(entry.rating) }}>
                {entry.rating || '—'}
              </span>
              <button type="button" className="upsolve__name link" onClick={() => openUrl(entry.url)}>
                {entry.name}
              </button>
              <button
                type="button"
                className="iconbtn"
                disabled={busy}
                onClick={() => void load(() => send({ type: 'backlog:remove', key: entry.key }))}
              >
                Remove
              </button>
            </div>
          ))}
        </>
      )}
    </>
  );
}

export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contests, setContests] = useState<ContestsResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);
  const [query, setQuery] = useState('');
  const [label, setLabel] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('home');

  const load = useCallback(async () => {
    try {
      setData(await send({ type: 'dashboard:get' }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The side panel stays open across navigation, so without this it shows
   * whatever was true when it was opened — a problem solved while it is on
   * screen never appears, which reads exactly like the solve was not recorded.
   */
  useEffect(() => {
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      if (!('problems' in changes) && !('meta' in changes) && !('settings' in changes)) return;
      void load();
    };

    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [load]);

  // Contests are fetched only when their tab is first opened, so the popup
  // does not wait on four judges just to show the due list.
  useEffect(() => {
    if (tab !== 'contests' || contests) return;
    void send({ type: 'contests:get' })
      .then(setContests)
      // An unreachable service worker still needs to end the loading state.
      .catch(() => setContests({ contests: [], fetchedAt: 0, failed: [], now: Date.now() }));
  }, [tab, contests]);

  const handleReview = useCallback(
    async (id: string, recall: Recall) => {
      await send({ type: 'problem:review', id, recall });
      await load();
    },
    [load],
  );

  const handleResync = useCallback(
    async (id: string) => {
      await send({ type: 'problem:resync', id });
      await load();
    },
    [load],
  );

  const handleResyncParikshaa = useCallback(
    async (id: string) => {
      await send({ type: 'problem:resync-parikshaa', id });
      await load();
    },
    [load],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await send({ type: 'problem:delete', id });
      await load();
    },
    [load],
  );

  const handleSaveDetails = useCallback(
    async (id: string, note: string, complexity: { time?: string; space?: string }) => {
      await send({ type: 'problem:details', id, note, complexity });
      await load();
    },
    [load],
  );

  const handleSaveLabels = useCallback(
    async (id: string, labels: string[]) => {
      await send({ type: 'problem:labels', id, labels });
      await load();
    },
    [load],
  );

  /**
   * A sync that failed stays failed — nothing re-drives it. Fixing the token is
   * the usual remedy, and that happens after the failure, so the problems it
   * would have covered need a way back.
   */
  const failedSyncs = useMemo(
    () => (data ? data.problems.filter((problem) => problem.github.status === 'error') : []),
    [data],
  );

  const handleRetryFailed = useCallback(async () => {
    setRetryingAll(true);
    try {
      // Serially: the service worker already queues commits, and a burst only
      // multiplies the same failure if the cause has not been fixed.
      for (const problem of failedSyncs) {
        await send({ type: 'problem:resync', id: problem.id });
      }
      await load();
    } finally {
      setRetryingAll(false);
    }
  }, [failedSyncs, load]);

  /** Title, tag, label and language, because those are how people look. */
  const matches = useCallback(
    (problem: SolvedProblem) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return (
        problem.title.toLowerCase().includes(needle) ||
        problem.slug.toLowerCase().includes(needle) ||
        problem.language.toLowerCase().includes(needle) ||
        problem.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
        (problem.labels ?? []).some((label) => label.includes(needle))
      );
    },
    [query],
  );

  const labels = useMemo(
    () => (data ? countLabels(data.problems, data.now) : []),
    [data],
  );

  const folders = useMemo(() => {
    if (!data) return [];
    const pool = label ? withLabel(data.problems, label) : data.problems;
    const grouped = new Map<string, SolvedProblem[]>();
    for (const problem of pool) {
      if (!matches(problem)) continue;
      grouped.set(problem.platform, [...(grouped.get(problem.platform) ?? []), problem]);
    }
    return [...grouped.entries()]
      .map(([platform, problems]) => ({
        platform,
        // Most recently solved first inside a folder; the panel's own sort is
        // by due date, which is the wrong order for browsing what you have done.
        problems: [...problems].sort((a, b) => b.solvedAt - a.solvedAt),
      }))
      .sort((a, b) => b.problems.length - a.problems.length);
  }, [data, matches, label]);

  const due = useMemo(
    () => (data ? dueProblems(data.problems, data.now) : []),
    [data],
  );
  /** Due yesterday or earlier — the ones actually slipping, not today's queue. */
  const overdueCount = useMemo(
    () =>
      data
        ? due.filter((problem) => data.now - problem.revision.dueAt > 86_400_000).length
        : 0,
    [due, data],
  );
  const upcoming = useMemo(
    () => (data ? upcomingProblems(data.problems, data.now, 3) : []),
    [data],
  );

  if (error) {
    return (
      <div className="shell">
        <div className="scroll">
          <div className="banner banner--error">{error}</div>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="shell">
        <div className="empty">Loading…</div>
      </div>
    );
  }

  const githubOff = !data.settings.github.enabled;

  return (
    <div className="shell">
      <header className="shell__header">
        <span className="brand">
          <span className="brand__mark" aria-hidden="true">↻</span>
          <span className="shell__title">Redo</span>
        </span>
        <span className="shell__spacer" />
        <button
          type="button"
          className="ghost iconbtn"
          onClick={() => void chrome.runtime.openOptionsPage()}
        >
          <GearIcon size={13} />
          Settings
        </button>
      </header>

      <nav className="tabs" role="tablist">
        {(
          [
            ['home', 'Home'],
            ['due', `Due${due.length > 0 ? ` (${due.length})` : ''}`],
            ['all', `Solved (${data.stats.total})`],
            ['contests', 'Contests'],
            ['stats', 'Stats'],
          ] as Array<[Tab, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="scroll">
        {tab === 'home' && <HomeTab onOpenDue={() => setTab('due')} />}

        {tab === 'due' && (
          <>
            {due.length === 0 ? (
              <Empty title="Nothing due right now">
                {data.stats.total === 0
                  ? 'Solve a problem on LeetCode or Codeforces and it will show up here.'
                  : 'Come back when the next problem comes around.'}
                {/* The one moment there is genuinely nothing to do here. */}
                <div style={{ marginTop: 12 }}>
                  Want something to solve?{' '}
                  <a href={PARIKSHAA_URL} target="_blank" rel="noreferrer">
                    Pick a sheet on Parikshaa
                  </a>{' '}
                  — solves there get ticked off automatically.
                </div>
                {upcoming.length > 0 && (
                  <div style={{ marginTop: 16, textAlign: 'left' }}>
                    <div className="section-title">Coming up</div>
                    {upcoming.map((problem) => (
                      <div className="bar-row" key={problem.id}>
                        <div className="bar-row__label">{problem.title}</div>
                        <div className="bar-row__value">
                          {formatDueIn(problem.revision.dueAt, data.now).replace('in ', '')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Empty>
            ) : (
              <>
                <div className="duehead">
                  <div className="duehead__stats">
                    <span className="duestat duestat--due">
                      <ClockIcon size={13} />
                      <strong>{due.length}</strong> due
                    </span>
                    {overdueCount > 0 && (
                      <span className="duestat duestat--late">
                        <AlertIcon size={13} />
                        <strong>{overdueCount}</strong> overdue
                      </span>
                    )}
                    {data.stats.currentStreak > 0 && (
                      <span className="duestat duestat--streak">
                        <FlameIcon size={13} />
                        <strong>{data.stats.currentStreak}</strong> day streak
                      </span>
                    )}
                    <span className="duestat">
                      <TrophyIcon size={13} />
                      <strong>{data.stats.reviewsCompleted}</strong> reviews
                    </span>
                  </div>
                  <p className="duehead__hint">
                    Re-solve each one on the site first, then rate how it went — the rating decides
                    when you see it again.
                  </p>
                </div>
                {due.map((problem) => (
                  <ProblemCard
                    key={problem.id}
                    problem={problem}
                    now={data.now}
                    onReview={(id, recall) => void handleReview(id, recall)}
                    onResync={(id) => void handleResync(id)}
                    onResyncParikshaa={(id) => void handleResyncParikshaa(id)}
                    onDelete={(id) => void handleDelete(id)}
                    onSaveDetails={handleSaveDetails}
                    onSaveLabels={(id, next) => void handleSaveLabels(id, next)}
                    labelSuggestions={suggestionsFor(problem.labels, labels)}
                    showRecall
                  />
                ))}
              </>
            )}
          </>
        )}

        {tab === 'all' && (
          <>
            {githubOff && (
              <div className="banner">
                GitHub sync is off — solutions are only stored in this browser. Turn it on in
                Settings to back them up.
              </div>
            )}
            {failedSyncs.length > 0 && (
              <div className="banner banner--error">
                <div>
                  {failedSyncs.length === 1
                    ? '1 solution could not reach GitHub.'
                    : `${failedSyncs.length} solutions could not reach GitHub.`}{' '}
                  {failedSyncs[0]?.github.error}
                </div>
                <button
                  type="button"
                  className="ghost"
                  style={{ marginTop: 8 }}
                  disabled={retryingAll}
                  onClick={() => void handleRetryFailed()}
                >
                  {retryingAll ? 'Retrying…' : 'Retry these'}
                </button>
              </div>
            )}
            {data.problems.length === 0 ? (
              <Empty title="No solved problems yet">
                Solve something on LeetCode or Codeforces with the extension installed.
              </Empty>
            ) : (
              <>
                <div className="search">
                  <SearchIcon size={13} />
                  <input
                    type="text"
                    value={query}
                    placeholder="Filter by title, tag, label or language"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query && (
                    <button type="button" className="ghost" onClick={() => setQuery('')}>
                      Clear
                    </button>
                  )}
                </div>

                {labels.length > 0 && (
                  <div className="labelbar">
                    <button
                      type="button"
                      className={`label label--filter ${label === null ? 'is-on' : ''}`}
                      onClick={() => setLabel(null)}
                    >
                      All
                    </button>
                    {labels.map((entry) => (
                      <button
                        key={entry.label}
                        type="button"
                        className={`label label--filter ${label === entry.label ? 'is-on' : ''}`}
                        onClick={() => setLabel(label === entry.label ? null : entry.label)}
                      >
                        <TagIcon size={10} />
                        {entry.label}
                        <span className="label__count">{entry.count}</span>
                        {entry.due > 0 && <span className="label__due">{entry.due} due</span>}
                      </button>
                    ))}
                  </div>
                )}

                {folders.length === 0 ? (
                  <Empty title="Nothing matches">Try a different word, or clear the filter.</Empty>
                ) : (
                  folders.map(({ platform, problems }) => (
                    <PlatformFolder
                      key={platform}
                      platform={platform}
                      problems={problems}
                      now={data.now}
                      // A filter is a search: opening the folders is the answer.
                      // Otherwise only the busiest judge starts open.
                      defaultOpen={
                        query.length > 0 || label !== null || platform === folders[0]?.platform
                      }
                    >
                      {(problem) => (
                        <ProblemCard
                          key={problem.id}
                          problem={problem}
                          now={data.now}
                          onReview={(id, recall) => void handleReview(id, recall)}
                          onResync={(id) => void handleResync(id)}
                          onResyncParikshaa={(id) => void handleResyncParikshaa(id)}
                          onDelete={(id) => void handleDelete(id)}
                          onSaveDetails={handleSaveDetails}
                          onSaveLabels={(id, next) => void handleSaveLabels(id, next)}
                          labelSuggestions={suggestionsFor(problem.labels, labels)}
                          showRecall={false}
                          collapsible
                        />
                      )}
                    </PlatformFolder>
                  ))
                )}
              </>
            )}
          </>
        )}

        {tab === 'contests' && (
          <>
            <RatingCard />
            <UpsolveCard />
            {!contests ? (
              <div className="empty">Loading contests…</div>
            ) : contests.contests.length === 0 ? (
              <Empty title="No upcoming contests found">
                {contests.failed.length > 0
                  ? `Could not reach ${contests.failed.join(', ')}. Try refreshing.`
                  : 'Nothing scheduled in the next 30 days on the judges you follow.'}
              </Empty>
            ) : (
              <>
                {contests.failed.length > 0 && (
                  <div className="banner banner--error">
                    Could not reach {contests.failed.join(', ')} — that judge's contests are
                    missing from this list.
                  </div>
                )}
                {contests.contests.map((contest) => (
                  <ContestRow key={contest.id} contest={contest} now={contests.now} />
                ))}
              </>
            )}
            <div className="card__actions" style={{ marginTop: 4 }}>
              <button
                type="button"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    setContests(await send({ type: 'contests:refresh' }));
                  } finally {
                    setRefreshing(false);
                  }
                }}
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </>
        )}

        {tab === 'stats' && (
          <>
            <WrappedCard problems={data.problems} now={data.now} streak={data.stats.currentStreak} />
            <div className="stat-grid">
              <div className="stat">
                <div className="stat__value">{data.stats.total}</div>
                <div className="stat__label">problems solved</div>
              </div>
              <div className="stat">
                <div className="stat__value">{data.stats.currentStreak}</div>
                <div className="stat__label">day streak</div>
              </div>
              <div className="stat">
                <div className="stat__value">{data.stats.reviewsCompleted}</div>
                <div className="stat__label">revisions done</div>
              </div>
              <div className="stat">
                <div className="stat__value">{data.stats.dueToday}</div>
                <div className="stat__label">due now</div>
              </div>
            </div>

            <div className="section-title">Difficulty</div>
            {(['easy', 'medium', 'hard'] as const).map((level) => {
              const count = data.stats.byDifficulty[level];
              const percent = data.stats.total === 0 ? 0 : (count / data.stats.total) * 100;
              return (
                <div className="bar-row" key={level}>
                  <div>
                    <div className="bar-row__label">{level}</div>
                    <div className="bar">
                      <div className="bar__fill" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                  <div className="bar-row__value">{count}</div>
                </div>
              );
            })}

            <FailureReport problems={data.problems} />

            <CodeforcesInsights />

            <TopicBars topics={data.stats.weakestTopics} title="Needs work" />
            <TopicBars topics={data.stats.strongestTopics} title="Solid" />

            {data.stats.total === 0 && (
              <Empty title="Nothing to chart yet">
                Topic mastery appears once a few problems are tracked.
              </Empty>
            )}
          </>
        )}
      </div>
    </div>
  );
}

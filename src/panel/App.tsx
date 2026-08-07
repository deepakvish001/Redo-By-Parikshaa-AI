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
import { buildWrappedSvg, summariseWeek, wrappedCaption } from '../core/wrapped.ts';
import { send, type ContestsResponse, type DashboardData } from '../core/messages.ts';
import { dueProblems, formatDueIn, upcomingProblems } from '../core/srs.ts';
import { PLATFORM_LABELS, type Difficulty, type Recall, type SolvedProblem, type TopicStat } from '../core/types.ts';
import {
  AlertIcon,
  ChevronRight,
  ClockIcon,
  FlameIcon,
  GearIcon,
  PlatformMark,
  SearchIcon,
  SparkIcon,
  TrophyIcon,
} from './icons.tsx';
import { copyPng, downloadPng } from './share.ts';

type Tab = 'due' | 'all' | 'contests' | 'stats';

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

function ProblemCard({
  problem,
  now,
  onReview,
  onResync,
  onResyncParikshaa,
  onDelete,
  onSaveDetails,
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

export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contests, setContests] = useState<ContestsResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('due');

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

  /** Title, tag and language, because those are the three ways people look. */
  const matches = useCallback(
    (problem: SolvedProblem) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return (
        problem.title.toLowerCase().includes(needle) ||
        problem.slug.toLowerCase().includes(needle) ||
        problem.language.toLowerCase().includes(needle) ||
        problem.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    },
    [query],
  );

  const folders = useMemo(() => {
    if (!data) return [];
    const grouped = new Map<string, SolvedProblem[]>();
    for (const problem of data.problems) {
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
  }, [data, matches]);

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
                    placeholder="Filter by title, tag or language"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query && (
                    <button type="button" className="ghost" onClick={() => setQuery('')}>
                      Clear
                    </button>
                  )}
                </div>

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
                      defaultOpen={query.length > 0 || platform === folders[0]?.platform}
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

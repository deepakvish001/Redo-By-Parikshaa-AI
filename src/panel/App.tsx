import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  calendarUrl,
  formatDuration,
  formatStartsIn,
  type Contest,
} from '../core/contests.ts';
import { send, type ContestsResponse, type DashboardData } from '../core/messages.ts';
import { dueProblems, formatDueIn, upcomingProblems } from '../core/srs.ts';
import type { Difficulty, Recall, SolvedProblem, TopicStat } from '../core/types.ts';

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

function DifficultyChip({ difficulty }: { difficulty: Difficulty }) {
  if (difficulty === 'unknown') return null;
  return <span className={`chip chip--${difficulty}`}>{difficulty}</span>;
}

function SyncChip({ problem }: { problem: SolvedProblem }) {
  const { status, commitUrl, error } = problem.github;
  if (status === 'synced') {
    return (
      <span className="chip chip--ok" title={commitUrl || undefined}>
        synced
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="chip chip--overdue" title={error}>
        sync failed
      </span>
    );
  }
  return <span className="chip">{status === 'pending' ? 'syncing' : 'local only'}</span>;
}

function ParikshaaChip({ problem }: { problem: SolvedProblem }) {
  const state = problem.parikshaa;
  // Older records predate Parikshaa sync and simply have nothing to show.
  if (!state || state.status === 'disabled') return null;

  if (state.status === 'synced') {
    return (
      <span className="chip chip--ok" title={state.url}>
        parikshaa ✓
      </span>
    );
  }
  if (state.status === 'error') {
    return (
      <span className="chip chip--overdue" title={state.error}>
        parikshaa failed
      </span>
    );
  }
  if (state.status === 'skipped') {
    return (
      <span className="chip" title={state.reason}>
        parikshaa n/a
      </span>
    );
  }
  return (
    <span className="chip" title={state.reason}>
      parikshaa queued
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
  onDelete,
  onSaveDetails,
  showRecall,
}: {
  problem: SolvedProblem;
  now: number;
  onReview: (id: string, recall: Recall) => void;
  onResync: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveDetails: (
    id: string,
    note: string,
    complexity: { time?: string; space?: string },
  ) => Promise<void>;
  showRecall: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const overdue = problem.revision.dueAt <= now;

  return (
    <div className="card">
      <div className="card__top">
        <div className="card__title">{problem.title}</div>
        <DifficultyChip difficulty={problem.difficulty} />
      </div>

      <div className="card__meta">
        <span className={`chip ${overdue ? 'chip--overdue' : ''}`}>
          {formatDueIn(problem.revision.dueAt, now)}
        </span>
        <SyncChip problem={problem} />
        <ParikshaaChip problem={problem} />
        <span className="card__facts">
          {[
            problem.platform,
            `stage ${problem.revision.stage + 1}`,
            problem.revision.lapses > 0 &&
              `${problem.revision.lapses} lapse${problem.revision.lapses === 1 ? '' : 's'}`,
            problem.solveTimeMs && `${Math.max(1, Math.round(problem.solveTimeMs / 60_000))} min`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

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

  const due = useMemo(
    () => (data ? dueProblems(data.problems, data.now) : []),
    [data],
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
        <button type="button" className="ghost" onClick={() => void chrome.runtime.openOptionsPage()}>
          Options
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
                <div className="banner">
                  Re-solve each problem on the site first, then rate how it went. Rating adjusts
                  when you will see it again.
                </div>
                {due.map((problem) => (
                  <ProblemCard
                    key={problem.id}
                    problem={problem}
                    now={data.now}
                    onReview={(id, recall) => void handleReview(id, recall)}
                    onResync={(id) => void handleResync(id)}
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
                Options to back them up.
              </div>
            )}
            {data.problems.length === 0 ? (
              <Empty title="No solved problems yet">
                Solve something on LeetCode or Codeforces with the extension installed.
              </Empty>
            ) : (
              data.problems.map((problem) => (
                <ProblemCard
                  key={problem.id}
                  problem={problem}
                  now={data.now}
                  onReview={(id, recall) => void handleReview(id, recall)}
                  onResync={(id) => void handleResync(id)}
                  onDelete={(id) => void handleDelete(id)}
                  onSaveDetails={handleSaveDetails}
                  showRecall={false}
                />
              ))
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

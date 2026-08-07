import { useEffect, useState } from 'react';
import { FOCUS_MODE_LABELS, type FocusMode } from '../core/focus.ts';
import { send, type DiagnosticEntry } from '../core/messages.ts';
import {
  BugIcon,
  CalendarIcon,
  ClockIcon,
  DownloadIcon,
  GearIcon,
  GithubIcon,
  LayersIcon,
  RefreshIcon,
  ShieldIcon,
  SparkIcon,
  TrophyIcon,
  UploadIcon,
} from '../panel/icons.tsx';
import type { SessionDiagnostic } from '../core/parikshaa.ts';
import { DEFAULT_SETTINGS } from '../core/storage.ts';
import { PLATFORMS, PLATFORM_LABELS, type Platform, type Settings } from '../core/types.ts';
import { downloadBlob } from '../panel/share.ts';

type Status = { tone: 'ok' | 'error'; message: string } | null;

/** The judges that publish a contest schedule we can read. */
const CONTEST_PLATFORMS: Platform[] = ['codeforces', 'leetcode', 'codechef', 'atcoder'];

/** Accepts "1, 3, 7" and similar, dropping anything that is not a positive day count. */
function parseIntervals(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((part) => Number.parseInt(part, 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

/**
 * Turns the content script's report into something actionable. Each branch is
 * a genuinely different failure with a genuinely different fix.
 */
function describeSessionRead(diagnostic: SessionDiagnostic | undefined): string {
  if (!diagnostic) {
    return 'The parikshaa.org page has not reported in yet — reload that tab and check again.';
  }
  if (diagnostic.matchedKeys.length === 0) {
    const sample = diagnostic.sampleKeys?.slice(0, 6).join(', ');
    return `No Supabase session was stored on the page${
      sample ? ` (it holds: ${sample}…)` : ''
    }. If you are signed in there, you may be signed in on a different parikshaa.org subdomain than the tab that was open.`;
  }
  if (!diagnostic.parsed) {
    return `Found ${diagnostic.matchedKeys.join(', ')}, but no readable session in any of them.`;
  }
  if (
    diagnostic.preferredOrigin &&
    diagnostic.candidateOrigins.length > 0 &&
    !diagnostic.candidateOrigins.includes(diagnostic.preferredOrigin)
  ) {
    // Several Supabase projects can have sessions here; none is Parikshaa's.
    return `Sessions were found for ${diagnostic.candidateOrigins.join(', ')}, but the site itself uses ${diagnostic.preferredOrigin}. Sign in again at parikshaa.org so a session for that project is stored.`;
  }
  if (!diagnostic.hasAccessToken) {
    return `Found ${diagnostic.matchedKeys.join(', ')}, but it holds no access token — the session has been signed out.`;
  }
  if (!diagnostic.hasIssuer) {
    return 'The stored token carries no issuer claim, so the API endpoint cannot be derived from it.';
  }
  if (!diagnostic.hasUserId) {
    return 'The stored token carries no user id.';
  }
  return 'The session looked complete but was not accepted — please report this.';
}

/** One line per event, oldest first — readable when pasted into a message. */
function formatLog(entries: DiagnosticEntry[]): string {
  return entries
    .map((entry) => {
      const time = new Date(entry.at).toLocaleTimeString();
      const flag = entry.kind === 'seen' ? (entry.matched ? '[match] ' : '        ') : '';
      return `${time}  ${entry.platform.padEnd(14)} ${entry.kind.padEnd(9)} ${flag}${entry.detail}`;
    })
    .join('\n');
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle__text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

/**
 * Export, import and restore.
 *
 * Kept as its own component with its own state because none of it goes through
 * "Save settings" — these are actions, and an action that only takes effect
 * after you remember to press Save somewhere else is a trap.
 */
function BackupSection({ connected }: { connected: boolean }) {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (what: string, task: () => Promise<string>) => {
    setBusy(what);
    setStatus(null);
    try {
      setStatus({ tone: 'ok', message: await task() });
    } catch (error) {
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const describe = (result: { problems: number; added: number; exportedAt: number }) => {
    const when = result.exportedAt
      ? ` (backed up ${new Date(result.exportedAt).toLocaleDateString()})`
      : '';
    return result.added > 0
      ? `Restored${when}: ${result.added} problem${result.added === 1 ? '' : 's'} added, ${result.problems} in total.`
      : `Restored${when}: nothing new — everything in that backup was already here.`;
  };

  return (
    <section className="section-card">
      <h2 className="section-card__title">
        <ShieldIcon size={14} />
        Backup and restore
      </h2>
      <p className="section-card__hint">
        Your solutions live in GitHub, but the revision schedule, the attempt journal and the
        streak live only in this browser — one profile reset takes them with it. This writes all of
        it to a file. Your GitHub token is deliberately left out, because backups get committed to
        repositories.
      </p>

      <div className="actions actions--wrap">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run('export', async () => {
              const { filename, json } = await send({ type: 'backup:export' });
              // An anchor rather than chrome.downloads, so this needs no extra
              // permission on a listing that already asks for enough.
              downloadBlob(new Blob([json], { type: 'application/json' }), filename);
              return `Saved ${filename} to your downloads.`;
            })
          }
        >
          <DownloadIcon size={13} />
          {busy === 'export' ? 'Preparing…' : 'Download a backup'}
        </button>

        <label className="filebtn">
          <UploadIcon size={13} />
          {busy === 'import' ? 'Restoring…' : 'Restore from a file'}
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy !== null}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the same file twice fires the change again.
              event.target.value = '';
              if (!file) return;
              void run('import', async () =>
                describe(await send({ type: 'backup:import', text: await file.text() })),
              );
            }}
          />
        </label>

        <button
          type="button"
          disabled={busy !== null || !connected}
          onClick={() =>
            void run('push', async () => {
              const { path } = await send({ type: 'backup:push' });
              return `Committed ${path}.`;
            })
          }
        >
          <GithubIcon size={13} />
          {busy === 'push' ? 'Committing…' : 'Back up now'}
        </button>

        <button
          type="button"
          disabled={busy !== null || !connected}
          onClick={() => void run('pull', async () => describe(await send({ type: 'backup:pull' })))}
        >
          <RefreshIcon size={13} />
          {busy === 'pull' ? 'Reading…' : 'Restore from GitHub'}
        </button>
      </div>

      {status && <div className={`status status--${status.tone}`}>{status.message}</div>}

      <p className="section-card__hint">
        Restoring merges rather than replaces: where both sides know a problem, the more recently
        solved record wins, so restoring an old backup can never undo newer work.
        {!connected && ' The two GitHub buttons need a connected repository above.'}
      </p>
    </section>
  );
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [intervalsText, setIntervalsText] = useState('');
  const [leadText, setLeadText] = useState('');
  const [saveStatus, setSaveStatus] = useState<Status>(null);
  const [verifyStatus, setVerifyStatus] = useState<Status>(null);
  const [parikshaaStatus, setParikshaaStatus] = useState<Status>(null);
  const [verifying, setVerifying] = useState(false);
  const [log, setLog] = useState<DiagnosticEntry[]>([]);
  const [goalText, setGoalText] = useState('');
  const [pauseText, setPauseText] = useState('');
  const [allowlistText, setAllowlistText] = useState('');
  const [ratingGoalText, setRatingGoalText] = useState('');

  const loadLog = async () => {
    try {
      const { entries } = await send({ type: 'diagnostics:get' });
      setLog(entries);
    } catch {
      /* the service worker may be starting up */
    }
  };

  useEffect(() => {
    void (async () => {
      const loaded = await send({ type: 'settings:get' });
      setSettings(loaded);
      setIntervalsText(loaded.revision.intervals.join(', '));
      setLeadText(String(loaded.contests.leadMinutes));
      setGoalText(String(loaded.focus.dailyGoal));
      setRatingGoalText(loaded.handles.goal > 0 ? String(loaded.handles.goal) : '');
      setPauseText(String(loaded.focus.pauseHours));
      setAllowlistText(loaded.focus.allowlist.join('\n'));
      if (loaded.diagnostics.enabled) await loadLog();
    })();
  }, []);

  if (!settings) {
    return <div className="page">Loading…</div>;
  }

  const patchGithub = (patch: Partial<Settings['github']>) =>
    setSettings({ ...settings, github: { ...settings.github, ...patch } });

  const patchFocus = (patch: Partial<Settings['focus']>) =>
    setSettings({ ...settings, focus: { ...settings.focus, ...patch } });

  const save = async () => {
    const intervals = parseIntervals(intervalsText);
    if (intervals.length === 0) {
      setSaveStatus({ tone: 'error', message: 'Add at least one revision interval, e.g. 1, 3, 7.' });
      return;
    }
    try {
      const lead = Number.parseInt(leadText, 10);
      const goal = Number.parseInt(goalText, 10);
      const pauseHours = Number.parseInt(pauseText, 10);
      const ratingGoal = Number.parseInt(ratingGoalText, 10);
      const saved = await send({
        type: 'settings:save',
        patch: {
          ...settings,
          focus: {
            ...settings.focus,
            // An unreadable number keeps the current value rather than becoming NaN.
            dailyGoal: Number.isFinite(goal) && goal > 0 ? goal : settings.focus.dailyGoal,
            pauseHours:
              Number.isFinite(pauseHours) && pauseHours > 0
                ? pauseHours
                : settings.focus.pauseHours,
            allowlist: allowlistText
              .split(/[\s,]+/)
              .map((entry) => entry.trim())
              .filter(Boolean),
          },
          revision: { ...settings.revision, intervals },
          handles: {
            ...settings.handles,
            // Empty means "the next rank up", which is stored as zero.
            goal: Number.isFinite(ratingGoal) && ratingGoal > 0 ? ratingGoal : 0,
          },
          contests: {
            ...settings.contests,
            // An unreadable value keeps the current setting rather than becoming NaN.
            leadMinutes: Number.isFinite(lead) && lead > 0 ? lead : settings.contests.leadMinutes,
          },
        },
      });
      setSettings(saved);
      setIntervalsText(saved.revision.intervals.join(', '));
      setLeadText(String(saved.contests.leadMinutes));
      setGoalText(String(saved.focus.dailyGoal));
      setPauseText(String(saved.focus.pauseHours));
      setAllowlistText(saved.focus.allowlist.join('\n'));
      setRatingGoalText(saved.handles.goal > 0 ? String(saved.handles.goal) : '');
      setSaveStatus({ tone: 'ok', message: 'Saved.' });
    } catch (error) {
      setSaveStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const refreshParikshaa = async () => {
    try {
      const status = await send({ type: 'parikshaa:status' });

      // The two halves arrive from the same content script but fail for
      // different reasons, so say which one is actually missing — and when the
      // session is the missing half, say what the read actually found.
      if (!status.connected) {
        setParikshaaStatus({
          tone: 'error',
          message: status.hasApiKey
            ? `No signed-in session found. ${describeSessionRead(status.diagnostic)}`
            : 'Nothing from parikshaa.org yet. Open (or reload) a parikshaa.org tab while signed in, then check again.',
        });
        return;
      }
      if (status.expired) {
        setParikshaaStatus({
          tone: 'error',
          message: `Session for ${status.email ?? 'your account'} has expired — open parikshaa.org to refresh it.${
            status.pending > 0 ? ` ${status.pending} problem(s) are waiting.` : ''
          }`,
        });
        return;
      }
      setParikshaaStatus({
        tone: 'ok',
        message: `Connected as ${status.email ?? 'your Parikshaa account'}.${
          status.pending > 0 ? ` ${status.pending} problem(s) queued.` : ''
        }`,
      });
    } catch (error) {
      setParikshaaStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const verify = async () => {
    setVerifying(true);
    setVerifyStatus(null);
    try {
      const info = await send({ type: 'github:verify', config: settings.github });
      const branch = settings.github.branch || info.defaultBranch;

      if (!info.canPush) {
        setVerifyStatus({
          tone: 'error',
          message: `Reached ${info.fullName} as ${info.login}, but this token cannot write to it. Grant "Contents: read and write" on that repository.`,
        });
      } else if (!info.branchExists) {
        // Read access proves the token works, so the branch is the only thing
        // left that can still fail — and it fails at commit time, not here.
        setVerifyStatus({
          tone: 'error',
          message: `Token can write to ${info.fullName}, but branch "${branch}" does not exist. Its default branch is "${info.defaultBranch}".`,
        });
      } else {
        setVerifyStatus({
          tone: 'ok',
          message: `Connected as ${info.login} — writing to ${info.fullName} on "${branch}".`,
        });
      }
    } catch (error) {
      setVerifyStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="page">
      <header>
        <h1>
          <span className="brand__mark" aria-hidden="true">↻</span>
          Redo
          <span className="page__label">
            <GearIcon size={13} />
            Settings
          </span>
        </h1>
        <p className="page__intro">
          Accepted solutions on LeetCode and Codeforces get committed to a GitHub repository,
          ticked off on Parikshaa, and scheduled for spaced-repetition revision. Everything is
          stored in this browser; nothing is sent anywhere except the destinations you turn on
          below.
        </p>
      </header>

      <section className="section-card">
        <h2 className="section-card__title">
          <GithubIcon size={14} />
          GitHub sync
        </h2>
        <p className="section-card__hint">
          Create a fine-grained personal access token with <strong>Contents: read and write</strong>{' '}
          on the target repository, at{' '}
          <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer">
            github.com/settings/personal-access-tokens
          </a>
          . The token is kept in this browser's extension storage — anyone with access to your
          browser profile can read it, so scope it to the one repository and nothing else.
        </p>

        <Toggle
          checked={settings.github.enabled}
          onChange={(enabled) => patchGithub({ enabled })}
          label="Commit accepted solutions to GitHub"
          hint="Off means solutions stay in this browser only."
        />

        <div className="field">
          <label className="field__label" htmlFor="token">
            Personal access token
          </label>
          <input
            id="token"
            type="password"
            value={settings.github.token}
            placeholder="github_pat_…"
            autoComplete="off"
            onChange={(event) => patchGithub({ token: event.target.value })}
          />
        </div>

        <div className="field field-row">
          <div>
            <label className="field__label" htmlFor="owner">
              Owner
            </label>
            <input
              id="owner"
              type="text"
              value={settings.github.owner}
              placeholder="your-username"
              onChange={(event) => patchGithub({ owner: event.target.value.trim() })}
            />
          </div>
          <div>
            <label className="field__label" htmlFor="repo">
              Repository
            </label>
            <input
              id="repo"
              type="text"
              value={settings.github.repo}
              placeholder="dsa-solutions"
              onChange={(event) => patchGithub({ repo: event.target.value.trim() })}
            />
          </div>
        </div>

        <div className="field field-row">
          <div>
            <label className="field__label" htmlFor="branch">
              Branch
            </label>
            <input
              id="branch"
              type="text"
              value={settings.github.branch}
              placeholder="main"
              onChange={(event) => patchGithub({ branch: event.target.value.trim() })}
            />
          </div>
          <div>
            <label className="field__label" htmlFor="commit-message">
              Commit message
            </label>
            <input
              id="commit-message"
              type="text"
              value={settings.github.commitMessage}
              onChange={(event) => patchGithub({ commitMessage: event.target.value })}
            />
            <div className="field__hint">
              {'Placeholders: {title}, {platform}, {id}, {difficulty}'}
            </div>
          </div>
        </div>

        <div className="actions">
          <button type="button" onClick={() => void verify()} disabled={verifying}>
            {verifying ? 'Checking…' : 'Test connection'}
          </button>
          {verifyStatus && (
            <span className={`status status--${verifyStatus.tone}`}>{verifyStatus.message}</span>
          )}
        </div>
      </section>

      <section className="section-card">
        <h2 className="section-card__title">
          <SparkIcon size={14} />
          Parikshaa sync
        </h2>
        <p className="section-card__hint">
          When an accepted LeetCode problem matches a problem on{' '}
          <a href="https://parikshaa.org" target="_blank" rel="noreferrer">
            parikshaa.org
          </a>{' '}
          (they share the same slugs), it gets ticked off there automatically — your solution is
          saved against the problem and an accepted submission is recorded, which is what marks it
          solved across your sheets.
        </p>
        <p className="section-card__hint">
          There is nothing to paste: the extension uses the session already in your browser from
          being signed in to parikshaa.org. Codeforces is not synced, because Parikshaa problems
          are matched by LeetCode slug. Existing notes and solutions in other languages are merged,
          never overwritten.
        </p>

        <Toggle
          checked={settings.parikshaa.enabled}
          onChange={(enabled) => setSettings({ ...settings, parikshaa: { enabled } })}
          label="Mark matching problems solved on Parikshaa"
        />

        <div className="actions">
          <button type="button" onClick={() => void refreshParikshaa()}>
            Check connection
          </button>
          {parikshaaStatus && (
            <span className={`status status--${parikshaaStatus.tone}`}>
              {parikshaaStatus.message}
            </span>
          )}
        </div>
      </section>

      <section className="section-card">
        <h2 className="section-card__title">
          <ShieldIcon size={14} />
          Focus mode
        </h2>
        <p className="section-card__hint">
          Nothing else until today's problem is done. Browsing anywhere outside the judges,
          Parikshaa and GitHub lands on a page that points you at one problem instead — the idea
          behind <em>Eat That Frog</em>, with the frog picked for you.
        </p>
        <p className="section-card__hint">
          This is the one feature that needs to see which site a tab is on, which is why the
          extension asks for the browsing-history permission. It reads the address and nothing
          else — never the contents of a page.
        </p>

        <Toggle
          checked={settings.focus.enabled}
          onChange={(enabled) => patchFocus({ enabled })}
          label="Gate browsing until I've solved today"
          hint="Off by default. Turning it off again takes one click, any time."
        />

        <div className="field">
          <span className="field__label">Send me to</span>
          {(['due', 'daily', 'any'] as FocusMode[]).map((mode) => (
            <label className="radio" key={mode}>
              <input
                type="radio"
                name="focus-mode"
                checked={settings.focus.mode === mode}
                onChange={() => patchFocus({ mode })}
              />
              <span>
                {FOCUS_MODE_LABELS[mode]}
                {mode === 'due' && (
                  <small>
                    Uses what Redo already knows you are about to forget. Falls back to Parikshaa's
                    library when nothing is due.
                  </small>
                )}
                {mode === 'daily' && <small>Rolls over at 00:00 UTC, as LeetCode's does.</small>}
              </span>
            </label>
          ))}
        </div>

        <div className="field field-row">
          <div>
            <label className="field__label" htmlFor="goal">
              Problems to solve before the gate opens
            </label>
            <input
              id="goal"
              type="text"
              value={goalText}
              onChange={(event) => setGoalText(event.target.value)}
              placeholder="1"
            />
          </div>
          <div>
            <label className="field__label" htmlFor="pause-hours">
              Emergency pause length (hours)
            </label>
            <input
              id="pause-hours"
              type="text"
              value={pauseText}
              onChange={(event) => setPauseText(event.target.value)}
              placeholder="3"
            />
            <div className="field__hint">One pause per day. Resets at local midnight.</div>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="allowlist">
            Never gate these sites
          </label>
          <textarea
            id="allowlist"
            rows={3}
            value={allowlistText}
            onChange={(event) => setAllowlistText(event.target.value)}
            placeholder={'stackoverflow.com\nnotion.so'}
          />
          <div className="field__hint">
            One host per line; subdomains are included. The judges, Parikshaa, GitHub, Google
            sign-in, Gmail and Calendar are always allowed.
          </div>
        </div>
      </section>

      <section className="section-card">
        <h2 className="section-card__title">
          <ClockIcon size={14} />
          Revision schedule
        </h2>
        <p className="section-card__hint">
          Days between revisions. A problem starts at the first interval and moves up the ladder
          each time you rate it well — and drops back down when you forget it.
        </p>

        <div className="field">
          <label className="field__label" htmlFor="intervals">
            Interval ladder (days)
          </label>
          <input
            id="intervals"
            type="text"
            value={intervalsText}
            onChange={(event) => setIntervalsText(event.target.value)}
            placeholder={DEFAULT_SETTINGS.revision.intervals.join(', ')}
          />
          <div className="field__hint">
            Default: {DEFAULT_SETTINGS.revision.intervals.join(', ')}
          </div>
        </div>

        <Toggle
          checked={settings.wrapped.notify}
          onChange={(notify) => setSettings({ ...settings, wrapped: { notify } })}
          label="Nudge me once a week with a shareable recap"
          hint="Stays quiet in a week where nothing was solved."
        />
        <Toggle
          checked={settings.revision.notify}
          onChange={(notify) =>
            setSettings({ ...settings, revision: { ...settings.revision, notify } })
          }
          label="Show a notification when problems are due"
          hint="Checked twice a day. The toolbar badge always shows the count."
        />
      </section>

      <section className="section-card">
        <h2 className="section-card__title">
          <BugIcon size={14} />
          Diagnostics
        </h2>
        <p className="section-card__hint">
          If a solved problem does not show up, turn this on, solve one, then copy the log below
          and send it over. It records which requests the judge made and whether any of them
          matched — <strong>paths only</strong>, never a request body, a response or your code.
        </p>

        <Toggle
          checked={settings.diagnostics.enabled}
          onChange={(enabled) => setSettings({ ...settings, diagnostics: { enabled } })}
          label="Record what the extension sees on the judges"
          hint="Save, then reload the judge's tab for it to take effect."
        />

        <div className="actions">
          <button type="button" onClick={() => void loadLog()}>
            Refresh log
          </button>
          <button
            type="button"
            disabled={log.length === 0}
            onClick={() => void navigator.clipboard.writeText(formatLog(log))}
          >
            Copy {log.length > 0 ? `(${log.length} lines)` : ''}
          </button>
          <button
            type="button"
            className="ghost danger"
            disabled={log.length === 0}
            onClick={async () => {
              await send({ type: 'diagnostics:clear' });
              setLog([]);
            }}
          >
            Clear
          </button>
        </div>

        {log.length > 0 && (
          <pre className="log">{formatLog(log.slice(-60))}</pre>
        )}
      </section>

      <section className="section-card">
        <h2 className="section-card__title">
          <TrophyIcon size={14} />
          Contest rating
        </h2>
        <p className="section-card__hint">
          Your handles, used to read your contest rating from each judge's public API. On
          Codeforces the extension also runs the site's own rating algorithm over a finished
          contest's standings, so the predicted change is the real calculation rather than an
          estimate. LeetCode publishes a rating but not the other entrants', so its rating can be
          shown but not predicted.
        </p>

        <div className="field field-row">
          <div>
            <label className="field__label" htmlFor="cf-handle">
              Codeforces handle
            </label>
            <input
              id="cf-handle"
              type="text"
              value={settings.handles.codeforces}
              placeholder="tourist"
              onChange={(event) =>
                setSettings({
                  ...settings,
                  handles: { ...settings.handles, codeforces: event.target.value.trim() },
                })
              }
            />
          </div>
          <div>
            <label className="field__label" htmlFor="lc-handle">
              LeetCode username
            </label>
            <input
              id="lc-handle"
              type="text"
              value={settings.handles.leetcode}
              placeholder="your-username"
              onChange={(event) =>
                setSettings({
                  ...settings,
                  handles: { ...settings.handles, leetcode: event.target.value.trim() },
                })
              }
            />
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="rating-goal">
            Rating you are aiming for
          </label>
          <input
            id="rating-goal"
            type="text"
            value={ratingGoalText}
            onChange={(event) => setRatingGoalText(event.target.value)}
            placeholder="leave empty for the next rank up"
          />
          <div className="field__hint">
            The panel works out how many contests that is at the pace your last eight set. Leave it
            empty and it tracks the next Codeforces rank instead.
          </div>
        </div>

        <div className="field__hint">
          Both handles are public profile names, not logins. They are stored in this browser and
          sent only to the judge they belong to.
        </div>
      </section>

      <BackupSection connected={settings.github.enabled} />

      <section className="section-card">
        <h2 className="section-card__title">
          <DownloadIcon size={14} />
          Automatic backup
        </h2>
        <p className="section-card__hint">
          Writes <code>.redo/backup.json</code> to the same repository once a day, so a browser
          reset costs you nothing. Your GitHub token is deliberately left out of the file.
        </p>
        <Toggle
          checked={settings.github.backup}
          onChange={(backup) =>
            setSettings({ ...settings, github: { ...settings.github, backup } })
          }
          label="Back up daily to my repository"
        />
      </section>

      <section className="section-card">
        <h2 className="section-card__title">
          <CalendarIcon size={14} />
          Contests
        </h2>
        <p className="section-card__hint">
          Upcoming contests from Codeforces, LeetCode, CodeChef and AtCoder are gathered into one
          list in the popup, with a link to add any of them to your calendar. Listings are
          re-fetched every few hours, not polled.
        </p>

        <Toggle
          checked={settings.contests.remind}
          onChange={(remind) =>
            setSettings({ ...settings, contests: { ...settings.contests, remind } })
          }
          label="Notify me before a contest starts"
        />

        <div className="field">
          <label className="field__label" htmlFor="lead">
            Warn me this many minutes ahead
          </label>
          <input
            id="lead"
            type="text"
            value={leadText}
            onChange={(event) => setLeadText(event.target.value)}
            placeholder="60"
          />
        </div>

        {CONTEST_PLATFORMS.map((platform) => (
          <Toggle
            key={platform}
            checked={settings.contests.platforms[platform] !== false}
            onChange={(value) =>
              setSettings({
                ...settings,
                contests: {
                  ...settings.contests,
                  platforms: { ...settings.contests.platforms, [platform]: value },
                },
              })
            }
            label={PLATFORM_LABELS[platform]}
          />
        ))}
      </section>

      <section className="section-card">
        <h2 className="section-card__title">
          <LayersIcon size={14} />
          Platforms
        </h2>
        <p className="section-card__hint">Turn off a platform to stop tracking submissions there.</p>
        {PLATFORMS.map((platform) => (
          <Toggle
            key={platform}
            checked={settings.platforms[platform] ?? true}
            onChange={(value) =>
              setSettings({
                ...settings,
                platforms: { ...settings.platforms, [platform]: value },
              })
            }
            label={PLATFORM_LABELS[platform]}
          />
        ))}
      </section>

      <div className="actions">
        <button type="button" className="primary" onClick={() => void save()}>
          Save settings
        </button>
        {saveStatus && <span className={`status status--${saveStatus.tone}`}>{saveStatus.message}</span>}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { send, type DiagnosticEntry } from '../core/messages.ts';
import {
  BugIcon,
  CalendarIcon,
  ClockIcon,
  GearIcon,
  GithubIcon,
  LayersIcon,
  SparkIcon,
} from '../panel/icons.tsx';
import type { SessionDiagnostic } from '../core/parikshaa.ts';
import { DEFAULT_SETTINGS } from '../core/storage.ts';
import { PLATFORMS, PLATFORM_LABELS, type Platform, type Settings } from '../core/types.ts';

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

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [intervalsText, setIntervalsText] = useState('');
  const [leadText, setLeadText] = useState('');
  const [saveStatus, setSaveStatus] = useState<Status>(null);
  const [verifyStatus, setVerifyStatus] = useState<Status>(null);
  const [parikshaaStatus, setParikshaaStatus] = useState<Status>(null);
  const [verifying, setVerifying] = useState(false);
  const [log, setLog] = useState<DiagnosticEntry[]>([]);

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
      if (loaded.diagnostics.enabled) await loadLog();
    })();
  }, []);

  if (!settings) {
    return <div className="page">Loading…</div>;
  }

  const patchGithub = (patch: Partial<Settings['github']>) =>
    setSettings({ ...settings, github: { ...settings.github, ...patch } });

  const save = async () => {
    const intervals = parseIntervals(intervalsText);
    if (intervals.length === 0) {
      setSaveStatus({ tone: 'error', message: 'Add at least one revision interval, e.g. 1, 3, 7.' });
      return;
    }
    try {
      const lead = Number.parseInt(leadText, 10);
      const saved = await send({
        type: 'settings:save',
        patch: {
          ...settings,
          revision: { ...settings.revision, intervals },
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

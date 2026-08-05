import { useEffect, useState } from 'react';
import { send } from '../core/messages.ts';
import { DEFAULT_SETTINGS } from '../core/storage.ts';
import type { Platform, Settings } from '../core/types.ts';

type Status = { tone: 'ok' | 'error'; message: string } | null;

const PLATFORM_LABELS: Record<Platform, string> = {
  leetcode: 'LeetCode',
  codeforces: 'Codeforces',
};

/** Accepts "1, 3, 7" and similar, dropping anything that is not a positive day count. */
function parseIntervals(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((part) => Number.parseInt(part, 10))
    .filter((value) => Number.isFinite(value) && value > 0);
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
  const [saveStatus, setSaveStatus] = useState<Status>(null);
  const [verifyStatus, setVerifyStatus] = useState<Status>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    void (async () => {
      const loaded = await send({ type: 'settings:get' });
      setSettings(loaded);
      setIntervalsText(loaded.revision.intervals.join(', '));
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
      const saved = await send({
        type: 'settings:save',
        patch: { ...settings, revision: { ...settings.revision, intervals } },
      });
      setSettings(saved);
      setIntervalsText(saved.revision.intervals.join(', '));
      setSaveStatus({ tone: 'ok', message: 'Saved.' });
    } catch (error) {
      setSaveStatus({
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
      setVerifyStatus({
        tone: info.canPush ? 'ok' : 'error',
        message: info.canPush
          ? `Connected as ${info.login} — ${info.fullName} (default branch: ${info.defaultBranch}).`
          : `Reached ${info.fullName}, but this token cannot write to it. Grant "Contents: read and write".`,
      });
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
        <h1>DSA Revision Buddy</h1>
        <p className="page__intro">
          Accepted solutions on LeetCode and Codeforces get committed to a GitHub repository and
          scheduled for spaced-repetition revision. Everything is stored in this browser; nothing is
          sent anywhere except the GitHub repository you choose below.
        </p>
      </header>

      <section className="panel">
        <h2 className="panel__title">GitHub sync</h2>
        <p className="panel__hint">
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

      <section className="panel">
        <h2 className="panel__title">Revision schedule</h2>
        <p className="panel__hint">
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

      <section className="panel">
        <h2 className="panel__title">Platforms</h2>
        <p className="panel__hint">Turn off a platform to stop tracking submissions there.</p>
        {(Object.keys(PLATFORM_LABELS) as Platform[]).map((platform) => (
          <Toggle
            key={platform}
            checked={settings.platforms[platform]}
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

import { useEffect, useRef, useState } from 'react';
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
import { DEFAULT_PORT, bridgeOrigin } from '../core/bridge.ts';
import { GITHUB_CLIENT_ID } from '../core/brand.ts';
import { GITHUB_ORIGIN, formatUserCode, type DeviceCode } from '../core/device-flow.ts';
import { LANGUAGES } from '../core/translate.ts';
import { PLATFORMS, PLATFORM_LABELS, type Platform, type Settings } from '../core/types.ts';
import type { CfConnection } from '../core/cf-auth.ts';
import type { RepoChoice } from '../core/github.ts';
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
 * How much unfinished code the workspace is holding, and a way to delete it.
 *
 * Drafts are the most personal thing the extension stores — half-written
 * solutions, saved without being asked for — so there is a button that removes
 * them rather than only a promise that they eventually roll over.
 */
function WorkspaceDrafts() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    void send({ type: 'workspace:drafts' })
      .then((result) => setCount(result.count))
      .catch(() => setCount(0));
  }, []);

  if (count === null || count === 0) return null;

  return (
    <div className="field__hint" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span>
        {count} saved draft{count === 1 ? '' : 's'} on this computer, so a closed tab does not cost
        you a solution.
      </span>
      <button
        type="button"
        onClick={() => {
          void send({ type: 'workspace:forget-drafts' })
            .then(() => setCount(0))
            .catch(() => undefined);
        }}
      >
        Forget them
      </button>
    </div>
  );
}

/**
 * Signing in to GitHub instead of pasting a token.
 *
 * Offered *beside* the token, never in place of it, and the copy says which is
 * better: a device-flow token can read and write every repository you can, and
 * a fine-grained token can be scoped to the one you sync to. That is a real
 * difference in what a leaked credential costs.
 *
 * The polling timer lives here rather than in the service worker. MV3 would
 * kill a fifteen-minute loop there anyway, and this page is open — the user is
 * looking at it.
 */
function DeviceSignIn({
  clientId,
  includePrivate,
  onToken,
}: {
  clientId: string;
  includePrivate: boolean;
  onToken: (token: string) => void;
}) {
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  // The callback through a ref, so a parent re-render cannot restart the poll
  // timer — an inline arrow prop is a new function every render, and a timer
  // that resets every render is a timer that never fires.
  const deliver = useRef(onToken);
  deliver.current = onToken;

  /** Hands github.com back the moment the flow is over, however it ended. */
  const release = () => {
    void chrome.permissions.remove({ origins: [GITHUB_ORIGIN] }).catch(() => undefined);
  };

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    let interval = code.interval * 1000;
    let timer = 0;

    const stop = (next: Status) => {
      setCode(null);
      setStatus(next);
      release();
    };

    const tick = async () => {
      if (cancelled) return;
      try {
        const result = await send({
          type: 'github:device-poll',
          deviceCode: code.deviceCode,
          clientId,
        });
        if (cancelled) return;

        if (result.token) {
          deliver.current(result.token);
          // Only api.github.com is needed from here on, and that one is not
          // optional — so github.com goes straight back.
          stop({ tone: 'ok', message: 'Signed in. Fill in the repository below and save.' });
          return;
        }
        if (result.error) {
          stop({ tone: 'error', message: result.error });
          return;
        }
        // GitHub asking to be polled less often is an instruction, not advice.
        if (result.interval) interval = result.interval * 1000;
      } catch {
        /* One missed poll is not a failure; the next one is due anyway. */
      }

      if (Date.now() > code.expiresAt) {
        stop({ tone: 'error', message: 'The code expired. Start again.' });
        return;
      }
      timer = setTimeout(() => void tick(), interval) as unknown as number;
    };

    timer = setTimeout(() => void tick(), interval) as unknown as number;
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, clientId]);

  // A build with no client id cannot do this at all, and a button that can only
  // ever fail is worse than no button. The id is a build constant, so this is
  // answered here rather than by asking the service worker.
  if (!clientId.trim() && !GITHUB_CLIENT_ID.trim()) return null;

  return (
    <div className="field">
      {code ? (
        <div className="devicecode">
          <span className="devicecode__code mono">{formatUserCode(code.userCode)}</span>
          <div>
            <div>
              Enter that code at{' '}
              <a href={code.verificationUri} target="_blank" rel="noreferrer">
                {code.verificationUri.replace('https://', '')}
              </a>
              , then come back — this page is waiting.
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setCode(null);
                release();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setStatus(null);
            try {
              // github.com is an *optional* permission, asked for here and not
              // at install: the flow talks to github.com rather than the API
              // host the extension already has, and one optional sign-in is no
              // reason for every install to grant it. It must be requested
              // from the click — Chrome refuses without a user gesture, which
              // is also why this is not in the service worker.
              const granted = await chrome.permissions.request({ origins: [GITHUB_ORIGIN] });
              if (!granted) {
                setStatus({
                  tone: 'error',
                  message: 'Without access to github.com the sign-in cannot run. Paste a token instead.',
                });
                return;
              }

              const result = await send({
                type: 'github:device-start',
                includePrivate,
                clientId,
              });
              if (result.code) setCode(result.code);
              else setStatus({ tone: 'error', message: result.error ?? 'GitHub sent no code.' });
            } finally {
              setBusy(false);
            }
          }}
        >
          <GithubIcon size={13} />
          {busy ? 'Asking GitHub…' : 'Sign in with GitHub instead'}
        </button>
      )}

      {status && <div className={`status status--${status.tone}`}>{status.message}</div>}

      <span className="field__hint">
        Signing in is quicker; a token is <strong>safer</strong>. A signed-in token can read and
        write {includePrivate ? 'every repository you have access to' : 'your public repositories'},
        and a fine-grained token can be limited to the one you sync to, with <code>Contents</code>{' '}
        and nothing else.
      </span>
    </div>
  );
}

/**
 * Choosing a repository instead of typing one.
 *
 * Owner, repo and branch typed by hand is three chances to make a typo that
 * only shows up as a 404 much later, and it asks you to remember the exact
 * spelling of something GitHub already knows. This asks GitHub.
 *
 * It works with whatever token is in the box, pasted or signed-in, and with the
 * token as it is *typed* rather than as it was last saved — you should not have
 * to save a half-filled form before the picker will talk to you.
 *
 * Repositories the token cannot write to are listed and marked rather than
 * hidden: "my repository is missing" is a worse puzzle than "my repository is
 * there but says read-only".
 */
function RepoPicker({
  token,
  selected,
  onPick,
  onBranches,
}: {
  token: string;
  selected: string;
  onPick: (repo: RepoChoice) => void;
  onBranches: (branches: string[]) => void;
}) {
  const [repos, setRepos] = useState<RepoChoice[] | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const load = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await send({ type: 'github:repos', token });
      setRepos(result.repos);
      if (result.repos.length === 0) {
        setStatus({
          tone: 'error',
          message:
            'This token can see no repositories. A fine-grained token lists them one by one under "Repository access".',
        });
      }
    } catch (error) {
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const pick = async (repo: RepoChoice) => {
    onPick(repo);
    onBranches([]);
    try {
      const result = await send({
        type: 'github:branches',
        token,
        owner: repo.owner,
        repo: repo.name,
        defaultBranch: repo.defaultBranch,
      });
      onBranches(result.branches);
    } catch {
      // Not worth a message: the branch box still takes a typed name, and the
      // repository — the part that was actually being chosen — is already set.
    }
  };

  const needle = filter.trim().toLowerCase();
  const shown = (repos ?? []).filter((repo) => repo.fullName.toLowerCase().includes(needle));

  return (
    <div className="field">
      {repos === null ? (
        <>
          <button type="button" onClick={() => void load()} disabled={busy || !token.trim()}>
            {busy ? 'Asking GitHub…' : 'Choose from my repositories'}
          </button>
          <span className="field__hint">
            {token.trim()
              ? 'Lists everything this token can reach, so you can pick one instead of typing it.'
              : 'Paste a token or sign in above, then pick a repository from a list.'}
          </span>
        </>
      ) : (
        <>
          <div className="repopick">
            <input
              type="search"
              value={filter}
              placeholder={`Filter ${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'}…`}
              onChange={(event) => setFilter(event.target.value)}
            />
            <div className="repopick__list" role="listbox">
              {shown.map((repo) => (
                <button
                  type="button"
                  key={repo.fullName}
                  role="option"
                  aria-selected={repo.fullName === selected}
                  className={`repopick__row${repo.fullName === selected ? ' is-on' : ''}`}
                  onClick={() => void pick(repo)}
                >
                  <span className="repopick__name">{repo.fullName}</span>
                  {repo.private && <span className="repopick__tag">private</span>}
                  {!repo.canPush && <span className="repopick__tag is-warn">read-only</span>}
                </button>
              ))}
              {shown.length === 0 && <div className="repopick__empty">Nothing matches “{filter}”.</div>}
            </div>
          </div>
          <span className="field__hint">
            Picking one fills in owner, repository and its default branch below.{' '}
            <button type="button" className="linkish" onClick={() => void load()}>
              Reload the list
            </button>
          </span>
        </>
      )}

      {status && <div className={`status status--${status.tone}`}>{status.message}</div>}
    </div>
  );
}

/**
 * Connecting Codeforces — three things, reported one by one.
 *
 * **Codeforces has no OAuth.** There is no "Sign in with Codeforces" to build,
 * and a password box on a page that is not codeforces.com would be a phishing
 * pattern whatever the intent — so this does not ask for a password, and says
 * why rather than leaving a gap where a button ought to be.
 *
 * What it can do is confirm all three of the things "connected" could mean: the
 * handle (public, needs nothing), an API key and secret (optional, yours to
 * generate and revoke), and whether this browser is signed in — which is the
 * one Run and Submit in the workspace actually depend on. Each is shown
 * separately, because a single green tick hiding which of them is working is
 * worse than no tick at all.
 */
function CodeforcesConnect({
  handles,
  onChange,
}: {
  handles: Settings['handles'];
  onChange: (patch: Partial<Settings['handles']>) => void;
}) {
  const [result, setResult] = useState<CfConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await send({
          type: 'cf:connect',
          handle: handles.codeforces,
          key: handles.cfApiKey,
          secret: handles.cfApiSecret,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <div className="actions">
        <button type="button" onClick={() => void connect()} disabled={busy}>
          {busy ? 'Checking…' : 'Connect Codeforces'}
        </button>
        {error && <span className="status status--error">{error}</span>}
      </div>

      {result && (
        <ul className="checks">
          <li className={result.handle ? 'is-ok' : 'is-bad'}>
            {result.handle ? (
              <>
                <b>{result.handle}</b>
                {result.rank ? ` — ${result.rank}` : ''}
                {result.rating ? `, rated ${result.rating}` : ''}
              </>
            ) : (
              result.handleError ?? 'No handle given, so nothing to confirm.'
            )}
          </li>

          {result.authorized !== undefined && (
            <li className={result.authorized ? 'is-ok' : 'is-bad'}>
              {result.authorized
                ? 'API key and secret accepted — friends and private submissions are readable.'
                : result.authorizedError}
            </li>
          )}

          <li className={result.signedIn ? 'is-ok' : 'is-bad'}>
            {result.signedIn ? (
              <>
                Signed in to codeforces.com in this browser
                {result.signedInAs ? ` as ${result.signedInAs}` : ''} — Run and Submit will work.
              </>
            ) : (
              <>
                Not signed in to codeforces.com in this browser. The rating and problem data still
                work; <b>Run and Submit in the workspace will not</b>, because they post through the
                site's own form.{' '}
                <a href="https://codeforces.com/enter" target="_blank" rel="noreferrer">
                  Sign in
                </a>
                , then check again.
              </>
            )}
          </li>
        </ul>
      )}

      <details className="field">
        <summary>Optional: an API key, for friends and private submissions</summary>
        <p className="field__hint">
          Codeforces does not offer OAuth, so there is no button that signs you in — but you can
          generate a key and secret yourself at{' '}
          <a href="https://codeforces.com/settings/api" target="_blank" rel="noreferrer">
            codeforces.com/settings/api
          </a>
          , and revoke them there whenever you like. They sign requests so the API answers as you.
          Everything public — rating, contest history, solved problems — works without them.
        </p>
        <div className="field field-row">
          <div>
            <label className="field__label" htmlFor="cf-key">
              API key
            </label>
            <input
              id="cf-key"
              type="text"
              autoComplete="off"
              value={handles.cfApiKey}
              onChange={(event) => onChange({ cfApiKey: event.target.value.trim() })}
            />
          </div>
          <div>
            <label className="field__label" htmlFor="cf-secret">
              API secret
            </label>
            <input
              id="cf-secret"
              type="password"
              autoComplete="off"
              value={handles.cfApiSecret}
              onChange={(event) => onChange({ cfApiSecret: event.target.value.trim() })}
            />
          </div>
        </div>
        <span className="field__hint">
          Stored unencrypted, like every credential a browser extension holds. If that is not a
          trade you want for reading your friends list, leave both empty — nothing else needs them.
        </span>
      </details>
    </div>
  );
}

/**
 * The editor bridge, and the permission it needs.
 *
 * Its own component because switching it on is not a settings change — it is a
 * permission request, and Chrome only grants one from a user gesture. Doing it
 * from the checkbox rather than from a Save button is what makes the prompt
 * appear at the moment the user asked for the thing.
 */
function EditorBridge({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (bridge: Settings['bridge']) => void;
}) {
  const [status, setStatus] = useState<Status>(null);
  const [testing, setTesting] = useState(false);

  const enable = async (enabled: boolean) => {
    if (!enabled) {
      onChange({ ...settings.bridge, enabled: false });
      setStatus(null);
      // The permission is given back too: an extension holding access to
      // localhost for a feature that is off is exactly the kind of thing
      // nobody notices and everybody should mind.
      void chrome.permissions.remove({ origins: [bridgeOrigin(settings.bridge.port)] });
      return;
    }

    try {
      const granted = await chrome.permissions.request({
        origins: [bridgeOrigin(settings.bridge.port)],
      });
      if (!granted) {
        setStatus({ tone: 'error', message: 'Chrome did not grant access to 127.0.0.1.' });
        return;
      }
      onChange({ ...settings.bridge, enabled: true });
      setStatus(null);
    } catch (error) {
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <section className="section-card">
      <h2 className="section-card__title">
        <LayersIcon size={14} />
        Editor bridge
      </h2>
      <p className="section-card__hint">
        Every accepted solve is posted as JSON to a port on this machine, so the file can land in
        the project you are actually working in. This is a <strong>protocol, not an
        integration</strong>: Redo does not ship the listener, and anything can be one — a VS Code
        extension, a Neovim plugin, a shell script. The shape is documented in the README, and it
        goes to <code>127.0.0.1</code> and nowhere else, without cookies.
      </p>

      <Toggle
        checked={settings.bridge.enabled}
        onChange={(enabled) => void enable(enabled)}
        label="Push solves to a local editor"
        hint="Switching this on asks Chrome for access to 127.0.0.1; switching it off gives it back."
      />

      <div className="field field-row">
        <div>
          <label className="field__label" htmlFor="bridge-port">
            Port
          </label>
          <input
            id="bridge-port"
            type="number"
            min={1025}
            max={65535}
            value={settings.bridge.port}
            onChange={(event) =>
              onChange({ ...settings.bridge, port: Number(event.target.value) || DEFAULT_PORT })
            }
          />
        </div>
        <div style={{ alignSelf: 'end' }}>
          <button
            type="button"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              setStatus(null);
              try {
                const result = await send({ type: 'bridge:test', port: settings.bridge.port });
                setStatus(
                  result.ok
                    ? { tone: 'ok', message: 'The listener answered. A test payload was sent.' }
                    : { tone: 'error', message: result.error ?? 'No answer.' },
                );
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? 'Trying…' : 'Send a test payload'}
          </button>
        </div>
      </div>

      {status && <div className={`status status--${status.tone}`}>{status.message}</div>}
    </section>
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
  /** Branch names for the chosen repository, once the picker has fetched them. */
  const [branches, setBranches] = useState<string[]>([]);
  const [log, setLog] = useState<DiagnosticEntry[]>([]);
  const [goalText, setGoalText] = useState('');
  const [pauseText, setPauseText] = useState('');
  const [allowlistText, setAllowlistText] = useState('');
  const [ratingGoalText, setRatingGoalText] = useState('');
  const [friendsText, setFriendsText] = useState('');

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
      setFriendsText(loaded.handles.friends.join(', '));
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
            friends: friendsText
              .split(/[,\s]+/)
              .map((entry) => entry.trim())
              .filter(Boolean)
              .slice(0, 12),
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
      setFriendsText(saved.handles.friends.join(', '));
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

      {/*
        Shown until the two things that make Redo do anything are set. Landing
        in a nine-section settings page with no idea which parts matter is how
        people conclude an extension does not work.
      */}
      {(!settings.github.enabled || !settings.github.repo) && (
        <section className="section-card setup">
          <h2 className="section-card__title">
            <SparkIcon size={14} />
            Two things to set up
          </h2>
          <ol className="setup__list">
            <li className={settings.github.repo && settings.github.token ? 'is-done' : ''}>
              <b>A GitHub repository.</b> Where your accepted solutions get committed. You need a
              fine-grained token with <code>Contents: read and write</code> on that one repository —
              the next section walks through it.
            </li>
            <li className={settings.handles.codeforces || settings.handles.leetcode ? 'is-done' : ''}>
              <b>Your Codeforces handle.</b> It turns on the rating and solved marks on Codeforces
              pages, the contest rating card, and the upsolve queue. Public profile name, not a
              login.
            </li>
          </ol>
          <p className="section-card__hint" style={{ marginBottom: 0 }}>
            Everything else already has a sensible default. Nothing is sent anywhere except the
            destinations you switch on.
          </p>
        </section>
      )}

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

        <DeviceSignIn
          clientId={settings.github.clientId}
          includePrivate={settings.github.signInPrivate}
          onToken={(token) => patchGithub({ token })}
        />

        {/* Outside DeviceSignIn on purpose: that component hides itself when
            there is no client id, and this is the field that supplies one. */}
        <details className="field" open={!settings.github.clientId && !GITHUB_CLIENT_ID}>
          <summary>Set up “Sign in with GitHub”</summary>
          <p className="field__hint">
            GitHub only issues tokens to a registered OAuth App, and an app belongs to an account —
            there is no shared one this extension could ship. Registering your own takes a minute
            and is a one-off:
          </p>
          <ol className="field__hint steps">
            <li>
              Open{' '}
              <a
                href="https://github.com/settings/applications/new"
                target="_blank"
                rel="noreferrer"
              >
                github.com/settings/applications/new
              </a>
              .
            </li>
            <li>
              Any name and homepage will do — <code>http://localhost</code> is fine for the URL,
              since the device flow never redirects anywhere.
            </li>
            <li>
              Register it, then on the app’s page tick <b>Enable Device Flow</b> and save.
            </li>
            <li>Copy the Client ID and paste it here.</li>
          </ol>
          <label className="field__label" htmlFor="client-id">
            OAuth App Client ID
          </label>
          <input
            id="client-id"
            type="text"
            value={settings.github.clientId}
            placeholder={GITHUB_CLIENT_ID || 'Ov23li…'}
            autoComplete="off"
            onChange={(event) => patchGithub({ clientId: event.target.value.trim() })}
          />
          <span className="field__hint">
            Not a secret — the device flow has no client secret, which is exactly why it is the only
            OAuth flow an extension can run honestly.
          </span>
          <Toggle
            checked={settings.github.signInPrivate}
            onChange={(value) => patchGithub({ signInPrivate: value })}
            label="Include my private repositories"
            hint="On, so you can pick any repository after connecting. Off asks only for public ones, which is a narrower token."
          />
        </details>

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

        <RepoPicker
          token={settings.github.token}
          selected={`${settings.github.owner}/${settings.github.repo}`}
          onPick={(repo) =>
            patchGithub({ owner: repo.owner, repo: repo.name, branch: repo.defaultBranch })
          }
          onBranches={setBranches}
        />

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
            {/* A list once the repository's branches are known, and a text box
                until then — a dropdown that cannot offer anything is worse than
                a box you can type into. */}
            {branches.length > 0 ? (
              <select
                id="branch"
                value={settings.github.branch}
                onChange={(event) => patchGithub({ branch: event.target.value })}
              >
                {branches.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="branch"
                type="text"
                value={settings.github.branch}
                placeholder="main"
                onChange={(event) => patchGithub({ branch: event.target.value.trim() })}
              />
            )}
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
        <CodeforcesConnect
          handles={settings.handles}
          onChange={(patch) => setSettings({ ...settings, handles: { ...settings.handles, ...patch } })}
        />

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

        <div className="field field-row">
          <div>
            <label className="field__label" htmlFor="org">
              Your institution
            </label>
            <input
              id="org"
              type="text"
              value={settings.handles.organization}
              placeholder="as it appears on your Codeforces profile"
              onChange={(event) =>
                setSettings({
                  ...settings,
                  handles: { ...settings.handles, organization: event.target.value },
                })
              }
            />
          </div>
          <div>
            <label className="field__label" htmlFor="friends">
              Handles to watch
            </label>
            <input
              id="friends"
              type="text"
              value={friendsText}
              placeholder="tourist, Benq, jiangly"
              onChange={(event) => setFriendsText(event.target.value)}
            />
          </div>
        </div>
        <div className="field__hint">
          On a problem page, Redo can show which of these handles has solved it and in what
          language. One Codeforces call per handle, so it only looks when you ask — keep the list
          short. Stored in this browser and sent nowhere but Codeforces.
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
          <SparkIcon size={14} />
          On the judge's page
        </h2>
        <p className="section-card__hint">
          What Redo adds to Codeforces itself: a card in the sidebar with the problem's rating,
          your history on it and the revision prompt, plus rating and solved marks down listing
          pages. Nothing here changes the site's own layout — turn the first switch off and the
          pages are exactly as the judge built them.
        </p>

        <Toggle
          checked={settings.page.enabled}
          onChange={(enabled) => setSettings({ ...settings, page: { ...settings.page, enabled } })}
          label="Enhance judge pages"
          hint="The master switch for everything below."
        />

        <div style={{ opacity: settings.page.enabled ? 1 : 0.45 }}>
          {(
            [
              ['rail', 'Sidebar card on problem pages', 'Rating, your attempts, notes and the revision prompt.'],
              ['rating', 'Problem rating', "Shown even when you have Codeforces' own tags turned off."],
              ['tags', 'Reveal tags button', 'Tags stay hidden until you ask for them.'],
              ['timer', 'Solve clock', 'How long this attempt has taken so far.'],
              ['listings', 'Marks on listing pages', 'Rating and a tick beside every problem link.'],
              ['profile', 'Card on your profile', "Streaks and today's picks, on your own Codeforces profile."],
              ['hovercards', 'Preview on hover', 'Rank and rating when you hover any handle.'],
              ['friends', "Friends' submissions", 'Which of your saved handles solved the problem you are on.'],
              ['standings', 'Your place in the standings', 'College and country rank, from the page itself.'],
              [
                'workspace',
                'Workspace button on problem pages',
                'Statement beside a code editor, opened on demand. The editor is only downloaded the first time you open it.',
              ],
              [
                'workspaceAuto',
                'Open the workspace automatically',
                'Every problem page opens straight into the workspace. Close or Escape puts the page back, and it stays back until you open another problem.',
              ],
              [
                'skin',
                'Dark Codeforces',
                "Restyles the site itself. The only switch here that changes the judge's own page rather than adding to it — rank colours and verdicts are left alone, because on Codeforces they are information.",
              ],
            ] as Array<[keyof Settings['page'], string, string]>
          )
            // The automatic switch is meaningless without the workspace itself,
            // and a dead toggle is worse than a missing one.
            .filter(([key]) => key !== 'workspaceAuto' || settings.page.workspace)
            .map(([key, label, hint]) => (
            <Toggle
              key={key}
              checked={settings.page[key]}
              onChange={(value) =>
                setSettings({ ...settings, page: { ...settings.page, [key]: value } })
              }
              label={label}
              hint={hint}
            />
          ))}
        </div>

        {settings.page.workspace && <WorkspaceDrafts />}

        <div className="field__hint">
          Ratings and tags come from Codeforces' public problemset, cached locally for a week. Your
          solved marks come from your own submission history, refreshed hourly.
        </div>
      </section>

      <EditorBridge
        settings={settings}
        onChange={(bridge) => setSettings({ ...settings, bridge })}
      />

      <section className="section-card">
        <h2 className="section-card__title">
          <GithubIcon size={14} />
          Community solutions
        </h2>
        <p className="section-card__hint">
          Solution threads without a server, because GitHub already runs one: a problem's thread is
          an <strong>issue</strong> in a repository you name, and replies are comments.{' '}
          <strong>Posting is public, under your own GitHub account.</strong> That is the trade —
          more honest than a private backend nobody can audit, and the threads outlive the
          extension. Reading needs nothing but the repository; posting needs your token to have{' '}
          <strong>Issues: read and write</strong> on it, which is a permission the sync itself does
          not need.
        </p>

        <Toggle
          checked={settings.community.enabled}
          onChange={(enabled) =>
            setSettings({ ...settings, community: { ...settings.community, enabled } })
          }
          label="Enable community threads"
          hint="Nothing is read or posted until you open a problem's thread."
        />

        <div className="field field-row">
          <div>
            <label className="field__label" htmlFor="community-owner">
              Owner
            </label>
            <input
              id="community-owner"
              type="text"
              value={settings.community.owner}
              placeholder={settings.github.owner || 'your-username'}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  community: { ...settings.community, owner: event.target.value.trim() },
                })
              }
            />
          </div>
          <div>
            <label className="field__label" htmlFor="community-repo">
              Repository
            </label>
            <input
              id="community-repo"
              type="text"
              value={settings.community.repo}
              placeholder="dsa-discussions"
              onChange={(event) =>
                setSettings({
                  ...settings,
                  community: { ...settings.community, repo: event.target.value.trim() },
                })
              }
            />
          </div>
        </div>

        <div className="field__hint">
          Owner left blank uses your sync repository's owner. Issues have to be switched on for the
          repository.
        </div>
      </section>

      <section className="section-card">
        <h2 className="section-card__title">
          <SparkIcon size={14} />
          Translate statements
        </h2>
        <p className="section-card__hint">
          <strong>This is the only part of Redo that sends anything to a third party.</strong> With
          it on, pressing <em>Translate</em> on a Codeforces problem sends that statement's text to
          Google's Gemini API using a key you supply, and puts the answer back in place. Formulas,
          code and sample blocks are never sent and never touched; a translation that came back
          with a formula moved or missing is discarded rather than shown. Press the button again
          for the original. Nothing is sent until you press it, and a translation is kept for a day
          so re-reading a problem costs nothing.
        </p>

        <Toggle
          checked={settings.translate.enabled}
          onChange={(enabled) =>
            setSettings({ ...settings, translate: { ...settings.translate, enabled } })
          }
          label="Enable translation"
          hint="The button only appears once a key is saved as well."
        />

        <label className="field">
          <span className="field__label">Google Gemini API key</span>
          <input
            type="password"
            value={settings.translate.apiKey}
            placeholder="AIza…"
            onChange={(event) =>
              setSettings({
                ...settings,
                translate: { ...settings.translate, apiKey: event.target.value },
              })
            }
          />
          <span className="field__hint">
            Yours, from{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              aistudio.google.com/apikey
            </a>
            . Stored in this browser and sent only to Google, only when you press Translate. Redo
            has no key of its own and no server to hold one.
          </span>
        </label>

        <label className="field">
          <span className="field__label">Translate into</span>
          <select
            value={settings.translate.language}
            onChange={(event) =>
              setSettings({
                ...settings,
                translate: { ...settings.translate, language: event.target.value },
              })
            }
          >
            {LANGUAGES.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
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

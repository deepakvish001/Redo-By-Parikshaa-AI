import { useCallback, useEffect, useState } from 'react';
import { FOCUS_MODE_LABELS, canPause } from '../core/focus.ts';
import { send, type FocusStatus } from '../core/messages.ts';
import { ClockIcon, FlameIcon, GearIcon } from '../panel/icons.tsx';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function remaining(until: number, now: number): string {
  const minutes = Math.max(0, Math.round((until - now) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  const [status, setStatus] = useState<FocusStatus | null>(null);
  const [pausing, setPausing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await send({ type: 'focus:status' }));
    } catch {
      /* the service worker may still be starting */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Solving happens in another tab; the goal can be met while this page sits
  // open, and it should let the user go when it is.
  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && ('problems' in changes || 'focusPause' in changes)) void load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [load]);

  if (!status) {
    return <div className="gate__shell">Loading…</div>;
  }

  const { decision, target, pause, settings, dueCount } = status;
  const now = Date.now();
  const open = decision.solved >= decision.goal || (pause.until ? pause.until > now : false);

  return (
    <div className="gate__shell">
      <div className="gate__card">
        <span className="brand">
          <span className="brand__mark" aria-hidden="true">↻</span>
          <span className="shell__title">Redo</span>
        </span>

        {open ? (
          <>
            <h1 className="gate__title">You’re free to go.</h1>
            <p className="gate__lead">
              {decision.solved >= decision.goal
                ? `${decision.solved} solved today — that clears the gate.`
                : `Paused for another ${remaining(pause.until ?? now, now)}.`}
            </p>
            {from && (
              <a className="gate__primary" href={from}>
                Continue to {hostOf(from)}
              </a>
            )}
          </>
        ) : (
          <>
            <h1 className="gate__title">One problem first.</h1>
            <p className="gate__lead">
              You were heading to <strong>{hostOf(from) || 'a site'}</strong>. Focus mode is on, and
              today’s{' '}
              {decision.goal === 1 ? 'problem is' : `${decision.goal} problems are`} not done yet.
            </p>

            <div className="gate__target">
              <div className="gate__label">{FOCUS_MODE_LABELS[settings.mode]}</div>
              <div className="gate__problem">{target.title}</div>
              <div className="gate__note">{target.note}</div>
            </div>

            <a className="gate__primary" href={to || target.url}>
              Open the problem
            </a>

            <div className="gate__stats">
              <span className="duestat">
                <ClockIcon size={13} />
                <strong>
                  {decision.solved}/{decision.goal}
                </strong>{' '}
                solved today
              </span>
              {dueCount > 0 && (
                <span className="duestat duestat--due">
                  <FlameIcon size={13} />
                  <strong>{dueCount}</strong> due for revision
                </span>
              )}
            </div>
          </>
        )}

        <div className="gate__foot">
          {/* The escape hatch. Once a day is what makes the gate mean anything;
              no escape hatch at all is what gets an extension uninstalled. */}
          {!open && (
            <button
              type="button"
              className="ghost"
              // `canPause` rather than a date comparison written out here. The
              // version that was here compared against `toISOString()`, which
              // is UTC, while the day a pause is *spent* on is the local one —
              // so anywhere east of Greenwich the escape hatch sat disabled
              // through the small hours of every morning, with a pause
              // available and the button refusing to spend it.
              disabled={pausing || !canPause(pause, Date.now())}
              onClick={async () => {
                setPausing(true);
                try {
                  const result = await send({ type: 'focus:pause' });
                  if (result.started && from) {
                    window.location.replace(from);
                    return;
                  }
                  setMessage(
                    result.started
                      ? 'Paused.'
                      : 'Today’s pause has already been used. It resets at midnight.',
                  );
                  await load();
                } finally {
                  setPausing(false);
                }
              }}
            >
              {pausing ? 'Pausing…' : `Emergency — pause ${settings.pauseHours}h`}
            </button>
          )}
          <button
            type="button"
            className="ghost iconbtn"
            onClick={() => void chrome.runtime.openOptionsPage()}
          >
            <GearIcon size={13} />
            Settings
          </button>
        </div>

        {message && <div className="gate__message">{message}</div>}
      </div>
    </div>
  );
}

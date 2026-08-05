/**
 * In-page UI for the content script.
 *
 * Everything lives inside a shadow root so LeetCode's and Codeforces' own
 * stylesheets cannot reach it, and so nothing we add can leak styles back into
 * the host page.
 */

const HOST_ID = 'redo-root';

const STYLES = `
:host { all: initial; }
.stack {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.card {
  width: 320px;
  box-sizing: border-box;
  padding: 14px 16px;
  border-radius: 12px;
  background: #0a0a0c;
  color: #e7e7ee;
  border: 1px solid #2e2e2e;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.38);
  animation: slide-in 180ms ease-out;
}
@keyframes slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .card { animation: none; }
}
.card.error { border-color: #7f2a34; }
.card.success { border-color: #2f6f4f; }
.row { display: flex; align-items: flex-start; gap: 10px; }
.dot {
  width: 8px; height: 8px; border-radius: 50%;
  margin-top: 6px; flex: none;
  background: linear-gradient(135deg, #f97316 0%, #fbbf24 100%);
}
.card.error .dot { background: #f0616d; }
.card.success .dot { background: #4ade80; }
.title { font-size: 13px; font-weight: 600; line-height: 1.35; }
.body { margin-top: 4px; font-size: 12px; line-height: 1.5; color: #a9a9b8; white-space: pre-wrap; }
.body.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  color: #c8c8d6;
  max-height: 260px;
  overflow: auto;
  margin-top: 8px;
  padding: 8px 9px;
  border-radius: 7px;
  background: #101017;
  border: 1px solid #2a2a36;
}
.body a { color: #fb923c; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
button {
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid #3a3a48;
  background: #23232e;
  color: #e7e7ee;
  cursor: pointer;
}
button:hover { background: #2e2e3c; }
button.primary {
  background: linear-gradient(135deg, #f97316 0%, #fbbf24 100%);
  border-color: transparent; color: #1a1006;
}
button.primary:hover { filter: brightness(1.08); }
.close {
  margin-left: auto; border: none; background: none; color: #6f6f80;
  font-size: 15px; line-height: 1; padding: 0 2px; cursor: pointer;
}
.close:hover { color: #e7e7ee; }
`;

export interface ToastAction {
  label: string;
  primary?: boolean;
  onClick: () => void | Promise<void>;
  /** Keep the toast open after the action runs. */
  keepOpen?: boolean;
}

export interface ToastOptions {
  title: string;
  body?: string;
  tone?: 'info' | 'success' | 'error';
  actions?: ToastAction[];
  /** ms before auto-dismiss; omit or pass 0 to require manual dismissal. */
  timeout?: number;
  /** Render the body as scrollable monospace — used for showing code back. */
  mono?: boolean;
}

let stack: HTMLDivElement | null = null;

function ensureStack(): HTMLDivElement {
  if (stack?.isConnected) return stack;

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;

  const container = document.createElement('div');
  container.className = 'stack';

  shadow.append(style, container);
  document.documentElement.append(host);
  stack = container;
  return container;
}

export function showToast(options: ToastOptions): () => void {
  const container = ensureStack();

  const card = document.createElement('div');
  card.className = `card ${options.tone ?? 'info'}`;

  const row = document.createElement('div');
  row.className = 'row';

  const dot = document.createElement('span');
  dot.className = 'dot';

  const text = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = options.title;
  text.append(title);

  if (options.body) {
    const body = document.createElement('div');
    body.className = options.mono ? 'body mono' : 'body';
    body.textContent = options.body;
    text.append(body);
  }

  const close = document.createElement('button');
  close.className = 'close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Dismiss');

  row.append(dot, text, close);
  card.append(row);

  const dismiss = () => card.remove();
  close.addEventListener('click', dismiss);

  if (options.actions?.length) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    for (const action of options.actions) {
      const button = document.createElement('button');
      if (action.primary) button.className = 'primary';
      button.textContent = action.label;
      button.addEventListener('click', () => {
        void action.onClick();
        if (!action.keepOpen) dismiss();
      });
      actions.append(button);
    }
    card.append(actions);
  }

  container.append(card);

  if (options.timeout && options.timeout > 0) {
    setTimeout(dismiss, options.timeout);
  }

  return dismiss;
}

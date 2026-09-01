/**
 * The workspace's stylesheet.
 *
 * Kept out of the module that builds the DOM because it is long, and because
 * the two are edited for different reasons. Everything lives inside one shadow
 * root, so none of it can touch the judge's page and none of the judge's CSS
 * can touch it — with one deliberate exception, the statement, which is slotted
 * in and keeps Codeforces' own styling (see `STATEMENT_CSS`).
 */
export const WORKSPACE_CSS = `
:host { all: initial; display: block; height: 100%; }
* { box-sizing: border-box; }

.ws {
  --bg: #fff;
  --surface: hsl(220 20% 98%);
  --raised: hsl(220 20% 96%);
  --border: hsl(220 13% 89%);
  --border-soft: hsl(220 13% 93%);
  --text: hsl(220 15% 16%);
  --muted: hsl(220 9% 42%);
  --faint: hsl(220 9% 58%);
  --accent: hsl(22 95% 52%);
  --accent-ink: #fff;
  --ok: hsl(152 55% 34%);
  --bad: hsl(0 70% 46%);
  --wait: hsl(38 92% 40%);
  --code-bg: hsl(220 20% 98%);

  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color-scheme: light;
}

.ws[data-theme="dark"] {
  --bg: hsl(240 12% 8%);
  --surface: hsl(240 10% 11%);
  --raised: hsl(240 8% 15%);
  --border: hsl(240 6% 20%);
  --border-soft: hsl(240 6% 16%);
  --text: hsl(0 0% 94%);
  --muted: hsl(0 0% 66%);
  --faint: hsl(0 0% 48%);
  --accent: hsl(22 95% 55%);
  --accent-ink: hsl(20 40% 8%);
  --ok: hsl(152 55% 52%);
  --bad: hsl(0 78% 66%);
  --wait: hsl(43 92% 58%);
  --code-bg: hsl(240 12% 6%);
  color-scheme: dark;
}

/* ------------------------------------------------------------------ header */

.hd {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.hd__mark {
  color: var(--accent);
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
}

.hd__title {
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40vw;
}

.hd__spacer { flex: 1; }

.hd__hint {
  font-size: 11px;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ----------------------------------------------------------------- buttons */

button {
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  padding: 5px 12px;
  white-space: nowrap;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
}

button.primary:hover:not(:disabled) { filter: brightness(1.08); color: var(--accent-ink); }

button.icon,
button.plain {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 8px;
  color: var(--muted);
  line-height: 1;
}

button.mini {
  padding: 2px 9px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
}

button.mini.on {
  background: var(--raised);
  border-color: var(--border);
  color: var(--text);
}

button.plain { border-color: transparent; background: none; }

/* -------------------------------------------------------------------- tabs */

.tabs {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.tab {
  border: none;
  background: none;
  border-radius: 0;
  padding: 9px 6px;
  color: var(--muted);
  font-weight: 500;
  border-bottom: 2px solid transparent;
}

.tab:hover:not(:disabled) { color: var(--text); border-color: transparent; }

.tab.on {
  color: var(--text);
  font-weight: 600;
  border-bottom-color: var(--accent);
}

.tabs__sep { color: var(--border); }

/* ------------------------------------------------------------------- split */

.split { flex: 1 1 auto; display: flex; min-height: 0; }

.pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.pane--left { flex: 0 0 auto; border-right: 1px solid var(--border); }
.pane--right { flex: 1 1 0; }

.ws.wide .pane--left, .ws.wide .drag { display: none; }

.drag {
  flex: 0 0 5px;
  cursor: col-resize;
  background: var(--border-soft);
  transition: background 120ms ease;
}

.drag:hover { background: var(--accent); }

.body { flex: 1 1 auto; overflow: auto; min-height: 0; }

/* --------------------------------------------------------------- statement */

.pr { padding: 18px 22px 48px; }
.pr__title { font-size: 19px; font-weight: 700; margin: 0 0 10px; }

.pr__chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }

.chip {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 6px;
  background: var(--raised);
  color: var(--muted);
  white-space: nowrap;
}

/* ------------------------------------------------------------- submissions */

.subs { padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }

.sub {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.sub a { color: var(--accent); text-decoration: none; font-weight: 600; }
.sub a:hover { text-decoration: underline; }

.ok { color: var(--ok); font-weight: 600; }
.bad { color: var(--bad); font-weight: 600; }
.wait { color: var(--wait); font-weight: 600; }

.muted { color: var(--muted); }
.faint { color: var(--faint); font-size: 11.5px; }

.mono {
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  font-variant-numeric: tabular-nums;
}

/* ------------------------------------------------------------------ editor */

.ed__bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

select {
  font: inherit;
  font-size: 12px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  padding: 4px 8px;
  max-width: 280px;
}

select:disabled { opacity: 0.6; }

.ed { flex: 1 1 auto; min-height: 0; overflow: hidden; background: var(--bg); }
.ed .cm-editor { height: 100%; }
.ed .cm-editor.cm-focused { outline: none; }

.ed__foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-top: 1px solid var(--border-soft);
  background: var(--bg);
  font-size: 11px;
  color: var(--faint);
}

.ed__foot .by { color: var(--accent); font-weight: 600; }

/* ------------------------------------------------------------------- tests */

.tests {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  max-height: 42vh;
  border-top: 1px solid var(--border);
  background: var(--surface);
}

.tests__body { overflow: auto; padding: 10px 14px 14px; }

.cases { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }

.label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--faint);
  margin: 8px 0 4px;
}

textarea {
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  font-size: 12px;
  width: 100%;
  min-height: 46px;
  resize: vertical;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  padding: 7px 9px;
  line-height: 1.5;
}

textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }

pre.out {
  margin: 0;
  padding: 7px 9px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--code-bg);
  color: var(--text);
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow: auto;
}

.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
`;

/**
 * The statement's own pane, styled from the light DOM.
 *
 * The statement is slotted rather than copied into the shadow root, so
 * Codeforces' stylesheet still applies to it — which is the point, and also the
 * problem: that stylesheet assumes a white page. In dark mode these rules put
 * the colours back. They are page-level CSS scoped under the overlay's id, and
 * they are swapped when the theme changes.
 */
export function statementCss(theme: 'dark' | 'light'): string {
  if (theme === 'light') return '';

  return `
#redo-workspace .problem-statement,
#redo-workspace .problem-statement * {
  color: hsl(0 0% 88%) !important;
  border-color: hsl(240 6% 24%) !important;
}

#redo-workspace .problem-statement a,
#redo-workspace .problem-statement a * { color: hsl(22 95% 62%) !important; }

#redo-workspace .problem-statement pre,
#redo-workspace .problem-statement .sample-test .input,
#redo-workspace .problem-statement .sample-test .output,
#redo-workspace .problem-statement table td,
#redo-workspace .problem-statement table th {
  background: hsl(240 12% 6%) !important;
}

/* Codeforces ships a few statement images with transparent backgrounds that
   assume dark ink on white; lifting them keeps the diagrams readable. */
#redo-workspace .problem-statement img { filter: invert(1) hue-rotate(180deg); }
`;
}

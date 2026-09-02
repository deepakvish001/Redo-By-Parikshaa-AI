/**
 * The stylesheet every on-page widget shares.
 *
 * Each widget lives in its own shadow root, so this string is what gives them a
 * common look without any of it leaking into the judge's own page — or the
 * judge's own CSS leaking in. `all: initial` on the host is the wall; everything
 * after it is Redo's side of it.
 *
 * The palette is the panel's, deliberately: the card in a Codeforces sidebar and
 * the card in the side panel should be recognisably the same product.
 */
export const PAGE_TOKENS = `
:host {
  all: initial;
  display: block;
  color-scheme: dark;

  --bg: hsl(240 25% 4%);
  --surface: hsl(0 0% 8%);
  --surface-raised: hsl(0 0% 12%);
  --border: hsl(0 0% 20%);
  --border-strong: hsl(0 0% 28%);

  --text: hsl(0 0% 97%);
  --text-muted: hsl(0 0% 63%);
  --text-faint: hsl(0 0% 45%);

  --accent: hsl(22 95% 55%);
  --accent-soft: hsl(27 96% 63%);
  --amber: hsl(43 96% 58%);
  --accent-wash: hsl(22 95% 55% / 0.14);

  --easy: hsl(152 60% 50%);
  --medium: hsl(43 96% 56%);
  --hard: hsl(0 84% 64%);
  --ok: hsl(152 60% 50%);
  --danger: hsl(0 84% 64%);

  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
}

* { box-sizing: border-box; }

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

/* Matches the "→ Title" header Codeforces puts on its own sidebar boxes, so
   the card reads as part of the page rather than pasted onto it. */
.head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 11px;
  background: var(--surface-raised);
  border-bottom: 1px solid var(--border);
}

.head__mark {
  color: var(--accent);
  font-weight: 700;
  font-size: 13px;
  line-height: 1;
}

.head__title {
  font-weight: 700;
  font-size: 12.5px;
  letter-spacing: 0.01em;
}

.head__spacer { flex: 1; }

.body {
  padding: 10px 11px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-muted);
  white-space: nowrap;
}

.chip--rating { color: var(--text); border-color: var(--border-strong); }
.chip--ok { color: hsl(152 40% 12%); background: var(--ok); border-color: transparent; }
.chip--due { color: hsl(20 40% 12%); background: var(--amber); border-color: transparent; }
.chip--tag { font-weight: 500; text-transform: none; }

.mono {
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  font-variant-numeric: tabular-nums;
}

.muted { color: var(--text-muted); font-size: 12px; }
.faint { color: var(--text-faint); font-size: 11.5px; }

button {
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  border-radius: 7px;
  border: 1px solid var(--border-strong);
  background: var(--surface-raised);
  color: var(--text);
  padding: 4px 9px;
  transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
}

button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-soft); }
button:disabled { opacity: 0.45; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: hsl(20 40% 8%);
}

button.primary:hover:not(:disabled) { background: var(--accent-soft); color: hsl(20 40% 8%); }

button.ghost { background: transparent; border-color: var(--border); color: var(--text-muted); }

button.link {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
}

.grid button { width: 100%; padding: 5px 2px; }

.sep { height: 1px; background: var(--border); margin: 1px 0; }

.timer {
  margin-left: auto;
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
}

textarea {
  font: inherit;
  font-size: 12px;
  width: 100%;
  min-height: 60px;
  resize: vertical;
  border-radius: 7px;
  border: 1px solid var(--border-strong);
  background: var(--bg);
  color: var(--text);
  padding: 6px 8px;
}

textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

a { color: var(--accent); text-underline-offset: 2px; }

/* A small caption above a group, as on the rail's "MORE LIKE THIS". */
.label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.nextlink {
  display: block;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  text-decoration: none;
  font-size: 12px;
}

.nextlink:hover { border-color: var(--accent); }

.similar {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
}

.similar__name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.similar__rating {
  flex: none;
  font-weight: 700;
  font-size: 11px;
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
`;

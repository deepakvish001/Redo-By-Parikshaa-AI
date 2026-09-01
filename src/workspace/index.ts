import { PAGE_TOKENS } from '../content/inject/tokens.ts';
import { button, h } from '../content/inject/dom.ts';
import { parseProblem } from '../core/cf-url.ts';
import {
  loadSubmitForm,
  readSamples,
  readVerdict,
  submitSolution,
  type LanguageOption,
  type SampleTest,
  type SubmitTarget,
} from './codeforces.ts';
import { createEditor, type Editor } from './editor.ts';
import { DRAFTS_KEY, draftKey, putDraft, type DraftMap } from './drafts.ts';

/**
 * The workspace: the statement on the left, an editor on the right.
 *
 * Codeforces asks you to read a problem in one tab, write it in an editor
 * somewhere else, then find the submit page and paste. It is the one item on
 * the list that changes how the site is used rather than adding a fact to it.
 *
 * This is a separate bundle, injected only when asked, because CodeMirror is
 * two hundred kilobytes and nobody browsing the problemset should pay for it.
 *
 * The overlay is deliberately not one shadow root. The statement is *moved*
 * into the left pane rather than copied — a copy loses the MathJax the page has
 * already rendered, and re-running MathJax over a clone is both slow and often
 * wrong — and a moved statement has to keep the site's own CSS with it. So the
 * left pane stays in the light DOM, and only Redo's chrome gets a shadow root.
 */

const HOST_ID = 'redo-workspace';
const SPLIT_KEY = 'workspaceSplit';
const DEFAULT_SPLIT = 0.5;
/** Past these the panes stop being two panes. */
const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.8;
/** Roughly a hundred seconds of judging before it stops asking. */
const MAX_POLLS = 40;

/** The few rules that cannot live in the shadow root, all prefixed by the host. */
const OVERLAY_CSS = `
#${HOST_ID} {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  background: hsl(240 25% 4%);
  color-scheme: dark;
}

/* The statement arrives styled for a white page, because that is the page it
   was written for. Giving the pane that background back is far more robust than
   restyling markup the site rewrites every year. */
#${HOST_ID} .redo-ws__left {
  flex: 0 0 auto;
  overflow: auto;
  background: #fff;
  color: #000;
  padding: 18px 22px 40px;
}

#${HOST_ID} .redo-ws__left img,
#${HOST_ID} .redo-ws__left table { max-width: 100%; }

#${HOST_ID} .redo-ws__drag {
  flex: 0 0 6px;
  cursor: col-resize;
  background: hsl(0 0% 16%);
  transition: background 120ms ease;
}

#${HOST_ID} .redo-ws__drag:hover { background: hsl(22 95% 55%); }

#${HOST_ID} .redo-ws__right {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
`;

/** The workspace's own layout, inside the shadow root. */
const PANEL_CSS = `
:host { height: 100%; }

.ws {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
}

.ws__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.ws__title { font-weight: 700; font-size: 12.5px; }
.ws__spacer { flex: 1; }

.ws__editor {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.ws__editor .cm-editor { height: 100%; }

.ws__tests {
  flex: 0 0 auto;
  max-height: 36vh;
  overflow: auto;
  border-top: 1px solid var(--border);
  background: var(--surface);
  padding: 9px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ws__case {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}

.ws__case pre {
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg);
  color: var(--text);
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 130px;
  overflow: auto;
}

select {
  font: inherit;
  font-size: 11.5px;
  border-radius: 7px;
  border: 1px solid var(--border-strong);
  background: var(--surface-raised);
  color: var(--text);
  padding: 4px 7px;
  max-width: 230px;
}

select:disabled { opacity: 0.5; }

.status { font-size: 11.5px; font-weight: 600; color: var(--text-muted); }
.status--ok { color: var(--ok); }
.status--bad { color: var(--danger); }
.status--wait { color: var(--amber); }
`;

/* ---------------------------------------------------------------- storage */

async function readSplit(): Promise<number> {
  try {
    const stored = await chrome.storage.local.get(SPLIT_KEY);
    const value = stored[SPLIT_KEY];
    return typeof value === 'number' && value >= MIN_SPLIT && value <= MAX_SPLIT
      ? value
      : DEFAULT_SPLIT;
  } catch {
    return DEFAULT_SPLIT;
  }
}

async function readDrafts(): Promise<DraftMap> {
  try {
    const stored = await chrome.storage.local.get(DRAFTS_KEY);
    return (stored[DRAFTS_KEY] as DraftMap | undefined) ?? {};
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------- view */

/**
 * The sample cases, and the honest note about running them.
 *
 * A browser cannot compile C++. The only two ways to actually run a solution
 * are Codeforces' own custom invocation — no API, rate-limited, and a POST this
 * extension has no way to verify — or shipping the source to somebody else's
 * judge, which contradicts the whole promise. So the samples are here to read
 * and to copy, the limit is written on the panel, and the link goes to the
 * site's own custom invocation rather than to a Run button that lies.
 */
function testsPanel(samples: SampleTest[], target: SubmitTarget): HTMLElement {
  const panel = h('div', { class: 'ws__tests' });

  panel.append(
    h('div', { class: 'row' },
      h('span', { class: 'ws__title', text: `Sample tests · ${samples.length}` }),
      h('span', { class: 'ws__spacer' }),
      h('a', {
        class: 'chip',
        style: 'text-decoration:none',
        href: '/problemset/customtest',
        target: '_blank',
        rel: 'noopener',
        text: 'Custom invocation ↗',
      }),
    ),
  );

  if (samples.length === 0) {
    panel.append(
      h('div', { class: 'faint', text: 'This statement has no sample block Redo could read.' }),
    );
    return panel;
  }

  for (const [index, sample] of samples.entries()) {
    const input = h('pre');
    input.textContent = sample.input;
    const output = h('pre');
    output.textContent = sample.output;

    const copy = button('Copy input', () => {
      void navigator.clipboard.writeText(sample.input).catch(() => undefined);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy input'; }, 1200);
    }, { class: 'ghost' });

    panel.append(
      h('div', { class: 'row' },
        h('span', { class: 'faint', text: `Case ${index + 1}` }),
        h('span', { class: 'ws__spacer' }),
        copy,
      ),
      h('div', { class: 'ws__case' }, input, output),
    );
  }

  panel.append(
    h('div', {
      class: 'faint',
      text:
        'Redo cannot run these: a browser has no compiler, and sending your code to a third-party '
        + 'judge would break the promise that it stays on your machine. Submit posts to Codeforces '
        + `for problem ${target.index} — the only judge involved.`,
    }),
  );

  return panel;
}

/* ------------------------------------------------------------------- open */

/**
 * How a second injection closes the first one.
 *
 * `chrome.scripting.executeScript` runs the whole bundle again, and each run
 * gets its own module scope — so a module-level `teardown` variable is
 * `undefined` in the copy that needs to call it, and the toggle silently does
 * nothing while the overlay stays up. An event on the document is the one
 * channel both copies genuinely share.
 */
const CLOSE_EVENT = 'redo-workspace-close';

export function closeWorkspace(): void {
  document.dispatchEvent(new CustomEvent(CLOSE_EVENT));
}

export async function openWorkspace(): Promise<void> {
  // Toggle: the same button, and the same keystroke, closes it again.
  if (document.getElementById(HOST_ID)) {
    closeWorkspace();
    return;
  }

  const target = parseProblem(window.location.pathname);
  const statement = document.querySelector('.problem-statement');
  if (!target || !statement) return;

  const key = draftKey(target.contestId, target.index);
  const [split, drafts] = await Promise.all([readSplit(), readDrafts()]);
  const draft = drafts[key];

  // Read the samples before the statement moves. The markup is the same either
  // way, but reading first means a parse failure costs nothing.
  const samples = readSamples(statement);

  /* ---------------------------------------------------------- the overlay */

  const style = h('style', { id: `${HOST_ID}-style` });
  style.textContent = OVERLAY_CSS;
  document.head.append(style);

  const host = h('div', { id: HOST_ID });
  const left = h('div', { class: 'redo-ws__left' });
  const drag = h('div', { class: 'redo-ws__drag' });
  const right = h('div', { class: 'redo-ws__right' });
  host.append(left, drag, right);

  // Where the statement came from, so closing puts it back exactly where it was
  // rather than at the end of whatever contained it.
  const placeholder = document.createComment('redo-workspace-statement');
  const bodyOverflow = document.body.style.overflow;
  statement.replaceWith(placeholder);
  left.append(statement);

  const shadow = right.attachShadow({ mode: 'open' });
  const tokens = document.createElement('style');
  tokens.textContent = PAGE_TOKENS + PANEL_CSS;
  const panel = h('div', { class: 'ws' });
  shadow.append(tokens, panel);

  document.body.append(host);
  document.body.style.overflow = 'hidden';

  const setSplit = (ratio: number): number => {
    const clamped = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, ratio));
    left.style.flexBasis = `${clamped * 100}%`;
    return clamped;
  };
  setSplit(split);

  /* --------------------------------------------------------- the teardown */

  const controller = new AbortController();
  let editor: Editor | undefined;

  const teardown = () => {
    controller.abort();
    editor?.destroy();
    // The statement goes home before the overlay is removed, so a failure on
    // the next line leaves the page whole rather than blank.
    placeholder.replaceWith(statement);
    document.body.style.overflow = bodyOverflow;
    host.remove();
    style.remove();
  };

  // Registered before anything can throw, so the overlay is always closable.
  document.addEventListener(CLOSE_EVENT, teardown, {
    once: true,
    signal: controller.signal,
  });

  document.addEventListener('keydown', (event) => {
    // Escape closes, except from inside the editor, where Escape is how you
    // leave a selection rather than how you throw the window away.
    if (event.key === 'Escape' && !right.contains(event.target as Node)) closeWorkspace();
  }, { signal: controller.signal });

  /* ----------------------------------------------------------- the resize */

  drag.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    drag.setPointerCapture(event.pointerId);

    const move = (moved: PointerEvent) => setSplit(moved.clientX / window.innerWidth);
    drag.addEventListener('pointermove', move, { signal: controller.signal });

    drag.addEventListener('pointerup', () => {
      drag.removeEventListener('pointermove', move);
      const ratio = setSplit(left.getBoundingClientRect().width / window.innerWidth);
      void chrome.storage.local.set({ [SPLIT_KEY]: ratio });
    }, { once: true, signal: controller.signal });
  }, { signal: controller.signal });

  /* -------------------------------------------------------------- the bar */

  const languages = h('select');
  languages.disabled = true;
  languages.append(h('option', { value: '', text: 'Loading compilers…' }));

  const status = h('span', { class: 'status' });
  const setStatus = (text: string, tone?: 'ok' | 'bad' | 'wait') => {
    status.className = tone ? `status status--${tone}` : 'status';
    status.textContent = text;
  };

  const submit = button('Submit', () => void send(), { class: 'primary', disabled: true });

  const bar = h('div', { class: 'ws__bar' },
    h('span', { class: 'head__mark', text: '↻' }),
    h('span', { class: 'ws__title', text: `${target.contestId}${target.index}` }),
    languages,
    h('span', { class: 'ws__spacer' }),
    status,
    submit,
    button('Close', closeWorkspace, { class: 'ghost' }),
  );

  const editorHost = h('div', { class: 'ws__editor' });
  panel.append(bar, editorHost, testsPanel(samples, target));

  /* ----------------------------------------------------------- the editor */

  const languageName = () => languages.selectedOptions[0]?.textContent ?? '';

  let pending: ReturnType<typeof setTimeout> | undefined;
  const remember = (source: string) => {
    if (pending) clearTimeout(pending);
    // Debounced, but only just: the cost of writing is one storage set, and the
    // cost of not writing is somebody's solution.
    pending = setTimeout(() => {
      void readDrafts()
        .then((current) =>
          chrome.storage.local.set({
            [DRAFTS_KEY]: putDraft(current, key, {
              source,
              languageId: languages.value || undefined,
              at: Date.now(),
            }),
          }),
        )
        .catch(() => undefined);
    }, 600);
  };

  editor = createEditor(editorHost, {
    doc: draft?.source ?? '',
    language: '',
    onChange: remember,
  });

  languages.addEventListener('change', () => {
    editor?.setLanguage(languageName());
    remember(editor?.value() ?? '');
  }, { signal: controller.signal });

  /* ---------------------------------------------------------- the verdict */

  /**
   * Waits for the verdict, then stops.
   *
   * Bounded on purpose: a queue that is ten minutes deep must not leave this
   * polling forever behind a workspace nobody is looking at any more. It gives
   * up out loud and points at the status page.
   */
  const poll = async (attempt = 0): Promise<void> => {
    if (controller.signal.aborted) return;
    if (attempt >= MAX_POLLS) {
      setStatus('Still judging — check the status page.', 'wait');
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1500 : 2500));
    if (controller.signal.aborted) return;

    const verdict = await readVerdict(target).catch(() => undefined);
    if (!verdict || verdict.waiting) {
      if (verdict?.verdict) setStatus(verdict.verdict, 'wait');
      return poll(attempt + 1);
    }

    setStatus(verdict.verdict, /^(accepted|ok)/i.test(verdict.verdict) ? 'ok' : 'bad');
  };

  const send = async (): Promise<void> => {
    const source = editor?.value() ?? '';
    if (source.trim() === '') {
      setStatus('Nothing to submit.', 'bad');
      return;
    }

    submit.disabled = true;
    setStatus('Submitting…', 'wait');

    try {
      // The token is re-read rather than reused: Codeforces rotates it, and a
      // workspace left open for an hour would be posting a dead one.
      const fresh = await loadSubmitForm(target);
      const result = await submitSolution(target, {
        csrf: fresh.csrf,
        programTypeId: languages.value,
        source,
      });

      if (!result.ok) {
        setStatus(result.error ?? 'Codeforces refused the submission.', 'bad');
        return;
      }

      setStatus('In queue…', 'wait');
      await poll();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'bad');
    } finally {
      submit.disabled = false;
    }
  };

  /* -------------------------------------------------------- the compilers */

  const fillLanguages = (options: LanguageOption[]): void => {
    languages.replaceChildren();
    for (const option of options) {
      languages.append(h('option', { value: option.id, text: option.name }));
    }

    // The compiler you used last is the compiler you want, which is why the
    // draft carries it. Coming back to a problem in Delphi is a joke that stops
    // being funny the first time it costs a compile error.
    const wanted = draft?.languageId;
    if (wanted && options.some((option) => option.id === wanted)) languages.value = wanted;

    languages.disabled = false;
    editor?.setLanguage(languageName());
  };

  try {
    const form = await loadSubmitForm(target);
    if (controller.signal.aborted) return;
    fillLanguages(form.languages);
    submit.disabled = false;
    setStatus('');
  } catch (error) {
    if (controller.signal.aborted) return;
    // The editor still works, and the draft is still saved. Only submitting is
    // gone, which is what the message says rather than blanking the panel.
    languages.replaceChildren(h('option', { value: '', text: 'Unavailable' }));
    setStatus(error instanceof Error ? error.message : String(error), 'bad');
  }
}

void openWorkspace();

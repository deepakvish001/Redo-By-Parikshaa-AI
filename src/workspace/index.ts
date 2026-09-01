import { button, h } from '../content/inject/dom.ts';
import { parseProblem } from '../core/cf-url.ts';
import { send } from '../core/messages.ts';
import {
  fetchSubmissions,
  loadSubmitForm,
  readSamples,
  readVerdict,
  submitSolution,
  type LanguageOption,
  type SubmissionRow,
} from './codeforces.ts';
import { loadCustomTestForm, openCustomTest, runOnCodeforces, type RunOutcome } from './customtest.ts';
import { caretLabel, createEditor, type Editor, type Theme } from './editor.ts';
import { DRAFTS_KEY, draftKey, putDraft, type Draft, type DraftMap, type TestCase } from './drafts.ts';
import { WORKSPACE_CSS, statementCss } from './ui.css.ts';

/**
 * The workspace: the statement on the left, an editor on the right.
 *
 * Codeforces asks you to read a problem in one tab, write it in an editor
 * somewhere else, then find the submit page and paste. This replaces all three
 * with one screen — and it is the only feature here that covers the page rather
 * than adding to it, so it takes an explicit switch and an explicit press.
 *
 * **Nothing is compiled or run in the browser.** Run and Submit both hand the
 * source, the compiler id and (for Run) the input to Codeforces, through
 * Codeforces' own forms and the CSRF token that page issued to this session.
 * Codeforces compiles it, Codeforces runs it, Codeforces judges it; this shows
 * what comes back. That is the whole design, not a limitation worked around.
 *
 * The statement is *slotted*, not copied. A copy loses the MathJax the page has
 * already rendered; a slotted node stays a light-DOM child of the host, so
 * Codeforces' own stylesheet still applies to it while it renders inside the
 * shadow tree's layout. That is also why the dark theme ships a second, tiny
 * page-level stylesheet: the site's CSS assumes a white page.
 */

const HOST_ID = 'redo-workspace';
const SPLIT_KEY = 'workspaceSplit';
const THEME_KEY = 'workspaceTheme';
const DEFAULT_SPLIT = 0.44;
const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.8;
/** Roughly a hundred seconds of judging before it stops asking. */
const MAX_POLLS = 40;

/**
 * How a second injection closes the first one.
 *
 * `chrome.scripting.executeScript` runs the whole bundle again, and each run
 * gets its own module scope — so a module-level variable holding the teardown
 * is `undefined` in the copy that needs to call it. An event on the document is
 * the one channel both copies genuinely share.
 */
const CLOSE_EVENT = 'redo-workspace-close';

const OVERLAY_CSS = `
#${HOST_ID} { position: fixed; inset: 0; z-index: 2147483000; }
#${HOST_ID} .problem-statement { max-width: 100%; }
#${HOST_ID} .problem-statement img { max-width: 100%; height: auto; }
`;

export function closeWorkspace(): void {
  document.dispatchEvent(new CustomEvent(CLOSE_EVENT));
}

/* ---------------------------------------------------------------- storage */

async function readStored<T>(key: string, fallback: T, ok: (value: unknown) => boolean): Promise<T> {
  try {
    const stored = await chrome.storage.local.get(key);
    return ok(stored[key]) ? (stored[key] as T) : fallback;
  } catch {
    return fallback;
  }
}

async function readDrafts(): Promise<DraftMap> {
  return readStored<DraftMap>(DRAFTS_KEY, {}, (value) => typeof value === 'object' && value !== null);
}

/* ------------------------------------------------------------------- bits */

const isAccepted = (verdict: string) => /^(accepted|ok|полное)/i.test(verdict);

function verdictClass(row: { verdict: string; waiting: boolean }): string {
  if (row.waiting) return 'wait';
  return isAccepted(row.verdict) ? 'ok' : 'bad';
}

/** Codeforces' own rank colours, which are what a rating means to a reader. */
function ratingColour(rating: number): string {
  if (rating >= 2400) return 'hsl(0 75% 55%)';
  if (rating >= 2100) return 'hsl(30 90% 45%)';
  if (rating >= 1900) return 'hsl(291 50% 52%)';
  if (rating >= 1600) return 'hsl(222 80% 55%)';
  if (rating >= 1400) return 'hsl(175 55% 35%)';
  if (rating >= 1200) return 'hsl(122 40% 38%)';
  return 'hsl(240 4% 45%)';
}

/**
 * A stable pastel per tag.
 *
 * Hashed rather than assigned, because Codeforces has around forty tags and a
 * hand-written table would be missing whichever one the next round uses. The
 * point is only that "graphs" is the same colour every time you see it.
 */
function tagColour(tag: string, theme: Theme): { background: string; color: string } {
  let hash = 0;
  for (const character of tag) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return theme === 'dark'
    ? { background: `hsl(${hue} 45% 18%)`, color: `hsl(${hue} 70% 76%)` }
    : { background: `hsl(${hue} 72% 93%)`, color: `hsl(${hue} 55% 32%)` };
}

/**
 * The header's icons, as inline SVG.
 *
 * Not glyphs. A moon and a sun exist in Unicode, and on a machine without a
 * font that carries them they render as a box — which is exactly what happened
 * the first time this shipped with `\u263E`.
 */
function icon(path: string): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = path;
  return svg;
}

const ICONS = {
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5"/>',
  expand: '<path d="M15 3h6v6M21 3l-8 8M9 21H3v-6M3 21l8-8"/>',
  collapse: '<path d="M21 9h-6V3M15 9l7-7M3 15h6v6M9 15l-7 7"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
};

/* ------------------------------------------------------------------- open */

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
  const [split, storedTheme, drafts] = await Promise.all([
    readStored(SPLIT_KEY, DEFAULT_SPLIT, (v) => typeof v === 'number' && v >= MIN_SPLIT && v <= MAX_SPLIT),
    // Light unless you have said otherwise. The statement arrives styled for a
    // white page, because that is the page Codeforces wrote it for, so light is
    // the theme that needs no correcting — and the toggle remembers your answer
    // from the first time you press it.
    readStored<Theme>(THEME_KEY, 'light', (v) => v === 'dark' || v === 'light'),
    readDrafts(),
  ]);

  const draft: Draft | undefined = drafts[key];
  let theme: Theme = storedTheme;

  // Read the statement before it moves. The markup is the same either way, but
  // reading first means a parse failure costs nothing.
  const samples = readSamples(statement);
  const heading = statement.querySelector('.header .title')?.textContent?.trim();
  const limits = [
    statement.querySelector('.time-limit')?.textContent?.replace(/^time limit per test/i, '').trim(),
    statement.querySelector('.memory-limit')?.textContent?.replace(/^memory limit per test/i, '').trim(),
  ].filter(Boolean) as string[];

  let tests: TestCase[] =
    draft?.tests?.length
      ? draft.tests
      : samples.map((sample) => ({ input: sample.input, expected: sample.output }));
  if (tests.length === 0) tests = [{ input: '', expected: '' }];
  let current = 0;

  /* ---------------------------------------------------------- the overlay */

  const pageStyle = h('style', { id: `${HOST_ID}-style` });
  pageStyle.textContent = OVERLAY_CSS + statementCss(theme);
  document.head.append(pageStyle);

  const host = h('div', { id: HOST_ID });
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = document.createElement('style');
  sheet.textContent = WORKSPACE_CSS;

  const ws = h('div', { class: 'ws' });
  ws.dataset.theme = theme;
  shadow.append(sheet, ws);

  // Where the statement came from, so closing puts it back exactly where it
  // was rather than at the end of whatever contained it.
  const placeholder = document.createComment('redo-workspace-statement');
  const bodyOverflow = document.body.style.overflow;
  const statementHeader = statement.querySelector('.header') as HTMLElement | null;
  const headerDisplay = statementHeader?.style.display ?? '';
  statement.replaceWith(placeholder);
  // A light-DOM child of the host: rendered through the slot below, still
  // styled by Codeforces.
  host.append(statement);
  // Its own title block is replaced by the header bar and the chips.
  if (statementHeader) statementHeader.style.display = 'none';

  document.body.append(host);
  document.body.style.overflow = 'hidden';

  const controller = new AbortController();
  let editor: Editor | undefined;

  const teardown = () => {
    controller.abort();
    editor?.destroy();
    // The statement goes home before the overlay is removed, so a failure on
    // the next line leaves the page whole rather than blank.
    if (statementHeader) statementHeader.style.display = headerDisplay;
    placeholder.replaceWith(statement);
    document.body.style.overflow = bodyOverflow;
    host.remove();
    pageStyle.remove();
  };

  // Registered before anything can throw, so the overlay is always closable.
  document.addEventListener(CLOSE_EVENT, teardown, { once: true, signal: controller.signal });

  /* ----------------------------------------------------------- the header */

  const title = h('span', { class: 'hd__title', text: heading ?? `${target.contestId}${target.index}` });
  const status = h('span', { class: 'faint' });
  const setStatus = (text: string, tone?: 'ok' | 'bad' | 'wait') => {
    status.className = tone ?? 'faint';
    status.textContent = text;
  };

  const runButton = button('Run', () => void run(), { title: 'Runs on Codeforces, not here' });
  const submitButton = button('Submit', () => void submit(), { class: 'primary' });
  runButton.disabled = true;
  submitButton.disabled = true;

  const themeButton = button('', () => setTheme(theme === 'dark' ? 'light' : 'dark'), {
    class: 'icon',
    title: 'Light or dark',
  });

  const backButton = button('', closeWorkspace, { class: 'plain', title: 'Close the workspace' });
  backButton.append(icon(ICONS.back));

  const header = h('div', { class: 'hd' },
    backButton,
    h('span', { class: 'hd__mark', text: '↻' }),
    title,
    h('span', { class: 'hd__spacer' }),
    status,
    themeButton,
    runButton,
    h('span', { class: 'hd__hint', text: runHint() }),
    submitButton,
  );

  /* ------------------------------------------------------------ the panes */

  const statementPane = h('div', { class: 'body' },
    h('div', { class: 'pr' },
      h('h1', { class: 'pr__title', text: heading ?? `${target.contestId}${target.index}` }),
      h('div', { class: 'pr__chips' }),
      h('slot'),
    ),
  );
  const chips = statementPane.querySelector('.pr__chips') as HTMLElement;
  for (const limit of limits) chips.append(h('span', { class: 'chip', text: limit }));

  const subsPane = h('div', { class: 'body' },
    h('div', { class: 'subs' }, h('div', { class: 'faint', text: 'Loading…' })),
  );
  subsPane.hidden = true;

  const problemTab = button('Problem', () => showLeft('problem'), { class: 'tab on' });
  const subsTab = button('My Submissions', () => showLeft('subs'), { class: 'tab' });

  let subsLoaded = false;
  const showLeft = (which: 'problem' | 'subs') => {
    problemTab.classList.toggle('on', which === 'problem');
    subsTab.classList.toggle('on', which === 'subs');
    statementPane.hidden = which !== 'problem';
    subsPane.hidden = which !== 'subs';
    if (which === 'subs' && !subsLoaded) {
      subsLoaded = true;
      void loadSubmissions();
    }
  };

  const left = h('section', { class: 'pane pane--left' },
    h('nav', { class: 'tabs' }, problemTab, subsTab),
    statementPane,
    subsPane,
  );

  const drag = h('div', { class: 'drag' });

  /* ---------------------------------------------------------- the editor */

  const languages = h('select');
  languages.disabled = true;
  languages.append(h('option', { value: '', text: 'Loading compilers…' }));

  const expand = button('', () => {
    const wide = ws.classList.toggle('wide');
    expand.title = wide ? 'Show the statement' : 'Hide the statement';
    expand.replaceChildren(icon(wide ? ICONS.collapse : ICONS.expand));
  }, { class: 'icon', title: 'Hide the statement' });
  expand.append(icon(ICONS.expand));

  const caret = h('span', { text: 'Ln 1, Ch 0', class: 'mono' });
  const editorHost = h('div', { class: 'ed' });

  const right = h('section', { class: 'pane pane--right' },
    h('div', { class: 'ed__bar' }, languages, h('span', { class: 'hd__spacer' }), expand),
    editorHost,
    h('div', { class: 'ed__foot' },
      h('span', { class: 'by', text: 'Redo' }),
      h('span', { class: 'hd__spacer' }),
      caret,
    ),
  );

  /* ------------------------------------------------------------ the tests */

  const caseRow = h('div', { class: 'cases' });
  const input = h('textarea', { spellcheck: 'false' });
  const expected = h('textarea', { spellcheck: 'false' });
  const resultBody = h('div', {}, h('div', { class: 'faint', text: 'Press Run to send this case to Codeforces.' }));

  const samplesBody = h('div', {},
    caseRow,
    h('div', { class: 'label', text: 'INPUT' }),
    input,
    h('div', { class: 'label', text: 'OUTPUT' }),
    expected,
  );

  const samplesTab = button('Sample Tests', () => showTests('samples'), { class: 'tab on' });
  const resultTab = button('Test Result', () => showTests('result'), { class: 'tab' });

  const testsBody = h('div', { class: 'tests__body' }, samplesBody, resultBody);
  resultBody.hidden = true;

  const showTests = (which: 'samples' | 'result') => {
    samplesTab.classList.toggle('on', which === 'samples');
    resultTab.classList.toggle('on', which === 'result');
    samplesBody.hidden = which !== 'samples';
    resultBody.hidden = which !== 'result';
  };

  right.append(
    h('div', { class: 'tests' },
      h('nav', { class: 'tabs' },
        samplesTab,
        h('span', { class: 'tabs__sep', text: '|' }),
        resultTab,
      ),
      testsBody,
    ),
  );

  const drawCases = () => {
    caseRow.replaceChildren();
    for (const [index, _case] of tests.entries()) {
      const chip = button(`Case ${index + 1}`, () => {
        commitCase();
        current = index;
        drawCases();
      }, { class: index === current ? 'mini on' : 'mini' });
      caseRow.append(chip);
    }

    caseRow.append(
      button('+', () => {
        commitCase();
        tests.push({ input: '', expected: '' });
        current = tests.length - 1;
        drawCases();
        input.focus();
      }, { class: 'mini', title: 'Add a case' }),
    );

    if (tests.length > 1) {
      caseRow.append(
        button('−', () => {
          tests.splice(current, 1);
          current = Math.max(0, current - 1);
          drawCases();
          remember();
        }, { class: 'mini', title: 'Remove this case' }),
      );
    }

    input.value = tests[current]?.input ?? '';
    expected.value = tests[current]?.expected ?? '';
  };

  const commitCase = () => {
    const test = tests[current];
    if (!test) return;
    test.input = input.value;
    test.expected = expected.value;
  };

  for (const box of [input, expected]) {
    box.addEventListener('input', () => {
      commitCase();
      remember();
    }, { signal: controller.signal });
  }

  drawCases();

  /* ------------------------------------------------------------ assembly */

  ws.append(header, h('div', { class: 'split' }, left, drag, right));

  const setSplit = (ratio: number): number => {
    const clamped = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, ratio));
    left.style.flexBasis = `${clamped * 100}%`;
    return clamped;
  };
  setSplit(split);

  const setTheme = (next: Theme) => {
    theme = next;
    ws.dataset.theme = next;
    pageStyle.textContent = OVERLAY_CSS + statementCss(next);
    // The button offers the *other* theme, so it shows the other theme's icon.
    themeButton.replaceChildren(icon(next === 'dark' ? ICONS.sun : ICONS.moon));
    editor?.setTheme(next);
    paintTags();
    void chrome.storage.local.set({ [THEME_KEY]: next });
  };

  /* ------------------------------------------------------------- the tags */

  let tags: string[] = [];
  let rating: number | undefined;

  const paintTags = () => {
    for (const chip of chips.querySelectorAll('[data-tag]')) chip.remove();

    if (rating !== undefined) {
      const chip = h('span', { class: 'chip', 'data-tag': 'rating', text: `★ ${rating}` });
      chip.style.color = ratingColour(rating);
      chips.prepend(chip);
    }

    for (const tag of tags) {
      const chip = h('span', { class: 'chip', 'data-tag': tag, text: tag });
      const colours = tagColour(tag, theme);
      chip.style.background = colours.background;
      chip.style.color = colours.color;
      chips.append(chip);
    }
  };

  void send({ type: 'rail:get', platform: 'codeforces', slug: `${target.contestId}${target.index}` })
    .then((data) => {
      if (controller.signal.aborted) return;
      tags = data.cf?.tags ?? [];
      rating = data.cf?.rating;
      paintTags();
    })
    .catch(() => undefined);

  /* ---------------------------------------------------------- the resize */

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

  document.addEventListener('keydown', (event) => {
    // Escape closes, except from inside the editor, where Escape is how you
    // leave a selection rather than how you throw the window away.
    if (event.key === 'Escape' && !host.contains(event.target as Node)) closeWorkspace();
  }, { signal: controller.signal });

  /* ----------------------------------------------------------- the drafts */

  let pending: ReturnType<typeof setTimeout> | undefined;
  const remember = () => {
    if (pending) clearTimeout(pending);
    // Debounced, but only just: the cost of writing is one storage set, and the
    // cost of not writing is somebody's solution.
    pending = setTimeout(() => {
      void readDrafts()
        .then((stored) =>
          chrome.storage.local.set({
            [DRAFTS_KEY]: putDraft(stored, key, {
              source: editor?.value() ?? '',
              languageId: languages.value || undefined,
              tests,
              at: Date.now(),
            }),
          }),
        )
        .catch(() => undefined);
    }, 600);
  };

  const languageName = () => languages.selectedOptions[0]?.textContent ?? '';

  editor = createEditor(editorHost, {
    doc: draft?.source ?? '',
    language: '',
    theme,
    hint: '// Write your solution here\u2026',
    onChange: remember,
    onCaret: (label) => { caret.textContent = label; },
    onRun: () => void run(),
  });
  caret.textContent = caretLabel(editor.view.state);
  setTheme(theme);

  languages.addEventListener('change', () => {
    editor?.setLanguage(languageName());
    remember();
  }, { signal: controller.signal });

  /* ------------------------------------------------------------- my subs */

  async function loadSubmissions(): Promise<void> {
    const list = subsPane.querySelector('.subs') as HTMLElement;
    try {
      const rows = await fetchSubmissions(target!);
      if (controller.signal.aborted) return;
      list.replaceChildren();

      if (rows.length === 0) {
        list.append(h('div', { class: 'faint', text: 'Nothing submitted for this problem yet.' }));
        return;
      }

      for (const row of rows) list.append(submissionRow(row));
    } catch (error) {
      list.replaceChildren(
        h('div', { class: 'faint', text: error instanceof Error ? error.message : String(error) }),
      );
    }
  }

  function submissionRow(row: SubmissionRow): HTMLElement {
    const link = h('a', {
      href: `/contest/${target!.contestId}/submission/${row.id}`,
      target: '_blank',
      rel: 'noopener',
      text: row.id,
    });

    return h('div', { class: 'sub' },
      link,
      h('span', { class: verdictClass(row), text: row.verdict || 'Unknown' }),
      h('span', { class: 'hd__spacer' }),
      row.language ? h('span', { class: 'faint', text: row.language }) : false,
      row.time ? h('span', { class: 'faint mono', text: row.time }) : false,
      row.when ? h('span', { class: 'faint', text: row.when }) : false,
    );
  }

  /* ----------------------------------------------------------------- run */

  /**
   * Sends this case to Codeforces' custom invocation and shows what came back.
   *
   * Nothing is compiled here. If the result page cannot be read — it is the one
   * piece of Codeforces markup with no stable shape — the whole run is handed
   * to a real Codeforces tab instead, which cannot fail.
   */
  async function run(): Promise<void> {
    commitCase();
    const source = editor?.value() ?? '';
    if (source.trim() === '') {
      showTests('result');
      resultBody.replaceChildren(h('div', { class: 'bad', text: 'Nothing to run.' }));
      return;
    }

    runButton.disabled = true;
    showTests('result');
    resultBody.replaceChildren(h('div', { class: 'wait', text: 'Running on Codeforces…' }));

    const request = {
      csrf: '',
      programTypeId: languages.value,
      source,
      input: tests[current]?.input ?? '',
    };

    try {
      const form = await loadCustomTestForm();
      request.csrf = form.csrf;

      const outcome = await runOnCodeforces(request);
      if (controller.signal.aborted) return;

      resultBody.replaceChildren(
        outcome ? runResult(outcome) : handOff(request),
      );
    } catch (error) {
      resultBody.replaceChildren(
        h('div', { class: 'bad', text: error instanceof Error ? error.message : String(error) }),
        handOff(request),
      );
    } finally {
      runButton.disabled = false;
    }
  }

  function runResult(outcome: RunOutcome): HTMLElement {
    const wrap = h('div', {});
    const head = h('div', { class: 'row' });

    if (outcome.verdict) {
      head.append(
        h('span', {
          class: isAccepted(outcome.verdict) ? 'ok' : 'bad',
          text: outcome.verdict,
        }),
      );
    }
    if (outcome.time) head.append(h('span', { class: 'faint mono', text: outcome.time }));
    if (outcome.memory) head.append(h('span', { class: 'faint mono', text: outcome.memory }));

    // Compared, not judged: the sample's answer is one accepted answer, and a
    // problem with several valid outputs would make a "wrong" here a lie.
    const want = (tests[current]?.expected ?? '').trim();
    const got = (outcome.output ?? '').trim();
    if (want && outcome.output !== undefined) {
      head.append(
        got === want
          ? h('span', { class: 'ok', text: '✓ matches the expected output' })
          : h('span', { class: 'bad', text: '≠ differs from the expected output' }),
      );
    }

    wrap.append(head);

    if (outcome.output !== undefined) {
      wrap.append(h('div', { class: 'label', text: 'OUTPUT' }));
      const out = h('pre', { class: 'out' });
      out.textContent = outcome.output || '(nothing)';
      wrap.append(out);
    }

    if (outcome.error) {
      wrap.append(h('div', { class: 'label', text: 'FROM THE JUDGE' }));
      const log = h('pre', { class: 'out' });
      log.textContent = outcome.error;
      wrap.append(log);
    }

    return wrap;
  }

  function handOff(request: { csrf: string; programTypeId: string; source: string; input: string }): HTMLElement {
    return h('div', { class: 'row', style: 'margin-top:8px' },
      h('span', {
        class: 'faint',
        text: 'Codeforces ran it but Redo could not read the result page.',
      }),
      button('Open it on Codeforces', () => openCustomTest(request)),
    );
  }

  /* -------------------------------------------------------------- submit */

  /**
   * Waits for the verdict, then stops.
   *
   * Bounded on purpose: a queue that is ten minutes deep must not leave this
   * polling forever behind a workspace nobody is looking at any more.
   */
  const poll = async (attempt = 0): Promise<void> => {
    if (controller.signal.aborted) return;
    if (attempt >= MAX_POLLS) {
      setStatus('Still judging — see My Submissions.', 'wait');
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1500 : 2500));
    if (controller.signal.aborted) return;

    const verdict = await readVerdict(target!).catch(() => undefined);
    if (!verdict || verdict.waiting) {
      if (verdict?.verdict) setStatus(verdict.verdict, 'wait');
      return poll(attempt + 1);
    }

    setStatus(verdict.verdict, isAccepted(verdict.verdict) ? 'ok' : 'bad');
    subsLoaded = false;
    if (!subsPane.hidden) {
      subsLoaded = true;
      void loadSubmissions();
    }
  };

  const submit = async (): Promise<void> => {
    const source = editor?.value() ?? '';
    if (source.trim() === '') {
      setStatus('Nothing to submit.', 'bad');
      return;
    }

    submitButton.disabled = true;
    setStatus('Submitting…', 'wait');

    try {
      // The token is re-read rather than reused: Codeforces rotates it, and a
      // workspace left open for an hour would be posting a dead one.
      const fresh = await loadSubmitForm(target!);
      const result = await submitSolution(target!, {
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
      submitButton.disabled = false;
    }
  };

  /* ----------------------------------------------------------- compilers */

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
    runButton.disabled = false;
    submitButton.disabled = false;
    setStatus('');
    editor?.focus();
  } catch (error) {
    if (controller.signal.aborted) return;
    // The editor still works and the draft is still saved; only sending is
    // gone, which is what the message says rather than blanking the panel.
    languages.replaceChildren(h('option', { value: '', text: 'Unavailable' }));
    setStatus(error instanceof Error ? error.message : String(error), 'bad');
  }
}

/** `⌘+Enter` on a Mac, `Ctrl+Enter` everywhere else. */
function runHint(): string {
  return /mac/i.test(navigator.platform || navigator.userAgent) ? '⌘+Enter' : 'Ctrl+Enter';
}

void openWorkspace();

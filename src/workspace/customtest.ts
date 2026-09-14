import {
  completeFields,
  orderLanguages,
  readCsrf,
  readFormFields,
  readLanguages,
  type LanguageOption,
} from './codeforces.ts';

/**
 * Running a solution — on Codeforces, by Codeforces.
 *
 * A browser has no compiler, and shipping somebody's source to a third-party
 * judge to borrow one would contradict everything else this extension promises.
 * Codeforces already runs arbitrary code for you, on the same account, through
 * its **custom invocation** page: source, compiler and input go in, output comes
 * back. So Run does not run anything here. It posts the same form the site's own
 * page posts, from the same session, and shows what Codeforces sends back.
 *
 * Two ways out, because the result page is the one piece of Codeforces markup
 * with no documented shape: read the result in place if it can be read, and
 * otherwise hand the whole run to a real Codeforces tab, which cannot fail.
 */

export const CUSTOM_TEST_PATH = '/problemset/customtest';

export function customTestUrl(): string {
  return `${window.location.origin}${CUSTOM_TEST_PATH}`;
}

export interface CustomTestForm {
  csrf: string;
  languages: LanguageOption[];
  /** The page's own hidden fields, including the fingerprints. */
  fields: Record<string, string>;
}

export interface RunOutcome {
  /** What the program printed. */
  output?: string;
  /** "Ok", "Compilation error", "Runtime error"… as Codeforces words it. */
  verdict?: string;
  time?: string;
  memory?: string;
  /** A compiler log or a judge refusal, when there is one instead of output. */
  error?: string;
}

/**
 * Reads a custom invocation result out of the page Codeforces renders.
 *
 * Deliberately loose. The submit form has a stable shape because the whole site
 * depends on it; this page does not, and a parser that insists on one class name
 * would break the first time a caption is reworded. It looks for the block that
 * says it is an invocation result, then for the parts inside it, and reports
 * nothing at all rather than guessing — `undefined` is what makes the caller
 * fall back to opening a real Codeforces tab.
 */
export function readRunOutcome(document_: Document): RunOutcome | undefined {
  const block = resultBlock(document_);
  if (!block) return undefined;

  const text = block.textContent ?? '';
  const outcome: RunOutcome = {};

  const output = readOutput(block);
  if (output !== undefined) outcome.output = output;

  // "Ok", or a failure. Read from a verdict cell when there is one, and from the
  // block's own words when there is not.
  const cell = block.querySelector('.verdict, [class*="verdict"]');
  const verdict = cell?.textContent?.trim();
  if (verdict) outcome.verdict = verdict;
  else if (/compilation error/i.test(text)) outcome.verdict = 'Compilation error';
  else if (/runtime error/i.test(text)) outcome.verdict = 'Runtime error';
  else if (/time limit/i.test(text)) outcome.verdict = 'Time limit exceeded';

  outcome.time = /(\d+)\s*ms/i.exec(text)?.[0];
  outcome.memory = /(\d+)\s*(KB|MB)/i.exec(text)?.[0];

  if (outcome.verdict && outcome.verdict !== 'Ok' && !outcome.output) {
    outcome.error = trimTrailing(text).slice(0, 4000);
  }

  // Neither an output nor a verdict means the page had no result on it — the
  // form before a run looks exactly like this, and reporting it as a run that
  // printed nothing would be worse than admitting the page could not be read.
  return outcome.output || outcome.verdict ? outcome : undefined;
}

/** The box Codeforces prints the program's output into, when it has one. */
const OUTPUT = 'textarea[name="output"], #outputFileTextarea, #output-file-content, .output-view';

/** The boxes that hold what *you* typed, which must never be read as output. */
const TYPED = new Set(['source', 'input', 'sourcefile']);

/**
 * What the program printed, or `undefined` when the block holds no output.
 *
 * A blank output counts as none. The custom invocation page ships an empty
 * output box before anything has run, and a program that legitimately prints
 * nothing still arrives with a verdict — so treating blank as "no result" costs
 * nothing and stops the un-run form from being reported as a finished run.
 */
function readOutput(block: Element): string | undefined {
  const named = block.querySelector(OUTPUT);
  const candidates = named
    ? [named]
    : // Codeforces prints the input back above the output, so the last box wins
      // — of the boxes that are not the ones you typed into.
      [...block.querySelectorAll('pre, textarea')].filter(
        (box) => !TYPED.has((box.getAttribute('name') ?? '').toLowerCase()),
      );

  for (const box of candidates.reverse()) {
    // `tagName` rather than `instanceof HTMLTextAreaElement`: this parser runs
    // against documents from `DOMParser` in the browser and from jsdom in the
    // tests, and the constructor is a different object in each.
    const raw =
      box.tagName === 'TEXTAREA'
        ? (box as HTMLTextAreaElement).value || box.textContent
        : box.textContent;
    const text = trimTrailing(raw ?? '');
    if (text) return text;
  }

  return undefined;
}

function resultBlock(document_: Document): Element | undefined {
  const named = document_.querySelector(
    '#customTestResults, .customtest-results, .customtest, .custom-invocation-results',
  );
  if (named) return named;

  // The output box, if the page has one, sits inside whatever Codeforces is
  // currently calling the result box — so find it by the box that surrounds it.
  const box = document_.querySelector(OUTPUT)?.closest('.roundbox, table, form, div');
  if (box) return box;

  // Nothing named it, so find the box that says what it is. "Invocation result"
  // and not "custom invocation": the second is the page's own heading and is
  // there before anything has run, so it would match the empty form. The
  // smallest matching box, because an ancestor "says what it is" too — matching
  // `body` would hand back the navigation as an output.
  let best: Element | undefined;
  for (const candidate of document_.querySelectorAll('.roundbox, .datatable, table, div')) {
    if (!/invocation result/i.test(candidate.textContent ?? '')) continue;
    if (!candidate.querySelector('pre, textarea')) continue;
    const length = candidate.textContent?.length ?? 0;
    if (!best || length < (best.textContent?.length ?? 0)) best = candidate;
  }

  return best;
}

function trimTrailing(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

/* ---------------------------------------------------------------- requests */

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** The custom invocation page's own token and compiler list. */
export async function loadCustomTestForm(): Promise<CustomTestForm> {
  const response = await fetch(customTestUrl(), { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Codeforces answered ${response.status}.`);

  const document_ = parse(await response.text());
  const csrf = readCsrf(document_);
  const languages = orderLanguages(readLanguages(document_));

  if (!csrf) {
    throw new Error(
      'Could not read the custom invocation page. You are probably signed out of Codeforces.',
    );
  }

  return { csrf, languages, fields: completeFields(readFormFields(document_)) };
}

export interface RunRequest {
  csrf: string;
  programTypeId: string;
  source: string;
  input: string;
  /** The form's own hidden fields, read from the page. */
  fields?: Record<string, string>;
}

/**
 * The fields Codeforces' own custom invocation form posts.
 *
 * Built on top of whatever the page actually carried rather than from a list
 * of the fields that seemed necessary. The first version left out `ftaa` and
 * `bfaa` — two fingerprint fields the site's JavaScript fills in — and
 * Codeforces answered every run by handing the form back with no result and no
 * error, which reached the user as "Redo could not read the result page".
 */
export function runFields(request: RunRequest): Record<string, string> {
  return {
    // Whatever the page carried — `action` and `tabSize` included, so the
    // page's own values win over the defaults `completeFields` falls back to.
    ...completeFields(request.fields ?? {}),
    csrf_token: request.csrf,
    programTypeId: request.programTypeId,
    source: request.source,
    // Codeforces names the box `input` on this page.
    input: request.input,
  };
}

/**
 * Posts a run and reads the answer.
 *
 * Resolves with `undefined` when the answer could not be read — not an error,
 * because the run itself very likely happened; it just means the caller should
 * offer the Codeforces tab instead of inventing an output.
 */
export async function runOnCodeforces(request: RunRequest): Promise<RunOutcome | undefined> {
  const body = new FormData();
  for (const [name, value] of Object.entries(runFields(request))) body.set(name, value);

  const response = await fetch(
    `${customTestUrl()}?csrf_token=${encodeURIComponent(request.csrf)}`,
    { method: 'POST', credentials: 'same-origin', body },
  );

  if (!response.ok) throw new Error(`Codeforces answered ${response.status}.`);
  const posted = readRunOutcome(parse(await response.text()));
  if (posted) return posted;

  // The judge is not instant. A few looks at the page, then give up quietly.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1200 : 2000));
    const page = await fetch(customTestUrl(), { credentials: 'same-origin' });
    if (!page.ok) break;
    const outcome = readRunOutcome(parse(await page.text()));
    if (outcome) return outcome;
  }

  return undefined;
}

/**
 * Hands the whole run to a real Codeforces tab.
 *
 * A generated form posted with `target="_blank"` — which is exactly what
 * clicking Run on Codeforces does, minus the typing. Used when the result could
 * not be read in place, so "Run" always ends somewhere useful instead of in an
 * apology.
 */
export function openCustomTest(request: RunRequest): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = customTestUrl();
  form.target = '_blank';
  form.style.display = 'none';

  for (const [name, value] of Object.entries(runFields(request))) {
    const field = document.createElement('input');
    field.type = 'hidden';
    field.name = name;
    field.value = value;
    form.append(field);
  }

  document.body.append(form);
  form.submit();
  form.remove();
}

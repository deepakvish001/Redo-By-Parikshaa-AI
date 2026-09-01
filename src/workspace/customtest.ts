import { readCsrf, readLanguages, orderLanguages, type LanguageOption } from './codeforces.ts';

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

  const pres = [...block.querySelectorAll('pre')];
  // Codeforces prints the input back above the output; the output is the last.
  const output = pres.at(-1);
  if (output) outcome.output = trimTrailing(output.textContent ?? '');

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

  return outcome.output !== undefined || outcome.verdict ? outcome : undefined;
}

function resultBlock(document_: Document): Element | undefined {
  const named = document_.querySelector('#customTestResults, .customtest-results, .customtest');
  if (named) return named;

  // Nothing named it, so find the box that says what it is.
  for (const box of document_.querySelectorAll('.roundbox, .datatable, table')) {
    if (/invocation result|custom invocation/i.test(box.textContent ?? '')) return box;
  }

  return undefined;
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

  return { csrf, languages };
}

export interface RunRequest {
  csrf: string;
  programTypeId: string;
  source: string;
  input: string;
}

/** The fields Codeforces' own custom invocation form posts. */
export function runFields(request: RunRequest): Record<string, string> {
  return {
    csrf_token: request.csrf,
    action: 'submitSolutionFormSubmitted',
    programTypeId: request.programTypeId,
    source: request.source,
    // Codeforces names the box `input` on this page and `sourceFile` nowhere.
    input: request.input,
    tabSize: '4',
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

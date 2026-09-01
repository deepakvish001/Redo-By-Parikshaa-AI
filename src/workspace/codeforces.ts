/**
 * Talking to Codeforces' own submit form.
 *
 * There is no submit API — the only way to send a solution is the form the site
 * itself posts, so this reads that form for its CSRF token and its language
 * ids and then posts exactly what the browser would have posted. Nothing here
 * bypasses anything: it is the same request, from the same session, with the
 * same token.
 *
 * The parsing is exported separately from the fetching so the shapes can be
 * checked against recorded markup rather than against a live site.
 */

export interface LanguageOption {
  /** Codeforces' `programTypeId`. */
  id: string;
  name: string;
}

/**
 * The compilers people actually use, in the order they should be offered.
 *
 * Codeforces' own list is fifty entries deep with Delphi and Befunge near the
 * top, and hunting for C++20 in it every time is exactly the friction the
 * reference extension set out to remove.
 */
const PINNED = [
  /^GNU G\+\+2\d/i,
  /^GNU G\+\+1\d/i,
  /^Python 3/i,
  /^PyPy 3/i,
  /^Java \d/i,
  /^Rust/i,
  /^Go\b/i,
  /^C# /i,
  /^Kotlin/i,
  /^Node\.?js/i,
];

/** Reads the `<select name="programTypeId">` Codeforces renders. */
export function readLanguages(document_: Document): LanguageOption[] {
  const select = document_.querySelector('select[name="programTypeId"]');
  const options: LanguageOption[] = [];

  for (const option of select?.querySelectorAll('option') ?? []) {
    const id = option.getAttribute('value');
    const name = option.textContent?.trim();
    if (id && name) options.push({ id, name });
  }

  return options;
}

/** Puts the common compilers first, keeping everything else in its own order. */
export function orderLanguages(options: LanguageOption[]): LanguageOption[] {
  const rank = (name: string) => {
    const index = PINNED.findIndex((pattern) => pattern.test(name));
    return index === -1 ? PINNED.length : index;
  };

  return [...options].sort((a, b) => rank(a.name) - rank(b.name));
}

/**
 * The CSRF token Codeforces puts on every page.
 *
 * Two places carry it and they do not always agree — the meta tag is stale on a
 * page served from the browser's back-forward cache — so the form's own hidden
 * input wins when there is one.
 */
export function readCsrf(document_: Document): string | undefined {
  const input = document_.querySelector('input[name="csrf_token"]');
  const fromForm = input?.getAttribute('value');
  if (fromForm) return fromForm;

  const meta = document_.querySelector('meta[name="X-Csrf-Token"]');
  return meta?.getAttribute('content') ?? undefined;
}

export interface SampleTest {
  input: string;
  output: string;
}

/**
 * The sample cases, from the statement.
 *
 * Codeforces renders them as `.sample-test` containing alternating `.input` and
 * `.output` blocks. Newer statements wrap each line of the input in its own
 * `<div>` so the site can offer a copy button, which means `textContent` runs
 * them together — hence the per-line reconstruction.
 */
export function readSamples(root: ParentNode): SampleTest[] {
  const samples: SampleTest[] = [];
  const blocks = root.querySelectorAll('.sample-test');

  for (const block of blocks) {
    const inputs = [...block.querySelectorAll('.input pre')];
    const outputs = [...block.querySelectorAll('.output pre')];

    for (const [index, input] of inputs.entries()) {
      const output = outputs[index];
      samples.push({
        input: readPre(input),
        output: output ? readPre(output) : '',
      });
    }
  }

  return samples;
}

function readPre(pre: Element): string {
  // The line-wrapped form: one div per line, and textContent would join them
  // with nothing between.
  const lines = [...pre.children].filter((child) => child.tagName === 'DIV');
  const text = lines.length > 0
    ? lines.map((line) => line.textContent ?? '').join('\n')
    : (pre.textContent ?? '');

  return text.replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

/* ---------------------------------------------------------------- posting */

export interface SubmitTarget {
  contestId: string;
  index: string;
  /** Gym problems submit through a different path. */
  gym?: boolean;
}

export function submitUrl(target: SubmitTarget): string {
  const kind = target.gym ? 'gym' : 'contest';
  return `${window.location.origin}/${kind}/${target.contestId}/submit`;
}

export function statusUrl(target: SubmitTarget): string {
  const kind = target.gym ? 'gym' : 'contest';
  return `${window.location.origin}/${kind}/${target.contestId}/my`;
}

export interface SubmitResult {
  ok: boolean;
  /** What Codeforces said went wrong, quoted, when it refused. */
  error?: string;
}

/**
 * Reads the error Codeforces puts back on the form when it refuses.
 *
 * It does not use status codes for this: a rejected submission comes back as a
 * 200 with the form re-rendered and a red line in it. Reporting "submitted"
 * because the request succeeded would be the worst possible outcome here.
 */
export function readSubmitError(document_: Document): string | undefined {
  const error = document_.querySelector('.error, .for__source, span.error');
  const text = error?.textContent?.trim();
  if (text) return text;

  // The form coming back at all means it was not accepted — a successful
  // submit redirects to the status page.
  return document_.querySelector('select[name="programTypeId"]')
    ? 'Codeforces returned the form again without saying why. The usual causes are an identical submission or submitting too fast.'
    : undefined;
}

/**
 * The verdict of the newest submission on the status page.
 *
 * Read from `submissionverdict` rather than the cell's text: the text is
 * localised, and on the Russian locale "Accepted" is "Полное решение".
 */
export function readLatestVerdict(
  document_: Document,
  problem: string,
): { id: string; verdict: string; waiting: boolean } | undefined {
  for (const row of document_.querySelectorAll('tr[data-submission-id]')) {
    const link = row.querySelector('a[href*="/problem/"]');
    const href = link?.getAttribute('href') ?? '';
    const match = /\/problem\/([A-Za-z0-9]+)/.exec(href);
    if (!match || match[1]?.toUpperCase() !== problem.toUpperCase()) continue;

    const cell = row.querySelector('.status-verdict-cell');
    return {
      id: row.getAttribute('data-submission-id') ?? '',
      verdict: cell?.textContent?.trim() ?? '',
      waiting: cell?.getAttribute('waiting') === 'true',
    };
  }

  return undefined;
}

export interface SubmissionRow {
  id: string;
  verdict: string;
  waiting: boolean;
  language?: string;
  time?: string;
  memory?: string;
  when?: string;
}

/**
 * Your own submissions for one problem, from the status page.
 *
 * The language cell is the one immediately before the verdict cell rather than
 * "the cell containing a language word" — Codeforces has a language called
 * `Secret_171`, and the problem title cell comes first, which is how "Secret
 * Santa" once got filed as its own language.
 */
export function readSubmissions(document_: Document, problem: string): SubmissionRow[] {
  const rows: SubmissionRow[] = [];

  for (const row of document_.querySelectorAll('tr[data-submission-id]')) {
    const href = row.querySelector('a[href*="/problem/"]')?.getAttribute('href') ?? '';
    const match = /\/problem\/([A-Za-z0-9]+)/.exec(href);
    if (!match || match[1]?.toUpperCase() !== problem.toUpperCase()) continue;

    const cells = [...row.querySelectorAll('td')];
    const verdictCell = row.querySelector('.status-verdict-cell');
    const verdictAt = verdictCell ? cells.indexOf(verdictCell as HTMLTableCellElement) : -1;
    const text = (cell: Element | undefined) => cell?.textContent?.trim() || undefined;

    rows.push({
      id: row.getAttribute('data-submission-id') ?? '',
      verdict: text(verdictCell ?? undefined) ?? '',
      waiting: verdictCell?.getAttribute('waiting') === 'true',
      language: verdictAt > 0 ? text(cells[verdictAt - 1]) : undefined,
      // Time and memory sit immediately after the verdict, in that order.
      time: verdictAt >= 0 ? text(cells[verdictAt + 1]) : undefined,
      memory: verdictAt >= 0 ? text(cells[verdictAt + 2]) : undefined,
      when: text(cells[1]),
    });
  }

  return rows;
}

/* ------------------------------------------------------------ the requests */

/**
 * Parsing HTML that arrived over the network.
 *
 * `DOMParser` and not `innerHTML`: the fragment never gets a document to run
 * in, so a `<script>` or an `onerror` in whatever Codeforces returned is inert
 * markup rather than code running with the page's origin.
 */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

async function fetchPage(url: string): Promise<Document> {
  // `same-origin` credentials, which is what the browser would send for a link
  // click. This is the user's own session, reading their own pages.
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Codeforces answered ${response.status} for ${url}`);
  return parse(await response.text());
}

export interface SubmitForm {
  csrf: string;
  languages: LanguageOption[];
}

/**
 * Reads the submit page for the two things a submission needs.
 *
 * The language ids are per-page rather than hard-coded because Codeforces
 * renumbers them: `programTypeId` 89 is G++20 today and was something else two
 * years ago, and a stale table would silently submit C++ as Delphi.
 */
export async function loadSubmitForm(target: SubmitTarget): Promise<SubmitForm> {
  const document_ = await fetchPage(submitUrl(target));
  const csrf = readCsrf(document_);
  const languages = orderLanguages(readLanguages(document_));

  if (!csrf || languages.length === 0) {
    throw new Error(
      'Could not read the submit form. You are probably signed out of Codeforces — open the site in this tab and sign in.',
    );
  }

  return { csrf, languages };
}

/**
 * Posts a solution through Codeforces' own form.
 *
 * Every field here is one the site's own page posts, with the token it issued
 * to this session. Nothing is bypassed and nothing is spoofed; the only
 * difference from clicking Submit yourself is which element the click landed on.
 */
export async function submitSolution(
  target: SubmitTarget,
  submission: { csrf: string; programTypeId: string; source: string },
): Promise<SubmitResult> {
  const body = new FormData();
  body.set('csrf_token', submission.csrf);
  body.set('action', 'submitSolutionFormSubmitted');
  body.set('submittedProblemIndex', target.index.toUpperCase());
  body.set('programTypeId', submission.programTypeId);
  body.set('source', submission.source);
  body.set('tabSize', '4');
  body.set('sourceFile', '');

  const url = `${submitUrl(target)}?csrf_token=${encodeURIComponent(submission.csrf)}`;
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    body,
  });

  if (!response.ok) {
    return { ok: false, error: `Codeforces answered ${response.status}.` };
  }

  const error = readSubmitError(parse(await response.text()));
  return error ? { ok: false, error } : { ok: true };
}

export interface Verdict {
  id: string;
  verdict: string;
  waiting: boolean;
}

/** One look at your own status page for this contest. */
export async function readVerdict(target: SubmitTarget): Promise<Verdict | undefined> {
  return readLatestVerdict(await fetchPage(statusUrl(target)), target.index);
}

/** Everything you have sent for this problem, newest first. */
export async function fetchSubmissions(target: SubmitTarget): Promise<SubmissionRow[]> {
  return readSubmissions(await fetchPage(statusUrl(target)), target.index);
}

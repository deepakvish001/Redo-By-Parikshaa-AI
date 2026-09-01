/**
 * Translating a statement without destroying it.
 *
 * A Codeforces statement is not prose. It is prose wrapped around rendered
 * MathJax, variable names, code spans and sample blocks — and a translator
 * handed the whole thing back will happily "translate" `a_i` into a word,
 * localise the digits in `10^5`, and rewrite the sample input. Any one of those
 * turns a readable problem into a wrong one, which is worse than not
 * translating at all.
 *
 * So the text is taken apart first: every run of translatable words is pulled
 * out, everything else is replaced by a numbered placeholder the model is told
 * to copy through, and the pieces are put back afterwards. What comes back is
 * checked — a response that dropped or invented a placeholder is rejected
 * rather than pasted over the statement.
 *
 * The shaping lives here, away from the network, so it can be tested without a
 * key and without sending anything anywhere.
 */

/** Elements whose text must never be sent, let alone replaced. */
export const FROZEN = [
  'pre',
  'code',
  'script',
  'style',
  'textarea',
  '.sample-test',
  '.MathJax',
  '.MathJax_Preview',
  'mjx-container',
  'math',
  '.tex-font-style-tt',
  '.tex-graphics',
].join(',');

/** `⟦3⟧` — a marker no statement contains and no translator will translate. */
export function placeholder(index: number): string {
  return `⟦${index}⟧`;
}

const PLACEHOLDER = /⟦(\d+)⟧/g;

export interface Segment {
  /** The text to translate, with placeholders standing in for frozen parts. */
  text: string;
  /** What each placeholder stands for, in order. */
  frozen: string[];
}

/**
 * Splits one paragraph's worth of text into translatable prose plus frozen bits.
 *
 * Inline maths on Codeforces is `$$$x$$$`; variables often appear as `n`, `a_i`
 * or `10^5` inside those. Anything between the markers is a placeholder.
 */
export function freeze(text: string): Segment {
  const frozen: string[] = [];

  const withPlaceholders = text
    // Codeforces' own inline maths delimiter.
    .replace(/\$\$\$[\s\S]*?\$\$\$/g, (match) => {
      frozen.push(match);
      return placeholder(frozen.length - 1);
    })
    // Backticked code, which appears in editorials and some statements.
    .replace(/`[^`]*`/g, (match) => {
      frozen.push(match);
      return placeholder(frozen.length - 1);
    });

  return { text: withPlaceholders, frozen };
}

/** Puts the frozen parts back into a translated string. */
export function thaw(translated: string, frozen: string[]): string {
  return translated.replace(PLACEHOLDER, (whole, index: string) => {
    const original = frozen[Number(index)];
    return original ?? whole;
  });
}

/**
 * Whether a translation may be used.
 *
 * The check is not "does it look right" — it is whether every placeholder
 * survived, exactly once each. A model that dropped `⟦2⟧` has dropped a formula
 * out of the middle of a sentence, and pasting that over the statement would
 * quietly change what the problem is asking. Refusing is the only safe answer.
 */
export function isFaithful(translated: string, frozen: string[]): boolean {
  const seen = new Map<number, number>();
  for (const match of translated.matchAll(PLACEHOLDER)) {
    const index = Number(match[1]);
    seen.set(index, (seen.get(index) ?? 0) + 1);
  }

  if (seen.size !== frozen.length) return false;
  for (let index = 0; index < frozen.length; index += 1) {
    if (seen.get(index) !== 1) return false;
  }
  return true;
}

/* ----------------------------------------------------------------- cache */

export interface CachedTranslation {
  /** `<problem key>:<language>`. */
  key: string;
  /** Translated text per source string, so a re-render costs nothing. */
  strings: Record<string, string>;
  at: number;
}

/** A day. Statements do not change; this is about not hoarding somebody's text. */
export const CACHE_MS = 24 * 60 * 60 * 1000;

export function cacheKey(problem: string, language: string): string {
  return `${problem}:${language}`;
}

export function isFresh(entry: CachedTranslation | undefined, now: number): boolean {
  return entry !== undefined && now - entry.at < CACHE_MS;
}

/* --------------------------------------------------------------- prompting */

export const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'mr', label: 'Marathi' },
  { code: 'es', label: 'Spanish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'id', label: 'Indonesian' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
];

export function labelFor(code: string): string {
  return LANGUAGES.find((entry) => entry.code === code)?.label ?? code;
}

/**
 * The instruction sent with each batch.
 *
 * Explicit about the placeholders because that is the failure that matters:
 * a mistranslated adjective is a nuisance, a moved formula is a different
 * problem.
 */
export function buildPrompt(language: string, lines: string[]): string {
  return [
    `Translate each numbered line below into ${labelFor(language)}.`,
    'These are competitive-programming problem statements.',
    '',
    'Rules:',
    `- Markers like ${placeholder(0)} are mathematical formulas. Copy every marker through`,
    '  exactly as it appears, once each, in the position it belongs in the sentence.',
    '  Never translate, renumber, drop or duplicate one.',
    '- Keep variable names, numbers and units as they are.',
    '- Do not explain, summarise or solve anything. Translate only.',
    '- Answer with the same numbered lines and nothing else.',
    '',
    ...lines.map((line, index) => `${index + 1}. ${line}`),
  ].join('\n');
}

/**
 * Reads the numbered lines back.
 *
 * A model that returns a different number of lines has merged or split
 * sentences, and pairing them up by position after that would put the wrong
 * translation under the wrong paragraph — so the count has to match.
 */
export function parseNumbered(response: string, expected: number): string[] | undefined {
  const out: string[] = [];

  for (const line of response.split('\n')) {
    const match = /^\s*(\d+)\.\s?(.*)$/.exec(line);
    if (!match) {
      // A continuation of the previous line, which long statements produce.
      if (out.length > 0 && line.trim() !== '') out[out.length - 1] += `\n${line}`;
      continue;
    }
    out.push(match[2] ?? '');
  }

  return out.length === expected ? out.map((entry) => entry.trim()) : undefined;
}

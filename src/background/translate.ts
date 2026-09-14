import {
  buildPrompt,
  cacheKey,
  isFaithful,
  isFresh,
  parseNumbered,
  type CachedTranslation,
} from '../core/translate.ts';
import { getSettings } from '../core/storage.ts';

/**
 * The one thing in this extension that sends your reading to somebody else.
 *
 * Everything else Redo does talks to the judge you are already on, to the
 * GitHub repository you named, or to nothing at all. Translation cannot: there
 * is no offline translator worth the name, and a statement has to leave the
 * machine to come back in another language. So it is built to make that
 * completely explicit — off unless switched on, dead without a key you supply
 * yourself, and PRIVACY.md names Google as the recipient.
 *
 * The key is the user's own Gemini key, kept in local storage like the GitHub
 * token, and used from the service worker so it never enters a judge's page.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.0-flash';
const CACHE_KEY = 'translationCache';
/** How many statements' translations are kept. */
const MAX_CACHED = 40;

interface Cache {
  entries: Record<string, CachedTranslation>;
}

async function readCache(): Promise<Cache> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  return (stored[CACHE_KEY] as Cache | undefined) ?? { entries: {} };
}

async function writeCache(cache: Cache): Promise<void> {
  const keys = Object.keys(cache.entries);
  if (keys.length > MAX_CACHED) {
    const oldest = keys.sort((a, b) => (cache.entries[a]?.at ?? 0) - (cache.entries[b]?.at ?? 0));
    for (const key of oldest.slice(0, keys.length - MAX_CACHED)) delete cache.entries[key];
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

export interface TranslateResult {
  /** Source string → translation, for everything that came back faithfully. */
  strings: Record<string, string>;
  /** Why nothing came back, when nothing did. */
  error?: string;
  /** True when this was answered entirely from the cache. */
  cached: boolean;
}

/**
 * Translates a batch of strings for one problem.
 *
 * Cached per problem and language for a day — statements do not change, and the
 * cache is as much about not sending somebody's text over and over as it is
 * about speed.
 */
export async function translateStrings(
  problem: string,
  strings: string[],
): Promise<TranslateResult> {
  const settings = await getSettings();
  const { enabled, apiKey, language } = settings.translate;

  if (!enabled) return { strings: {}, cached: false, error: 'Translation is switched off.' };
  if (!apiKey.trim()) {
    return {
      strings: {},
      cached: false,
      error: 'No Gemini key. Add one in Settings — translation needs your own key.',
    };
  }

  const key = cacheKey(problem, language);
  const cache = await readCache();
  const existing = cache.entries[key];
  const now = Date.now();

  const known = isFresh(existing, now) ? (existing?.strings ?? {}) : {};
  const missing = strings.filter((line) => !(line in known));
  if (missing.length === 0) return { strings: known, cached: true };

  let translated: string[] | undefined;
  try {
    translated = await callGemini(apiKey.trim(), language, missing);
  } catch (error) {
    return {
      strings: known,
      cached: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!translated) {
    return {
      strings: known,
      cached: false,
      // Named precisely, because this is the failure that matters: a model
      // that dropped a formula out of a sentence must not be pasted over the
      // statement.
      error: 'The translation came back malformed and was discarded.',
    };
  }

  const merged = { ...known };
  for (const [index, source] of missing.entries()) {
    const line = translated[index];
    if (line !== undefined) merged[source] = line;
  }

  cache.entries[key] = { key, strings: merged, at: now };
  await writeCache(cache);

  return { strings: merged, cached: false };
}

/**
 * One request, one batch.
 *
 * Batched rather than one call per paragraph because a statement is twenty
 * paragraphs and twenty round trips is both slow and twenty times the quota.
 */
async function callGemini(
  apiKey: string,
  language: string,
  lines: string[],
): Promise<string[] | undefined> {
  const response = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // In a header rather than the query string: a key in a URL ends up in
      // logs, history and referrers.
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(language, lines) }] }],
      generationConfig: { temperature: 0 },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (response.status === 400 && /API key/i.test(detail)) {
      throw new Error('Google rejected the key. Check it in Settings.');
    }
    if (response.status === 429) {
      throw new Error('Google is rate-limiting this key. Try again in a minute.');
    }
    throw new Error(`Google answered ${response.status}.`);
  }

  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';

  const parsed = parseNumbered(text, lines.length);
  if (!parsed) return undefined;

  // Every placeholder has to have survived, in every line. One that did not is
  // a formula moved or lost, so the whole batch is refused rather than half of
  // it used.
  for (const [index, line] of parsed.entries()) {
    const source = lines[index] ?? '';
    const frozen = [...source.matchAll(/⟦(\d+)⟧/g)].map(() => '');
    if (!isFaithful(line, frozen)) return undefined;
  }

  return parsed;
}

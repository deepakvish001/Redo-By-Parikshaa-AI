import type { Platform, SolvedProblem } from './types.ts';

/**
 * Curated lists, tracked against what you have actually solved.
 *
 * Everybody works from a sheet — Blind 75, NeetCode 150, Striver's A2Z, a
 * senior's spreadsheet — and every one of them is tracked by hand, in a tab
 * that has to be reconciled with the judge by memory. Redo already knows what
 * you solved and when, so the reconciliation is free: give it the list and it
 * can say what is left.
 *
 * Deliberately *not* scraped from anywhere. A sheet is a list of problem slugs;
 * the lists worth having are published as lists, and the one built in here is
 * written out in full below. Everything else is imported by pasting it, which
 * also means a sheet nobody has heard of — your college's, your own — works
 * exactly as well as a famous one.
 *
 * The matching is on `platform:slug`, the same key the rest of the extension
 * uses, so a problem solved before the sheet was imported counts immediately.
 * That is the whole point: importing a sheet should tell you where you already
 * are, not reset you to zero.
 */

export interface SheetEntry {
  platform: Platform;
  slug: string;
  title: string;
  /** The section it sits in — "Arrays & Hashing", "Trees". Optional. */
  group?: string;
  /**
   * Locked behind LeetCode Premium.
   *
   * Marked rather than dropped, because a sheet that silently has 69 of its 75
   * problems is a sheet you cannot trust. Redo does not and will not work
   * around the paywall; it says which ones you will not be able to open, so a
   * progress bar that stops at 92% has a visible reason.
   */
  premium?: boolean;
}

export interface Sheet {
  id: string;
  name: string;
  /** Where the list came from, kept so it can be checked against the source. */
  source?: string;
  /** True for the lists that ship with the extension. */
  builtIn: boolean;
  addedAt: number;
  entries: SheetEntry[];
}

export interface GroupProgress {
  name: string;
  solved: number;
  total: number;
}

export interface SheetProgress {
  id: string;
  name: string;
  solved: number;
  total: number;
  /** Entries you cannot open without LeetCode Premium. */
  locked: number;
  /** 0–100, rounded. Counts locked entries in the total — they are on the list. */
  percent: number;
  groups: GroupProgress[];
  /** Everything not yet solved, in sheet order. */
  remaining: SheetEntry[];
}

export const MAX_SHEETS = 20;
export const MAX_ENTRIES = 1000;

export function entryKey(entry: Pick<SheetEntry, 'platform' | 'slug'>): string {
  return `${entry.platform}:${entry.slug}`;
}

/* --------------------------------------------------------------- progress */

export function sheetProgress(
  sheet: Sheet,
  problems: Record<string, SolvedProblem>,
): SheetProgress {
  const groups = new Map<string, GroupProgress>();
  const remaining: SheetEntry[] = [];
  let solved = 0;
  let locked = 0;

  for (const entry of sheet.entries) {
    const done = Boolean(problems[entryKey(entry)]);
    if (done) solved += 1;
    else remaining.push(entry);
    if (entry.premium && !done) locked += 1;

    const name = entry.group ?? 'Other';
    const group = groups.get(name) ?? { name, solved: 0, total: 0 };
    group.total += 1;
    if (done) group.solved += 1;
    groups.set(name, group);
  }

  const total = sheet.entries.length;
  return {
    id: sheet.id,
    name: sheet.name,
    solved,
    total,
    locked,
    percent: total === 0 ? 0 : Math.round((solved / total) * 100),
    groups: [...groups.values()],
    remaining,
  };
}

/**
 * The next few worth doing, preferring a section you have already started.
 *
 * Finishing a section beats starting a fourth one: the problems inside a
 * section rhyme, so doing them together is when the pattern actually lands.
 * Among sections, the one closest to done comes first — momentum is the thing
 * a sheet is for.
 */
export function nextFromSheet(progress: SheetProgress, count = 3): SheetEntry[] {
  const order = new Map(
    progress.groups
      .filter((group) => group.solved > 0 && group.solved < group.total)
      .sort((a, b) => b.solved / b.total - a.solved / a.total)
      .map((group, index) => [group.name, index]),
  );

  return [...progress.remaining]
    .sort((a, b) => {
      // A problem you can actually open outranks one behind the paywall.
      if (Boolean(a.premium) !== Boolean(b.premium)) return a.premium ? 1 : -1;
      const rankA = order.get(a.group ?? 'Other') ?? Number.MAX_SAFE_INTEGER;
      const rankB = order.get(b.group ?? 'Other') ?? Number.MAX_SAFE_INTEGER;
      return rankA - rankB;
    })
    .slice(0, count);
}

/* ---------------------------------------------------------------- parsing */

const LEETCODE_URL = /leetcode\.(?:com|cn)\/problems\/([a-z0-9-]+)/i;
const CODEFORCES_PROBLEMSET = /codeforces\.com\/problemset\/problem\/(\d+)\/([A-Za-z]\d?)/i;
const CODEFORCES_CONTEST = /codeforces\.com\/contest\/(\d+)\/problem\/([A-Za-z]\d?)/i;
const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)]+)\)/;
/**
 * A slug as written, not as lower-cased.
 *
 * Tested against the original text on purpose: `3sum` and `subsets` are real
 * LeetCode slugs with no hyphen in them, so a single word has to be accepted —
 * and once it is, the only thing separating a slug from a section heading like
 * `Arrays` is that a slug is already lower-case.
 */
const BARE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Letters, digits and the punctuation real problem titles use — nothing else. */
const TITLE_SHAPED = /^[A-Za-z0-9][A-Za-z0-9 '().,:&+-]*$/;

/**
 * The longest LeetCode title is eight words; a dozen is generous.
 *
 * Paired with the rule below it, this is what separates a problem title from a
 * sentence of instructions sitting in the same pasted file.
 */
const MAX_TITLE_WORDS = 12;

/** A line that ends like a sentence is a sentence. No problem title does. */
const ENDS_LIKE_PROSE = /[.?!:]$/;

function looksLikeTitle(text: string): boolean {
  if (!TITLE_SHAPED.test(text) || ENDS_LIKE_PROSE.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length > 1 && words.length <= MAX_TITLE_WORDS;
}

/**
 * Slugs in the shape the rest of the extension keys problems by.
 *
 * Codeforces is the one that matters: the key is `1899A`, with the index in
 * upper case, and a sheet that stored `1899a` would never match a solve no
 * matter how many times you solved it.
 */
export function normaliseSlug(platform: Platform, slug: string): string {
  const trimmed = slug.trim();
  if (platform !== 'codeforces') return trimmed.toLowerCase();
  const match = /^(\d+)([A-Za-z]\d*)$/.exec(trimmed);
  return match ? `${match[1]}${match[2]!.toUpperCase()}` : trimmed;
}

/** `two-sum` → `Two Sum`, for a line that gave a slug and no title. */
export function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => (/^\d+$/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/**
 * One line of a pasted list, or nothing.
 *
 * Written to accept what people actually have rather than a format they must
 * first convert to: a bare URL, a markdown link out of a README, a numbered
 * row from a spreadsheet, or just the slug. Anything it cannot read is skipped
 * and counted, so the import can say "94 read, 2 skipped" instead of failing
 * whole because one row had a stray character.
 */
export function parseSheetLine(raw: string): SheetEntry | undefined {
  const line = raw.trim();
  if (!line || line.startsWith('#')) return undefined;

  // A markdown link carries both halves: the title and the URL.
  const link = MARKDOWN_LINK.exec(line);
  const titleFromLink = link?.[1]?.trim();
  const text = link ? link[2]! : line;

  const codeforces = CODEFORCES_PROBLEMSET.exec(text) ?? CODEFORCES_CONTEST.exec(text);
  if (codeforces) {
    const slug = `${codeforces[1]}${codeforces[2]!.toUpperCase()}`;
    return { platform: 'codeforces', slug, title: titleFromLink || slug };
  }

  const leetcode = LEETCODE_URL.exec(text);
  if (leetcode) {
    const slug = leetcode[1]!.toLowerCase();
    return { platform: 'leetcode', slug, title: titleFromLink || titleFromSlug(slug) };
  }

  // No URL, so the line is a title, a slug, or "Title | slug" / "1. Title".
  const stripped = line
    .replace(/^\s*[-*]\s*/, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .trim();
  const [left, right] = stripped.split(/\s*[|,\t]\s*/);
  const candidate = (right ?? left ?? '').trim();

  if (BARE_SLUG.test(candidate)) {
    return {
      platform: 'leetcode',
      slug: candidate,
      title: right ? (left ?? '').trim() : titleFromSlug(candidate),
    };
  }

  // A plain title with no slug is turned into the slug LeetCode would use,
  // which is exactly how LeetCode builds them.
  //
  // Only for lines that actually look like a problem title, though. Without
  // that guard every sentence in a pasted README becomes a problem nobody has
  // ever solved, and the sheet fills with rows that can never be ticked off —
  // which looks exactly like a sheet you are failing at.
  //
  // The test is deliberately strict: a line that is ambiguous is skipped and
  // counted, and the import says how many it skipped. Leaving a real problem
  // out is a line the user can paste again; inventing one they can never solve
  // is a permanent wrong number in the progress bar.
  if (!looksLikeTitle(stripped)) return undefined;

  const guess = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return guess.includes('-') ? { platform: 'leetcode', slug: guess, title: stripped } : undefined;
}

export interface ImportResult {
  entries: SheetEntry[];
  /** Lines that could not be read as a problem. */
  skipped: number;
  /** The same problem listed twice is kept once. */
  duplicates: number;
}

export function parseSheet(text: string): ImportResult {
  // A JSON export round-trips exactly, which matters for a sheet somebody
  // built by hand and wants to move between machines.
  const asJson = parseSheetJson(text);
  if (asJson) return asJson;

  const entries: SheetEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let duplicates = 0;
  let group: string | undefined;

  for (const line of text.split(/\r?\n/)) {
    // A markdown heading is the section the rows under it belong to.
    const heading = /^\s*#{1,6}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      group = heading[1]!.trim();
      continue;
    }

    const entry = parseSheetLine(line);
    if (!entry) {
      if (line.trim()) skipped += 1;
      continue;
    }

    const key = entryKey(entry);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    entries.push(group ? { ...entry, group } : entry);
    if (entries.length >= MAX_ENTRIES) break;
  }

  return { entries, skipped, duplicates };
}

function parseSheetJson(text: string): ImportResult | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : ((parsed as { entries?: unknown }).entries as unknown[] | undefined);
  if (!Array.isArray(rows)) return undefined;

  const entries: SheetEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let duplicates = 0;

  for (const row of rows) {
    if (typeof row === 'string') {
      const entry = parseSheetLine(row);
      if (!entry) {
        skipped += 1;
        continue;
      }
      const key = entryKey(entry);
      if (seen.has(key)) duplicates += 1;
      else {
        seen.add(key);
        entries.push(entry);
      }
      continue;
    }

    const record = row as Partial<SheetEntry>;
    const platform = (record.platform ?? 'leetcode') as Platform;
    const slug = typeof record.slug === 'string' ? normaliseSlug(platform, record.slug) : '';
    if (!slug) {
      skipped += 1;
      continue;
    }
    const entry: SheetEntry = {
      platform,
      slug,
      title: typeof record.title === 'string' && record.title.trim() ? record.title.trim() : titleFromSlug(slug),
      ...(record.group ? { group: record.group } : {}),
      ...(record.premium ? { premium: true } : {}),
    };
    const key = entryKey(entry);
    if (seen.has(key)) duplicates += 1;
    else {
      seen.add(key);
      entries.push(entry);
    }
    if (entries.length >= MAX_ENTRIES) break;
  }

  return { entries, skipped, duplicates };
}

/** A stable id from the name, so importing the same sheet twice replaces it. */
export function sheetId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `sheet-${Date.now()}`;
}

export function buildSheet(name: string, text: string, now = Date.now()): { sheet: Sheet; result: ImportResult } {
  const result = parseSheet(text);
  return {
    sheet: {
      id: sheetId(name),
      name: name.trim() || 'Imported sheet',
      builtIn: false,
      addedAt: now,
      entries: result.entries,
    },
    result,
  };
}

/* ------------------------------------------------------------- the built-in */

const B = (group: string, rows: Array<[string, string] | [string, string, 'premium']>): SheetEntry[] =>
  rows.map(([title, slug, premium]) => ({
    platform: 'leetcode' as const,
    slug,
    title,
    group,
    ...(premium ? { premium: true } : {}),
  }));

/**
 * Blind 75.
 *
 * Written out rather than fetched, and it is the only list that ships: it is
 * short enough to get right by hand and stable enough to be worth freezing.
 * Longer lists — NeetCode 150, Striver's A2Z, a college's own — are imported
 * by pasting them, which is both more honest than me transcribing four hundred
 * slugs from memory and more useful, because it works for any list at all.
 *
 * Six of the seventy-five need LeetCode Premium. They are marked, not removed.
 */
export const BLIND_75: Sheet = {
  id: 'blind-75',
  name: 'Blind 75',
  source: 'https://www.teamblind.com/post/New-Year-Gift---Curated-List-of-Top-75-LeetCode-Questions-to-Save-Your-Time-OaM1orEU',
  builtIn: true,
  addedAt: 0,
  entries: [
    ...B('Array', [
      ['Two Sum', 'two-sum'],
      ['Best Time to Buy and Sell Stock', 'best-time-to-buy-and-sell-stock'],
      ['Contains Duplicate', 'contains-duplicate'],
      ['Product of Array Except Self', 'product-of-array-except-self'],
      ['Maximum Subarray', 'maximum-subarray'],
      ['Maximum Product Subarray', 'maximum-product-subarray'],
      ['Find Minimum in Rotated Sorted Array', 'find-minimum-in-rotated-sorted-array'],
      ['Search in Rotated Sorted Array', 'search-in-rotated-sorted-array'],
      ['3Sum', '3sum'],
      ['Container With Most Water', 'container-with-most-water'],
    ]),
    ...B('Binary', [
      ['Sum of Two Integers', 'sum-of-two-integers'],
      ['Number of 1 Bits', 'number-of-1-bits'],
      ['Counting Bits', 'counting-bits'],
      ['Missing Number', 'missing-number'],
      ['Reverse Bits', 'reverse-bits'],
    ]),
    ...B('Dynamic Programming', [
      ['Climbing Stairs', 'climbing-stairs'],
      ['Coin Change', 'coin-change'],
      ['Longest Increasing Subsequence', 'longest-increasing-subsequence'],
      ['Longest Common Subsequence', 'longest-common-subsequence'],
      ['Word Break', 'word-break'],
      ['Combination Sum IV', 'combination-sum-iv'],
      ['House Robber', 'house-robber'],
      ['House Robber II', 'house-robber-ii'],
      ['Decode Ways', 'decode-ways'],
      ['Unique Paths', 'unique-paths'],
      ['Jump Game', 'jump-game'],
    ]),
    ...B('Graph', [
      ['Clone Graph', 'clone-graph'],
      ['Course Schedule', 'course-schedule'],
      ['Pacific Atlantic Water Flow', 'pacific-atlantic-water-flow'],
      ['Number of Islands', 'number-of-islands'],
      ['Longest Consecutive Sequence', 'longest-consecutive-sequence'],
      ['Alien Dictionary', 'alien-dictionary', 'premium'],
      ['Graph Valid Tree', 'graph-valid-tree', 'premium'],
      ['Number of Connected Components in an Undirected Graph', 'number-of-connected-components-in-an-undirected-graph', 'premium'],
    ]),
    ...B('Interval', [
      ['Insert Interval', 'insert-interval'],
      ['Merge Intervals', 'merge-intervals'],
      ['Non-overlapping Intervals', 'non-overlapping-intervals'],
      ['Meeting Rooms', 'meeting-rooms', 'premium'],
      ['Meeting Rooms II', 'meeting-rooms-ii', 'premium'],
    ]),
    ...B('Linked List', [
      ['Reverse Linked List', 'reverse-linked-list'],
      ['Linked List Cycle', 'linked-list-cycle'],
      ['Merge Two Sorted Lists', 'merge-two-sorted-lists'],
      ['Merge k Sorted Lists', 'merge-k-sorted-lists'],
      ['Remove Nth Node From End of List', 'remove-nth-node-from-end-of-list'],
      ['Reorder List', 'reorder-list'],
    ]),
    ...B('Matrix', [
      ['Set Matrix Zeroes', 'set-matrix-zeroes'],
      ['Spiral Matrix', 'spiral-matrix'],
      ['Rotate Image', 'rotate-image'],
      ['Word Search', 'word-search'],
    ]),
    ...B('String', [
      ['Longest Substring Without Repeating Characters', 'longest-substring-without-repeating-characters'],
      ['Longest Repeating Character Replacement', 'longest-repeating-character-replacement'],
      ['Minimum Window Substring', 'minimum-window-substring'],
      ['Valid Anagram', 'valid-anagram'],
      ['Group Anagrams', 'group-anagrams'],
      ['Valid Parentheses', 'valid-parentheses'],
      ['Valid Palindrome', 'valid-palindrome'],
      ['Longest Palindromic Substring', 'longest-palindromic-substring'],
      ['Palindromic Substrings', 'palindromic-substrings'],
      ['Encode and Decode Strings', 'encode-and-decode-strings', 'premium'],
    ]),
    ...B('Tree', [
      ['Maximum Depth of Binary Tree', 'maximum-depth-of-binary-tree'],
      ['Same Tree', 'same-tree'],
      ['Invert Binary Tree', 'invert-binary-tree'],
      ['Binary Tree Maximum Path Sum', 'binary-tree-maximum-path-sum'],
      ['Binary Tree Level Order Traversal', 'binary-tree-level-order-traversal'],
      ['Serialize and Deserialize Binary Tree', 'serialize-and-deserialize-binary-tree'],
      ['Subtree of Another Tree', 'subtree-of-another-tree'],
      ['Construct Binary Tree from Preorder and Inorder Traversal', 'construct-binary-tree-from-preorder-and-inorder-traversal'],
      ['Validate Binary Search Tree', 'validate-binary-search-tree'],
      ['Kth Smallest Element in a BST', 'kth-smallest-element-in-a-bst'],
      ['Lowest Common Ancestor of a Binary Search Tree', 'lowest-common-ancestor-of-a-binary-search-tree'],
      ['Implement Trie (Prefix Tree)', 'implement-trie-prefix-tree'],
      ['Design Add and Search Words Data Structure', 'design-add-and-search-words-data-structure'],
      ['Word Search II', 'word-search-ii'],
    ]),
    ...B('Heap', [
      ['Top K Frequent Elements', 'top-k-frequent-elements'],
      ['Find Median from Data Stream', 'find-median-from-data-stream'],
    ]),
  ],
};

export const BUILT_IN_SHEETS: Sheet[] = [BLIND_75];

/** The URL a sheet entry points at. */
export function sheetEntryUrl(entry: SheetEntry): string {
  if (entry.platform === 'codeforces') {
    const match = /^(\d+)([A-Za-z]\d*)$/.exec(entry.slug);
    return match
      ? `https://codeforces.com/problemset/problem/${match[1]}/${match[2]!.toUpperCase()}`
      : 'https://codeforces.com/problemset';
  }
  return `https://leetcode.com/problems/${entry.slug}/`;
}

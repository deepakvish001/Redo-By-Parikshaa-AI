/**
 * The state the screenshots are taken of.
 *
 * Invented, and it has to be: a real install's data is somebody's actual
 * practice history. It is also shaped to be honest — a mix of difficulties, a
 * couple of problems that fought back, some topics clearly weaker than others,
 * and a sheet that is part-finished. A screenshot showing 100% on everything
 * sells a product nobody recognises.
 */

const DAY = 86_400_000;
const now = Date.now();

const problem = (over) => ({
  platform: 'leetcode',
  language: 'Python3',
  attempts: 1,
  github: {
    status: 'synced',
    path: `leetcode/${over.difficulty ?? 'medium'}/${over.slug}/solution.py`,
    commitUrl: 'https://github.com/deepakvish001/dsa/commit/abc1234',
    syncedAt: now - DAY,
  },
  parikshaa: { status: 'synced' },
  solvedAt: now - 6 * DAY,
  updatedAt: now - DAY,
  code: 'class Solution:\n    def solve(self):\n        ...\n',
  ...over,
  revision: {
    stage: 1,
    ease: 1,
    dueAt: now + DAY,
    reviewCount: 1,
    lapses: 0,
    hintsUsed: 0,
    ...(over.revision ?? {}),
  },
});

export const problems = {
  'leetcode:daily-temperatures': problem({
    id: 'leetcode:daily-temperatures',
    problemId: '739',
    slug: 'daily-temperatures',
    title: 'Daily Temperatures',
    url: 'https://leetcode.com/problems/daily-temperatures/',
    difficulty: 'medium',
    tags: ['Stack', 'Array'],
    note: 'Walk right to left, keep indices whose answer is still unknown.',
    complexity: { time: 'O(n)', space: 'O(n)' },
    solveTimeMs: 24 * 60_000,
    attempts: 2,
    code:
      'class Solution:\n'
      + '    def dailyTemperatures(self, t: List[int]) -> List[int]:\n'
      + '        out, stack = [0] * len(t), []   # monotonic stack, decreasing\n'
      + '        for i, x in enumerate(t):\n'
      + '            while stack and t[stack[-1]] < x:\n'
      + '                j = stack.pop()\n'
      + '                out[j] = i - j\n'
      + '            stack.append(i)\n'
      + '        return out\n',
    solvedAt: now - 9 * DAY,
    revision: { stage: 2, dueAt: now - 2 * DAY, reviewCount: 3, lapses: 1 },
  }),
  'leetcode:trapping-rain-water': problem({
    id: 'leetcode:trapping-rain-water',
    problemId: '42',
    slug: 'trapping-rain-water',
    title: 'Trapping Rain Water',
    url: 'https://leetcode.com/problems/trapping-rain-water/',
    difficulty: 'hard',
    tags: ['Array', 'Two Pointers', 'Stack'],
    labels: ['revisit'],
    language: 'C++',
    note: 'Two pointers beat the monotonic stack here, and it is shorter.',
    attempts: 4,
    solveTimeMs: 52 * 60_000,
    code:
      'int trap(vector<int>& h) {\n'
      + '    int l = 0, r = h.size() - 1, lm = 0, rm = 0, out = 0;\n'
      + '    // monotonic stack works too, but two pointers is O(1) space\n'
      + '    while (l < r) { /* ... */ }\n'
      + '    return out;\n'
      + '}\n',
    solvedAt: now - 3 * DAY,
    revision: { stage: 0, dueAt: now - DAY, reviewCount: 2, lapses: 2, hintsUsed: 2 },
  }),
  'leetcode:word-break': problem({
    id: 'leetcode:word-break',
    problemId: '139',
    slug: 'word-break',
    title: 'Word Break',
    url: 'https://leetcode.com/problems/word-break/',
    difficulty: 'medium',
    tags: ['Dynamic Programming', 'Hash Table'],
    attempts: 3,
    solveTimeMs: 41 * 60_000,
    solvedAt: now - 14 * DAY,
    revision: { stage: 1, dueAt: now - 3 * DAY, reviewCount: 2, lapses: 1, hintsUsed: 1 },
  }),
  'leetcode:two-sum': problem({
    id: 'leetcode:two-sum',
    problemId: '1',
    slug: 'two-sum',
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'easy',
    tags: ['Array', 'Hash Table'],
    solveTimeMs: 7 * 60_000,
    solvedAt: now - 40 * DAY,
    revision: { stage: 3, dueAt: now + 11 * DAY, reviewCount: 4, lastReviewedAt: now - 30 * DAY },
  }),
  'leetcode:course-schedule': problem({
    id: 'leetcode:course-schedule',
    problemId: '207',
    slug: 'course-schedule',
    title: 'Course Schedule',
    url: 'https://leetcode.com/problems/course-schedule/',
    difficulty: 'medium',
    tags: ['Graph', 'Topological Sort'],
    attempts: 2,
    solveTimeMs: 33 * 60_000,
    solvedAt: now - 48 * DAY,
    revision: { stage: 2, dueAt: now + 4 * DAY, reviewCount: 3, lastReviewedAt: now - 38 * DAY },
  }),
  'leetcode:lru-cache': problem({
    id: 'leetcode:lru-cache',
    problemId: '146',
    slug: 'lru-cache',
    title: 'LRU Cache',
    url: 'https://leetcode.com/problems/lru-cache/',
    difficulty: 'medium',
    tags: ['Hash Table', 'Linked List', 'Design'],
    solveTimeMs: 29 * 60_000,
    solvedAt: now - 55 * DAY,
    revision: { stage: 2, dueAt: now + 6 * DAY, reviewCount: 3, lastReviewedAt: now - 45 * DAY },
  }),
  'leetcode:merge-intervals': problem({
    id: 'leetcode:merge-intervals',
    problemId: '56',
    slug: 'merge-intervals',
    title: 'Merge Intervals',
    url: 'https://leetcode.com/problems/merge-intervals/',
    difficulty: 'medium',
    tags: ['Array', 'Sorting'],
    solvedAt: now - 22 * DAY,
    revision: { stage: 2, dueAt: now + 2 * DAY, reviewCount: 2 },
  }),
  'leetcode:number-of-islands': problem({
    id: 'leetcode:number-of-islands',
    problemId: '200',
    slug: 'number-of-islands',
    title: 'Number of Islands',
    url: 'https://leetcode.com/problems/number-of-islands/',
    difficulty: 'medium',
    tags: ['Graph', 'Matrix'],
    solvedAt: now - 30 * DAY,
    revision: { stage: 1, dueAt: now + 3 * DAY, reviewCount: 1 },
  }),
  'codeforces:1899A': problem({
    id: 'codeforces:1899A',
    platform: 'codeforces',
    problemId: '1899A',
    slug: '1899A',
    title: 'Game with Integers',
    url: 'https://codeforces.com/problemset/problem/1899/A',
    difficulty: 'easy',
    tags: ['games', 'math'],
    language: 'C++',
    github: {
      status: 'synced',
      path: 'codeforces/800/1899A-game-with-integers/solution.cpp',
      commitUrl: 'https://github.com/deepakvish001/dsa/commit/def5678',
    },
    solvedAt: now - 2 * DAY,
    revision: { stage: 1, dueAt: now + DAY, reviewCount: 1 },
  }),
  'codeforces:1899C': problem({
    id: 'codeforces:1899C',
    platform: 'codeforces',
    problemId: '1899C',
    slug: '1899C',
    title: 'Yarik and Array',
    url: 'https://codeforces.com/problemset/problem/1899/C',
    difficulty: 'medium',
    tags: ['dp', 'greedy'],
    language: 'C++',
    attempts: 3,
    solvedAt: now - 11 * DAY,
    revision: { stage: 1, dueAt: now - DAY, reviewCount: 1, lapses: 1 },
  }),
};

/**
 * Nine consecutive days of revision behind today.
 *
 * The streak is computed from the days problems were solved or revised, not
 * from a counter — so it has to be earned here too. Without this the Stats tab
 * photographs a streak of zero directly beneath the streak feature.
 */
for (const [index, record] of Object.values(problems).slice(0, 9).entries()) {
  record.revision.lastReviewedAt = now - index * DAY;
}

export const meta = {
  reviewsCompleted: 46,
  lastReviewDay: new Date(now).toISOString().slice(0, 10),
  currentStreak: 12,
  longestStreak: 21,
};

/**
 * Eleven days solved behind an open today.
 *
 * The streak calendar reads this, not `meta` — and a card advertising a streak
 * feature while showing "0-day streak" is the screenshot arguing against the
 * product.
 */
export const daily = Object.fromEntries(
  Array.from({ length: 11 }, (_, i) => {
    const day = new Date(now - (i + 1) * DAY).toISOString().slice(0, 10);
    // Both keys are problems in `problems` above, because the calendar marks a
    // day green by looking the pick up there — a day whose pick was never
    // solved shows as picked-and-missed, and eleven of those is a streak of one.
    return [day, { key: i % 2 === 0 ? '1899A' : '1899C', pickedAt: now - (i + 1) * DAY }];
  }),
);

export const contests = {
  fetchedAt: now,
  failed: [],
  contests: [
    {
      id: 'codeforces:1900',
      platform: 'codeforces',
      name: 'Codeforces Round 900 (Div. 2)',
      url: 'https://codeforces.com/contests/1900',
      startAt: now + 2 * DAY + 3 * 3_600_000,
      durationMs: 2 * 3_600_000,
    },
    {
      id: 'leetcode:weekly-contest-500',
      platform: 'leetcode',
      name: 'Weekly Contest 500',
      url: 'https://leetcode.com/contest/weekly-contest-500',
      startAt: now + 4 * DAY,
      durationMs: 90 * 60_000,
    },
    {
      id: 'codechef:START100',
      platform: 'codechef',
      name: 'Starters 100',
      url: 'https://www.codechef.com/START100',
      startAt: now + 5 * DAY,
      durationMs: 3 * 3_600_000,
    },
    {
      id: 'atcoder:abc390',
      platform: 'atcoder',
      name: 'AtCoder Beginner Contest 390',
      url: 'https://atcoder.jp/contests/abc390',
      startAt: now + 6 * DAY,
      durationMs: 100 * 60_000,
    },
  ],
};

/** A part-finished import, which is what a sheet actually looks like. */
export const sheets = [
  {
    id: 'neetcode-150',
    name: 'NeetCode 150',
    builtIn: false,
    addedAt: now - 30 * DAY,
    entries: [
      ...[
        ['Two Sum', 'two-sum'],
        ['Contains Duplicate', 'contains-duplicate'],
        ['Valid Anagram', 'valid-anagram'],
        ['Group Anagrams', 'group-anagrams'],
        ['Top K Frequent Elements', 'top-k-frequent-elements'],
      ].map(([title, slug]) => ({ platform: 'leetcode', slug, title, group: 'Arrays & Hashing' })),
      ...[
        ['Daily Temperatures', 'daily-temperatures'],
        ['Trapping Rain Water', 'trapping-rain-water'],
        ['Largest Rectangle in Histogram', 'largest-rectangle-in-histogram'],
      ].map(([title, slug]) => ({ platform: 'leetcode', slug, title, group: 'Stack' })),
      ...[
        ['Number of Islands', 'number-of-islands'],
        ['Course Schedule', 'course-schedule'],
        ['Pacific Atlantic Water Flow', 'pacific-atlantic-water-flow'],
        ['Word Ladder', 'word-ladder'],
      ].map(([title, slug]) => ({ platform: 'leetcode', slug, title, group: 'Graphs' })),
      ...[
        ['Word Break', 'word-break'],
        ['Longest Increasing Subsequence', 'longest-increasing-subsequence'],
        ['Coin Change', 'coin-change'],
      ].map(([title, slug]) => ({ platform: 'leetcode', slug, title, group: 'Dynamic Programming' })),
    ],
  },
];

export const settings = {
  github: {
    token: 'github_pat_11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcdefgh',
    clientId: '',
    signInPrivate: true,
    perPlatform: {},
    owner: 'deepakvish001',
    repo: 'dsa',
    branch: 'main',
    enabled: true,
    commitMessage: 'solve: {title} ({platform})',
    backup: true,
    sync: true,
  },
  handles: {
    codeforces: 'deepakvish001',
    cfApiKey: '',
    cfApiSecret: '',
    leetcode: 'deepakvish001',
    goal: 1600,
    friends: [],
    organization: '',
  },
};

export { now, DAY };

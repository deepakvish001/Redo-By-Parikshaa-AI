import type { SolvedProblem } from './types.ts';

/**
 * The hint ladder for a problem you have already solved.
 *
 * This is a revision tool, so the most useful hints are not generic advice —
 * they are your own past work, revealed a step at a time. The ladder climbs
 * from "what kind of problem is this" to "what you wrote last time", and only
 * falls back to the tag library when there is nothing of your own to show.
 *
 * Nothing here calls out to a model or a server: everything comes from the
 * record already stored for the problem.
 */

export interface Hint {
  level: 1 | 2 | 3;
  title: string;
  body: string;
}

/**
 * Per-topic prompts. A nudge points at the shape of the problem without
 * naming the technique; an approach names it without writing the code.
 */
const TAG_HINTS: Record<string, { nudge: string; approach: string }> = {
  'hash table': {
    nudge: 'What would you need to look up instantly for this to become easy?',
    approach: 'Store what you have already seen in a map, keyed by whatever you will search for.',
  },
  array: {
    nudge: 'Does the order of the elements matter, or only their values?',
    approach: 'Consider a single pass that maintains a running answer as you go.',
  },
  string: {
    nudge: 'What changes as you move one character along?',
    approach: 'Track the state of the window or prefix as you scan, rather than rebuilding it.',
  },
  'two pointers': {
    nudge: 'What could you learn from looking at both ends at once?',
    approach: 'Move one pointer from each end, deciding at each step which side can safely advance.',
  },
  'sliding window': {
    nudge: 'Is the answer over a contiguous stretch that you could grow and shrink?',
    approach: 'Expand the right edge, then pull the left edge in while the window is invalid.',
  },
  'binary search': {
    nudge: 'Is there something monotonic here — a point where the answer flips from no to yes?',
    approach: 'Binary search over that boundary, with a predicate that is false then true.',
  },
  sorting: {
    nudge: 'Would this be obvious if the input were in order?',
    approach: 'Sort first, then let the ordering collapse the cases you have to handle.',
  },
  'dynamic programming': {
    nudge: 'What is the smallest version of this problem you could answer outright?',
    approach: 'Define the state, write the transition from smaller states, then decide the order to fill it in.',
  },
  greedy: {
    nudge: 'Is there a choice that is always safe to make first?',
    approach: 'Prove that taking the locally best option cannot rule out the best overall answer.',
  },
  recursion: {
    nudge: 'What does this problem look like one step smaller?',
    approach: 'Handle the base case, then assume the recursive call is correct and combine the results.',
  },
  backtracking: {
    nudge: 'What decision are you making at each step, and what makes a branch hopeless?',
    approach: 'Build the candidate one choice at a time, undoing the choice on the way back up.',
  },
  graph: {
    nudge: 'What are the nodes here, and what makes two of them adjacent?',
    approach: 'Model it as a graph explicitly, then reach for the traversal that matches the question.',
  },
  bfs: {
    nudge: 'Are you looking for the shortest number of steps?',
    approach: 'Breadth-first from the start, level by level, marking nodes as you enqueue them.',
  },
  dfs: {
    nudge: 'Do you need to explore one path fully before considering another?',
    approach: 'Depth-first with a visited set, carrying the state you need down the recursion.',
  },
  tree: {
    nudge: 'What does each subtree need to report back to its parent?',
    approach: 'Recurse to the children, then combine their answers into this node’s answer.',
  },
  'binary search tree': {
    nudge: 'What does the ordering guarantee let you skip?',
    approach: 'Use the invariant that everything left is smaller to discard half the tree at each step.',
  },
  heap: {
    nudge: 'Do you repeatedly need the smallest or largest item so far?',
    approach: 'Keep a heap of the candidates, pushing and popping as you scan.',
  },
  stack: {
    nudge: 'Does something need to wait until you find its match later?',
    approach: 'Push the pending items, and pop them the moment the thing they were waiting for arrives.',
  },
  queue: {
    nudge: 'Do items need to be handled in the order they arrived?',
    approach: 'Process from the front while appending to the back.',
  },
  'linked list': {
    nudge: 'Would a second pointer moving at a different speed tell you something?',
    approach: 'Use fast and slow pointers, and a dummy head so the first node is not a special case.',
  },
  'bit manipulation': {
    nudge: 'What happens if you look at this one bit at a time?',
    approach: 'Use masks and shifts; XOR cancels pairs, and n & (n-1) clears the lowest set bit.',
  },
  math: {
    nudge: 'Is there a formula or invariant that skips the simulation?',
    approach: 'Work out the closed form on small cases first, then confirm it holds in general.',
  },
  'prefix sum': {
    nudge: 'Are you asking the same range question over and over?',
    approach: 'Precompute cumulative totals so any range becomes one subtraction.',
  },
  'union find': {
    nudge: 'Are you really just asking whether two things ended up in the same group?',
    approach: 'Disjoint set union with path compression, merging as you process each connection.',
  },
  trie: {
    nudge: 'Do many of the inputs share the same beginnings?',
    approach: 'Build a prefix tree so shared prefixes are walked once.',
  },
  matrix: {
    nudge: 'Can you treat rows and columns as separate one-dimensional problems?',
    approach: 'Fix one dimension and reduce the rest to a problem you already know.',
  },
  simulation: {
    nudge: 'Have you written down the rules exactly as stated?',
    approach: 'Follow the process literally, and keep the state in one structure you can reason about.',
  },
  implementation: {
    nudge: 'Which case are you most likely to get wrong here?',
    approach: 'Enumerate the edge cases up front, then write the straightforward version.',
  },
};

/**
 * Tags that describe what the input is rather than how to attack it.
 *
 * Almost every problem is tagged `array` or `string`, so those carry far less
 * information than the technique tag sitting next to them — "Two Sum" is
 * tagged both `array` and `hash table`, and only the second one is a hint.
 */
const STRUCTURAL_TAGS = new Set([
  'array',
  'string',
  'matrix',
  'math',
  'implementation',
  'simulation',
]);

function firstTagHint(tags: string[]): { tag: string; nudge: string; approach: string } | undefined {
  const normalized = tags.map((tag) => tag.trim().toLowerCase());
  const known = normalized.filter((tag) => TAG_HINTS[tag]);

  const tag = known.find((candidate) => !STRUCTURAL_TAGS.has(candidate)) ?? known[0];
  const hit = tag ? TAG_HINTS[tag] : undefined;
  return hit ? { tag: tag as string, ...hit } : undefined;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Trimmed so level 3 is a reminder of your solution, not a wall of code. */
export function previewCode(code: string, maxLines = 30): string {
  const lines = code.split('\n');
  if (lines.length <= maxLines) return code;
  return `${lines.slice(0, maxLines).join('\n')}\n… (${lines.length - maxLines} more lines)`;
}

export function buildHintLadder(problem: SolvedProblem): Hint[] {
  const tagHint = firstTagHint(problem.tags);

  /* --- level 1: what kind of problem this is --- */

  const context: string[] = [];
  if (problem.tags.length > 0) context.push(`Tagged ${problem.tags.slice(0, 4).join(', ')}.`);
  if (problem.attempts > 1) {
    context.push(`It took you ${problem.attempts} attempts the first time.`);
  }
  if (problem.solveTimeMs) {
    context.push(`You spent about ${formatDuration(problem.solveTimeMs)} on it.`);
  }
  if (tagHint) context.push(tagHint.nudge);
  if (context.length === 0) {
    context.push('Start from the smallest input you can reason about completely.');
  }

  /* --- level 2: the technique, or what you wrote about it --- */

  const approach: string[] = [];
  if (problem.note?.trim()) approach.push(problem.note.trim());
  const complexity = [
    problem.complexity?.time && `Time ${problem.complexity.time}`,
    problem.complexity?.space && `Space ${problem.complexity.space}`,
  ].filter(Boolean);
  if (complexity.length > 0) approach.push(`You aimed for ${complexity.join(', ')}.`);
  if (approach.length === 0 && tagHint) approach.push(tagHint.approach);
  if (approach.length === 0) {
    approach.push('No notes were saved for this one — add some after you solve it again.');
  }

  return [
    { level: 1, title: 'Nudge', body: context.join(' ') },
    { level: 2, title: 'Approach', body: approach.join('\n\n') },
    {
      level: 3,
      title: `Your solution (${problem.language})`,
      body: previewCode(problem.code),
    },
  ];
}

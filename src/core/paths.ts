import type { Platform, SolvedProblem } from './types.ts';

/**
 * Maps a platform's language label to a file extension. LeetCode reports
 * machine-readable slugs (`python3`, `golang`); Codeforces reports human
 * labels (`GNU C++17 (64)`, `Python 3.8.10`), so lookup falls back to matching
 * the longest known keyword contained in the label.
 */
const EXTENSIONS: Record<string, string> = {
  c: 'c',
  gcc: 'c',
  clang: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  'g++': 'cpp',
  'clang++': 'cpp',
  csharp: 'cs',
  'c#': 'cs',
  java: 'java',
  javascript: 'js',
  js: 'js',
  node: 'js',
  typescript: 'ts',
  python: 'py',
  python3: 'py',
  pythondata: 'py',
  pypy: 'py',
  go: 'go',
  golang: 'go',
  rust: 'rs',
  kotlin: 'kt',
  swift: 'swift',
  scala: 'scala',
  ruby: 'rb',
  php: 'php',
  dart: 'dart',
  elixir: 'ex',
  erlang: 'erl',
  racket: 'rkt',
  bash: 'sh',
  mysql: 'sql',
  mssql: 'sql',
  oraclesql: 'sql',
  postgresql: 'sql',
  sql: 'sql',
  haskell: 'hs',
  perl: 'pl',
  pascal: 'pas',
  delphi: 'pas',
  ocaml: 'ml',
  fsharp: 'fs',
  d: 'd',
};

export function extensionForLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized) return 'txt';

  const exact = EXTENSIONS[normalized];
  if (exact) return exact;

  // Substring matching would be wrong here — "whitespace" contains "c". Instead
  // each word is matched on its own, trimming a version suffix one character at
  // a time so "g++17" reaches "g++" and "node.js" reaches "node".
  for (const token of normalized.split(/[^a-z0-9+#.]+/)) {
    for (let candidate = token; candidate.length > 0; candidate = candidate.slice(0, -1)) {
      const hit = EXTENSIONS[candidate];
      if (hit) return hit;
    }
  }

  return 'txt';
}

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Zero-pads numeric LeetCode ids so directory listings sort naturally. */
export function normalizeProblemId(problemId: string): string {
  return /^\d+$/.test(problemId) ? problemId.padStart(4, '0') : problemId.toUpperCase();
}

export function problemKey(platform: Platform, slug: string): string {
  return `${platform}:${slug}`;
}

/** Directory a problem's files live in, relative to the repository root. */
export function problemDirectory(problem: SolvedProblem): string {
  const parts: string[] = [problem.platform];
  if (problem.difficulty !== 'unknown') parts.push(problem.difficulty);
  parts.push(`${normalizeProblemId(problem.problemId)}-${slugify(problem.title) || problem.slug}`);
  return parts.join('/');
}

export function solutionPath(problem: SolvedProblem): string {
  return solutionFile(problem, extensionForLanguage(problem.language));
}

export function solutionFile(problem: SolvedProblem, extension: string): string {
  return `${problemDirectory(problem)}/solution.${extension}`;
}

/**
 * Every solution file this problem should have, newest language first.
 *
 * Solving something in C++ and then again in Python used to overwrite the C++
 * file: one problem, one `solution.<ext>`, last language wins. Two of the
 * reference extensions get this right and Redo did not.
 */
export function solutionFiles(
  problem: SolvedProblem,
): Array<{ path: string; content: string; language: string }> {
  const solutions = problem.solutions ?? {};
  const extensions = Object.keys(solutions);

  // A record written before this existed has only the flat `code` field.
  if (extensions.length === 0) {
    return [
      {
        path: solutionPath(problem),
        content: problem.code,
        language: problem.language,
      },
    ];
  }

  return extensions
    .sort((a, b) => (solutions[b]?.solvedAt ?? 0) - (solutions[a]?.solvedAt ?? 0))
    .map((extension) => ({
      path: solutionFile(problem, extension),
      content: solutions[extension]!.code,
      language: solutions[extension]!.language,
    }));
}

export function notesPath(problem: SolvedProblem): string {
  return `${problemDirectory(problem)}/README.md`;
}

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
  return `${problemDirectory(problem)}/solution.${extensionForLanguage(problem.language)}`;
}

export function notesPath(problem: SolvedProblem): string {
  return `${problemDirectory(problem)}/README.md`;
}

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { tags } from '@lezer/highlight';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';

/**
 * The editor.
 *
 * CodeMirror 6 rather than Monaco: roughly six hundred kilobytes against five
 * megabytes, for an editor that needs to highlight four languages and indent
 * with tab. Monaco brings a whole language-server protocol and a web worker
 * with it, and none of that is reachable for C++ in a content script.
 *
 * Only the pieces that earn their weight are imported — no autocompletion, no
 * search panel, no lint gutter. Every one of those is a package.
 */

export type Theme = 'dark' | 'light';

const DARK = EditorView.theme(
  {
    '&': { color: 'hsl(0 0% 97%)', backgroundColor: 'hsl(240 25% 4%)', height: '100%' },
    '.cm-content': { caretColor: 'hsl(22 95% 55%)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'hsl(22 95% 55%)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'hsl(22 95% 55% / 0.24)',
    },
    '.cm-gutters': {
      backgroundColor: 'hsl(240 25% 4%)',
      color: 'hsl(0 0% 38%)',
      border: 'none',
      borderRight: '1px solid hsl(0 0% 14%)',
    },
    '.cm-activeLine': { backgroundColor: 'hsl(0 0% 100% / 0.035)' },
    '.cm-activeLineGutter': { backgroundColor: 'hsl(0 0% 100% / 0.035)', color: 'hsl(0 0% 72%)' },
  },
  { dark: true },
);

const LIGHT = EditorView.theme(
  {
    '&': { color: 'hsl(220 15% 16%)', backgroundColor: '#fff', height: '100%' },
    '.cm-content': { caretColor: 'hsl(22 95% 45%)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'hsl(22 95% 45%)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'hsl(22 95% 55% / 0.18)',
    },
    '.cm-gutters': {
      backgroundColor: '#fff',
      color: 'hsl(220 9% 62%)',
      border: 'none',
      borderRight: '1px solid hsl(220 13% 91%)',
    },
    '.cm-activeLine': { backgroundColor: 'hsl(220 20% 96%)' },
    '.cm-activeLineGutter': { backgroundColor: 'hsl(220 20% 96%)', color: 'hsl(220 12% 40%)' },
  },
  { dark: false },
);

/** Shared by both themes: only the colours differ, never the metrics. */
const METRICS = EditorView.theme({
  '&': { fontSize: '13px' },
  '.cm-content': {
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
    padding: '10px 0',
  },
  '.cm-gutters': { fontVariantNumeric: 'tabular-nums' },
  '.cm-placeholder': { color: 'hsl(220 9% 55%)', fontStyle: 'normal' },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.6' },
});

const DARK_TOKENS = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword], color: 'hsl(291 55% 72%)' },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: 'hsl(0 0% 92%)' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: 'hsl(43 96% 62%)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'hsl(175 60% 55%)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'hsl(22 95% 62%)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'hsl(122 40% 62%)' },
  { tag: tags.comment, color: 'hsl(0 0% 44%)', fontStyle: 'italic' },
  { tag: tags.operator, color: 'hsl(0 0% 72%)' },
  { tag: [tags.processingInstruction, tags.meta], color: 'hsl(222 90% 72%)' },
  { tag: tags.invalid, color: 'hsl(0 84% 66%)' },
]);

const LIGHT_TOKENS = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword], color: 'hsl(291 60% 42%)' },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: 'hsl(220 15% 20%)' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: 'hsl(35 90% 38%)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'hsl(185 65% 30%)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'hsl(20 90% 42%)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'hsl(122 45% 30%)' },
  { tag: tags.comment, color: 'hsl(220 9% 55%)', fontStyle: 'italic' },
  { tag: tags.operator, color: 'hsl(220 12% 38%)' },
  { tag: [tags.processingInstruction, tags.meta], color: 'hsl(222 75% 45%)' },
  { tag: tags.invalid, color: 'hsl(0 70% 45%)' },
]);

function themeOf(theme: Theme): Extension {
  return theme === 'light'
    ? [LIGHT, syntaxHighlighting(LIGHT_TOKENS)]
    : [DARK, syntaxHighlighting(DARK_TOKENS)];
}

/**
 * The grammar for a Codeforces language name.
 *
 * Matched loosely on purpose: Codeforces offers fifty compilers and the names
 * change every year, so anything unrecognised gets a plain editor rather than
 * the wrong grammar — highlighting Rust as C++ is worse than not highlighting.
 */
export function grammarFor(language: string): Extension | undefined {
  const name = language.toLowerCase();
  if (/g\+\+|c\+\+|clang|gcc|\bc\b/.test(name)) return cpp();
  if (/python|pypy/.test(name)) return python();
  if (/kotlin|java(?!script)/.test(name)) return java();
  if (/javascript|node|typescript/.test(name)) return javascript();
  return undefined;
}

/** `Ln 12, Ch 4` — the caret, as the status line prints it. */
export function caretLabel(state: EditorState): string {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return `Ln ${line.number}, Ch ${head - line.from}`;
}

export interface Editor {
  view: EditorView;
  value(): string;
  setValue(text: string): void;
  setLanguage(language: string): void;
  setTheme(theme: Theme): void;
  focus(): void;
  destroy(): void;
}

export function createEditor(
  parent: HTMLElement,
  options: {
    doc: string;
    language: string;
    theme: Theme;
    /** Shown while the document is empty, as the reference editors do. */
    hint?: string;
    onChange: (text: string) => void;
    /** Called for the caret as well as for edits, so the status line can follow. */
    onCaret?: (label: string) => void;
    /** ⌘/Ctrl+Enter, which the header advertises. */
    onRun?: () => void;
  },
): Editor {
  const grammar = new Compartment();
  const palette = new Compartment();

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        keymap.of([
          // Before the defaults, so Enter does not simply insert a newline here.
          {
            key: 'Mod-Enter',
            run: () => {
              options.onRun?.();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          // `indentWithTab` last, so Tab indents rather than moving focus —
          // the right trade in an editor and the wrong one anywhere else.
          indentWithTab,
        ]),
        indentUnit.of('    '),
        options.hint ? placeholder(options.hint) : [],
        METRICS,
        palette.of(themeOf(options.theme)),
        grammar.of(grammarFor(options.language) ?? []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString());
          if (update.docChanged || update.selectionSet) {
            options.onCaret?.(caretLabel(update.state));
          }
        }),
      ],
    }),
  });

  return {
    view,
    value: () => view.state.doc.toString(),
    setValue: (text) =>
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    setLanguage: (language) =>
      view.dispatch({ effects: grammar.reconfigure(grammarFor(language) ?? []) }),
    setTheme: (theme) => view.dispatch({ effects: palette.reconfigure(themeOf(theme)) }),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

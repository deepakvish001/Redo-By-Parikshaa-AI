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
} from '@codemirror/view';

/**
 * The editor.
 *
 * CodeMirror 6 rather than Monaco: roughly two hundred kilobytes against a
 * megabyte and a half, for an editor that needs to highlight four languages and
 * indent with tab. Monaco brings a whole language-server protocol and a web
 * worker with it, and none of that is reachable for C++ in a content script.
 *
 * Only the pieces that earn their weight are imported — no autocompletion, no
 * search panel, no lint gutter. Every one of those is a package.
 */

/** Redo's palette, as CodeMirror wants it. */
const THEME = EditorView.theme(
  {
    '&': {
      color: 'hsl(0 0% 97%)',
      backgroundColor: 'hsl(240 25% 4%)',
      height: '100%',
      fontSize: '13px',
    },
    '.cm-content': {
      caretColor: 'hsl(22 95% 55%)',
      fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
      padding: '8px 0',
    },
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
    '.cm-activeLineGutter': {
      backgroundColor: 'hsl(0 0% 100% / 0.035)',
      color: 'hsl(0 0% 72%)',
    },
    '.cm-scroller': { overflow: 'auto', lineHeight: '1.55' },
  },
  { dark: true },
);

const HIGHLIGHT = HighlightStyle.define([
  { tag: tags.keyword, color: 'hsl(291 55% 72%)' },
  { tag: tags.controlKeyword, color: 'hsl(291 55% 72%)' },
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

export interface Editor {
  view: EditorView;
  value(): string;
  setValue(text: string): void;
  setLanguage(language: string): void;
  destroy(): void;
}

export function createEditor(
  parent: HTMLElement,
  options: { doc: string; language: string; onChange: (text: string) => void },
): Editor {
  const grammar = new Compartment();

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
        // `indentWithTab` last, so Tab indents rather than moving focus — which
        // is the right trade in an editor and the wrong one anywhere else.
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        indentUnit.of('    '),
        syntaxHighlighting(HIGHLIGHT),
        THEME,
        grammar.of(grammarFor(options.language) ?? []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString());
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
    destroy: () => view.destroy(),
  };
}

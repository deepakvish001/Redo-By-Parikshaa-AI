import { isHost } from '../../core/hosts.ts';
import { parseProblem } from '../../core/cf-url.ts';
import { send } from '../../core/messages.ts';
import { FROZEN, freeze, labelFor, thaw } from '../../core/translate.ts';
import { button, h } from '../inject/dom.ts';
import type { Mount, MountContext } from '../inject/registry.ts';
import { showToast } from '../toast.ts';

/**
 * A button that translates the statement in place, and puts it back.
 *
 * Two decisions worth stating.
 *
 * **It replaces text nodes, not HTML.** The alternative — translate the
 * statement's innerHTML and write it back — is how every naive version of this
 * loses the MathJax the page has already rendered, and it is also an injection
 * of a third party's output into the page as markup. Walking text nodes cannot
 * do either: `nodeValue` is text, and a translated string that happened to
 * contain a tag would appear as a tag, spelled out, and change nothing.
 *
 * **It is reversible.** Every node keeps its original, so pressing the button
 * again restores the statement exactly. A translation you cannot undo is a
 * translation you cannot check.
 */

const MIN_LENGTH = 3;

/**
 * The text nodes worth translating.
 *
 * Anything inside a frozen element — code, samples, rendered maths — is skipped
 * entirely, and so is anything without a letter in it: `10^5` and `1 ≤ n ≤ 200`
 * are not sentences, and sending them invites a model to helpfully "fix" them.
 */
export function collectTextNodes(root: Element): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const value = text.nodeValue ?? '';
    if (value.trim().length < MIN_LENGTH) continue;
    if (!/\p{Letter}{2}/u.test(value)) continue;
    if (text.parentElement?.closest(FROZEN)) continue;
    out.push(text);
  }

  return out;
}

function render(context: MountContext): void {
  const parsed = parseProblem(context.url.pathname);
  const statement = document.querySelector('.problem-statement');
  if (!parsed || !statement) return;

  const original = new Map<Text, string>();
  let showing = false;

  const restore = () => {
    for (const [node, value] of original) node.nodeValue = value;
    original.clear();
    showing = false;
  };

  // Registered here so navigating away or switching the feature off never
  // leaves the page holding a half-translated statement.
  context.signal.addEventListener('abort', restore);

  const label = (busy: boolean) =>
    busy ? 'Translating…' : showing ? 'Show the original' : `Translate`;

  const control = button('', async () => {
    if (showing) {
      restore();
      control.textContent = label(false);
      return;
    }

    control.disabled = true;
    control.textContent = label(true);

    try {
      const nodes = collectTextNodes(statement);
      const segments = nodes.map((node) => freeze(node.nodeValue ?? ''));
      // Deduplicated: a statement repeats "Input" and "Output" and every
      // repetition would otherwise be its own line in the request.
      const unique = [...new Set(segments.map((segment) => segment.text))];

      const result = await send({
        type: 'translate:strings',
        problem: `${parsed.contestId}${parsed.index}`,
        strings: unique,
      });

      if (context.signal.aborted) return;

      const translatedCount = Object.keys(result.strings).length;
      if (translatedCount === 0) {
        showToast({
          title: 'Could not translate',
          body: result.error ?? 'Nothing came back.',
          tone: 'error',
        });
        return;
      }

      for (const [index, node] of nodes.entries()) {
        const segment = segments[index]!;
        const line = result.strings[segment.text];
        if (line === undefined) continue;
        original.set(node, node.nodeValue ?? '');
        // Text, not markup — see the note at the top of this file.
        node.nodeValue = thaw(line, segment.frozen);
      }

      showing = original.size > 0;
      if (result.error) {
        showToast({
          title: 'Translated in part',
          body: result.error,
          tone: 'info',
          timeout: 6000,
        });
      }
    } catch (error) {
      showToast({
        title: 'Could not translate',
        body: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    } finally {
      control.disabled = false;
      control.textContent = label(false);
    }
  }, { class: 'ghost' });

  control.textContent = label(false);

  void send({ type: 'settings:get' })
    .then((settings) => {
      if (context.signal.aborted) return;
      control.title = `Sends the statement's text to Google, in ${labelFor(settings.translate.language)}`;
    })
    .catch(() => undefined);

  context.el.replaceChildren(
    h('div', { class: 'card' }, h('div', { class: 'body' }, h('div', { class: 'row' }, control))),
  );
}

export const codeforcesTranslate: Mount = {
  id: 'cf-translate',
  matches: (url) =>
    isHost(url.hostname, 'codeforces.com') && parseProblem(url.pathname) !== null,
  // Both switches: the feature, and a key to use it with. Without a key the
  // button would only ever produce an error, and a button that cannot work is
  // worse than no button.
  enabled: (settings) => settings.translate.enabled && settings.translate.apiKey.trim() !== '',
  anchor: () => {
    const sidebar = document.querySelector('#sidebar');
    return sidebar ? { parent: sidebar, position: 'afterbegin' } : null;
  },
  render,
};

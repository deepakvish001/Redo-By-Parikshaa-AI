import { isHost } from '../../core/hosts.ts';
import type { Mount, MountContext } from '../inject/registry.ts';

/**
 * A dark Codeforces, for people who want one.
 *
 * This is the only thing Redo does that restyles the judge's own page rather
 * than adding to it, and it is off by default for that reason. Two of the
 * reference extensions exist purely to do this, which says the demand is real;
 * it also means the risk is real, because a stylesheet that fights the site is
 * worse than no stylesheet at all.
 *
 * Three rules kept it honest:
 *
 * - **Recolour, never relayout.** Not one rule here touches `display`,
 *   `position`, `width` or `float`. Codeforces is a table-heavy 2010 layout
 *   that people have used for fifteen years; moving anything would break muscle
 *   memory for a cosmetic gain.
 * - **Leave the rank colours alone.** A handle's colour *is* information on
 *   Codeforces — it is how you read a standings page at a glance — so every
 *   `.user-*` class is explicitly excluded.
 * - **Leave verdicts alone.** Green means accepted and red means it is not.
 *
 * It is one `<style>` element. Turning the switch off removes it and the page
 * is exactly as Codeforces built it, with no reload.
 */

export const SKIN = `
:root {
  color-scheme: dark;
  --redo-bg: #14141a;
  --redo-surface: #1b1b22;
  --redo-raised: #22222b;
  --redo-line: #2e2e39;
  --redo-text: #e6e6ea;
  --redo-muted: #a0a0ad;
}

html, body {
  background: var(--redo-bg) !important;
  color: var(--redo-text) !important;
}

/* Codeforces paints its own background image on the body wrapper. */
#body, #pageContent, .content-with-sidebar, #footer {
  background: transparent !important;
  background-image: none !important;
}

/* The boxes: sidebar cards, the problem statement, tables, the header bar. */
.roundbox, .problem-statement, .datatable, .sidebar, .caption,
.menu-box, .second-level-menu, table.rtable, .comment-table, .topic,
.bottom-links, #header, .lang-chooser, .titled {
  background: var(--redo-surface) !important;
  background-image: none !important;
  color: var(--redo-text) !important;
  border-color: var(--redo-line) !important;
}

.roundbox .caption, .datatable caption, table th, .datatable th, .rtable th {
  background: var(--redo-raised) !important;
  color: var(--redo-text) !important;
  border-color: var(--redo-line) !important;
}

/* Codeforces draws box corners as images, which stay light on a dark box. */
.roundbox .lt, .roundbox .rt, .roundbox .lb, .roundbox .rb,
.roundbox .ilt, .roundbox .irt, .roundbox .ilb, .roundbox .irb {
  background-image: none !important;
}

td, th, tr, .datatable td, .rtable td {
  border-color: var(--redo-line) !important;
  background-color: transparent !important;
}

/* Sample blocks and code, which are the reason people want this at all. */
pre, code, .input pre, .output pre, .sample-test .title, .prettyprint {
  background: #101016 !important;
  color: #dcdce4 !important;
  border-color: var(--redo-line) !important;
}

input[type="text"], input[type="password"], input[type="number"],
textarea, select, .monospaced {
  background: #101016 !important;
  color: var(--redo-text) !important;
  border-color: var(--redo-line) !important;
}

/* Rank colours and verdicts are information on Codeforces: a handle's colour
   is how you read a standings page at a glance, and green against red is the
   whole point of a status table. Nothing here may touch either.

   Excluded by not matching, rather than by overriding. The first attempt set
   "color: revert !important" on them, which reverts to the user-agent origin
   and so threw the site's own colour away — every rank went link-blue and
   every verdict went plain grey. No author rule can put another author rule
   back, so the only correct approach is never to have matched. */
a:not(.rated-user):not([class*="user-"]) { color: #7aa7ff; }

/* Images and diagrams inside statements assume a white page. */
.problem-statement img, .ttypography img {
  background: #f4f4f6;
  border-radius: 3px;
}
`;

/**
 * Tighter navigation: the second-level menu made sticky.
 *
 * The one exception to "recolour, never relayout", and it is a small one —
 * the tab strip stops scrolling away on a long standings page. Nothing moves;
 * it just stays.
 */
export const NAVIGATION = `
.second-level-menu {
  position: sticky !important;
  top: 0;
  z-index: 40;
}
`;

function render(context: MountContext): void {
  // Deliberately in the light DOM: this styles the *page*, and a shadow root
  // is the one place from which it could not.
  const style = document.createElement('style');
  style.id = 'redo-cf-skin';
  style.textContent = SKIN + NAVIGATION;
  document.documentElement.append(style);

  // The mount's own host stays empty; it exists so the runner tears the
  // stylesheet down when the switch goes off or the page changes.
  context.signal.addEventListener('abort', () => style.remove());
}

export const codeforcesSkin: Mount = {
  id: 'cf-skin',
  matches: (url) => isHost(url.hostname, 'codeforces.com'),
  enabled: (settings) => settings.page.skin,
  anchor: () => (document.body ? { parent: document.body, position: 'beforeend' } : null),
  render,
};

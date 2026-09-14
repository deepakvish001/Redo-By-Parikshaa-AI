import assert from 'node:assert/strict';
import test from 'node:test';

import { NAVIGATION, SKIN as RAW } from '../src/content/mounts/cf-skin.ts';

/** The rules only — the comments explain what is deliberately absent. */
const SKIN = RAW.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The skin is CSS, so these are invariants rather than behaviour: the rules it
 * must never contain. Both were violated by the first draft, and both are the
 * kind of thing that is invisible until somebody's standings page is unreadable.
 */

test('the skin recolours and never relayouts', () => {
  // Codeforces is a table-heavy 2010 layout people have used for fifteen
  // years. Moving anything trades muscle memory for a cosmetic gain.
  for (const property of ['display:', 'float:', 'width:', 'margin:', 'padding:', 'flex']) {
    assert.ok(
      !SKIN.includes(property),
      `the skin must not set ${property} — it recolours, it does not relayout`,
    );
  }
});

test('nothing in the skin targets a rank or a verdict', () => {
  // A handle's colour is how a standings page is read at a glance, and green
  // against red is the whole point of a status table.
  for (const selector of ['.user-', '.rated-user {', '.verdict-', '.cell-accepted']) {
    assert.ok(!SKIN.includes(`${selector}`) || SKIN.includes(`:not(${selector}`), selector);
  }
});

test('the link colour explicitly steps around rated users', () => {
  assert.match(SKIN, /a:not\(\.rated-user\):not\(\[class\*="user-"\]\)/);
});

test('"revert" is never used to undo a rule', () => {
  // It reverts to the *user-agent* origin, not to the site's own rule, so it
  // throws away exactly what it was meant to preserve.
  assert.ok(!SKIN.includes('revert'));
});

test('the one layout change is sticky navigation, and it is separate', () => {
  assert.match(NAVIGATION, /position: sticky/);
  assert.ok(!NAVIGATION.includes('display:'));
});

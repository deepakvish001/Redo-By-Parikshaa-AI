/**
 * A four-line element builder.
 *
 * Widgets are built from elements rather than from `innerHTML` strings on
 * purpose: a problem title, a verdict and a note are all user- or judge-supplied
 * text going into a page, and `textContent` cannot be talked into executing
 * anything. The helper exists so that choice stays convenient.
 */

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | false | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (name === 'class') el.className = String(value);
    else if (name === 'text') el.textContent = String(value);
    else el.setAttribute(name, value === true ? '' : String(value));
  }

  for (const child of children) {
    if (child === false || child === null || child === undefined) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  return el;
}

/** `button` with its click handler, because every widget needs a dozen. */
export function button(
  label: string,
  onClick: () => void,
  options: { class?: string; title?: string; disabled?: boolean } = {},
): HTMLButtonElement {
  const el = h('button', {
    type: 'button',
    class: options.class,
    title: options.title,
    disabled: options.disabled,
  });
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

/** `01:23:45`, or `04:32` under an hour. Used by the solve clock. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = String(Math.floor(total / 60) % 60).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

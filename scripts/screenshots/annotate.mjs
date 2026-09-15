/**
 * Callouts, drawn over a screenshot at the thing they are describing.
 *
 * A store screenshot has about two seconds to say what it is looking at. A bare
 * capture of a side panel does not: the reader has to find the interesting part
 * themselves, and mostly does not bother. So each shot carries numbered labels
 * with an arrow to the control they name.
 *
 * The geometry is measured, never guessed. Each label names a real selector,
 * the element's box is read from the live page, and the arrow is drawn to that
 * box — so a callout cannot drift away from its target when the layout changes,
 * and a selector that stops matching fails the render instead of quietly
 * pointing at empty space.
 */

/** Injected into whichever page is being captured. */
export const OVERLAY_CSS = `
.rdo-layer {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  font-family: 'Manrope', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.rdo-label {
  position: absolute;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  max-width: 330px;
  padding: 10px 13px 10px 11px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(14, 14, 16, 0.94);
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.55);
  color: #f4f4f5;
  font-size: 13.5px;
  line-height: 1.45;
  font-weight: 500;
}
.rdo-label b {
  flex: none;
  width: 21px;
  height: 21px;
  margin-top: 1px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #f97316, #fbbf24);
  color: #1a1006;
  font-size: 12px;
  font-weight: 800;
}
.rdo-label i {
  font-style: normal;
}
.rdo-label strong {
  display: block;
  font-weight: 700;
  color: #fff;
}
.rdo-ring {
  position: absolute;
  border-radius: 9px;
  border: 2px solid #fbbf24;
  box-shadow: 0 0 0 4px rgba(251, 191, 36, 0.14);
  pointer-events: none;
}
`;

/**
 * Places the labels and draws the arrows.
 *
 * Runs inside the page because it needs the real label heights — a label's box
 * is only known once the text has wrapped, and the collision pass that keeps
 * two callouts off each other depends on those heights being the true ones.
 */
export function drawAnnotations(unordered, viewport) {
  // Numbered down the page, so the reader's eye and the numbers agree. The
  // callouts are written in whatever order makes sense to write them in.
  const items = [...unordered].sort((a, b) => a.target.y - b.target.y);

  const layer = document.createElement('div');
  layer.className = 'rdo-layer';
  document.body.append(layer);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(viewport.width));
  svg.setAttribute('height', String(viewport.height));
  svg.style.cssText = 'position:absolute;inset:0;overflow:visible';
  layer.append(svg);

  const placed = [];

  for (const [index, item] of items.entries()) {
    const label = document.createElement('div');
    label.className = 'rdo-label';
    label.innerHTML = `<b>${index + 1}</b><i>${
      item.title ? `<strong>${item.title}</strong>` : ''
    }${item.say}</i>`;
    layer.append(label);

    const size = label.getBoundingClientRect();
    const onLeft = item.side !== 'right';

    // Beside the target, then nudged down until it clears the previous label.
    // Never above `item.column.top`, which is where the headline ends — a
    // callout sitting on the title is the first thing a reviewer notices.
    const x = onLeft ? item.column.left : item.column.right - size.width;
    let y = Math.max(item.column.top, item.target.y + item.target.height / 2 - size.height / 2);

    for (const other of placed) {
      const overlaps = y < other.bottom + 14 && y + size.height > other.top - 14;
      const sameColumn = Math.abs(other.left - x) < 40;
      if (overlaps && sameColumn) y = other.bottom + 14;
    }
    y = Math.min(y, viewport.height - size.height - 16);

    label.style.left = `${Math.round(x)}px`;
    label.style.top = `${Math.round(y)}px`;
    placed.push({ top: y, bottom: y + size.height, left: x });

    // The arrow leaves the side of the label nearest its target.
    const startX = onLeft ? x + size.width : x;
    const startY = y + size.height / 2;
    const endX = onLeft ? item.target.x - 10 : item.target.x + item.target.width + 10;
    const endY = item.target.y + item.target.height / 2;

    // A single control point pulled horizontally gives a calm arc rather than
    // the loops a symmetric cubic produces when the two ends are level.
    const midX = (startX + endX) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#fbbf24');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    svg.append(path);

    const head = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const tip = onLeft ? endX + 9 : endX - 9;
    const back = onLeft ? endX : endX;
    head.setAttribute(
      'd',
      `M ${tip} ${endY} L ${back} ${endY - 5} L ${back} ${endY + 5} Z`,
    );
    head.setAttribute('fill', '#fbbf24');
    svg.append(head);

    // A ring around the whole control rather than a dot on top of it: the dot
    // covered the very thing the callout was pointing at.
    const ring = document.createElement('div');
    ring.className = 'rdo-ring';
    const pad = 4;
    ring.style.left = `${Math.round(item.target.x - pad)}px`;
    ring.style.top = `${Math.round(item.target.y - pad)}px`;
    ring.style.width = `${Math.round(item.target.width + pad * 2)}px`;
    ring.style.height = `${Math.round(item.target.height + pad * 2)}px`;
    layer.append(ring);
  }
}

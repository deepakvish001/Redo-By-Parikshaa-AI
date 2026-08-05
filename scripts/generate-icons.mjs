import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');

/* --- minimal PNG encoder (RGBA, no external deps) --- */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay 0: deflate, adaptive filtering, no interlace

  // Each scanline is prefixed with filter byte 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --- the artwork: rounded tile, checkmark, revision dot --- */

const SS = 4; // supersampling factor, gives us cheap anti-aliasing

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideRoundedRect(x, y, size, radius) {
  const inset = size * 0.04;
  const min = inset;
  const max = size - inset;
  if (x < min || y < min || x > max || y > max) return false;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function blend(dst, src, alpha) {
  return dst * (1 - alpha) + src * alpha;
}

/** Sign of the cross product — the side of AB that P falls on. */
function side(px, py, ax, ay, bx, by) {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

function insideTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = side(px, py, ax, ay, bx, by);
  const d2 = side(px, py, bx, by, cx, cy);
  const d3 = side(px, py, cx, cy, ax, ay);
  // Inside when every cross product shares a sign.
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.24;
  const stroke = size * 0.088;
  const ringRadius = size * 0.235;

  /**
   * A solid arrowhead sitting on the open end of the ring, pointing the way
   * the arrow travels. Drawn as a triangle so the tip stays sharp at 16px,
   * where a stroked chevron turns to mush.
   */
  const head = [
    [0.55, 0.135],
    [0.55, 0.405],
    [0.79, 0.27],
  ].map(([x, y]) => [x * size, y * size]);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          let sr = 0;
          let sg = 0;
          let sb = 0;
          let sa = 0;

          if (insideRoundedRect(px, py, size, radius)) {
            // Parikshaa's own gradient: orange hsl(22 95% 53%) -> amber hsl(43 96% 56%)
            const t = (px + py) / (2 * size);
            sr = blend(249, 251, t);
            sg = blend(115, 191, t);
            sb = blend(22, 36, t);
            sa = 1;

            // A redo arrow: an open ring with an arrowhead at its top right.
            const dx = px - size / 2;
            const dy = py - size / 2;
            const fromCentre = Math.hypot(dx, dy);
            const angle = Math.atan2(dy, dx);
            // The gap the arrowhead fills, from about -78 to -8 degrees.
            const inGap = angle > -1.36 && angle < -0.14;
            const onRing =
              Math.abs(fromCentre - ringRadius) <= stroke / 2 && !inGap;

            if (onRing || insideTriangle(px, py, head[0], head[1], head[2])) {
              sr = 26;
              sg = 16;
              sb = 6;
            }
          }

          r += sr;
          g += sg;
          b += sb;
          a += sa;
        }
      }

      const samples = SS * SS;
      const i = (y * size + x) * 4;
      // Colours are averaged over covered samples only, so edges do not bleed
      // toward black where coverage is partial.
      const covered = a || 1;
      rgba[i] = Math.round(r / covered);
      rgba[i + 1] = Math.round(g / covered);
      rgba[i + 2] = Math.round(b / covered);
      rgba[i + 3] = Math.round((a / samples) * 255);
    }
  }

  return encodePng(size, rgba);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(outDir, `icon-${size}.png`), renderIcon(size));
  console.log(`wrote icon-${size}.png`);
}

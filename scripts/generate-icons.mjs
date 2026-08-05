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

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.24;
  const stroke = size * 0.085;

  // checkmark, in unit coordinates scaled to the tile
  const check = [
    [0.28, 0.53, 0.44, 0.68],
    [0.44, 0.68, 0.74, 0.34],
  ].map(([ax, ay, bx, by]) => [ax * size, ay * size, bx * size, by * size]);

  const dot = { x: size * 0.775, y: size * 0.735, r: size * 0.085 };

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
            // vertical indigo -> violet gradient
            const t = py / size;
            sr = blend(79, 139, t);
            sg = blend(70, 92, t);
            sb = blend(229, 246, t);
            sa = 1;

            const checkDistance = Math.min(
              ...check.map(([ax, ay, bx, by]) => distanceToSegment(px, py, ax, ay, bx, by)),
            );
            if (checkDistance <= stroke / 2) {
              sr = 255;
              sg = 255;
              sb = 255;
            }

            if (Math.hypot(px - dot.x, py - dot.y) <= dot.r) {
              sr = 251;
              sg = 191;
              sb = 36;
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

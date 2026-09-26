// Writes the ALT toolbar icons (MASTER blue rounded square with a white "A" glyph) as PNGs,
// using a tiny encoder on node:zlib so no binaries live in git and no dependency is needed.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const BLUE = [0x00, 0x71, 0xe3];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Signed distance from point to a segment, used to draw the "A" strokes. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pixel(x, y, size) {
  // Normalised coordinates 0..1 at pixel centre.
  const u = (x + 0.5) / size;
  const v = (y + 0.5) / size;
  const r = 0.22; // corner radius
  const cx = Math.min(Math.max(u, r), 1 - r);
  const cy = Math.min(Math.max(v, r), 1 - r);
  const inside = Math.hypot(u - cx, v - cy) <= r;
  if (!inside) return [0, 0, 0, 0];
  const w = Math.max(0.075, 1.6 / size);
  const glyph =
    segDist(u, v, 0.5, 0.22, 0.28, 0.78) < w ||
    segDist(u, v, 0.5, 0.22, 0.72, 0.78) < w ||
    segDist(u, v, 0.37, 0.58, 0.63, 0.58) < w * 0.85;
  return glyph ? [255, 255, 255, 255] : [...BLUE, 255];
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function writeIcons(outDir) {
  const dir = join(outDir, "icons");
  mkdirSync(dir, { recursive: true });
  for (const size of [16, 32, 48, 128]) writeFileSync(join(dir, `icon-${size}.png`), png(size));
}

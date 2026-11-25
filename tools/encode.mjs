// Dependency-free PNG and animated-GIF encoders for the capture script.
import zlib from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export function encodePNG(img) {
  const { w, h, px } = img;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const c = px[y * w + x], o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = c & 255; raw[o + 1] = (c >>> 8) & 255; raw[o + 2] = (c >>> 16) & 255; raw[o + 3] = c >>> 24;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- GIF ----
function buildPalette(frames) {
  let shift = 0;
  for (;;) {
    const m = shift ? (0xff << shift) & 0xff : 0xff;
    const key = (c) => ((c & m) | (((c >>> 8) & m) << 8) | (((c >>> 16) & m) << 16)) >>> 0;
    const map = new Map();
    for (const f of frames) for (const c of f) { const k = key(c); if (!map.has(k)) map.set(k, map.size + 1); if (map.size > 255) break; }
    if (map.size <= 255) return { map, key };
    shift++;
  }
}

function lzw(indices, minCode, out) {
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1, dict = new Map();
  let acc = 0, nbits = 0;
  const bytes = [];
  const emit = (code) => {
    acc |= code << nbits; nbits += size;
    while (nbits >= 8) { bytes.push(acc & 255); acc >>>= 8; nbits -= 8; }
  };
  emit(clear);
  let cur = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (cur << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) { cur = hit; continue; }
    emit(cur);
    if (next === 4096) { emit(clear); next = eoi + 1; size = minCode + 1; dict = new Map(); }
    else { if (next >= 1 << size) size++; dict.set(key, next++); }
    cur = k;
  }
  emit(cur); emit(eoi);
  if (nbits > 0) bytes.push(acc & 255);
  out.push(minCode);
  for (let i = 0; i < bytes.length; i += 255) { const n = Math.min(255, bytes.length - i); out.push(n, ...bytes.slice(i, i + n)); }
  out.push(0);
}

// frames: array of Img (same size). delay in 1/100 s.
export function encodeGIF(frames, delay = 10) {
  const w = frames[0].w, h = frames[0].h;
  const { map, key } = buildPalette(frames.map((f) => f.px));
  const out = [];
  const push16 = (v) => out.push(v & 255, (v >> 8) & 255);
  out.push(...Buffer.from('GIF89a'));
  push16(w); push16(h);
  out.push(0xf7, 0, 0);
  const pal = new Array(256 * 3).fill(0);
  for (const [k, i] of map) { pal[i * 3] = k & 255; pal[i * 3 + 1] = (k >>> 8) & 255; pal[i * 3 + 2] = (k >>> 16) & 255; }
  out.push(...pal);
  out.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0);
  let prev = null;
  for (const f of frames) {
    const idx = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) idx[i] = map.get(key(f.px[i]));
    let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    if (prev) {
      x0 = w; y0 = h; x1 = -1; y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (idx[i] !== prev[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) { x0 = y0 = x1 = y1 = 0; }
    }
    const fw = x1 - x0 + 1, fh = y1 - y0 + 1;
    const sub = new Array(fw * fh);
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const i = (y + y0) * w + (x + x0);
      sub[y * fw + x] = prev && idx[i] === prev[i] ? 0 : idx[i];
    }
    out.push(0x21, 0xf9, 4, (1 << 2) | 1); push16(delay); out.push(0, 0);
    out.push(0x2c); push16(x0); push16(y0); push16(fw); push16(fh); out.push(0);
    lzw(sub, 8, out);
    prev = idx;
  }
  out.push(0x3b);
  return Buffer.from(out);
}

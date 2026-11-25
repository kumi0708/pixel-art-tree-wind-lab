import { A, mix } from './color.js';

// A tiny software framebuffer. Everything in the lab is drawn into these at
// native resolution (320x180) and only scaled up with nearest-neighbour at the end,
// so every offset is a whole pixel by construction.
export class Img {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint32Array(w * h);
  }
  get(x, y) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.px[y * this.w + x];
  }
  set(x, y, c) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  fill(c) {
    this.px.fill(c);
    return this;
  }
  clone() {
    const o = new Img(this.w, this.h);
    o.px.set(this.px);
    return o;
  }
  copyFrom(src) {
    this.px.set(src.px);
  }
}

// Copy opaque pixels of src onto dst at integer (dx,dy).
// rowShift(y) optionally shifts each source row horizontally (the pine bend "shader").
export function blit(dst, src, dx, dy, rowShift = null) {
  const sw = src.w, sh = src.h, dw = dst.w, dh = dst.h, sp = src.px, dp = dst.px;
  for (let y = 0; y < sh; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dh) continue;
    const sh2 = rowShift ? rowShift(y) : 0;
    const row = y * sw, trow = ty * dw;
    for (let x = 0; x < sw; x++) {
      const c = sp[row + x];
      if (!(c >>> 24)) continue;
      const tx = x + dx + sh2;
      if (tx < 0 || tx >= dw) continue;
      dp[trow + tx] = c;
    }
  }
}

// Same as blit but blends every pixel toward `color` (debug views).
export function blitTint(dst, src, dx, dy, color, t, rowShift = null) {
  const sw = src.w, sh = src.h, dw = dst.w, dh = dst.h, sp = src.px, dp = dst.px;
  for (let y = 0; y < sh; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dh) continue;
    const s2 = rowShift ? rowShift(y) : 0;
    for (let x = 0; x < sw; x++) {
      const c = sp[y * sw + x];
      if (!A(c)) continue;
      const tx = x + dx + s2;
      if (tx < 0 || tx >= dw) continue;
      dp[ty * dw + tx] = mix(c, color, t);
    }
  }
}

export function scaleUp(img, k) {
  const o = new Img(img.w * k, img.h * k);
  for (let y = 0; y < o.h; y++) {
    const sy = (y / k) | 0;
    for (let x = 0; x < o.w; x++) o.px[y * o.w + x] = img.px[sy * img.w + ((x / k) | 0)];
  }
  return o;
}

export function crop(img, x0, y0, w, h) {
  const o = new Img(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o.px[y * w + x] = img.get(x0 + x, y0 + y);
  return o;
}

// Paste (fully, including transparency → bg) used for composing figures.
export function paste(dst, src, dx, dy, bg = 0) {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const c = src.px[y * src.w + x];
      dst.set(dx + x, dy + y, A(c) ? c : bg || dst.get(dx + x, dy + y));
    }
}

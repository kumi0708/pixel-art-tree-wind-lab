// Offline tree splitter — a JavaScript port of the article's Python pipeline
// (numpy / scipy / scikit-image): colour masks → blurred luminance → peak seeds →
// watershed → filtering → outline hand-off → layers (trunk, inside, clumps).
import { Img } from './image.js';
import { A, hsv, lum, scale, labelColor, rgba, mix } from './color.js';

export const SPLIT_PARAMS = {
  oak: { minDist: 5, minSize: 25, trunkPart: 0.4, sigma: 1.6, reach: 2, leafTop: 0.78 },
  pine: { minDist: 5, minSize: 25, trunkPart: 0.12, sigma: 1.6, reach: 2, leafTop: 0.86 },
  bush: { minDist: 3, minSize: 10, trunkPart: 0.0, sigma: 1.6, reach: 2, leafTop: 0.78 },
};

export function gaussianBlur(src, W, H, sigma) {
  const r = Math.ceil(sigma * 3);
  const k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  // 'nearest' edge handling like scipy's gaussian_filter(mode='nearest')
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += k[i + r] * src[y * W + Math.min(W - 1, Math.max(0, x + i))];
      tmp[y * W + x] = s;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += k[i + r] * tmp[Math.min(H - 1, Math.max(0, y + i)) * W + x];
      out[y * W + x] = s;
    }
  return out;
}

// skimage.feature.peak_local_max(img, min_distance, labels=mask)
export function peakLocalMax(B, W, H, md, mask) {
  const cand = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      const v = B[i];
      if (v < 0.05) continue;
      let ok = true;
      for (let dy = -md; dy <= md && ok; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -md; dx <= md; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx;
          if (mask[j] && B[j] > v) { ok = false; break; }
        }
      }
      if (ok) cand.push(i);
    }
  cand.sort((a, b) => B[b] - B[a]);
  const kept = [];
  for (const c of cand) {
    const cx = c % W, cy = (c / W) | 0;
    if (kept.every((k) => Math.max(Math.abs((k % W) - cx), Math.abs(((k / W) | 0) - cy)) > md)) kept.push(c);
  }
  return kept;
}

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(e) {
    const a = this.a; a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cmp(a[p], a[i]) <= 0) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && cmp(a[l], a[m]) < 0) m = l;
        if (r < a.length && cmp(a[r], a[m]) < 0) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}
const cmp = (p, q) => p[0] - q[0] || p[1] - q[1];

// skimage.segmentation.watershed(-blur, markers, mask) with 4-connectivity:
// flood outward from every seed, always growing into the brightest pixel next.
export function watershed(B, W, H, seeds, mask) {
  const lab = new Int32Array(W * H);
  const heap = new Heap();
  let age = 0;
  const nb = (i, f) => {
    const x = i % W;
    if (x > 0) f(i - 1);
    if (x < W - 1) f(i + 1);
    if (i >= W) f(i - W);
    if (i < W * (H - 1)) f(i + W);
  };
  seeds.forEach((s, k) => { lab[s] = k + 1; });
  seeds.forEach((s, k) => nb(s, (j) => { if (mask[j] && !lab[j]) heap.push([-B[j], age++, j, k + 1]); }));
  while (heap.size) {
    const [, , i, l] = heap.pop();
    if (lab[i]) continue;
    lab[i] = l;
    nb(i, (j) => { if (mask[j] && !lab[j]) heap.push([-B[j], age++, j, l]); });
  }
  return lab;
}

export function splitTree(sprite, kind, overrides = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const P = { ...SPLIT_PARAMS[kind], ...overrides };
  const img = sprite.img;
  const W = img.w, H = img.h, N = W * H, px = img.px;
  const opaque = new Uint8Array(N), wood = new Uint8Array(N), bark = new Uint8Array(N), leaves = new Uint8Array(N);
  let minY = H, maxY = -1;

  // 1) colour masks
  for (let i = 0; i < N; i++) {
    const c = px[i];
    if (!A(c)) continue;
    opaque[i] = 1;
    const y = (i / W) | 0;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    const { h, s } = hsv(c), l = lum(c);
    if (h >= 5 && h <= 40 && s > 0.22 && l < 125) wood[i] = 1;
    else if (s < 0.16 && l > 95) bark[i] = 1;
  }
  const span = maxY - minY + 1;
  const leafLimit = minY + P.leafTop * span;
  for (let i = 0; i < N; i++) if (opaque[i] && !wood[i] && !bark[i] && ((i / W) | 0) < leafLimit) leaves[i] = 1;

  // 2) blurred luminance
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) L[i] = opaque[i] ? lum(px[i]) / 255 : 0;
  const blur = gaussianBlur(L, W, H, P.sigma);

  // 3) seeds + 4) watershed
  const seeds = peakLocalMax(blur, W, H, P.minDist, leaves);
  const lab = watershed(blur, W, H, seeds, leaves);
  const rawLab = lab.slice();

  // leaf pixels the flood could not reach (only diagonal contact) join a neighbour
  for (let pass = 0; pass < 3; pass++)
    for (let i = 0; i < N; i++) {
      if (!leaves[i] || lab[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1 && !lab[i]; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const l = lab[yy * W + xx];
          if (l) { lab[i] = l; break; }
        }
    }

  // 5) drop clumps that are too small or sit too low (they belong to the trunk)
  const n0 = seeds.length;
  const cnt = new Float64Array(n0 + 1), sy = new Float64Array(n0 + 1);
  for (let i = 0; i < N; i++) if (lab[i]) { cnt[lab[i]]++; sy[lab[i]] += (i / W) | 0; }
  const trunkLine = maxY - span * P.trunkPart;
  const remap = new Int32Array(n0 + 1);
  let next = 0, dropped = 0;
  for (let k = 1; k <= n0; k++) {
    if (cnt[k] < P.minSize || sy[k] / cnt[k] > trunkLine) { remap[k] = 0; dropped++; }
    else remap[k] = ++next;
  }
  for (let i = 0; i < N; i++) lab[i] = remap[lab[i]];
  const filtered = lab.slice();

  // 6) add_outline: brown pixels on the silhouette go with the clump next to them,
  //    unless they are closer to the trunk body or to pale bark.
  const R = P.reach;
  const nearEdge = (x, y) => {
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H || !opaque[yy * W + xx]) return true;
      }
    return false;
  };
  const edge = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (opaque[i]) edge[i] = nearEdge(i % W, (i / W) | 0) ? 1 : 0;
  const moved = new Uint8Array(N);
  const assign = [];
  for (let i = 0; i < N; i++) {
    if (!wood[i] || lab[i] || !edge[i]) continue;
    const x = i % W, y = (i / W) | 0;
    let dc = Infinity, lc = 0, dt = Infinity, db = Infinity;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx, d = Math.hypot(dx, dy);
        if (lab[j] && d < dc) { dc = d; lc = lab[j]; }
        if (wood[j] && !edge[j] && !lab[j] && d < dt) dt = d;
        if (bark[j] && d < db) db = d;
      }
    if (lc && dc < dt && dc < db) assign.push([i, lc]);
  }
  for (const [i, l] of assign) { lab[i] = l; moved[i] = 1; }

  // 7) layers
  const trunk = new Img(W, H), inside = new Img(W, H);
  for (let i = 0; i < N; i++) if (opaque[i] && !lab[i]) trunk.px[i] = px[i];
  const E = 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!lab[i]) continue;
      let ok = true;
      for (let dy = -E; dy <= E && ok; dy++)
        for (let dx = -E; dx <= E; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H || !lab[yy * W + xx]) { ok = false; break; }
        }
      if (ok) inside.px[i] = scale(px[i], 0.55);
    }
  const clumps = [];
  for (let k = 1; k <= next; k++) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0, sx = 0, syy = 0;
    for (let i = 0; i < N; i++) {
      if (lab[i] !== k) continue;
      const x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      n++; sx += x; syy += y;
    }
    if (!n) continue;
    const c = new Img(x1 - x0 + 1, y1 - y0 + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (lab[y * W + x] === k) c.px[(y - y0) * c.w + (x - x0)] = px[y * W + x];
    clumps.push({ id: k, img: c, bx: x0, by: y0, cx: sx / n, cy: syy / n, count: n });
  }
  // draw order: pines bottom-up, broadleaf back (top) to front (bottom)
  clumps.sort((a, b) => (kind === 'pine' ? b.cy - a.cy : a.cy - b.cy));

  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return {
    kind, W, H, minY, maxY, trunk, inside, clumps, lab,
    stats: { seeds: seeds.length, clumps: clumps.length, dropped, outlineMoved: assign.length, ms },
    debug: { opaque, wood, bark, leaves, blur, seeds, rawLab, filtered, moved, leafLimit, trunkLine },
  };
}

// ------------------------------------------------------- debug images ----
const DIM = rgba(34, 38, 52);
export function debugImages(sprite, sp) {
  const { W, H } = sp, src = sprite.img.px, d = sp.debug, N = W * H;
  const mk = (f) => { const o = new Img(W, H); for (let i = 0; i < N; i++) o.px[i] = f(i); return o; };
  const ghost = (i) => (d.opaque[i] ? mix(src[i], DIM, 0.75) : 0);
  const out = {};
  out.source = sprite.img;
  out.wood = mk((i) => (d.wood[i] ? src[i] : d.bark[i] ? rgba(240, 240, 240) : ghost(i)));
  out.leaves = mk((i) => (d.leaves[i] ? mix(src[i], rgba(120, 255, 120), 0.35) : ghost(i)));
  out.blur = mk((i) => { const v = Math.min(255, Math.round(d.blur[i] * 255 * 1.6)); return rgba(v, v, v); });
  const seeds = mk((i) => (d.opaque[i] ? mix(src[i], DIM, 0.55) : 0));
  for (const s of d.seeds) {
    const x = s % W, y = (s / W) | 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) seeds.set(x + dx, y + dy, rgba(255, 60, 70));
  }
  out.seeds = seeds;
  out.watershed = mk((i) => (d.rawLab[i] ? mix(src[i], labelColor(d.rawLab[i]), 0.7) : ghost(i)));
  out.clumps = mk((i) => (d.moved[i] ? rgba(255, 255, 255) : sp.lab[i] ? mix(src[i], labelColor(sp.lab[i]), 0.6) : d.opaque[i] ? mix(src[i], rgba(90, 90, 100), 0.5) : 0));
  out.inside = sp.inside;
  out.trunk = sp.trunk;
  return out;
}

export const STAGES = ['source', 'wood', 'leaves', 'blur', 'seeds', 'watershed', 'clumps', 'inside', 'trunk'];

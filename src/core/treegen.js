// Procedural pixel-art tree painter.
//
// The article starts from a hand-painted tree sprite. We have no artist here, so we
// *paint* one procedurally — as a single flat image — and then hand it to the same
// kind of offline splitter the article uses (see split.js). The generator never tells
// the splitter where the clumps are: it has to find them from colour and light alone.
import { Img } from './image.js';
import { mulberry32, hash2, valueNoise, bayer } from './rng.js';
import { PAL } from './palette.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- wood ----
// Limbs are painted as tapered capsules. For every pixel we keep the limb whose
// axis is closest, plus a cylinder-like lighting value (light from upper-left).
function makeWood(W, H) {
  return { W, H, u: new Float32Array(W * H).fill(9), lit: new Float32Array(W * H), r: new Float32Array(W * H) };
}

function limb(wc, x0, y0, x1, y1, r0, r1) {
  const { W, H } = wc;
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
  const rm = Math.max(r0, r1) + 1;
  const xa = clamp(Math.floor(Math.min(x0, x1) - rm), 0, W - 1), xb = clamp(Math.ceil(Math.max(x0, x1) + rm), 0, W - 1);
  const ya = clamp(Math.floor(Math.min(y0, y1) - rm), 0, H - 1), yb = clamp(Math.ceil(Math.max(y0, y1) + rm), 0, H - 1);
  for (let y = ya; y <= yb; y++)
    for (let x = xa; x <= xb; x++) {
      const px = x + 0.5, py = y + 0.5;
      const s = clamp(((px - x0) * dx + (py - y0) * dy) / len2, 0, 1);
      const ex = px - (x0 + dx * s), ey = py - (y0 + dy * s);
      const d = Math.hypot(ex, ey), r = r0 + (r1 - r0) * s;
      if (d > r) continue;
      const u = d / r, i = y * W + x;
      if (u >= wc.u[i]) continue;
      const sx = d > 1e-6 ? ex / d : 0, sy = d > 1e-6 ? ey / d : 0;
      // normal of a cylinder seen side-on: (sx*u, sy*u, sqrt(1-u^2)); light (-0.62,-0.32,0.72)
      wc.u[i] = u;
      wc.lit[i] = sx * u * -0.62 + sy * u * -0.32 + Math.sqrt(1 - u * u) * 0.72;
      wc.r[i] = r;
    }
}

// Polyline limb through points [[x,y,r],...]
function limbPath(wc, pts) {
  for (let i = 0; i < pts.length - 1; i++) limb(wc, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], pts[i][2], pts[i + 1][2]);
}

function woodTones(wc, seed) {
  const { W, H } = wc;
  const tone = new Int8Array(W * H).fill(-1);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (wc.u[i] > 1) continue;
      // bark grooves: vertical-ish streaks
      const groove = hash2(Math.round(x * 0.8), Math.floor(y / 3), seed) < 0.18 ? -0.22 : 0;
      let v = 0.5 + 0.5 * wc.lit[i] + groove + (hash2(x, y, seed + 9) - 0.5) * 0.12;
      let t = clamp(Math.floor(v * 4.6 + bayer(x, y) * 0.9), 1, 4);
      if (wc.u[i] > 0.78 && wc.r[i] > 1.6) t = 0; // outline on thick limbs
      if (wc.r[i] <= 1.2) t = clamp(t - 1, 0, 2); // thin twigs stay dark
      tone[i] = t;
    }
  return tone;
}

// ------------------------------------------------------------- canopy ----
// Clump canopy = painter-ordered "puffs". Each puff is lit like a small sphere,
// so it ends up with its own highlight: that's exactly what lets the splitter
// find it again later (a luminance peak per clump).
function paintPuffs(W, H, puffs, pal, seed, center, axes) {
  const L = [-0.55, -0.72, 0.42];
  const ln = Math.hypot(...L);
  L[0] /= ln; L[1] /= ln; L[2] /= ln;
  const owner = new Int16Array(W * H).fill(-1);
  const contains = (p, x, y) => {
    const dx = x + 0.5 - p.x, dy = (y + 0.5 - p.y) * (y + 0.5 > p.y ? 1.18 : 1);
    const th = Math.atan2(dy, dx);
    const re = p.r * (1 + 0.1 * Math.sin(6 * th + p.ph) + 0.05 * Math.sin(11 * th + p.ph * 2.3));
    const d = Math.hypot(dx, dy);
    return d <= re ? { nx: dx / re, ny: dy / re } : null;
  };
  const normal = new Float32Array(W * H * 2);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let k = puffs.length - 1; k >= 0; k--) {
        const n = contains(puffs[k], x, y);
        if (n) {
          const i = y * W + x;
          owner[i] = k;
          normal[i * 2] = n.nx;
          normal[i * 2 + 1] = n.ny;
          break;
        }
      }
  const leaf = new Img(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x, k = owner[i];
      if (k < 0) continue;
      const nx = normal[i * 2], ny = normal[i * 2 + 1];
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const d = nx * L[0] + ny * L[1] + nz * L[2];
      const gx = (x - center[0]) / axes[0], gy = (y - center[1]) / axes[1];
      let v = 0.62 * (0.5 + 0.5 * d) + 0.38 * (0.55 - 0.28 * gx - 0.42 * gy);
      v += puffs[k].depth * 0.14;
      v += (valueNoise(x / 2.2, y / 2.2, seed) - 0.5) * 0.16 + (hash2(x, y, seed + 3) - 0.5) * 0.07;
      // ambient occlusion: the back puff darkens right where a front puff overlaps it
      const f1 = owner[i + W] ?? -1, f2 = owner[i + W + 1] ?? -1, f3 = owner[i + 2 * W] ?? -1;
      if ((y + 1 < H && f1 > k) || (y + 1 < H && x + 1 < W && f2 > k)) v -= 0.3;
      else if (y + 2 < H && f3 > k) v -= 0.14;
      const t = clamp(Math.floor(v * 6.3 - 0.35 + bayer(x, y) * 0.95), 1, 6);
      leaf.px[i] = pal[t];
    }
  return { leaf, owner };
}

function carveHoles(leaf, holes) {
  for (const hl of holes)
    for (let y = Math.floor(hl.y - hl.r); y <= hl.y + hl.r; y++)
      for (let x = Math.floor(hl.x - hl.r); x <= hl.x + hl.r; x++)
        if (Math.hypot(x + 0.5 - hl.x, (y + 0.5 - hl.y) * 1.3) <= hl.r) leaf.set(x, y, 0);
}

// Selective outline + a few stray leaves on the silhouette.
function outlineAndFringe(leaf, pal, rnd) {
  const { w: W, h: H } = leaf;
  const src = leaf.px.slice();
  const has = (x, y) => x >= 0 && y >= 0 && x < W && y < H && src[y * W + x] !== 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!has(x, y)) continue;
      if (!has(x, y + 1) || !has(x + 1, y)) leaf.px[y * W + x] = pal[0];
      else if (!has(x - 1, y) || !has(x, y - 1)) leaf.px[y * W + x] = pal[Math.max(2, Math.min(5, pal.indexOf(src[y * W + x]) + 1))] ?? pal[3];
    }
  const src2 = leaf.px.slice();
  const has2 = (x, y) => x >= 0 && y >= 0 && x < W && y < H && src2[y * W + x] !== 0;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (has2(x, y)) continue;
      if (has2(x, y - 1) && !has2(x, y + 1) && rnd() < 0.16) leaf.px[y * W + x] = pal[0];
      else if (has2(x, y + 1) && !has2(x, y - 1) && rnd() < 0.12) leaf.px[y * W + x] = pal[4];
    }
}

function composite(W, H, wc, tone, barkPal, leaf, canopyShade = true) {
  const img = new Img(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (leaf.px[i]) { img.px[i] = leaf.px[i]; continue; }
      let t = tone[i];
      if (t < 0) continue;
      if (canopyShade) {
        // canopy casts shade on the wood right under it
        for (let k = 1; k <= 8; k++)
          if (y - k >= 0 && leaf.px[i - k * W]) { t = Math.max(0, t - (k <= 3 ? 2 : 1)); break; }
      }
      img.px[i] = barkPal[t];
    }
  return img;
}

// ---------------------------------------------------------------- oak ----
export function makeOak(seed, s = 1) {
  const rnd = mulberry32(seed * 7919 + 1);
  const W = Math.round(96 * s), H = Math.round(104 * s);
  const fx = W / 2, fy = H - 1;
  const wc = makeWood(W, H);
  const trunkTop = fy - 46 * s;
  const lean = (rnd() - 0.5) * 7 * s, ph = rnd() * 6;
  const tx = (t) => fx + lean * t * t + Math.sin(t * 2.6 + ph) * 1.1 * s;
  const trunk = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    trunk.push([tx(t), fy + 1 - (fy + 1 - trunkTop) * t, Math.max(1.6, (5.4 - 2.2 * t) * s)]);
  }
  limbPath(wc, trunk);
  // root flare
  limb(wc, fx - 1, fy - 6 * s, fx - 10 * s, fy + 0.5, 2.8 * s, 0.9);
  limb(wc, fx + 1, fy - 6 * s, fx + 9.5 * s, fy + 0.5, 2.6 * s, 0.9);
  limb(wc, fx + 0.5, fy - 4 * s, fx + 3 * s, fy + 0.5, 2 * s, 1);
  const T = [tx(1), trunkTop];
  const cy0 = 41 * s, ax = 40 * s, ay = 32 * s;
  const j = () => (rnd() - 0.5) * 5 * s;
  const branches = [
    [[T[0], T[1], 3.4 * s], [fx - 13 * s + j(), trunkTop - 11 * s, 2.4 * s], [fx - 27 * s + j(), cy0 - 4 * s, 1.3 * s]],
    [[T[0], T[1], 3.2 * s], [fx + 12 * s + j(), trunkTop - 13 * s, 2.3 * s], [fx + 26 * s + j(), cy0 - 7 * s, 1.3 * s]],
    [[T[0], T[1], 3.0 * s], [fx + 1 * s + j(), trunkTop - 17 * s, 2.2 * s], [fx - 3 * s + j(), cy0 - 20 * s, 1.2 * s]],
    [[fx - 13 * s, trunkTop - 11 * s, 1.5 * s], [fx - 18 * s + j(), trunkTop - 2 * s, 1.0]],
    [[fx + 12 * s, trunkTop - 13 * s, 1.5 * s], [fx + 20 * s + j(), trunkTop - 4 * s, 1.0]],
  ];
  for (const b of branches) limbPath(wc, b);

  const layout = [
    [0, -0.66, 13], [-0.44, -0.46, 12], [0.44, -0.5, 12], [-0.8, -0.06, 11], [0.8, -0.1, 11],
    [-0.3, -0.14, 13], [0.3, -0.18, 13], [0, 0.04, 12], [-0.6, 0.38, 11], [0.6, 0.34, 11],
    [-0.2, 0.48, 11], [0.24, 0.5, 11], [-0.94, 0.3, 8], [0.94, 0.26, 8],
  ];
  const puffs = layout.map(([u, v, r]) => ({
    x: fx + (u + (rnd() - 0.5) * 0.08) * ax,
    y: cy0 + (v + (rnd() - 0.5) * 0.08) * ay,
    r: (r + (rnd() - 0.5) * 2.4) * s,
    ph: rnd() * 6.28,
    depth: v < -0.3 ? -0.5 : 0,
  }));
  puffs.sort((a, b) => a.y - b.y);
  const { leaf } = paintPuffs(W, H, puffs, PAL.oakLeaf, seed, [fx, cy0], [ax, ay]);
  outlineAndFringe(leaf, PAL.oakLeaf, rnd);
  const tone = woodTones(wc, seed);
  return { img: composite(W, H, wc, tone, PAL.oakBark, leaf), footX: Math.floor(fx), footY: fy, kind: 'oak' };
}

// --------------------------------------------------------------- bush ----
export function makeBush(seed, s = 1) {
  const rnd = mulberry32(seed * 104729 + 5);
  const W = Math.round(46 * s), H = Math.round(30 * s);
  const fx = W / 2, fy = H - 1;
  const wc = makeWood(W, H);
  for (let k = -1; k <= 1; k++) limb(wc, fx + k * 3 * s, fy + 0.5, fx + k * 6 * s, fy - 7 * s, 1.4, 0.7);
  const cy0 = 17 * s, ax = 17 * s, ay = 9 * s;
  const layout = [[0, -0.5, 9], [-0.55, -0.05, 8.5], [0.55, -0.1, 8.5], [-0.25, 0.25, 8.5], [0.3, 0.3, 8.5]];
  const puffs = layout.map(([u, v, r]) => ({
    x: fx + (u + (rnd() - 0.5) * 0.1) * ax,
    y: cy0 + (v + (rnd() - 0.5) * 0.1) * ay,
    r: (r + (rnd() - 0.5) * 1.6) * s,
    ph: rnd() * 6.28,
    depth: 0,
  }));
  puffs.sort((a, b) => a.y - b.y);
  const { leaf } = paintPuffs(W, H, puffs, PAL.bushLeaf, seed, [fx, cy0], [ax, ay]);
  outlineAndFringe(leaf, PAL.bushLeaf, rnd);
  // berries / blossoms on the lit side
  const berry = PAL.berry[Math.floor(rnd() * PAL.berry.length)];
  for (let k = 0; k < 14 * s; k++) {
    const x = Math.floor(fx + (rnd() - 0.6) * ax * 1.6), y = Math.floor(cy0 + (rnd() - 0.7) * ay * 1.6);
    const c = leaf.get(x, y);
    if (c && c !== PAL.bushLeaf[0] && leaf.get(x + 1, y) && leaf.get(x, y + 1)) leaf.set(x, y, berry);
  }
  const tone = woodTones(wc, seed);
  return { img: composite(W, H, wc, tone, PAL.oakBark, leaf, false), footX: Math.floor(fx), footY: fy, kind: 'bush' };
}

// --------------------------------------------------------------- pine ----
// A pine is a stack of drooping branch tiers; each tier is lit from the upper-left
// and its underside sits in the shadow of the tier above.
export function makePine(seed, s = 1) {
  const rnd = mulberry32(seed * 15485863 + 11);
  const W = Math.round(64 * s), H = Math.round(116 * s);
  const fx = W / 2, fy = H - 1;
  const wc = makeWood(W, H);
  const lean = (rnd() - 0.5) * 3 * s;
  limbPath(wc, [[fx, fy + 1, 3.2 * s], [fx + lean * 0.3, fy - 40 * s, 2.4 * s], [fx + lean, 6 * s, 0.9]]);
  limb(wc, fx - 1, fy - 3 * s, fx - 6 * s, fy + 0.5, 1.8 * s, 0.8);
  limb(wc, fx + 1, fy - 3 * s, fx + 6 * s, fy + 0.5, 1.8 * s, 0.8);

  const N = 8;
  const tiers = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    tiers.push({
      cx: fx + lean * t + (rnd() - 0.5) * 2 * s,
      cy: (84 - 70 * t) * s,
      w: (28 - 20 * t + (rnd() - 0.5) * 3) * s,
      h: (17 - 7 * t) * s,
      ph: Math.floor(rnd() * 5),
    });
  }
  const owner = new Int16Array(W * H).fill(-1);
  const geo = new Float32Array(W * H * 2);
  const tierAt = (tr, i, x, y) => {
    const dxn = (x + 0.5 - tr.cx) / tr.w;
    if (Math.abs(dxn) > 1) return null;
    const ad = Math.abs(dxn);
    let yTop = tr.cy - tr.h * 0.62 + Math.pow(ad, 1.25) * tr.h * 0.8;
    if (i === N - 1) yTop = Math.min(yTop, tr.cy - tr.h * 0.62 - (1 - ad * 3) * 6 * s); // spire
    const saw = ((Math.floor(x + tr.ph) % 4) + 4) % 4;
    const yBot = tr.cy + tr.h * 0.42 - ad * tr.h * 0.12 + [0, 1.2, 2.4, 1.2][saw] * s + (ad > 0.85 ? 1.5 : 0);
    if (y + 0.5 < yTop || y + 0.5 > yBot) return null;
    return { dxn, tv: (y + 0.5 - yTop) / Math.max(1, yBot - yTop) };
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let i = N - 1; i >= 0; i--) {
        const g = tierAt(tiers[i], i, x, y);
        if (g) {
          const k = y * W + x;
          owner[k] = i;
          geo[k * 2] = g.dxn;
          geo[k * 2 + 1] = g.tv;
          break;
        }
      }
  const pal = PAL.pineLeaf;
  const leaf = new Img(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x, i = owner[k];
      if (i < 0) continue;
      const dxn = geo[k * 2], tv = geo[k * 2 + 1];
      const pk = Math.hypot((dxn + 0.38) * 1.3, tv - 0.15);
      let v = 0.86 - 0.5 * tv - 0.22 * dxn - 0.32 * pk + 0.05 * (i / N);
      const stroke = ((x - Math.round(y * 0.7 * Math.sign(dxn || 1))) % 3 + 3) % 3 === 0 ? -0.1 : 0.04;
      v += stroke + (hash2(x, y, seed) - 0.5) * 0.08;
      if (y >= 1 && owner[k - W] > i) v -= 0.34;
      else if (y >= 2 && owner[k - 2 * W] > i) v -= 0.16;
      leaf.px[k] = pal[clamp(Math.floor(v * 6.4 + bayer(x, y) * 0.9), 1, 6)];
    }
  outlineAndFringe(leaf, pal, rnd);
  const tone = woodTones(wc, seed);
  return { img: composite(W, H, wc, tone, PAL.pineBark, leaf), footX: Math.floor(fx), footY: fy, kind: 'pine' };
}

export const MAKERS = { oak: makeOak, bush: makeBush, pine: makePine };

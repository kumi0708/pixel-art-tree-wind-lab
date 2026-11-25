// The whole 320x180 diorama: sky, clouds, mountains, meadow, pond, trees,
// falling leaves, shadows and the debug overlays.
import { Img, blit } from './image.js';
import { rgba, mix, R, G, B } from './color.js';
import { mulberry32, hash2, valueNoise, fbm1, bayer } from './rng.js';
import { PAL } from './palette.js';
import { MAKERS } from './treegen.js';
import { splitTree } from './split.js';
import { WindTree, POSE_TIME } from './tree.js';
import { Wind, WAVE_PERIOD, WAVE_LENGTH } from './wind.js';

export const W = 320, H = 180, HORIZON = 104;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const LAYOUT = [
  { kind: 'pine', x: 98, y: 124, s: 0.7 },
  { kind: 'oak', x: 238, y: 127, s: 0.68 },
  { kind: 'pine', x: 300, y: 134, s: 0.8 },
  { kind: 'bush', x: 124, y: 146, s: 0.8 },
  { kind: 'pine', x: 34, y: 162, s: 1.0 },
  { kind: 'oak', x: 168, y: 170, s: 1.0 },
  { kind: 'bush', x: 80, y: 172, s: 1.0 },
  { kind: 'bush', x: 222, y: 175, s: 1.0 },
  { kind: 'bush', x: 293, y: 168, s: 0.85 },
];

const POND = { x: 268, y: 150, rx: 30, ry: 7 };
const pathX = (y) => 196 - (y - HORIZON) * 1.0 + 7 * Math.sin((y - HORIZON) * 0.075);
const pathHalf = (y) => 0.5 + (y - HORIZON) * 0.075;
const inPond = (x, y, m = 0) => ((x + 0.5 - POND.x) / (POND.rx + m)) ** 2 + ((y + 0.5 - POND.y) / (POND.ry + m)) ** 2 <= 1;

export const DEFAULT_OPTS = {
  mode: 'article', // 'article' | 'sine' | 'noise'
  view: 'normal', // 'normal' | 'clumps' | 'weight'
  overlayGust: false,
  overlayWave: false,
  spring: true,
  inside: true,
  shadows: true,
  leaves: true,
  stepped: true, // 10 Hz poses (article) vs every frame
};

export class Scene {
  constructor(seed = 1) {
    this.wind = new Wind();
    this.opts = { ...DEFAULT_OPTS };
    this.fb = new Img(W, H);
    this.mask = new Uint8Array(W * H);
    this.shadeCache = new Map();
    this.build(seed);
  }

  build(seed) {
    this.seed = seed;
    this.rnd = mulberry32(seed * 31 + 7);
    this.buildSky();
    this.buildLand();
    this.buildTrees(seed);
    this.buildDetails();
    this.leaves = [];
    this.poseClock = 0;
    this.t = 0;
    this.wind.t = 0;
  }

  // ------------------------------------------------------------ static ----
  buildSky() {
    const sky = new Img(W, H);
    const S = PAL.sky, n = S.length;
    for (let y = 0; y < HORIZON + 2; y++) {
      const t = Math.pow(y / (HORIZON + 2), 1.15) * (n - 1);
      for (let x = 0; x < W; x++) {
        const i = clamp(Math.floor(t + bayer(x, y) * 0.9 + 0.5), 0, n - 1);
        sky.px[y * W + x] = S[i];
      }
    }
    // sun with dithered halo, upper-left (light comes from here everywhere)
    const sx = 58, sy = 30;
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 120; x++) {
        const d = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
        if (d <= 7.5) sky.set(x, y, PAL.sun);
        else if (d <= 9.5) sky.set(x, y, PAL.sunHalo[0]);
        else if (d <= 16 && bayer(x, y) < 0.5 - (d - 9.5) / 6.5) sky.set(x, y, mix(sky.get(x, y), PAL.sunHalo[1], 0.5));
      }
    this.sky = sky;

    // clouds: puffs with a flat base, lit from above
    const rnd = mulberry32(this.seed * 13 + 3);
    this.clouds = [];
    for (let k = 0; k < 6; k++) {
      const cw = 26 + Math.floor(rnd() * 40), ch = 10 + Math.floor(rnd() * 8);
      const img = new Img(cw, ch);
      const puffs = [];
      for (let p = 0; p < 4 + Math.floor(rnd() * 4); p++)
        puffs.push({ x: 4 + rnd() * (cw - 8), y: ch - 3 - rnd() * (ch * 0.45), r: 3 + rnd() * (ch * 0.45) });
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          let top = -1;
          for (const p of puffs) if (Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) <= p.r) top = Math.max(top, 1 - (y + 0.5 - (p.y - p.r)) / (2 * p.r));
          if (top < 0 || y > ch - 2) continue;
          const v = 0.25 + 0.75 * top - (y / ch) * 0.35;
          img.set(x, y, PAL.cloud[clamp(Math.floor(v * 5 + bayer(x, y) * 0.8), 0, 4)]);
        }
      this.clouds.push({ img, x: rnd() * (W + 80) - 40, y: 6 + rnd() * 44, v: 1.5 + rnd() * 2.5 });
    }
  }

  buildLand() {
    const land = new Img(W, H);
    const level = new Int8Array(W * H).fill(-1);
    const seed = this.seed;
    // two mountain ranges built from peaks (cones + noise); the sun-facing (left) side is lit
    const prnd = mulberry32(seed * 3 + 11);
    const range = (n, base, hmin, hmax, slope) => {
      const pk = [];
      for (let k = 0; k < n; k++) pk.push({ x: (k + prnd() * 0.8) * (W / (n - 0.6)) - 20, h: hmin + prnd() * (hmax - hmin), s: slope * (0.8 + prnd() * 0.5) });
      return (x) => {
        let best = -1e9, lit = false;
        for (const p of pk) {
          const v = p.h - Math.abs(x + 0.5 - p.x) * p.s;
          if (v > best) { best = v; lit = x + 0.5 < p.x; }
        }
        return { y: base - Math.max(0, best) - 2.5 * fbm1(x / 9, seed + n), lit };
      };
    };
    const far = range(6, HORIZON, 30, 60, 0.85), near = range(9, HORIZON, 8, 22, 0.6);
    for (let x = 0; x < W; x++) {
      const f = far(x);
      for (let y = Math.floor(f.y); y < HORIZON; y++) {
        const d = y - f.y;
        let c = PAL.mountFar[f.lit ? 2 : 1];
        if (y < 80 && d < 5 + 4 * valueNoise(x / 3, y / 6, seed)) c = PAL.snow[f.lit ? 1 : 0];
        else if (y > 90) c = PAL.mountFar[0];
        else if (!f.lit && hash2(x, y, seed) < 0.08) c = PAL.mountFar[0];
        land.set(x, y, c);
      }
      const n2 = near(x);
      for (let y = Math.floor(n2.y); y < HORIZON; y++) land.set(x, y, PAL.mountNear[n2.lit ? (y - n2.y < 2 ? 2 : 1) : 0]);
      // forested hills with tiny tree tops
      const r3 = 95 + 5 * fbm1(x / 30, seed + 9);
      const bump = Math.max(0, Math.sin(x * 1.3 + Math.sin(x * 0.37) * 3)) * 3 * (hash2(x >> 2, 0, seed) > 0.25 ? 1 : 0);
      for (let y = Math.floor(r3 - bump); y < HORIZON + 2; y++) {
        const d = y - (r3 - bump);
        land.set(x, y, d < 1 && bump > 1 ? PAL.forest[2] : d < 3 ? PAL.forest[1] : PAL.hill[clamp(Math.floor((y - 96) / 3 + bayer(x, y)), 0, 2)]);
      }
    }
    // meadow: lighter & hazier far away, deeper green up front, with soft patches
    const Gp = PAL.grass;
    for (let y = HORIZON; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = (y - HORIZON) / (H - HORIZON);
        let v = 4.6 - 3.0 * Math.sqrt(t) + (valueNoise(x / 22, y / 9, seed + 2) - 0.5) * 1.6 + (valueNoise(x / 6, y / 3, seed + 4) - 0.5) * 0.6;
        const lv = clamp(Math.floor(v + bayer(x, y) * 0.9), 0, 5);
        level[y * W + x] = lv;
        let c = Gp[lv];
        if (y < HORIZON + 6) c = mix(c, PAL.hill[2], 0.35 * (1 - (y - HORIZON) / 6));
        land.set(x, y, c);
      }
    // dirt path winding to the horizon
    for (let y = HORIZON + 1; y < H; y++) {
      const cx = pathX(y), hw = pathHalf(y);
      for (let x = Math.floor(cx - hw - 1); x <= cx + hw + 1; x++) {
        const d = Math.abs(x + 0.5 - cx) / hw;
        if (d > 1.12) continue;
        const i = y * W + x;
        level[i] = -1;
        let c = d > 0.85 ? PAL.dirt[0] : PAL.dirt[clamp(Math.floor(2.2 - d + bayer(x, y) * 0.8), 1, 2)];
        if (hash2(x, y, seed + 21) < 0.06) c = PAL.dirt[3];
        land.set(x, y, c);
      }
    }
    // pond: reflects the sky, darker toward the near bank, with a muddy rim
    for (let y = POND.y - POND.ry - 2; y <= POND.y + POND.ry + 2; y++)
      for (let x = POND.x - POND.rx - 2; x <= POND.x + POND.rx + 2; x++) {
        if (!inPond(x, y, 1.4)) continue;
        const i = y * W + x;
        level[i] = -1;
        if (!inPond(x, y)) { land.set(x, y, y < POND.y ? PAL.grass[1] : PAL.dirt[0]); continue; }
        const t = (y - (POND.y - POND.ry)) / (2 * POND.ry);
        land.set(x, y, PAL.water[clamp(Math.floor(3 - t * 2.6 + bayer(x, y) * 0.9), 0, 3)]);
      }
    // rocks
    const rnd = mulberry32(seed * 5 + 77);
    const rocks = [[POND.x - 26, POND.y + 6, 6, 3], [POND.x + 28, POND.y - 3, 4, 2.5], [146, 160, 4, 2.5], [10, 176, 7, 4], [188, 140, 3, 2]];
    for (const [rx, ry, a, b] of rocks)
      for (let y = Math.floor(ry - b * 2); y <= ry; y++)
        for (let x = Math.floor(rx - a); x <= rx + a; x++) {
          const nx = (x + 0.5 - rx) / a, ny = (y + 0.5 - ry) / (b * 2);
          if (nx * nx + ny * ny > 1 || y > ry) continue;
          const v = 0.55 - 0.45 * nx - 0.5 * ny - 0.35 + (hash2(x, y, seed) - 0.5) * 0.2;
          let c = PAL.rock[clamp(Math.floor(v * 4 + bayer(x, y) * 0.8), 0, 3)];
          if (ny < -0.55 && hash2(x, y, seed + 1) < 0.6) c = PAL.grass[3];
          land.set(x, y, c);
          level[y * W + x] = -1;
        }
    void rnd;
    this.land = land;
    this.level = level;
  }

  buildTrees(seed) {
    this.trees = LAYOUT.map((L, k) => {
      const sprite = MAKERS[L.kind](seed * 100 + k, L.s);
      const sp = splitTree(sprite, L.kind);
      const t = new WindTree(L.kind, sprite, sp, L.x, L.y);
      t.name = `${L.kind} #${k + 1}`;
      return t;
    });
  }

  buildDetails() {
    const rnd = mulberry32(this.seed * 17 + 5);
    const ok = (x, y) => this.level[y * W + x] >= 0;
    // grass streaks: in a gust they turn one flat shade lighter
    this.dashes = [];
    for (let k = 0; k < 900; k++) {
      const y = HORIZON + 3 + Math.floor(rnd() * (H - HORIZON - 3)), x = Math.floor(rnd() * W);
      const t = (y - HORIZON) / (H - HORIZON);
      const len = 1 + Math.round(t * 4 * rnd() + t * 1.5);
      let good = true;
      for (let i = 0; i < len; i++) if (!ok(clamp(x + i, 0, W - 1), y)) good = false;
      if (!good) continue;
      const lv = this.level[y * W + x];
      this.dashes.push({ x, y, len, calm: PAL.grass[Math.max(0, lv - 1)], lit: PAL.grass[Math.min(6, lv + 2)] });
    }
    // tufts and flowers walk the same one-pixel loop as the clumps
    this.props = [];
    for (let k = 0; k < 110; k++) {
      const y = HORIZON + 8 + Math.floor(Math.pow(rnd(), 0.7) * (H - HORIZON - 8)), x = Math.floor(rnd() * W);
      if (!ok(x, y)) continue;
      const t = (y - HORIZON) / (H - HORIZON);
      const blades = [];
      const nb = 3 + Math.floor(rnd() * 3);
      for (let b = 0; b < nb; b++) blades.push({ dx: b - (nb >> 1) + (rnd() < 0.3 ? 1 : 0), h: 2 + Math.round(rnd() * 2 + t * 3) });
      this.props.push({ type: 'tuft', x, y, blades, dx: 0 });
    }
    for (let k = 0; k < 70; k++) {
      const cx = Math.floor(rnd() * W), cy = HORIZON + 14 + Math.floor(rnd() * (H - HORIZON - 14));
      const color = PAL.flower[Math.floor(rnd() * PAL.flower.length)];
      for (let f = 0; f < 3; f++) {
        const x = cx + Math.round((rnd() - 0.5) * 10), y = cy + Math.round((rnd() - 0.5) * 5);
        if (y >= H || y <= HORIZON || x < 0 || x >= W || !ok(x, y)) continue;
        this.props.push({ type: 'flower', x, y, h: 2 + Math.round(rnd() * 2 * ((y - HORIZON) / 76) + 0.5), color, dx: 0 });
      }
    }
    for (const t of this.trees) this.props.push({ type: 'tree', y: t.footY, tree: t });
    this.props.sort((a, b) => a.y - b.y || (a.type === 'tree' ? -1 : 1));
  }

  // ------------------------------------------------------------ update ----
  setTime(t) {
    this.t = t;
    this.wind.t = t;
  }

  step(dt) {
    this.t += dt;
    this.wind.t = this.t;
    const o = this.opts;
    for (const t of this.trees) t.step(dt, this.wind, o);
    this.poseClock += dt;
    if (!o.stepped || this.poseClock >= POSE_TIME) {
      this.poseClock = o.stepped ? this.poseClock % POSE_TIME : 0;
      for (const t of this.trees) t.pose(this.wind, o, this.rnd);
      for (const p of this.props) {
        if (p.type === 'tree') continue;
        const a = this.wind.wavePhase(p.x, p.y), b = this.wind.breeze(p.x, p.y), g = this.wind.gust(p.x, p.y);
        if (o.mode === 'sine') p.dx = Math.round(Math.sin((2 * Math.PI * this.t) / 1.54));
        else if (o.mode === 'noise') p.dx = Math.round(this.rnd() * 2 - 1);
        else p.dx = Math.min(2, Math.round((0.9 * b + 1.3 * g) * (0.5 - 0.5 * Math.cos(a))));
        p.gusted = g > 0.3;
      }
    }
    for (const c of this.clouds) {
      c.x += c.v * dt * (0.6 + 0.4 * this.wind.strength);
      if (c.x > W + 4) c.x = -c.img.w - 4;
    }
    if (o.leaves) this.updateLeaves(dt);
    else this.leaves.length = 0;
  }

  // Leaves are shed only while a gust is on, and ride the same wind.
  updateLeaves(dt) {
    const rnd = this.rnd, wind = this.wind;
    for (const t of this.trees) {
      if (t.kind === 'bush' && rnd() > 0.3) continue;
      const g = wind.gust(t.footX, t.footY - t.height * 0.6);
      if (g < 0.35) continue;
      const rate = (g - 0.35) * (t.kind === 'pine' ? 3 : 7) * (t.height / 100);
      if (rnd() > rate * dt) continue;
      const c = t.split.clumps[Math.floor(rnd() * t.split.clumps.length)];
      if (!c) continue;
      for (let tries = 0; tries < 6; tries++) {
        const x = Math.floor(rnd() * c.img.w), y = Math.floor(rnd() * c.img.h);
        const col = c.img.px[y * c.img.w + x];
        if (!(col >>> 24)) continue;
        this.leaves.push({
          x: t.ox + c.bx + c.dx + x, y: t.oy + c.by + c.dy + y, vx: 10, vy: 2,
          c: col, ph: rnd() * 6.28, rest: t.footY - 2 + rnd() * 14, life: 4 + rnd() * 3, landed: false,
        });
        break;
      }
    }
    for (const l of this.leaves) {
      if (l.landed) { l.life -= dt; continue; }
      const g = wind.gust(l.x, l.y), b = wind.breeze(l.x, l.y);
      const wx = 30 * g + 8 * b + 2;
      l.vx += (wx - l.vx) * Math.min(1, dt * 1.6);
      l.vy += (11 - l.vy) * Math.min(1, dt * 1.2);
      l.x += (l.vx + Math.sin(this.t * 5 + l.ph) * 6) * dt;
      l.y += (l.vy + Math.cos(this.t * 4 + l.ph) * 5) * dt;
      if (l.y >= l.rest) { l.y = l.rest; l.landed = true; }
    }
    this.leaves = this.leaves.filter((l) => l.life > 0 && l.x < W + 4);
    if (this.leaves.length > 400) this.leaves.splice(0, this.leaves.length - 400);
  }

  // ------------------------------------------------------------ render ----
  shade(c) {
    let s = this.shadeCache.get(c);
    if (s === undefined) {
      s = mix(rgba(Math.round(R(c) * 0.62), Math.round(G(c) * 0.64), Math.round(B(c) * 0.7)), PAL.shadowTint, 0.25);
      this.shadeCache.set(c, s);
    }
    return s;
  }

  render(fb = this.fb) {
    const o = this.opts, wind = this.wind;
    fb.copyFrom(this.sky);
    // birds: a small flock crosses every 25 s
    const bt = this.t % 25;
    if (bt < 14) {
      const flap = Math.floor(this.t * 4) % 2;
      for (let k = 0; k < 4; k++) {
        const x = Math.round(-10 + bt * 26 + k * 7 - (k % 2) * 3), y = Math.round(40 + k * 3 + Math.sin(this.t * 1.3 + k) * 1.5);
        const shape = flap ? [[-2, -1], [-1, 0], [0, 0], [1, 0], [2, -1]] : [[-2, 1], [-1, 0], [0, 0], [1, 0], [2, 1]];
        for (const [dx, dy] of shape) fb.set(x + dx, y + dy, PAL.bird);
      }
    }
    for (const c of this.clouds) blit(fb, c.img, Math.round(c.x), Math.round(c.y));
    blit(fb, this.land, 0, 0);

    // grass streaks
    for (const d of this.dashes) {
      const lit = wind.gust(d.x, d.y) > 0.28;
      for (let i = 0; i < d.len; i++) fb.set(d.x + i, d.y, lit ? d.lit : d.calm);
    }
    // pond shimmer + cat's-paw ripples when a gust crosses the water
    const pg = wind.gust(POND.x, POND.y);
    for (let k = 0; k < 18; k++) {
      const y = POND.y - POND.ry + 1 + ((k * 5) % (POND.ry * 2 - 1));
      const span = POND.rx * 2;
      const x = Math.round(POND.x - POND.rx + ((k * 23 + this.t * (3 + (k % 3) * 2)) % span));
      const len = 2 + (k % 3);
      const on = Math.sin(this.t * 2.2 + k * 1.7) > -0.1;
      if (!on) continue;
      for (let i = 0; i < len; i++) if (inPond(x + i, y)) fb.set(x + i, y, k % 4 === 0 ? PAL.water[4] : PAL.water[3]);
    }
    if (pg > 0.15) {
      const n = Math.floor(pg * 30);
      for (let k = 0; k < n; k++) {
        const x = Math.floor(POND.x - POND.rx + hash2(k, Math.floor(this.t * 8), 3) * POND.rx * 2);
        const y = Math.floor(POND.y - POND.ry + hash2(k, Math.floor(this.t * 8), 4) * POND.ry * 2);
        if (inPond(x, y) && inPond(x + 1, y)) { fb.set(x, y, PAL.water[0]); fb.set(x + 1, y, PAL.water[1]); }
      }
    }

    // shadows (one flat darkening, never doubled)
    if (o.shadows) {
      const m = this.mask;
      m.fill(0);
      for (const t of this.trees) t.drawShadow(m, W, H);
      for (let i = HORIZON * W; i < W * H; i++) if (m[i]) fb.px[i] = this.shade(fb.px[i]);
    }

    // depth-sorted props: trees, tufts, flowers
    for (const p of this.props) {
      if (p.type === 'tree') { p.tree.draw(fb, o); continue; }
      if (p.type === 'tuft') {
        for (const b of p.blades) {
          for (let k = 0; k < b.h; k++) {
            const sh = k >= b.h - Math.ceil(b.h / 2) ? p.dx : 0;
            const tip = k === b.h - 1;
            const c = tip ? PAL.grass[p.gusted ? 6 : 4] : PAL.grass[k === 0 ? 1 : 3];
            fb.set(p.x + b.dx + sh, p.y - k, c);
          }
        }
      } else {
        for (let k = 0; k < p.h; k++) fb.set(p.x + (k === p.h - 1 ? p.dx : 0), p.y - k, PAL.grass[2]);
        fb.set(p.x + p.dx, p.y - p.h, p.color);
        fb.set(p.x + p.dx + 1, p.y - p.h, mix(p.color, rgba(0, 0, 0), 0.25));
      }
    }

    // falling leaves: 2 px, flipping between flat and edge-on
    for (const l of this.leaves) {
      const x = Math.round(l.x), y = Math.round(l.y);
      const flat = l.landed || Math.floor(this.t * 7 + l.ph) % 2 === 0;
      if (flat) { fb.set(x, y, l.c); fb.set(x + 1, y, l.c); }
      else { fb.set(x, y, mix(l.c, rgba(0, 0, 0), 0.3)); fb.set(x, y + 1, mix(l.c, rgba(0, 0, 0), 0.3)); }
    }

    if (o.overlayGust) this.drawGustOverlay(fb);
    if (o.overlayWave) this.drawWaveOverlay(fb);
    return fb;
  }

  drawGustOverlay(fb) {
    const cols = [0, rgba(255, 224, 80), rgba(255, 160, 60), rgba(255, 90, 60), rgba(240, 40, 110)];
    for (let y = 0; y < H; y += 2)
      for (let x = 0; x < W; x += 2) {
        const g = this.wind.gust(x + 1, y + 1);
        const lv = clamp(Math.floor(g * 4 + 0.35), 0, 4);
        if (!lv) continue;
        const t = 0.22 + lv * 0.08;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const i = (y + dy) * W + x + dx;
          fb.px[i] = mix(fb.px[i], cols[lv], t);
        }
      }
  }

  drawWaveOverlay(fb) {
    const t = this.wind.t;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const f = (((t / WAVE_PERIOD - (x + 0.25 * y) / WAVE_LENGTH) % 1) + 1) % 1;
        const i = y * W + x;
        if (f < 0.025) fb.px[i] = mix(fb.px[i], rgba(255, 255, 255), 0.65);
        else if (f < 0.5) fb.px[i] = mix(fb.px[i], rgba(80, 200, 255), 0.12);
      }
  }
}

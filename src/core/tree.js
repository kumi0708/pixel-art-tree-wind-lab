// A tree in the wind (the article's `wind_tree.gd`, ported).
//  * trunk stays still (oak/bush) or bends row-by-row (pine)
//  * the whole canopy leans on a damped spring driven by the gust at the foot
//  * every clump walks a one-pixel loop, timed by the traveling wave
import { blit, blitTint } from './image.js';
import { labelColor, mix, rgba } from './color.js';

export const TREE_PARAMS = {
  oak: { push: 2.2, spring: 2.2, damping: 0.35, inner: 0.35, bend: 0.0 },
  bush: { push: 1.4, spring: 1.0, damping: 0.35, inner: 0.35, bend: 0.0 },
  pine: { push: 3.6, spring: 2.8, damping: 0.22, inner: 0.35, bend: 1.0 },
};
export const POSE_TIME = 0.1; // clumps change pose 10x per second

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const BLUE = rgba(70, 120, 255), RED = rgba(255, 70, 60), GREY = rgba(120, 120, 130);

export class WindTree {
  constructor(kind, sprite, split, footX, footY) {
    this.kind = kind;
    this.p = { ...TREE_PARAMS[kind] };
    this.sprite = sprite;
    this.split = split;
    this.footX = footX;
    this.footY = footY;
    this.ox = footX - sprite.footX;
    this.oy = footY - sprite.footY;
    this.lean = 0;
    this.leanV = 0;
    this.target = 0;
    this.poseLean = 0;
    this.height = sprite.footY - split.minY;
    const cl = split.clumps;
    let sx = 0, sy = 0, n = 0;
    for (const c of cl) { sx += c.cx * c.count; sy += c.cy * c.count; n += c.count; }
    this.center = [sx / n, sy / n];
    let maxD = 1e-6;
    for (const c of cl) maxD = Math.max(maxD, Math.hypot(c.cx - this.center[0], c.cy - this.center[1]));
    for (const c of cl) {
      const dn = Math.hypot(c.cx - this.center[0], c.cy - this.center[1]) / maxD;
      c.w = lerp(this.p.inner, 1, clamp01(dn)); // outer clumps move more, inner ones are stiff
      c.hn = clamp01((sprite.footY - c.cy) / this.height);
      c.wx = this.ox + c.cx;
      c.wy = this.oy + c.cy;
      c.dx = 0;
      c.dy = 0;
    }
  }

  // Damped spring, every frame: lean'' = w0^2 (target - lean) - 2 ζ w0 lean'
  step(dt, wind, o = {}) {
    this.target = this.p.push * wind.gust(this.footX, this.footY);
    if (o.spring === false) { this.lean = this.target; this.leanV = 0; return; }
    const w0 = (2 * Math.PI) / this.p.spring;
    this.leanV += (w0 * w0 * (this.target - this.lean) - 2 * this.p.damping * w0 * this.leanV) * dt;
    this.lean += this.leanV * dt;
  }

  // Clump poses, POSE_TIME steps.
  pose(wind, o = {}, rnd = Math.random) {
    this.poseLean = this.lean;
    const mode = o.mode || 'article';
    for (const c of this.split.clumps) {
      if (mode === 'sine') {
        // naive: the whole canopy swings together on one sine — no wave, no gusts
        c.dx = Math.round(1.5 * Math.sin((2 * Math.PI * wind.t) / 1.54));
        c.dy = 0;
        continue;
      }
      if (mode === 'noise') {
        // naive: every clump jitters randomly — reads as shivering, not wind
        c.dx = Math.round(rnd() * 2 - 1);
        c.dy = Math.round(rnd() * 2 - 1);
        continue;
      }
      const a = wind.wavePhase(c.wx, c.wy);
      const b = wind.breeze(c.wx, c.wy);
      const g = wind.gust(c.wx, c.wy);
      const ride = this.poseLean * lerp(c.w, c.hn * c.hn, this.p.bend);
      const dx = ride + c.w * (0.9 * b + 1.3 * g) * (0.5 - 0.5 * Math.cos(a));
      const dy = -c.w * (0.75 * b + 0.5 * g) * Math.max(Math.sin(a), 0);
      c.dx = Math.round(dx);
      c.dy = Math.round(dy);
    }
  }

  // The pine "row_bend" shader, done on the CPU: shift = round(lean * up^power)
  rowShift() {
    if (!(this.p.bend > 0)) return null;
    const H = this.split.H, lean = this.poseLean * this.p.bend;
    if (Math.round(lean) === 0) return null;
    return (y) => Math.round(lean * Math.pow(1 - (y + 0.5) / H, 2));
  }

  draw(fb, o = {}) {
    const view = o.view || 'normal';
    const rs = this.rowShift();
    const { inside, trunk, clumps } = this.split;
    if (o.inside !== false) {
      if (view === 'normal') blit(fb, inside, this.ox, this.oy, rs);
      else blitTint(fb, inside, this.ox, this.oy, rgba(20, 20, 30), 0.6, rs);
    }
    if (view === 'normal') blit(fb, trunk, this.ox, this.oy, rs);
    else blitTint(fb, trunk, this.ox, this.oy, GREY, 0.55, rs);
    for (const c of clumps) {
      const x = this.ox + c.bx + c.dx, y = this.oy + c.by + c.dy;
      if (view === 'clumps') blitTint(fb, c.img, x, y, labelColor(c.id), 0.6);
      else if (view === 'weight') blitTint(fb, c.img, x, y, mix(BLUE, RED, (c.w - this.p.inner) / (1 - this.p.inner)), 0.65);
      else blit(fb, c.img, x, y);
    }
  }

  // Shadow = the tree's *current pose* projected onto the ground (sun upper-left).
  drawShadow(mask, W, H, k = [0.5, 0.18]) {
    const rs = this.rowShift();
    const put = (img, x0, y0, shift) => {
      for (let y = 0; y < img.h; y++) {
        const Y = y0 + y, h = this.footY - Y;
        if (h < 0) continue;
        const s = shift ? shift(y) : 0;
        const sy = this.footY + Math.round(h * k[1]);
        if (sy < 0 || sy >= H) continue;
        for (let x = 0; x < img.w; x++) {
          if (!(img.px[y * img.w + x] >>> 24)) continue;
          const sx = x0 + x + s + Math.round(h * k[0]);
          if (sx >= 0 && sx < W) mask[sy * W + sx] = 1;
        }
      }
    };
    put(this.split.trunk, this.ox, this.oy, rs);
    put(this.split.inside, this.ox, this.oy, rs);
    for (const c of this.split.clumps) put(c.img, this.ox + c.bx + c.dx, this.oy + c.by + c.dy, null);
  }
}

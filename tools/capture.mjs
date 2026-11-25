// Renders every figure used in the README straight from the simulation code.
//   node tools/capture.mjs            → docs/images/*.png|gif
// Everything is deterministic (fixed seed, fixed 60 Hz step), so the figures
// always match what the live page does.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Scene, W, H } from '../src/core/scene.js';
import { Img, crop, scaleUp, paste } from '../src/core/image.js';
import { rgba, labelColor, mix } from '../src/core/color.js';
import { MAKERS } from '../src/core/treegen.js';
import { splitTree, debugImages, STAGES } from '../src/core/split.js';
import { WindTree } from '../src/core/tree.js';
import { Wind } from '../src/core/wind.js';
import { encodePNG, encodeGIF } from './encode.mjs';
import { drawText, textWidth } from './font.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/images');
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const want = (n) => !only.length || only.includes(n);
const save = (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); console.log(`${name.padEnd(22)} ${(buf.length / 1024).toFixed(0).padStart(5)} KB`); };

const BG = rgba(20, 24, 36), INK = rgba(232, 236, 244), MUTED = rgba(152, 162, 187), ACC = rgba(255, 179, 71);
const DT = 1 / 60;
const SEED = 1;

function sceneAt(t, opts = {}) {
  const s = new Scene(SEED);
  Object.assign(s.opts, opts);
  const n = Math.round(t / DT);
  for (let i = 0; i < n; i++) s.step(DT);
  return s;
}
const advance = (s, sec) => { const n = Math.round(sec / DT); for (let i = 0; i < n; i++) s.step(DT); };

// Run `frames` frames at 10 fps over the given scenes; `compose` builds one GIF frame.
function film(scenes, frames, compose) {
  const out = [];
  for (let f = 0; f < frames; f++) {
    out.push(compose(scenes));
    for (const s of scenes) advance(s, 0.1);
  }
  return out;
}

function labelBar(img, text, x, y, w, k = 2, color = INK) {
  drawText(img, text, x + Math.round((w - textWidth(text, k)) / 2), y, color, k);
}

// The big front oak and the big front pine
const BIG_OAK = 5, BIG_PINE = 4;
const treeBox = (s, idx, pad = 6) => {
  const t = s.trees[idx];
  const x0 = Math.max(0, t.ox - pad), y0 = Math.max(0, t.oy - pad);
  return [x0, y0, Math.min(W, t.ox + t.split.W + pad) - x0, Math.min(H, t.footY + 8) - y0];
};

// ------------------------------------------------------------- hero ----
if (want('hero')) {
  const s = sceneAt(16.5);
  const frames = film([s], 110, ([a]) => scaleUp(a.render().clone(), 2));
  save('hero.gif', encodeGIF(frames, 10));
  const st = sceneAt(19.4);
  save('scene.png', encodePNG(scaleUp(st.render(), 3)));
}

// --------------------------------------------------------- pipeline ----
if (want('pipeline')) {
  for (const kind of ['oak', 'pine', 'bush']) {
    const sprite = MAKERS[kind](SEED * 100 + 99, 1);
    const sp = splitTree(sprite, kind);
    const imgs = debugImages(sprite, sp);
    const k = kind === 'bush' ? 4 : 2, sw = sprite.img.w * k, sh = sprite.img.h * k;
    const cols = kind === 'bush' ? 3 : 9, rows = Math.ceil(STAGES.length / cols);
    const cw = sw + 16, chh = sh + 34;
    const fig = new Img(cols * cw + 8, rows * chh + 8).fill(BG);
    STAGES.forEach((st, i) => {
      const cx = 8 + (i % cols) * cw, cy = 8 + Math.floor(i / cols) * chh;
      const panel = scaleUp(imgs[st], k);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) fig.set(cx + x, cy + y, ((x >> 3) + (y >> 3)) & 1 ? rgba(27, 32, 46) : rgba(22, 26, 38));
      paste(fig, panel, cx, cy);
      const names = { source: 'SOURCE', wood: 'WOOD MASK', leaves: 'LEAF MASK', blur: 'BLUR LUM', seeds: 'SEEDS', watershed: 'WATERSHED', clumps: 'CLUMPS', inside: 'INSIDE', trunk: 'TRUNK' };
      labelBar(fig, `${i + 1} ${names[st]}`, cx, cy + sh + 8, sw, 2, i === 6 ? ACC : INK);
    });
    save(`pipeline_${kind}.png`, encodePNG(fig));
    console.log('   ', kind, sp.stats);
  }
}

// ------------------------------------------------------------ clumps ----
if (want('clumps')) {
  const s = sceneAt(17.6);
  const box = treeBox(s, BIG_OAK, 4);
  const k = 3, pw = box[2] * k, ph = box[3] * k;
  const views = ['normal', 'clumps', 'weight'], names = ['NORMAL', 'CLUMPS', 'WEIGHT W'];
  const frames = film([s], 70, ([a]) => {
    const fig = new Img(pw * 3 + 32, ph + 30).fill(BG);
    views.forEach((v, i) => {
      a.opts.view = v;
      a.opts.leaves = v === 'normal';
      const im = scaleUp(crop(a.render(), ...box), k);
      paste(fig, im, 8 + i * (pw + 8), 22);
      labelBar(fig, names[i], 8 + i * (pw + 8), 6, pw, 2, i ? ACC : INK);
    });
    a.opts.view = 'normal';
    return fig;
  });
  save('clumps.gif', encodeGIF(frames, 10));
}

// -------------------------------------------------------------- loop ----
if (want('loop')) {
  const sprite = MAKERS.oak(SEED * 100 + 99, 1);
  const sp = splitTree(sprite, 'oak');
  // pick an outer, left-side clump
  const c = sp.clumps.slice().sort((a, b) => a.cx - b.cx)[1];
  // sweep the phase and keep the distinct poses (breeze 1, gust 0)
  const poses = (w) => {
    const out = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const p = [Math.round(w * 0.9 * (0.5 - 0.5 * Math.cos(a))), Math.round(-w * 0.75 * Math.max(Math.sin(a), 0))];
      if (!out.length || out[out.length - 1][0] !== p[0] || out[out.length - 1][1] !== p[1]) out.push(p);
    }
    if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
    return out;
  };
  const rows = [[1, poses(1)], [0.35, poses(0.35)]];
  const pad = 3, k = 8;
  const cw = (c.img.w + pad * 2) * k, ch = (c.img.h + pad * 2) * k;
  const fig = new Img(4 * (cw + 10) + 10 + 120, rows.length * (ch + 30) + 10).fill(BG);
  rows.forEach(([w, ps], r) => {
    const y0 = 10 + r * (ch + 30);
    drawText(fig, `W=${w}`, 10, y0 + ch / 2 - 5, r ? MUTED : ACC, 3);
    for (let i = 0; i < 4; i++) {
      const p = ps[i % ps.length];
      const x0 = 120 + i * (cw + 10);
      const panel = new Img(c.img.w + pad * 2, c.img.h + pad * 2).fill(rgba(28, 33, 48));
      // ghost of the rest pose
      for (let y = 0; y < c.img.h; y++) for (let x = 0; x < c.img.w; x++) if (c.img.px[y * c.img.w + x]) panel.set(x + pad, y + pad, rgba(60, 66, 86));
      for (let y = 0; y < c.img.h; y++) for (let x = 0; x < c.img.w; x++) { const col = c.img.px[y * c.img.w + x]; if (col) panel.set(x + pad + p[0], y + pad + p[1], col); }
      const big = scaleUp(panel, k);
      for (let y = 0; y < big.h; y++) for (let x = 0; x < big.w; x++) if (x % k === 0 || y % k === 0) big.px[y * big.w + x] = mix(big.px[y * big.w + x], rgba(0, 0, 0), 0.25);
      paste(fig, big, x0, y0);
      labelBar(fig, `(${p[0]},${p[1]})`, x0, y0 + ch + 8, cw, 3, r ? MUTED : INK);
    }
  });
  save('loop.png', encodePNG(fig));
}

// ---------------------------------------------------- wind overlays ----
if (want('wind')) {
  const s = sceneAt(17.8, { overlayGust: true, leaves: false });
  save('gust.gif', encodeGIF(film([s], 70, ([a]) => scaleUp(a.render().clone(), 2)), 10));
  const w = sceneAt(6.0, { overlayWave: true, leaves: false });
  save('wave.gif', encodeGIF(film([w], 46, ([a]) => scaleUp(a.render().clone(), 2)), 10));
}

// ------------------------------------------------------------ spring ----
if (want('spring')) {
  const s = new Scene(SEED);
  const ids = [BIG_OAK, 6, BIG_PINE];
  const T = 40, n = Math.round(T / DT);
  const rec = ids.map(() => []);
  for (let i = 0; i < n; i++) {
    s.step(DT);
    ids.forEach((id, j) => rec[j].push([s.trees[id].target, s.trees[id].lean]));
  }
  const pw = 800, ph = 110, k = 2;
  const fig = new Img(pw + 20, ids.length * (ph + 26) + 34).fill(BG);
  drawText(fig, '0S', 10, fig.h - 16, MUTED, 2);
  drawText(fig, '20S', 10 + pw / 2 - 10, fig.h - 16, MUTED, 2);
  drawText(fig, '40S', 10 + pw - 22, fig.h - 16, MUTED, 2);
  ids.forEach((id, j) => {
    const t = s.trees[id];
    const y0 = 8 + j * (ph + 26);
    drawText(fig, `${t.kind.toUpperCase()}  PUSH ${t.p.push}  PERIOD ${t.p.spring}S  DAMPING ${t.p.damping}`, 10, y0, INK, 2);
    const top = y0 + 16;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) fig.set(10 + x, top + y, rgba(16, 19, 29));
    const maxV = 6, Y = (v) => top + ph - 14 - Math.round((v / maxV) * (ph - 24));
    for (let v = 0; v <= maxV; v++) for (let x = 0; x < pw; x += 2) fig.set(10 + x, Y(v), v === 0 ? rgba(90, 98, 125) : rgba(38, 44, 64));
    for (const [kk, col, th] of [[0, ACC, 1], [1, rgba(95, 212, 255), 2]]) {
      let py = null;
      for (let x = 0; x < pw; x++) {
        const i = Math.floor((x / pw) * n);
        const yy = Y(rec[j][i][kk]);
        const a = py ?? yy;
        for (let y = Math.min(a, yy); y <= Math.max(a, yy); y++) for (let d = 0; d < th; d++) fig.set(10 + x, y + d, col);
        py = yy;
      }
    }
  });
  save('spring.png', encodePNG(scaleUp(fig, 1)));
  void k;
}

// -------------------------------------------------------- pine bend ----
if (want('pine')) {
  const s = sceneAt(17.8, { leaves: false });
  const box = treeBox(s, BIG_PINE, 8);
  box[2] = Math.min(W - box[0], box[2] + 10);
  const k = 3, pw = box[2] * k, ph = box[3] * k;
  const frames = film([s], 70, ([a]) => {
    const fig = new Img(pw * 2 + 24, ph + 30).fill(BG);
    ['normal', 'clumps'].forEach((v, i) => {
      a.opts.view = v;
      paste(fig, scaleUp(crop(a.render(), ...box), k), 8 + i * (pw + 8), 22);
      labelBar(fig, i ? 'TIERS + ROW BEND' : 'PINE', 8 + i * (pw + 8), 6, pw, 2, i ? ACC : INK);
    });
    a.opts.view = 'normal';
    return fig;
  });
  save('pine_bend.gif', encodeGIF(frames, 10));
}

// ---------------------------------------------------------- compare ----
if (want('compare')) {
  const modes = [['sine', 'ONE SINE'], ['noise', 'RANDOM JITTER'], ['article', 'THIS METHOD']];
  const scenes = modes.map(([m]) => sceneAt(17.6, { mode: m, leaves: false, shadows: true }));
  const box = treeBox(scenes[0], BIG_OAK, 4);
  const k = 2, pw = box[2] * k, ph = box[3] * k;
  const frames = film(scenes, 70, (ss) => {
    const fig = new Img(pw * 3 + 32, ph + 30).fill(BG);
    ss.forEach((a, i) => {
      paste(fig, scaleUp(crop(a.render(), ...box), k), 8 + i * (pw + 8), 22);
      labelBar(fig, modes[i][1], 8 + i * (pw + 8), 6, pw, 2, i === 2 ? ACC : MUTED);
    });
    return fig;
  });
  save('compare.gif', encodeGIF(frames, 10));
}

// ----------------------------------------------------------- inside ----
if (want('inside')) {
  // find the moment the big oak is displaced the most
  const s = sceneAt(17);
  let best = 0, bestT = 0;
  const probe = sceneAt(17);
  for (let i = 0; i < 80; i++) {
    advance(probe, 0.1);
    const m = probe.trees[BIG_OAK].split.clumps.reduce((acc, c) => acc + Math.abs(c.dx) + Math.abs(c.dy), 0);
    if (m > best) { best = m; bestT = probe.t; }
  }
  advance(s, bestT - s.t);
  const box = treeBox(s, BIG_OAK, 4);
  const k = 3, pw = box[2] * k, ph = box[3] * k;
  const fig = new Img(pw * 2 + 24, ph + 30).fill(BG);
  [[false, 'WITHOUT INSIDE'], [true, 'WITH INSIDE']].forEach(([on, name], i) => {
    s.opts.inside = on;
    s.opts.leaves = false;
    paste(fig, scaleUp(crop(s.render(), ...box), k), 8 + i * (pw + 8), 22);
    labelBar(fig, name, 8 + i * (pw + 8), 6, pw, 2, i ? ACC : MUTED);
  });
  save('inside.png', encodePNG(fig));
}

// ------------------------------------------------------------ layers ----
if (want('layers')) {
  // exploded view: inside / trunk / each clump
  const sprite = MAKERS.oak(SEED * 100 + 99, 1);
  const sp = splitTree(sprite, 'oak');
  const k = 2, gap = 10;
  const sw = sp.W * k, sh = sp.H * k;
  const fig = new Img(sw * 3 + gap * 4 + 40, sh + 40).fill(BG);
  const put = (img, x, y) => paste(fig, scaleUp(img, k), x, y);
  put(sp.inside, gap, 26); labelBar(fig, 'INSIDE', gap, 8, sw, 2);
  put(sp.trunk, gap * 2 + sw, 26); labelBar(fig, 'TRUNK', gap * 2 + sw, 8, sw, 2);
  // exploded clumps: push each clump away from the canopy centre
  const cx = sp.clumps.reduce((a, c) => a + c.cx, 0) / sp.clumps.length, cy = sp.clumps.reduce((a, c) => a + c.cy, 0) / sp.clumps.length;
  const ox = gap * 3 + sw * 2 + 20;
  for (const c of sp.clumps) {
    const ex = Math.round((c.cx - cx) * 0.35), ey = Math.round((c.cy - cy) * 0.35);
    put(c.img, ox + (c.bx + ex) * k, 26 + (c.by + ey + 8) * k);
  }
  labelBar(fig, `${sp.clumps.length} CLUMPS`, ox, 8, sw, 2, ACC);
  save('layers.png', encodePNG(fig));
}

void labelColor; void WindTree; void Wind;

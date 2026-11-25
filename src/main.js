import { Scene, W, H } from './core/scene.js';
import { GUSTS, LOOP } from './core/wind.js';
import { MAKERS } from './core/treegen.js';
import { splitTree, debugImages, STAGES } from './core/split.js';
import { TEXT } from './i18n.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
let lang = params.get('lang') === 'en' ? 'en' : localStorage.getItem('lang') || 'ja';
const scene = new Scene(+params.get('seed') || 1);
if (params.has('t')) scene.setTime(+params.get('t'));

// ------------------------------------------------------------ stage ----
const canvas = $('#stage');
const ctx = canvas.getContext('2d');
const imgData = ctx.createImageData(W, H);
const view32 = new Uint32Array(imgData.data.buffer);

function fitStage() {
  const avail = canvas.parentElement.clientWidth - 12;
  const k = Math.max(1, Math.floor(avail / W));
  canvas.style.width = `${W * k}px`;
  canvas.style.height = `${H * k}px`;
}
addEventListener('resize', fitStage);
fitStage();

let playing = true, speed = 1, last = performance.now(), acc = 0;
const DT = 1 / 60;
const history = [];
let selected = scene.trees.findIndex((t) => t.kind === 'oak' && t.footY > 150);

function frame(now) {
  const el = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing) {
    acc += el * speed;
    while (acc >= DT) {
      scene.step(DT);
      acc -= DT;
      const t = scene.trees[selected];
      if (t) history.push([scene.t, t.target, t.lean]);
    }
    if (history.length > 900) history.splice(0, history.length - 900);
  }
  scene.render();
  view32.set(scene.fb.px);
  ctx.putImageData(imgData, 0, 0);
  drawTimeline();
  drawGraph();
  requestAnimationFrame(frame);
}

// --------------------------------------------------------- timeline ----
function buildGustMarks() {
  const box = $('#tlgusts');
  box.innerHTML = '';
  for (const [enter, speedG] of GUSTS) {
    // a gust needs about (map width / speed) seconds to cross the stage
    const dur = (W + 0.25 * H) / speedG;
    for (const off of [0, -LOOP]) {
      const a = enter + off, b = a + dur;
      if (b < 0 || a > LOOP) continue;
      const s = document.createElement('span');
      s.style.left = `${(Math.max(0, a) / LOOP) * 100}%`;
      s.style.width = `${((Math.min(LOOP, b) - Math.max(0, a)) / LOOP) * 100}%`;
      box.appendChild(s);
    }
  }
}
function drawTimeline() {
  const lt = ((scene.t % LOOP) + LOOP) % LOOP;
  $('#tlfill').style.width = `${(lt / LOOP) * 100}%`;
  $('#clock').textContent = `${lt.toFixed(1)}s / ${LOOP}s`;
}
$('#tlbar').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const base = Math.floor(scene.t / LOOP) * LOOP;
  scene.setTime(base + ((e.clientX - r.left) / r.width) * LOOP);
  history.length = 0;
});
$('#jump').addEventListener('click', () => {
  scene.setTime(Math.floor(scene.t / LOOP) * LOOP + 17.8);
  history.length = 0;
});
$('#play').addEventListener('click', () => {
  playing = !playing;
  $('#play').textContent = playing ? '⏸' : '▶';
});
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); $('#play').click(); }
});

// ------------------------------------------------------------ graph ----
const gctx = $('#graph').getContext('2d');
function drawGraph() {
  const c = gctx.canvas, gw = c.width, gh = c.height;
  gctx.fillStyle = '#10131d';
  gctx.fillRect(0, 0, gw, gh);
  const t = scene.trees[selected];
  if (!t) return;
  const maxV = Math.max(4, t.p.push * 1.6);
  const y = (v) => gh - 20 - (v / maxV) * (gh - 40) - (gh - 40) * 0.2;
  gctx.strokeStyle = '#2a3147';
  gctx.lineWidth = 1;
  for (let v = -1; v <= maxV; v++) {
    gctx.beginPath(); gctx.moveTo(0, y(v)); gctx.lineTo(gw, y(v)); gctx.stroke();
  }
  gctx.strokeStyle = '#56607d';
  gctx.beginPath(); gctx.moveTo(0, y(0)); gctx.lineTo(gw, y(0)); gctx.stroke();
  gctx.fillStyle = '#6c7794';
  gctx.font = '12px ui-monospace, monospace';
  for (let v = 0; v <= maxV; v += 2) gctx.fillText(`${v}px`, 4, y(v) - 3);
  const span = 15, t1 = scene.t, t0 = t1 - span;
  const X = (tt) => ((tt - t0) / span) * gw;
  const line = (k, color, w) => {
    gctx.strokeStyle = color; gctx.lineWidth = w; gctx.beginPath();
    let first = true;
    for (const h of history) { if (h[0] < t0) continue; const px = X(h[0]), py = y(h[k]); if (first) { gctx.moveTo(px, py); first = false; } else gctx.lineTo(px, py); }
    gctx.stroke();
  };
  line(1, '#ffb347', 2);
  line(2, '#5fd4ff', 3);
  $('#leanV').textContent = `${t.name}  lean = ${t.lean.toFixed(2)} px  (push ${t.p.push}, period ${t.p.spring}s, damping ${t.p.damping})`;
}
function fillTreeSelect() {
  const sel = $('#treeSel');
  sel.innerHTML = '';
  scene.trees.forEach((t, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = `${TEXT[lang].tree[t.kind]} #${i + 1} (x=${t.footX})`;
    sel.appendChild(o);
  });
  sel.value = selected;
}
$('#treeSel').addEventListener('change', (e) => { selected = +e.target.value; history.length = 0; });
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
  let best = -1, bd = 1e9;
  scene.trees.forEach((t, i) => {
    const cx = t.footX, cy = t.footY - t.height * 0.55;
    const d = Math.hypot((x - cx) / (t.split.W * 0.5), (y - cy) / (t.height * 0.6));
    if (d < bd) { bd = d; best = i; }
  });
  if (best >= 0 && bd < 1.3) { selected = best; $('#treeSel').value = best; history.length = 0; }
});

// ------------------------------------------------------- pipeline ----
function drawPipeline() {
  const kind = $('#pipeKind').value;
  const sprite = MAKERS[kind](scene.seed * 100 + 99, 1);
  const sp = splitTree(sprite, kind);
  const imgs = debugImages(sprite, sp);
  const box = $('#pipeline');
  box.innerHTML = '';
  const tx = TEXT[lang];
  STAGES.forEach((st, i) => {
    const fig = document.createElement('figure');
    const cv = document.createElement('canvas');
    const im = imgs[st];
    cv.width = im.w; cv.height = im.h;
    const c2 = cv.getContext('2d');
    const id = c2.createImageData(im.w, im.h);
    new Uint32Array(id.data.buffer).set(im.px);
    c2.putImageData(id, 0, 0);
    fig.appendChild(cv);
    const cap = document.createElement('figcaption');
    cap.innerHTML = `<b>${i + 1}. ${tx['s_' + st]}</b>${tx['d_' + st]}`;
    fig.appendChild(cap);
    box.appendChild(fig);
  });
  const s = sp.stats;
  $('#pipeStats').textContent = `seeds ${s.seeds} → clumps ${s.clumps} (dropped ${s.dropped}, outline px ${s.outlineMoved}) · ${s.ms.toFixed(1)} ms`;
}
$('#pipeKind').addEventListener('change', drawPipeline);

// ------------------------------------------------------- controls ----
document.querySelectorAll('input[name=view]').forEach((r) => r.addEventListener('change', () => { scene.opts.view = r.value; }));
document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => { scene.opts.mode = r.value; }));
for (const id of ['overlayGust', 'overlayWave', 'spring', 'inside', 'stepped', 'shadows', 'leaves'])
  $('#' + id).addEventListener('change', (e) => { scene.opts[id] = e.target.checked; });
$('#waveOn').addEventListener('change', (e) => { scene.wind.waveOn = e.target.checked; });
$('#gustsOn').addEventListener('change', (e) => { scene.wind.gustsOn = e.target.checked; });
$('#speed').addEventListener('change', (e) => { speed = +e.target.value; });
$('#strength').addEventListener('input', (e) => { scene.wind.strength = +e.target.value; $('#strengthV').textContent = (+e.target.value).toFixed(2); });
$('#seed').value = scene.seed;
const rebuild = (seed) => {
  const t = scene.t;
  scene.build(seed);
  scene.setTime(t);
  $('#seed').value = seed;
  history.length = 0;
  fillTreeSelect();
  drawPipeline();
};
$('#reroll').addEventListener('click', () => rebuild(1 + Math.floor(Math.random() * 99999)));
$('#seed').addEventListener('change', (e) => rebuild(Math.max(1, +e.target.value | 0)));

// ------------------------------------------------------------- i18n ----
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.innerHTML = TEXT[lang][el.dataset.i18n] ?? ''; });
  document.querySelectorAll('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
  fillTreeSelect();
  drawPipeline();
}
document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => { lang = b.dataset.lang; localStorage.setItem('lang', lang); applyLang(); }));

buildGustMarks();
applyLang();
requestAnimationFrame(frame);

// Handy for poking at the simulation from the devtools console: lab.scene.trees[5].p.push = 6
window.lab = { scene };

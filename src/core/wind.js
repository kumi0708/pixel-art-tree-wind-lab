// Global wind field (the article's Godot `wind.gd` autoload, ported).
//
//  * a traveling wave (period 1.54 s, wavelength 69 px) gives every point a phase;
//  * six gusts — Gaussian bumps that slide across the map — give it a strength;
//  * between gusts the air is *still*: no noise anywhere.
export const LOOP = 20.0;
export const WAVE_PERIOD = 1.54;
export const WAVE_LENGTH = 69.0;

// [enter_time, speed px/s, center_y, half_height (0 = whole map), length px, strength]
export const GUSTS = [
  [18.6, 65, 0, 0, 44, 1.25],
  [19.8, 65, 0, 0, 26, 0.5],
  [1.5, 60, 95, 45, 30, 0.6],
  [6.0, 55, 150, 60, 34, 0.75],
  [7.3, 55, 145, 65, 30, 0.9],
  [8.5, 50, 50, 55, 30, 0.55],
];

const wrap = (v, lo, hi) => {
  const r = hi - lo;
  return lo + ((((v - lo) % r) + r) % r);
};

export class Wind {
  constructor() {
    this.t = 0;
    this.strength = 1; // UI multiplier
    this.gustsOn = true;
    this.waveOn = true;
  }
  // wind blows to the right and slightly "down-screen": fronts are tilted lines
  along(x, y) {
    return x + 0.25 * y;
  }
  field(x, y, spread) {
    const al = this.along(x, y);
    let s = 0;
    for (const [enter, speed, cy, hh, len, str] of GUSTS) {
      const path = speed * LOOP;
      const d = wrap(al - speed * (this.t - enter), -path / 2, path / 2);
      let a = str * Math.exp(-((d / (len * spread)) ** 2));
      if (hh > 0) a *= Math.exp(-(((y - cy) / (hh * (spread > 1 ? 1.6 : 1))) ** 2));
      s += a;
    }
    return s * this.strength;
  }
  gust(x, y) {
    return this.gustsOn ? this.field(x, y, 1) : 0;
  }
  breeze(x, y) {
    return Math.min(1.6 * this.field(x, y, 2.2), 1);
  }
  wavePhase(x, y) {
    return 2 * Math.PI * (this.t / WAVE_PERIOD - (this.waveOn ? this.along(x, y) / WAVE_LENGTH : 0));
  }
}

// Packed colors: 0xAABBGGRR (little-endian RGBA bytes), so a Uint32Array of
// these can be handed straight to ImageData.
export const rgba = (r, g, b, a = 255) =>
  (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;

export const hex = (h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255);
};

export const R = (c) => c & 255;
export const G = (c) => (c >>> 8) & 255;
export const B = (c) => (c >>> 16) & 255;
export const A = (c) => c >>> 24;

export const lum = (c) => 0.299 * R(c) + 0.587 * G(c) + 0.114 * B(c);

export function mix(c1, c2, t) {
  return rgba(
    Math.round(R(c1) + (R(c2) - R(c1)) * t),
    Math.round(G(c1) + (G(c2) - G(c1)) * t),
    Math.round(B(c1) + (B(c2) - B(c1)) * t),
    255,
  );
}

export function scale(c, k) {
  return rgba(Math.round(R(c) * k), Math.round(G(c) * k), Math.round(B(c) * k), A(c));
}

// HSV with h in degrees [0,360), s and v in [0,1].
export function hsv(c) {
  const r = R(c) / 255, g = G(c) / 255, b = B(c) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function fromHsv(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgba(Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255));
}

// Distinct debug colors for clump labels.
export const labelColor = (k) => fromHsv(((k * 0.61803398875) % 1) * 360, 0.62, 0.98);

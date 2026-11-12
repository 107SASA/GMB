/**
 * Photo sharpness for visiting cards — pure (no imports), unit-tested.
 *
 * Variance of the Laplacian (edge strength) per tile, over the CENTRE of the
 * photo only (the card; a textured tablecloth around it must not make a
 * blurry card look sharp), scoring the 2nd-best tile so one noisy tile can't
 * pass a blurry photo and a card with little text still scores high.
 *
 * Calibrated on rendered cards shrunk to 640px wide (same as the app):
 *   sharp ≈ 6000–8000 · slightly soft (still readable) ≈ 700 · blurry ≤ 200 · unreadable ≤ 40.
 */

export const BLUR_WARN_BELOW = 250;

export function tiledSharpness(gray: ArrayLike<number>, w: number, h: number, cols = 6, rows = 4, centre = 0.7): number {
  if (w < 8 || h < 8) return 0;
  const cx0 = Math.floor((w * (1 - centre)) / 2);
  const cy0 = Math.floor((h * (1 - centre)) / 2);
  const cw = Math.floor(w * centre);
  const ch = Math.floor(h * centre);
  const tw = Math.max(2, Math.floor(cw / cols));
  const th = Math.max(2, Math.floor(ch / rows));
  const scores: number[] = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = Math.max(1, cx0 + tx * tw);
      const y0 = Math.max(1, cy0 + ty * th);
      const x1 = Math.min(w - 1, x0 + tw);
      const y1 = Math.min(h - 1, y0 + th);
      let n = 0;
      let sum = 0;
      let sq = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          const l = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
          sum += l;
          sq += l * l;
          n++;
        }
      }
      if (n) scores.push(sq / n - (sum / n) ** 2);
    }
  }
  scores.sort((a, b) => b - a);
  return scores[1] ?? scores[0] ?? 0;
}

/** RGBA pixels → grayscale (Rec. 601 luma). */
export function rgbaToGray(rgba: ArrayLike<number>, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 → bytes (no reliance on atob / Buffer in the JS engine). */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length && i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (o < out.length && i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

import { BLUR_WARN_BELOW, base64ToBytes, rgbaToGray, tiledSharpness } from '../src/lib/sharpness';

const W = 640;
const H = 360;

/** Light card with dark "text" strokes across the centre. */
function card(): Uint8Array {
  const g = new Uint8Array(W * H).fill(235);
  for (let y = 90; y < 270; y += 18) {
    for (let x = 120; x < 520; x++) {
      if ((x >> 3) % 3 !== 0) for (let t = 0; t < 4; t++) g[(y + t) * W + x] = 30;
    }
  }
  return g;
}

function boxBlur(src: Uint8Array, r: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < H && xx >= 0 && xx < W) {
            s += src[yy * W + xx];
            n++;
          }
        }
      }
      out[y * W + x] = s / n;
    }
  }
  return out;
}

describe('visiting-card sharpness check', () => {
  it('a sharp card passes, a blurred one is flagged', () => {
    const sharp = tiledSharpness(card(), W, H);
    const blurred = tiledSharpness(boxBlur(card(), 4), W, H);
    expect(sharp).toBeGreaterThan(BLUR_WARN_BELOW * 4);
    expect(blurred).toBeLessThan(BLUR_WARN_BELOW);
  });

  it('a textured background around a blurry card does not make it look sharp', () => {
    const img = boxBlur(card(), 4);
    // Busy cloth pattern only in the outer 10% border.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const border = x < W * 0.1 || x > W * 0.9 || y < H * 0.1 || y > H * 0.9;
        if (border) img[y * W + x] = (x + y) % 2 ? 0 : 255;
      }
    }
    expect(tiledSharpness(img, W, H)).toBeLessThan(BLUR_WARN_BELOW);
  });

  it('tiny / empty images never throw', () => {
    expect(tiledSharpness(new Uint8Array(0), 0, 0)).toBe(0);
    expect(tiledSharpness(new Uint8Array(16), 4, 4)).toBe(0);
  });

  it('base64 decoding and grayscale match the reference', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253]);
    expect(Array.from(base64ToBytes('AAEC+vv8/Q=='))).toEqual(Array.from(bytes));
    expect(Array.from(rgbaToGray([255, 255, 255, 255, 0, 0, 0, 255], 2, 1))).toEqual([255, 0]);
  });
});

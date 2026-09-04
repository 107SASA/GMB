import { getBrandLogoBuffer } from '@/lib/brandAsset';

/**
 * Composites the brand mark onto a generated image, bottom-right corner.
 * Used for every AI-generated post/thumbnail image so shared/published
 * visuals always carry the brand. Server-only (needs `sharp`).
 *
 * Fails soft: if sharp or the logo isn't available, returns the source
 * bytes re-encoded (or, worst case, the original untouched) rather than
 * throwing — a missing watermark must never block content generation.
 */

const MAX_EDGE = 1080; // downscale big model outputs to a sane web size
const LOGO_WIDTH_RATIO = 0.16; // logo ~16% of the image width
const MARGIN_RATIO = 0.03; // gap from the edges, relative to image width
const LOGO_OPACITY = 0.85;

export async function watermarkImageBuffer(input: Buffer): Promise<{ buffer: Buffer; mime: string }> {
  try {
    const sharp = (await import('sharp')).default;

    const base = sharp(input, { failOn: 'none' }).rotate(); // respect EXIF orientation
    const meta = await base.metadata();
    const srcW = meta.width ?? MAX_EDGE;

    // Resize first so the logo is sized against the FINAL dimensions.
    const resized = base.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });
    const resizedBuf = await resized.toBuffer();
    const resizedMeta = await sharp(resizedBuf).metadata();
    const finalW = resizedMeta.width ?? Math.min(srcW, MAX_EDGE);

    const logo = getBrandLogoBuffer();
    if (!logo) {
      const buffer = await sharp(resizedBuf).jpeg({ quality: 85 }).toBuffer();
      return { buffer, mime: 'image/jpeg' };
    }

    const logoW = Math.max(48, Math.round(finalW * LOGO_WIDTH_RATIO));
    const margin = Math.max(16, Math.round(finalW * MARGIN_RATIO));

    const scaledLogo = await sharp(logo).resize({ width: logoW }).ensureAlpha().png().toBuffer();
    // Dim the whole logo's alpha for a subtle mark.
    const dimmedLogo = await sharp(scaledLogo)
      .composite([
        {
          input: Buffer.from([255, 255, 255, Math.round(LOGO_OPACITY * 255)]),
          raw: { width: 1, height: 1, channels: 4 },
          tile: true,
          blend: 'dest-in',
        },
      ])
      .png()
      .toBuffer();
    // sharp's gravity placement has no per-side offset, so bake the corner
    // margin into the overlay by padding it with transparency.
    const preparedLogo = await sharp(dimmedLogo)
      .extend({ top: margin, bottom: margin, left: margin, right: margin, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const buffer = await sharp(resizedBuf)
      .composite([{ input: preparedLogo, gravity: 'southeast' }])
      .jpeg({ quality: 85 })
      .toBuffer();

    return { buffer, mime: 'image/jpeg' };
  } catch (err) {
    console.warn('[imageWatermark] skipped:', (err as Error).message);
    return { buffer: input, mime: 'image/png' };
  }
}

/** Same as {@link watermarkImageBuffer} but returns a data-URI. */
export async function watermarkToDataUri(input: Buffer): Promise<string> {
  const { buffer, mime } = await watermarkImageBuffer(input);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

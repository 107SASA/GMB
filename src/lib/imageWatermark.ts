/**
 * Image finishing for customer GBP creatives. Server-only (needs `sharp`).
 *
 * Sep 2026: customer Google images NEVER carry the GrowwMatics mark — the
 * business being advertised is the brand. When the customer's own logo is
 * available it is composited subtly (bottom-right); otherwise the image is
 * only resized/re-encoded. (The GrowwMatics mark still appears on
 * GrowwMatics' own artefacts such as PDF reports — see lib/brandAsset.ts.)
 *
 * Fails soft: never blocks content generation.
 */

const MAX_EDGE = 1080; // downscale big model outputs to a sane web size
const LOGO_WIDTH_RATIO = 0.14; // customer logo ~14% of the image width — subtle
const MARGIN_RATIO = 0.03;
const LOGO_OPACITY = 0.92;

export async function watermarkImageBuffer(input: Buffer, customerLogo: Buffer | null = null): Promise<{ buffer: Buffer; mime: string }> {
  try {
    const sharp = (await import('sharp')).default;
    const resizedBuf = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    if (!customerLogo) {
      return { buffer: await sharp(resizedBuf).jpeg({ quality: 85 }).toBuffer(), mime: 'image/jpeg' };
    }
    const finalW = (await sharp(resizedBuf).metadata()).width ?? MAX_EDGE;
    const logoW = Math.max(56, Math.round(finalW * LOGO_WIDTH_RATIO));
    const margin = Math.max(16, Math.round(finalW * MARGIN_RATIO));
    const scaled = await sharp(customerLogo).resize({ width: logoW }).ensureAlpha().png().toBuffer();
    const dimmed = await sharp(scaled)
      .composite([{ input: Buffer.from([255, 255, 255, Math.round(LOGO_OPACITY * 255)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }])
      .png()
      .toBuffer();
    const padded = await sharp(dimmed)
      .extend({ top: margin, bottom: margin, left: margin, right: margin, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const buffer = await sharp(resizedBuf).composite([{ input: padded, gravity: 'southeast' }]).jpeg({ quality: 85 }).toBuffer();
    return { buffer, mime: 'image/jpeg' };
  } catch (err) {
    console.warn('[imageWatermark] skipped:', (err as Error).message);
    return { buffer: input, mime: 'image/png' };
  }
}

/** Same as {@link watermarkImageBuffer} but returns a data-URI. */
export async function watermarkToDataUri(input: Buffer, customerLogo: Buffer | null = null): Promise<string> {
  const { buffer, mime } = await watermarkImageBuffer(input, customerLogo);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * Safe branded graphic — the fallback when there is no photo and image
 * generation fails: brand colours, the verified headline (service / festival
 * greeting / "This week at <business>") and the customer's logo. No scene,
 * no people, no invented claims.
 */
export async function brandedGraphic(opts: { headline: string; subline?: string; colors: string[]; customerLogo?: Buffer | null }): Promise<{ buffer: Buffer; mime: string }> {
  const sharp = (await import('sharp')).default;
  const [bg, accent] = [opts.colors[0] || '#1f2937', opts.colors[1] || '#f3f4f6'];
  const W = 1080; const H = 1080;
  const words = opts.headline.split(/\s+/);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + w).length <= 22) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  const shown = lines.slice(0, 4);
  const startY = H / 2 - (shown.length - 1) * 45;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${bg}" stop-opacity="0.82"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="80" y="${H - 120}" width="${W - 160}" height="6" fill="${accent}" opacity="0.7"/>
    ${shown.map((l, i) => `<text x="${W / 2}" y="${startY + i * 90}" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="700" fill="${accent}" text-anchor="middle">${esc(l)}</text>`).join('')}
    ${opts.subline ? `<text x="${W / 2}" y="${startY + shown.length * 90 + 30}" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="${accent}" opacity="0.9" text-anchor="middle">${esc(opts.subline)}</text>` : ''}
  </svg>`;
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  return watermarkImageBuffer(base, opts.customerLogo ?? null);
}

/**
 * Overlays the owner's EXACT offer text as a band across the top of an image
 * (drawn here, not by the image model — so the wording can't be altered,
 * misspelled or embellished). Long text is wrapped to 3 lines and clipped
 * with "…". The bottom-right logo corner is left untouched.
 */
export async function addOfferTextBand(input: Buffer, text: string, colors: string[]): Promise<{ buffer: Buffer; mime: string }> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(input).metadata();
  const W = meta.width || 1080;
  const [bg, fg] = [colors[0] || '#1f2937', colors[1] && colors[1] !== colors[0] ? colors[1] : '#ffffff'];
  const fontSize = Math.round(W * 0.045);
  const perLine = Math.max(16, Math.floor((W * 0.86) / (fontSize * 0.55)));
  const lines: string[] = [];
  for (const w of String(text).replace(/\s+/g, ' ').trim().split(' ')) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' ' + w).length <= perLine) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  const shown = lines.slice(0, 3);
  if (lines.length > 3) shown[2] = `${shown[2].replace(/.{0,2}$/, '')}…`;
  const pad = Math.round(fontSize * 0.7);
  const bandH = pad * 2 + shown.length * Math.round(fontSize * 1.3);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${bandH}">
    <rect width="100%" height="100%" fill="${bg}" opacity="0.88"/>
    ${shown.map((l, i) => `<text x="${W / 2}" y="${pad + fontSize + i * Math.round(fontSize * 1.3)}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="${fg}" text-anchor="middle">${esc(l)}</text>`).join('')}
  </svg>`;
  const band = await sharp(Buffer.from(svg)).png().toBuffer();
  const buffer = await sharp(input).composite([{ input: band, gravity: 'north' }]).jpeg({ quality: 88 }).toBuffer();
  return { buffer, mime: 'image/jpeg' };
}

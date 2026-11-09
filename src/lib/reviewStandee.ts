import QRCode from 'qrcode';

/**
 * Branded "scan to review us on Google" counter standee (PhonePe-standee
 * style), drawn on a canvas in the browser. One design backs both the
 * "Download QR" PNG and the "Print poster" page, so they always match.
 *
 * 1200×1800 px (2:3 — 4×6 in at 300 dpi, fits A5/A4 when printed).
 */
export const STANDEE_W = 1200;
export const STANDEE_H = 1800;

const BRAND = '#06b34c';
const BRAND_DARK = '#0a8a3e';
const INK = '#101613';
const MUTED = '#5b6660';
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const GOOGLE = [
  { ch: 'G', color: '#4285F4' }, { ch: 'o', color: '#EA4335' }, { ch: 'o', color: '#FBBC05' },
  { ch: 'g', color: '#4285F4' }, { ch: 'l', color: '#34A853' }, { ch: 'e', color: '#EA4335' },
];

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(cx + rad * Math.cos(a), cy + rad * Math.sin(a));
  }
  ctx.closePath();
  ctx.fill();
}

/** Splits text into at most `maxLines` lines that fit `maxW`, ellipsizing the last. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

export async function renderReviewStandee(opts: { businessName: string; reviewUrl: string }): Promise<HTMLCanvasElement> {
  const W = STANDEE_W, H = STANDEE_H, cx = W / 2;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const [qr, logo] = await Promise.all([
    QRCode.toDataURL(opts.reviewUrl, { width: 680, margin: 0, errorCorrectionLevel: 'H', color: { dark: INK, light: '#ffffff' } }).then(loadImage),
    loadImage('/brand/icon.png'),
  ]);

  // Page
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Top brand band with a curved bottom edge
  const band = ctx.createLinearGradient(0, 0, W, 0);
  band.addColorStop(0, BRAND);
  band.addColorStop(1, BRAND_DARK);
  ctx.fillStyle = band;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, 230);
  ctx.quadraticCurveTo(cx, 330, 0, 230);
  ctx.closePath();
  ctx.fill();

  // Logo + "Growwmatics AI" wordmark, centred together
  ctx.font = `700 68px ${FONT}`;
  ctx.textBaseline = 'middle';
  const word = 'Growwmatics AI';
  const logoSize = 112, gap = 26;
  const groupW = (logo ? logoSize + gap : 0) + ctx.measureText(word).width;
  let x = cx - groupW / 2;
  const bandMid = 135;
  if (logo) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + logoSize / 2, bandMid, logoSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(logo, x + 14, bandMid - logoSize / 2 + 14, logoSize - 28, logoSize - 28);
    x += logoSize + gap;
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(word, x, bandMid + 2);

  // Headline: "Loved your visit?" + "Review us on Google"
  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  ctx.font = `500 46px ${FONT}`;
  ctx.fillText('Loved your visit?', cx, 400);

  ctx.font = `800 76px ${FONT}`;
  const lead = 'Review us on ';
  const leadW = ctx.measureText(lead).width;
  const gW = GOOGLE.reduce((s, l) => s + ctx.measureText(l.ch).width, 0);
  let lx = cx - (leadW + gW) / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.fillText(lead, lx, 490);
  lx += leadW;
  for (const l of GOOGLE) {
    ctx.fillStyle = l.color;
    ctx.fillText(l.ch, lx, 490);
    lx += ctx.measureText(l.ch).width;
  }

  // Five stars
  ctx.fillStyle = '#FBBC05';
  for (let i = 0; i < 5; i++) star(ctx, cx + (i - 2) * 74, 580, 30);

  // QR card with Google-coloured corner brackets
  const card = 780, cardX = cx - card / 2, cardY = 650;
  ctx.save();
  ctx.shadowColor = 'rgba(16,22,19,0.12)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, cardX, cardY, card, card, 44);
  ctx.fill();
  ctx.restore();

  const br = 90, off = 18, th = 14;
  ctx.lineWidth = th;
  ctx.lineCap = 'round';
  const corners: [number, number, number, number, string][] = [
    [cardX - off, cardY - off, 1, 1, '#EA4335'],
    [cardX + card + off, cardY - off, -1, 1, '#4285F4'],
    [cardX - off, cardY + card + off, 1, -1, '#FBBC05'],
    [cardX + card + off, cardY + card + off, -1, -1, '#34A853'],
  ];
  for (const [px, py, dx, dy, color] of corners) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(px, py + dy * br);
    ctx.lineTo(px, py + dy * 24);
    ctx.quadraticCurveTo(px, py, px + dx * 24, py);
    ctx.lineTo(px + dx * br, py);
    ctx.stroke();
  }

  const qrSize = 680, qrX = cx - qrSize / 2, qrY = cardY + (card - qrSize) / 2;
  if (qr) ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);

  // Brand mark in the QR centre (error correction H tolerates it)
  if (logo) {
    const m = 128, mx = cx - m / 2, my = qrY + qrSize / 2 - m / 2;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, mx, my, m, m, 28);
    ctx.fill();
    ctx.drawImage(logo, mx + 14, my + 14, m - 28, m - 28);
  }

  // Business name (up to 2 lines)
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  // Long names drop to a smaller size so two lines + caption clear the badge.
  ctx.font = `800 60px ${FONT}`;
  let nameLines = wrap(ctx, opts.businessName, W - 200, 2);
  if (nameLines.length > 1) {
    ctx.font = `800 52px ${FONT}`;
    nameLines = wrap(ctx, opts.businessName, W - 160, 2);
  }
  let ny = 1500;
  for (const line of nameLines) { ctx.fillText(line, cx, ny); ny += 58; }

  ctx.fillStyle = MUTED;
  ctx.font = `500 34px ${FONT}`;
  ctx.fillText('Scan with your phone camera', cx, ny + 4);

  // "Powered by Growwmatics AI" pill badge at the bottom
  const pre = 'Powered by ', brand = 'Growwmatics AI';
  ctx.font = `500 38px ${FONT}`;
  const preW = ctx.measureText(pre).width;
  ctx.font = `800 38px ${FONT}`;
  const brandW = ctx.measureText(brand).width;
  const dot = 64, pad = 18, pillH = 100;
  const pillW = pad + (logo ? dot + 20 : 18) + preW + brandW + 36;
  const pillX = cx - pillW / 2, pillY = H - 44 - pillH;
  ctx.save();
  ctx.shadowColor = 'rgba(6,179,76,0.35)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = band;
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.restore();
  let px = pillX + pad;
  const pMid = pillY + pillH / 2;
  if (logo) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px + dot / 2, pMid, dot / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(logo, px + 8, pMid - dot / 2 + 8, dot - 16, dot - 16);
    px += dot + 20;
  } else {
    px += 18;
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `500 38px ${FONT}`;
  ctx.fillText(pre, px, pMid + 2);
  ctx.font = `800 38px ${FONT}`;
  ctx.fillText(brand, px + preW, pMid + 2);

  return canvas;
}

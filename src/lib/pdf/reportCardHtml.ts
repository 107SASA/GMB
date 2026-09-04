/**
 * Compact WhatsApp "report card" image template — mirrors the raw-HTML-string
 * + inline-style pattern of src/lib/pdf/reportHtml.ts (the PDF template),
 * screenshotted instead of PDF'd (see the /print/report-card/[token] route).
 * A smaller, square-ish subset of the full report: name, rating, rank, and
 * the three scores extractReportScores() already produces (profile/SEO/
 * review) — "review reply score" from the competitor's card is intentionally
 * omitted since there's no proven field for it in the audit data.
 */

import { getBrandLogoDataUri } from '@/lib/brandAsset';

export interface ReportCardContext {
  businessName: string;
  rating?: number;
  reviewCount?: number;
  rank: string; // e.g. "12" or "beyond 20"
  profileCompletion: number; // 0-100
  seoScore: number;
  reviewScore: number;
}

function h(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function watermarkHtml(): string {
  const uri = getBrandLogoDataUri();
  return uri
    ? `<img src="${uri}" alt="GrowwMatics" style="position:absolute;right:20px;bottom:16px;width:44px;height:44px;object-fit:contain;opacity:0.55;" />`
    : '';
}

function ratingLabel(score: number): { label: string; color: string } {
  if (score >= 75) return { label: 'Good', color: '#22c55e' };
  if (score >= 50) return { label: 'Average', color: '#eab308' };
  return { label: 'Poor', color: '#ef4444' };
}

function metricRow(label: string, value: number): string {
  const { label: ratingText, color } = ratingLabel(value);
  return `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #f1f5f9;">
  <div style="font-size:15px;font-weight:600;color:#0f172a;">${h(label)}</div>
  <div style="display:flex;align-items:center;gap:10px;">
    <div style="font-size:15px;font-weight:800;color:#0f172a;">${Math.round(value)}%</div>
    <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:${color};color:#fff;">${ratingText}</span>
  </div>
</div>`;
}

function starRow(rating: number): string {
  const full = Math.round(rating);
  let out = '';
  for (let i = 1; i <= 5; i++) {
    out += `<span style="color:${i <= full ? '#FBBF24' : '#cbd5e1'};font-size:18px;">★</span>`;
  }
  return out;
}

export function buildReportCardHtml(ctx: ReportCardContext): string {
  const rankIsNumber = /^\d+(\.\d+)?$/.test(ctx.rank);
  const rankNum = rankIsNumber ? Number(ctx.rank) : null;
  const rankColor = rankNum == null ? '#94a3b8' : rankNum <= 5 ? '#22c55e' : rankNum <= 10 ? '#eab308' : '#ef4444';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: 600px 800px; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0; width: 600px; padding: 40px; position: relative;
    font-family: Inter, -apple-system, sans-serif;
    background: linear-gradient(180deg, #ede9fe 0%, #ffffff 220px);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
</style>
</head>
<body>
  ${watermarkHtml()}
  <div style="text-align:center;margin-bottom:8px;">
    <span style="font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#0a8a3e;">GrowwMatics AI · Free Report</span>
  </div>
  <h1 style="text-align:center;font-size:24px;font-weight:900;color:#0f172a;margin:4px 0 8px;">${h(ctx.businessName)}</h1>
  ${
    ctx.rating != null
      ? `<div style="text-align:center;margin-bottom:24px;">${starRow(ctx.rating)} <span style="font-size:14px;color:#64748b;margin-left:6px;">${ctx.rating.toFixed(1)} (${ctx.reviewCount ?? 0} reviews)</span></div>`
      : '<div style="margin-bottom:24px;"></div>'
  }

  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:28px;box-shadow:0 4px 24px rgba(15,23,42,0.06);">
    <div style="display:flex;align-items:center;gap:20px;padding-bottom:20px;border-bottom:1px solid #f1f5f9;">
      <div style="width:84px;height:84px;border-radius:50%;background:${rankColor};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <span style="font-size:26px;font-weight:900;color:#fff;">${h(ctx.rank)}</span>
      </div>
      <div>
        <div style="font-size:13px;color:#64748b;font-weight:600;">Google Search Rank</div>
        <div style="font-size:14px;color:#94a3b8;">for your main keyword</div>
      </div>
    </div>

    ${metricRow('Profile Completion', ctx.profileCompletion)}
    ${metricRow('SEO Score', ctx.seoScore)}
    ${metricRow('Review Score', ctx.reviewScore)}
  </div>

  <div style="text-align:center;margin-top:24px;font-size:12px;color:#94a3b8;">
    Full breakdown &amp; action plan waiting for you on WhatsApp 👇
  </div>
</body>
</html>`;
}

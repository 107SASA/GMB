import type {
  IAudit, IAuditData, IChecklistItem, IGeoGridKeyword,
} from '@/models/Audit';
import { formatRank, rankBucket, computeSuspensionRisk } from '@/services/audit/reportMath';
import { getBrandLogoDataUri } from '@/lib/brandAsset';
import { formatProfileCompletionDisplay } from '@/lib/profileCompletion';

// Brand triad (src/app/globals.css: --color-secondary / --color-primary-container /
// --color-error) — the same three colors the on-screen report uses for
// rank/score/risk indicators, so a PDF and its matching screen report never
// show different colors for the same number.
const BRAND_GOOD = '#0a8a3e';
const BRAND_MID  = '#fab219'; // --color-warning — primary and secondary are both greens post-rebrand, so "medium" needs a real third hue to stay distinguishable from BRAND_GOOD; see globals.css's --color-warning comment.
const BRAND_BAD  = '#ba1a1a';
const BRAND_RANK_OK = BRAND_MID; // text-warning-text — used specifically for the 6-10 rank bucket, matching AuditReportGrexa's rankTextClass

export interface ReportContext {
  audit: IAudit;
  businessRating?: number;
  coordinates?: { lat: number; lng: number };
  mapsApiKey?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function h(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Circular gauge matching the React CircularGauge component style
function svgRing(value: number, color: string, size = 96): string {
  const strokeWidth = Math.round(size * 0.1);
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const v = Math.min(100, Math.max(0, value));
  const used = (v / 100) * circ;
  const cx = size / 2;
  const fontSize = Math.round(size * 0.22);
  return `<div style="position:relative;width:${size}px;height:${size}px;display:inline-block;flex-shrink:0;">
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="#f1f5f9" stroke-width="${strokeWidth}"/>
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"
      stroke-dasharray="${used.toFixed(1)} ${(circ - used).toFixed(1)}"
      stroke-linecap="round" transform="rotate(-90 ${cx} ${cx})"/>
    <text x="${cx}" y="${cx}" dominant-baseline="middle" text-anchor="middle"
      font-size="${fontSize}" font-weight="900" fill="#0f172a"
      font-family="Inter,-apple-system,sans-serif">${v}%</text>
  </svg>
</div>`;
}

function rankMeta(rank: number | undefined | null): { color: string; display: string } {
  const bucket = rankBucket(rank);
  const color = bucket === 'good' ? BRAND_GOOD
    : bucket === 'ok' ? BRAND_RANK_OK
    : bucket === 'bad' ? BRAND_BAD
    : '#737781'; // --color-outline
  return { color, display: formatRank(rank) };
}

function starRow(rating: number): string {
  const full = Math.floor(rating);
  let out = '';
  for (let i = 1; i <= 5; i++) {
    out += `<span style="color:${i <= full ? '#FBBF24' : '#cbd5e1'};font-size:16px;">★</span>`;
  }
  return out;
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    Good:    `background:${BRAND_GOOD};color:#fff;`,
    Poor:    `background:${BRAND_BAD};color:#fff;`,
    Average: `background:${BRAND_MID};color:#fff;`,
    Low:     `background:${BRAND_GOOD};color:#fff;`,
    High:    `background:${BRAND_BAD};color:#fff;`,
    Medium:  `background:${BRAND_MID};color:#fff;`,
  };
  const style = map[status] ?? 'background:#737781;color:#fff;';
  return `<span style="font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;${style}">${h(status)}</span>`;
}

function checkIcon(status: IChecklistItem['status'] | string): string {
  if (status === 'Complete')
    return `<svg width="20" height="20" viewBox="0 0 24 24" style="flex-shrink:0;">
      <circle cx="12" cy="12" r="10" fill="${BRAND_GOOD}"/>
      <path d="M8 12l3 3 5-5" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`;
  if (status === 'Partial')
    return `<svg width="20" height="20" viewBox="0 0 24 24" style="flex-shrink:0;">
      <circle cx="12" cy="12" r="10" fill="${BRAND_MID}"/>
      <path d="M12 7v5M12 16h.01" stroke="white" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    </svg>`;
  return `<svg width="20" height="20" viewBox="0 0 24 24" style="flex-shrink:0;">
    <circle cx="12" cy="12" r="10" fill="${BRAND_BAD}"/>
    <path d="M15 9l-6 6M9 9l6 6" stroke="white" stroke-width="2.2" stroke-linecap="round" fill="none"/>
  </svg>`;
}

function googleSvg(size = 18): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>`;
}

function buildingIcon(): string {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
    <line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>
  </svg>`;
}

function buildStaticMapUrlForPdf(
  pts: Array<{ lat: number; lng: number; rank: number }>,
  apiKey: string,
  gridSpacingKm = 1.5,
): string {
  const center = pts[4] ?? pts[0];
  const zoom = gridSpacingKm <= 1 ? 14 : gridSpacingKm <= 2 ? 13 : 12;
  const parts: string[] = [
    `center=${center.lat},${center.lng}`,
    `zoom=${zoom}`,
    'size=580x320',
    'scale=2',
    'maptype=roadmap',
    'style=feature:poi%7Celement:labels%7Cvisibility:off',
    'style=feature:transit%7Cvisibility:off',
  ];
  for (let i = 0; i < pts.length; i++) {
    if (i === 4) continue;
    const p = pts[i];
    let color: string; let labelPart = '';
    if (p.rank <= 5)       { color = '0x22c55e'; if (p.rank <= 9) labelPart = `%7Clabel:${p.rank}`; }
    else if (p.rank <= 10) { color = '0xf59e0b'; if (p.rank <= 9) labelPart = `%7Clabel:${p.rank}`; }
    else if (p.rank <= 20) { color = '0xef4444'; }
    else                   { color = '0x94a3b8'; }
    parts.push(`markers=color:${color}%7Csize:mid${labelPart}%7C${p.lat},${p.lng}`);
  }
  parts.push(`markers=color:0x1d4ed8%7Csize:large%7Clabel:Y%7C${center.lat},${center.lng}`);
  parts.push(`key=${encodeURIComponent(apiKey)}`);
  return `https://maps.googleapis.com/maps/api/staticmap?${parts.join('&')}`;
}

function renderGeoGridMap(kw: IGeoGridKeyword, mapsApiKey?: string, gridSpacingKm = 1.5): string {
  const pts = [...kw.points]
    .sort((a, b) => b.lat - a.lat || a.lng - b.lng)
    .slice(0, 9);
  const fallbackLat = pts.reduce((s, p) => s + p.lat, 0) / (pts.length || 1);
  const fallbackLng = pts.reduce((s, p) => s + p.lng, 0) / (pts.length || 1);
  while (pts.length < 9) pts.push({ lat: fallbackLat, lng: fallbackLng, rank: 21 });

  const { color: rankColor, display: rankDisplay } = rankMeta(kw.avgRank);

  const cells = pts.map((pt, i) => {
    const isCenter = i === 4;
    let bg: string;
    if (isCenter)            { bg = '#1d4ed8'; }
    else if (pt.rank <= 5)   { bg = '#22c55e'; }
    else if (pt.rank <= 10)  { bg = '#f59e0b'; }
    else if (pt.rank <= 20)  { bg = '#f97316'; }
    else                     { bg = '#ef4444'; }
    const disp = pt.rank > 20 ? '20+' : String(pt.rank);
    const sz = isCenter ? 46 : 38;
    const fs = disp.length > 2 ? 9 : isCenter ? 13 : 12;
    const shadow = isCenter
      ? `box-shadow:0 0 0 3px ${bg}40,0 4px 12px rgba(0,0,0,.4);border:3px solid white;`
      : `box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid rgba(255,255,255,.7);`;
    return `<div style="display:flex;align-items:center;justify-content:center;">
      <div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${bg};color:#fff;
        display:flex;align-items:center;justify-content:center;font-weight:900;font-size:${fs}px;
        ${shadow}flex-shrink:0;position:relative;">${disp}${isCenter ? `<span style="position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:3px;font-size:7px;font-weight:700;color:#fff;background:#1d4ed8;border-radius:4px;padding:1px 4px;white-space:nowrap;">YOU</span>` : ''}</div>
    </div>`;
  }).join('');

  const hasMap = !!mapsApiKey;
  const mapUrl = hasMap ? buildStaticMapUrlForPdf(pts, mapsApiKey!, gridSpacingKm) : '';

  const mapBg = hasMap
    ? `background:#e8edf2;`
    : `background:#e8edf2;background-image:linear-gradient(rgba(148,163,184,.25) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.25) 1px,transparent 1px);background-size:24px 24px;`;

  const mapContent = hasMap
    ? `<img src="${mapUrl}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" alt="map"/>`
    : '';

  const legend = [
    { bg: '#1d4ed8', label: 'You' },
    { bg: '#22c55e', label: '1–5' },
    { bg: '#f59e0b', label: '6–10' },
    { bg: '#f97316', label: '11–20' },
    { bg: '#ef4444', label: '20+' },
  ].map(({ bg, label }) =>
    `<div style="display:flex;align-items:center;gap:4px;">
      <div style="width:10px;height:10px;border-radius:50%;background:${bg};flex-shrink:0;"></div>
      <span style="font-size:10px;color:#64748b;font-weight:600;">${label}</span>
    </div>`
  ).join('');

  return `<div style="border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;break-inside:avoid;display:flex;flex-direction:column;">
  <div style="padding:12px 16px;background:linear-gradient(to right,#f8fafc,#fff);border-bottom:1px solid #e2e8f0;">
    <p style="margin:0 0 2px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.7px;">Keyword</p>
    <p style="margin:0;font-size:13px;font-weight:700;color:#2563eb;line-height:1.3;">${h(kw.keyword)}</p>
    <div style="display:flex;align-items:baseline;gap:5px;margin-top:5px;">
      <span style="font-size:11px;color:#64748b;">Avg Rank</span>
      <span style="font-size:20px;font-weight:900;color:${rankColor};">${rankDisplay}</span>
    </div>
  </div>
  <div style="position:relative;flex:1;min-height:220px;${mapBg}">
    ${mapContent}
    <div style="position:absolute;inset:0;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);padding:${hasMap ? '18px' : '14px'};gap:${hasMap ? '10px' : '8px'};">
      ${cells}
    </div>
  </div>
  <div style="padding:8px 14px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
    ${legend}
  </div>
</div>`;
}

// ── Consultant sections (Key Finding → Data Required) ──────────────────────────
// String-HTML mirror of ConsultantSections.tsx. Kept intentionally close in
// structure so the PDF and the web report stay in sync section-for-section.

const NAVY = '#1e293b';
const RANK_RED = '#dc2626';
const BAND_W: Record<string, string> = { HIGH: '100%', MED: '66%', LOW: '38%', NICHE: '18%' };
const BAND_C: Record<string, string> = { HIGH: '#f59e0b', MED: '#f59e0b', LOW: '#60a5fa', NICHE: '#a78bfa' };
const POT_C: Record<string, string> = { 'HIGHEST POTENTIAL': '#16a34a', 'IMMEDIATE WIN': '#ea580c', 'HIGH POTENTIAL': '#2563eb' };
const PRI_C: Record<string, string> = { CRITICAL: '#dc2626', HIGH: '#ea580c', MEDIUM: '#ca8a04' };

const fmtR = (r?: number | null) => (r == null ? '—' : r >= 21 ? '20+' : `#${Math.round(r)}`);
const bar = (n: number, title: string) =>
  `<div style="background:${NAVY};color:#fff;border-radius:10px;padding:12px 16px;font-weight:700;font-size:13px;margin:18px 0 10px;">${n}. ${h(title)}</div>`;
const card = (inner: string) =>
  `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;break-inside:avoid;margin-bottom:12px;">${inner}</div>`;
const pill = (t: string, c: string) =>
  `<span style="background:${c};color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;text-transform:uppercase;white-space:nowrap;">${h(t)}</span>`;

const TONE_HEX: Record<string, string> = { good: '#16a34a', warn: '#ca8a04', bad: '#dc2626' };

function renderConsultantSections(
  draft: any,
  keywordTable: Array<{ keyword: string; volumeBand: string; estimated: boolean; mapsRank: number; searchVolume?: number | null; mapsVolume?: number | null }>,
  businessName: string,
  city: string,
): string {
  if (!draft) return '';
  const full = draft.depth === 'full';
  const parts: string[] = [];
  let sn = 0;
  const sec = () => ++sn;
  const showMapsVol = full && keywordTable.some((k) => k.mapsVolume != null);

  // Performance Snapshot
  if (Array.isArray(draft.performanceSnapshot) && draft.performanceSnapshot.length) {
    const tiles = draft.performanceSnapshot
      .map((t: any) => `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;">
        <div style="font-size:9px;color:#94a3b8;">${h(t.label)}</div>
        <div style="font-size:15px;font-weight:800;margin-top:3px;color:${t.tone ? TONE_HEX[t.tone] || '#0f172a' : '#0f172a'};">${h(t.value)}</div>
        ${t.note ? `<div style="font-size:9px;color:#94a3b8;margin-top:2px;">${h(t.note)}</div>` : ''}
      </div>`)
      .join('');
    parts.push(bar(sec(), 'PERFORMANCE SNAPSHOT') + card(`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">${tiles}</div>`));
  }

  if (draft.keyFinding) {
    parts.push(card(
      `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#06b34c;margin-bottom:6px;">Key Finding</div>
       <p style="font-size:12px;color:#374151;line-height:1.6;margin:0;">${h(draft.keyFinding)}</p>`,
    ));
  }

  if (full && draft.websiteAssessment) {
    parts.push(card(
      `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#06b34c;margin-bottom:6px;">Your Website</div>
       <p style="font-size:12px;color:#374151;line-height:1.6;margin:0;">${h(draft.websiteAssessment)}</p>`,
    ));
  }

  if (draft.criticalGap?.rows?.length) {
    const rows = draft.criticalGap.rows
      .map((r: any) => `<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px;border-top:1px solid #fde68a;"><span>${h(r.keyword)}</span><span style="color:${RANK_RED};font-weight:700;">${fmtR(r.mapsRank)}</span></div>`)
      .join('');
    parts.push(
      `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:18px;break-inside:avoid;margin-bottom:12px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#92400e;margin-bottom:6px;">Critical Gap — Searches That Are Not Showing You</div>
        <p style="font-size:12px;color:#78716c;margin:0 0 8px;">${h(draft.criticalGap.intro)}</p>
        ${rows}
        <p style="font-size:12px;color:#78716c;margin:10px 0 0;">${h(draft.criticalGap.closer)}</p>
      </div>`,
    );
  }

  if (keywordTable.length) {
    const volCols = showMapsVol
      ? `<th style="padding:4px 6px;text-align:right;">Search/mo</th><th style="padding:4px 6px;text-align:right;">Maps/mo ~</th>`
      : '';
    const rows = keywordTable
      .map((k) => `<tr style="border-top:1px solid #f1f5f9;">
        <td style="padding:7px 6px;font-size:11px;color:#374151;">${h(k.keyword)}</td>
        ${showMapsVol ? `<td style="padding:7px 6px;text-align:right;font-size:10px;color:#64748b;">${k.searchVolume != null ? h(k.searchVolume.toLocaleString('en-IN')) : '—'}</td><td style="padding:7px 6px;text-align:right;font-size:10px;color:#64748b;">${k.mapsVolume != null ? h(`~${k.mapsVolume.toLocaleString('en-IN')}`) : '—'}</td>` : ''}
        <td style="padding:7px 6px;"><span style="display:inline-block;width:56px;height:5px;border-radius:3px;background:#e2e8f0;vertical-align:middle;overflow:hidden;"><span style="display:block;height:100%;width:${BAND_W[k.volumeBand] || '18%'};background:${BAND_C[k.volumeBand] || '#a78bfa'};"></span></span> <span style="font-size:10px;font-weight:700;color:${BAND_C[k.volumeBand] || '#a78bfa'};">${h(k.volumeBand)}${k.estimated ? '*' : ''}</span></td>
        <td style="padding:7px 6px;text-align:right;font-weight:700;font-size:11px;color:${k.mapsRank > 5 ? RANK_RED : '#16a34a'};">${fmtR(k.mapsRank)}</td>
      </tr>`)
      .join('');
    const insights = (draft.keywordInsights || []).map((l: string) => `<li style="font-size:11px;color:#64748b;">${h(l)}</li>`).join('');
    parts.push(bar(sec(), 'KEYWORD SEARCH VOLUME ANALYSIS — GOOGLE MAPS') + card(
      `<p style="font-size:11px;color:#64748b;margin:0 0 8px;">Phrases people type around ${h(city || 'your area')}. Rank is live Maps data when we have it — never guessed. <span>* = estimated demand${showMapsVol ? ' · ~ Maps volume derived from Google search volume' : ''}</span></p>
       <table style="width:100%;border-collapse:collapse;"><thead><tr style="text-align:left;font-size:9px;color:#94a3b8;text-transform:uppercase;"><th style="padding:4px 6px;">Keyword</th>${volCols}<th style="padding:4px 6px;">Demand</th><th style="padding:4px 6px;text-align:right;">Maps Rank</th></tr></thead><tbody>${rows}</tbody></table>
       ${insights ? `<ul style="margin:10px 0 0;padding-left:16px;">${insights}</ul>` : ''}`,
    ));
  }

  if (draft.competitorLandscape?.length) {
    const rows = draft.competitorLandscape
      .map((c: any) => `<tr style="border-top:1px solid #f1f5f9;vertical-align:top;">
        <td style="padding:7px 6px;font-size:11px;font-weight:600;color:#0f172a;">${h(c.name)}</td>
        <td style="padding:7px 6px;font-size:11px;font-weight:700;color:#06b34c;white-space:nowrap;">${fmtR(c.mapsRank)}</td>
        <td style="padding:7px 6px;font-size:11px;color:#64748b;white-space:nowrap;">${c.rating != null ? h(`${c.rating}★`) : '—'}${c.reviewCount != null ? h(` · ${c.reviewCount}`) : ''}</td>
        <td style="padding:7px 6px;font-size:11px;color:#64748b;">${h(c.keyEdge || '')}</td>
      </tr>`)
      .join('');
    parts.push(bar(sec(), 'COMPETITOR LANDSCAPE') + card(
      `<table style="width:100%;border-collapse:collapse;"><thead><tr style="text-align:left;font-size:9px;color:#94a3b8;text-transform:uppercase;"><th style="padding:4px 6px;">Competitor</th><th style="padding:4px 6px;">Maps Rank</th><th style="padding:4px 6px;">Reviews</th><th style="padding:4px 6px;">Key Edge</th></tr></thead><tbody>${rows}</tbody></table>
       ${draft.competitorCounterPosition ? `<p style="font-size:11px;color:#64748b;margin:10px 0 0;line-height:1.6;">${h(draft.competitorCounterPosition)}</p>` : ''}`,
    ));
  }

  if (draft.gbpGaps?.length || draft.suggestedTitle) {
    const mark = (s?: string) => (s === 'ok' ? '✓' : s === 'unverified' ? '?' : '✕');
    const gaps = (draft.gbpGaps || []).map((g: any) =>
      `<div style="margin-bottom:8px;"><div style="font-size:11px;font-weight:600;color:#0f172a;">${mark(g.status)} ${h(g.field)}</div><div style="font-size:10px;color:#94a3b8;">${h(g.whyItMatters || '')}</div><div style="font-size:11px;color:#374151;">${h(g.recommendation || '')}</div></div>`).join('');
    const chips = (arr: string[], bg: string, fg: string) => arr.map((s) => `<span style="display:inline-block;font-size:10px;padding:3px 7px;border-radius:4px;background:${bg};color:${fg};margin:0 4px 4px 0;">${h(s)}</span>`).join('');
    const services = chips(draft.suggestedServices || [], '#dcfce7', '#166534');
    const cats = chips(draft.suggestedCategories || [], '#f1f5f9', '#475569');
    const attrs = chips(draft.suggestedAttributes || [], '#dbeafe', '#1e40af');
    const descKw = chips(draft.descriptionKeywords || [], '#f1f5f9', '#475569');
    const platforms = (draft.platformGaps || []).map((p: any) => `<li style="font-size:11px;color:#64748b;"><b style="color:#0f172a;">${h(p.platform)}</b> — ${h(p.why || '')}</li>`).join('');
    parts.push(bar(sec(), 'GBP PROFILE GAP ANALYSIS') + card(
      `<p style="font-size:11px;color:#64748b;margin:0 0 10px;">Drafts for ${h(businessName)} only. We do not overwrite the live listing from this report.</p>
       ${gaps}
       ${descKw ? `<div style="margin-top:8px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">The 750-char description must embed</div>${descKw}</div>` : ''}
       ${attrs ? `<div style="margin-top:8px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${RANK_RED};margin-bottom:4px;">GBP attributes to set</div>${attrs}</div>` : ''}
       ${platforms ? `<div style="margin-top:8px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">List on these platforms too</div><ul style="margin:0;padding-left:16px;">${platforms}</ul></div>` : ''}
       ${draft.suggestedTitle ? `<div style="margin-top:10px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${RANK_RED};">Title is not carrying the keywords</div><div style="font-size:12px;font-weight:600;color:#0f172a;">${h(draft.suggestedTitle)}</div></div>` : ''}
       ${draft.suggestedDescription ? `<div style="margin-top:8px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${RANK_RED};">Description — first 150 characters must be the USP</div><div style="font-size:11px;color:#374151;line-height:1.6;">${h(draft.suggestedDescription)}</div></div>` : ''}
       ${services ? `<div style="margin-top:10px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${RANK_RED};margin-bottom:4px;">Services list is thinner than it should be</div>${services}</div>` : ''}
       ${cats ? `<div style="margin-top:8px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">Extra Google categories to add</div>${cats}</div>` : ''}`,
    ));
  }

  if (draft.marketOpportunities?.length) {
    const rows = draft.marketOpportunities.map((m: any) =>
      `<div style="padding:10px 0;border-top:1px solid #f1f5f9;"><div style="font-size:12px;font-weight:700;color:#0f172a;">${h(m.keyword)}</div><div style="margin:3px 0;">${pill(m.potential || 'HIGH POTENTIAL', POT_C[(m.potential || '').toUpperCase()] || '#2563eb')}</div><div style="font-size:11px;color:#64748b;">${h(m.rationale || '')}</div></div>`).join('');
    parts.push(bar(sec(), 'MARKET OPPORTUNITY GAPS') + card(rows));
  }

  if (draft.actionPhases?.length) {
    const phases = draft.actionPhases.map((p: any) => {
      const items = (p.items || []).map((it: any, i: number) =>
        `<div style="display:flex;gap:8px;margin-bottom:6px;"><span style="font-size:10px;font-weight:700;color:#06b34c;">${i + 1}.</span><div style="flex:1;"><div style="display:flex;justify-content:space-between;gap:6px;"><span style="font-size:11px;font-weight:600;color:#0f172a;">${h(it.title)}</span>${pill(it.priority || 'MEDIUM', PRI_C[(it.priority || '').toUpperCase()] || '#ca8a04')}</div><div style="font-size:11px;color:#64748b;">${h(it.detail || '')}</div></div></div>`).join('');
      return `<div style="margin-bottom:12px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${RANK_RED};margin-bottom:6px;">${h(p.label)} (${h(p.window)})</div>${items}</div>`;
    }).join('');
    parts.push(bar(sec(), 'PRIORITY ACTION PLAN — 30 / 60 / 90 DAYS') + card(phases));
  }

  if (draft.weeklyPostThemes?.length) {
    const cards = draft.weeklyPostThemes.map((t: any) =>
      `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:11px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;">${h(t.weekday)} · ${h(t.postType)}</div><div style="font-weight:600;color:#0f172a;margin-top:3px;">${h(t.theme)}</div><div style="color:#94a3b8;margin-top:2px;">Keyword: ${h(t.keyword)}</div></div>`).join('');
    parts.push(bar(sec(), "THIS WEEK'S GOOGLE POSTS") + card(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">${cards}</div>`));
  }

  if (draft.suggestedQas?.length) {
    const qas = draft.suggestedQas.map((qa: any) =>
      `<div style="padding:8px 0;border-top:1px solid #f1f5f9;"><div style="font-size:11px;font-weight:600;color:#0f172a;">${h(qa.q)}</div><div style="font-size:11px;color:#64748b;margin-top:2px;">${h(qa.a)}</div></div>`).join('');
    parts.push(bar(sec(), 'SUGGESTED GOOGLE Q&AS') + card(qas));
  }

  if (full && Array.isArray(draft.rankTimeline) && draft.rankTimeline.length) {
    const ms = draft.rankTimeline
      .map((m: any, i: number) => `<div style="border:1px solid ${i === 0 ? '#fde68a' : '#e2e8f0'};${i === 0 ? 'background:#fffbeb;' : ''}border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;">${h(m.label)}</div>
        <div style="font-size:16px;font-weight:800;color:${m.tone ? TONE_HEX[m.tone] || '#0f172a' : '#0f172a'};">${h(m.rank)}</div>
        <div style="font-size:9px;color:#94a3b8;margin-top:4px;">${h(m.note || '')}</div>
      </div>`)
      .join('');
    parts.push(bar(sec(), 'PROJECTED RANK IMPROVEMENT TIMELINE') + card(
      `<p style="font-size:11px;color:#64748b;margin:0 0 8px;">Targets for the work, not a promise of position. Google decides ranking.</p><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">${ms}</div>`,
    ));
  } else if (draft.whatWeAimFor) {
    const ms = [
      `<div style="border:1px solid #fde68a;background:#fffbeb;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;">Today</div><div style="font-size:20px;font-weight:800;color:${RANK_RED};">${h(draft.whatWeAimFor.todayRank)}</div><div style="font-size:9px;color:#94a3b8;">Live Maps position we measured</div></div>`,
      ...(draft.whatWeAimFor.milestones || []).map((m: any) =>
        `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;">${h(m.label)}</div><div style="font-size:9px;color:#64748b;margin-top:6px;">${h(m.text)}</div></div>`),
    ].join('');
    parts.push(bar(sec(), 'WHAT WE AIM FOR — NOT A GUARANTEED RANK') + card(
      `<p style="font-size:11px;color:#64748b;margin:0 0 8px;">Targets for the work, not a promise of position. Google decides ranking.</p><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">${ms}</div>`,
    ));
  }

  if (draft.dataRequired?.length) {
    const items = draft.dataRequired.map((d: string, i: number) =>
      `<li style="font-size:11px;color:#374151;margin-bottom:4px;list-style:none;"><span style="color:#94a3b8;font-family:monospace;">${String(i + 1).padStart(2, '0')}.</span> ${h(d)}</li>`).join('');
    parts.push(bar(sec(), 'DATA REQUIRED TO COMPLETE THIS AUDIT') + card(`<ul style="margin:0;padding:0;">${items}</ul>`));
  }

  return parts.join('\n');
}

// ── Main builder ───────────────────────────────────────────────────────────────

export function buildReportHtml(ctx: ReportContext): string {
  const { audit, businessRating } = ctx;
  const data = (audit.auditData ?? {}) as IAuditData & Record<string, unknown>;

  // ── Data extraction ──────────────────────────────────────────────────────────
  const overallScore: number = (audit as any).overallScore ?? data.profileScore?.overallScore ?? 0;
  const seoScore: number = data.seoScore?.score ?? 0;
  const completionView = formatProfileCompletionDisplay(data.profileCompletion);
  const completionPct: number = completionView.pct;
  const checklist: IChecklistItem[] = data.profileCompletion?.checklist ?? [];
  // Mirrors AuditReportGrexa: no reviews synced yet means auditService deleted
  // reviewAnalysis entirely rather than leaving hollow zeros, so its presence
  // (not just reviewCount) is the real "do we have review data" signal.
  const hasReviews: boolean = !!data.reviewAnalysis;
  const reviewCount: number = (audit as any).metadata?.reviewsActualCount ?? data.reviewAnalysis?.reviewCount ?? 0;
  const avgRating: number = businessRating ?? data.reviewAnalysis?.averageRating ?? 0;
  const reviewsPerWeek: number = data.reviewAnalysis?.reviewsPerWeek ?? 0;
  const industryAvg: number = data.reviewAnalysis?.industryAverage ?? 2;
  const responseRateStr: string = data.reviewAnalysis?.responseRate ?? '0%';
  const responseRatePct: number = parseInt(responseRateStr, 10) || 0;
  const reviewPeriodDays: number = (audit as any).reviewPeriodDays ?? (audit as any).metadata?.reviewPeriodDays ?? 14;
  const visibilityPct: number | undefined = data.geoGridRank?.visibilityPct;
  const thirtyDayPlan: any[] = (data as any).thirtyDayPlan ?? [];
  const ninetyDayPlan: any[] = (data as any).ninetyDayPlan ?? [];
  const actionPlanMeta: any = (data as any).actionPlan ?? {};
  const planDurationDays: number = actionPlanMeta.durationDays ?? (audit as any).actionPlanDurationDays ?? 30;
  const planLabel: string = actionPlanMeta.planLabel ?? `${planDurationDays}-Day Action Plan`;
  const extendedLabel: string = actionPlanMeta.extendedLabel ?? `Beyond ${planDurationDays} Days — Ongoing Roadmap`;
  const geoGridKeywords: IGeoGridKeyword[] = data.geoGridRank?.keywords?.length
    ? data.geoGridRank.keywords
    : ((data.googleSearchRank?.topKeywords ?? []).map((k) => ({
        keyword: k.keyword,
        avgRank: k.rank,
        points: [],
      })) as IGeoGridKeyword[]);
  const overallAvgRank: number | undefined =
    data.geoGridRank?.overallAvgRank
    ?? (data.googleSearchRank?.averageRank && data.googleSearchRank.averageRank > 0
      ? data.googleSearchRank.averageRank
      : undefined);
  const areaSqKm: number = data.geoGridRank?.areaSqKm ?? 9;
  const gridSpacingKm: number = data.geoGridRank?.gridSpacingKm ?? 1.5;
  const localPackComps = (
    (data.localPackCompetitors?.length
      ? data.localPackCompetitors
      : (data.competitors ?? []).map((c: any) => ({
          name: c.name,
          avgRank: c.avgRank ?? c.estimatedRank,
          rating: c.rating,
          reviewCount: c.reviewCount,
        }))
    ) ?? []
  ) as any[];
  const missingOpps: string[] = data.seoScore?.optimizationOpportunities ?? [];
  const missingKeywords: string[] = data.seoScore?.missingKeywords ?? [];
  const hasGeoGrid = geoGridKeywords.length > 0;
  const hasMapGrid = (data.geoGridRank?.keywords ?? []).some((k) => (k.points?.length ?? 0) > 0);

  // Missing SEO fields
  const missingFields: string[] = [];
  const opLower = missingOpps.map((o) => o.toLowerCase()).join(' ');
  if (opLower.includes('title')       || missingKeywords.length > 0) missingFields.push('Title');
  if (opLower.includes('categor')     || missingKeywords.length > 0) missingFields.push('Additional Category');
  if (opLower.includes('service')     || missingKeywords.length > 0) missingFields.push('Services');
  if (opLower.includes('description') || missingKeywords.length > 0) missingFields.push('Description');
  if (missingFields.length === 0 && missingOpps.length > 0) {
    missingFields.push(...missingOpps.slice(0, 4));
  }

  // Services / categories
  const servicesItem   = checklist.find((c) => c.field.toLowerCase().includes('service'));
  const categoriesItem = checklist.find((c) => c.field.toLowerCase().includes('categor'));
  const servicesOk     = servicesItem?.status === 'Complete';
  const categoriesOk   = !(categoriesItem?.status === 'Missing' || categoriesItem?.status === 'Unknown');
  const evidence: Record<string, any> = (data as any).evidence ?? {};
  const servicesCnt    = evidence.servicesCount    ?? null;
  const categoriesCnt  = evidence.categoriesCount  ?? null;

  // Suspension risk — shared with AuditReportGrexa via computeSuspensionRisk
  // so the two never disagree on Low/Medium/High for the same business.
  const { level: suspLevel, pct: suspPct } = computeSuspensionRisk(completionPct, reviewCount);
  const suspColor = suspLevel === 'Low' ? BRAND_GOOD : suspLevel === 'Medium' ? BRAND_MID : BRAND_BAD;

  // Rank + colors
  const rankM        = rankMeta(overallAvgRank);
  const profileColor = overallScore >= 80 ? BRAND_GOOD : overallScore >= 60 ? BRAND_MID : BRAND_BAD;
  const seoColor     = seoScore    >= 80 ? BRAND_GOOD : seoScore    >= 50 ? BRAND_MID : BRAND_BAD;
  const genDate      = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  // Checklist columns — never invent fake Complete/Missing rows
  const displayChecklist = checklist;
  const half   = Math.ceil(Math.max(displayChecklist.length, 1) / 2);
  const leftCL = displayChecklist.slice(0, half);
  const rightCL = displayChecklist.slice(half);

  // ── CSS ──────────────────────────────────────────────────────────────────────
  const css = `
    *, *::before, *::after {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0; padding: 0;
      background: #f8fafc;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px; color: #0f172a;
    }
    @page { size: A4 portrait; margin: 10mm 12mm; }
    table { width: 100%; border-collapse: collapse; }
    img   { max-width: 100%; display: block; }
    p, h1, h2, h3 { margin: 0; }
    /* Brand mark, bottom-right of every printed page (Chrome repeats
       position:fixed elements per page in print/PDF). */
    .gm-watermark {
      position: fixed; right: 6mm; bottom: 5mm;
      width: 15mm; height: 15mm; opacity: 0.5; z-index: 9999;
    }
    .gm-watermark img { width: 100%; height: 100%; object-fit: contain; }
  `;

  // ── 1. REPORT HEADER ─────────────────────────────────────────────────────────
  const headerHtml = `
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;margin-bottom:14px;break-inside:avoid;">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
    <div style="display:flex;align-items:center;gap:8px;">
      ${googleSvg(18)}
      <span style="font-size:13px;font-weight:600;color:#374151;">Google Search Rank Report for Your Business Profile</span>
    </div>
    <div style="background:linear-gradient(135deg,#62bd32,#06b34c);border-radius:6px;padding:4px 10px;">
      <span style="font-size:11px;font-weight:700;color:#fff;letter-spacing:0.5px;">GrowwMatics AI</span>
    </div>
  </div>
  <div style="padding:16px 20px;">
    <h1 style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:7px;line-height:1.2;">${h(audit.businessName)}</h1>
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:13px;color:#64748b;">
      ${avgRating > 0 ? `<div style="display:flex;align-items:center;gap:2px;">${starRow(avgRating)}</div>
      <span style="font-weight:700;color:#1e293b;">${avgRating.toFixed(1)}</span>
      ${reviewCount > 0 ? `<span style="color:#94a3b8;">(${reviewCount})</span>` : ''}` : ''}
      ${audit.address ? `${avgRating > 0 ? `<span style="color:#cbd5e1;">|</span>` : ''}
      <span style="color:#64748b;">${h(audit.address)}</span>` : ''}
    </div>
  </div>
</div>`;

  // ── 2. HERO CARDS ────────────────────────────────────────────────────────────
  const heroHtml = `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">

  <!-- Search Rank -->
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;break-inside:avoid;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
      ${googleSvg(18)}
      <span style="font-size:13px;font-weight:700;color:#374151;">Google Search Rank</span>
    </div>
    ${hasGeoGrid || (overallAvgRank != null && overallAvgRank > 0) ? `
    <div style="margin-bottom:5px;">
      <span style="font-size:68px;font-weight:900;line-height:1;letter-spacing:-2px;color:${rankM.color};">${rankM.display}</span>
    </div>
    <p style="font-size:11px;color:#64748b;line-height:1.6;margin-bottom:16px;">
      ${(overallAvgRank ?? 0) > 20
        ? 'Not appearing in Google&#39;s local pack for most tracked keywords'
        : `Overall average rank for the <strong style="color:#374151;">${geoGridKeywords.length} most searched keywords</strong> on Google for your business`}
      ${typeof visibilityPct === 'number' ? ` &middot; visible in <strong style="color:#374151;">${visibilityPct}%</strong> of nearby searches` : ''}
    </p>
    <div style="display:flex;gap:14px;">
      <div style="display:flex;align-items:center;gap:5px;">
        <div style="width:11px;height:11px;border-radius:50%;background:${BRAND_GOOD};flex-shrink:0;"></div>
        <span style="font-size:11px;color:#374151;">Top 5</span>
      </div>
      <div style="display:flex;align-items:center;gap:5px;">
        <div style="width:11px;height:11px;border-radius:50%;background:${BRAND_MID};flex-shrink:0;"></div>
        <span style="font-size:11px;color:#374151;">Under 10</span>
      </div>
      <div style="display:flex;align-items:center;gap:5px;">
        <div style="width:11px;height:11px;border-radius:50%;background:${BRAND_BAD};flex-shrink:0;"></div>
        <span style="font-size:11px;color:#374151;">20+</span>
      </div>
    </div>` : `
    <div style="font-size:13px;color:#94a3b8;padding:20px 0;text-align:center;">Ranking data unavailable</div>`}
  </div>

  <!-- Profile Score -->
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;break-inside:avoid;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
      ${googleSvg(18)}
      <span style="font-size:13px;font-weight:700;color:#374151;">Google Profile Score</span>
    </div>
    <div style="display:flex;align-items:center;gap:18px;">
      ${svgRing(overallScore, profileColor, 120)}
      <div>
        <p style="font-size:11px;color:#64748b;line-height:1.6;margin-bottom:10px;">
          Based on 25+ parameters — SEO, Reviews, Completion, Rating.
        </p>
        <p style="font-size:11px;font-weight:600;color:#374151;">
          Good businesses score more than 90%
        </p>
      </div>
    </div>
  </div>

</div>`;

  // ── 3. RANK ANALYTICS ────────────────────────────────────────────────────────
  const rankAnalyticsHtml = (hasGeoGrid || localPackComps.length > 0) ? `
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:14px;break-inside:avoid;">
  <h2 style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:16px;">Your Google Rank Analytics</h2>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">

    <!-- Keywords table -->
    <div style="padding-right:20px;border-right:1px solid #e2e8f0;">
      <p style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;">
        Your rank for top ${Math.max(geoGridKeywords.length, 1)} keywords
      </p>
      ${geoGridKeywords.length > 0 ? `
      <table>
        <thead>
          <tr style="border-bottom:2px solid #e2e8f0;">
            <th style="text-align:left;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;padding-bottom:8px;">KEYWORD</th>
            <th style="text-align:right;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;padding-bottom:8px;">AVG RANK</th>
          </tr>
        </thead>
        <tbody>
          ${geoGridKeywords.slice(0, 5).map((kw) => {
            const m = rankMeta(kw.avgRank);
            return `<tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:10px 12px 10px 0;font-size:12px;color:#2563eb;font-weight:500;">${h(kw.keyword)}</td>
            <td style="padding:10px 0;text-align:right;">
              <span style="font-size:13px;font-weight:800;color:${m.color};">${m.display}</span>
            </td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>` : `
      <div style="padding:16px;text-align:center;color:#94a3b8;font-size:12px;background:#f8fafc;border-radius:8px;">
        No keyword ranking data
      </div>`}
    </div>

    <!-- Competitors table -->
    <div style="padding-left:20px;">
      <p style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;">
        Competitors ranking higher at your locations
      </p>
      ${localPackComps.length > 0 ? `
      <table>
        <thead>
          <tr style="border-bottom:2px solid #e2e8f0;">
            <th style="text-align:left;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;padding-bottom:8px;">NAME</th>
            <th style="text-align:right;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;padding-bottom:8px;">AVG RANK</th>
          </tr>
        </thead>
        <tbody>
          ${localPackComps.slice(0, 5).map((c: any) => {
            const rank = c.avgRank != null ? Number(c.avgRank) : undefined;
            const m = rankMeta(rank);
            return `<tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:10px 12px 10px 0;">
              <div style="display:flex;align-items:center;gap:8px;">
                <div style="width:26px;height:26px;border-radius:6px;background:#f1f5f9;border:1px solid #e2e8f0;
                  display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  ${buildingIcon()}
                </div>
                <span style="font-size:12px;color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:155px;">${h(String(c.name ?? ''))}</span>
              </div>
            </td>
            <td style="padding:10px 0;text-align:right;">
              <span style="font-size:13px;font-weight:800;color:${m.color};">${m.display}</span>
            </td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>` : `
      <div style="padding:16px;text-align:center;color:#94a3b8;font-size:12px;background:#f8fafc;border-radius:8px;">
        No competitor data available
      </div>`}
    </div>

  </div>
</div>` : '';

  // ── 4. GEO-GRID MAPS (top 2 keywords only) ───────────────────────────────────
  let geoGridHtml = '';
  if (hasMapGrid) {
    const mapKws = (data.geoGridRank?.keywords ?? []).filter((k) => (k.points?.length ?? 0) > 0).slice(0, 2);
    const gridCards = mapKws.map((kw) => renderGeoGridMap(kw, ctx.mapsApiKey, gridSpacingKm));
    const rowContent = gridCards.length === 1
      ? `<div style="max-width:480px;">${gridCards[0]}</div>`
      : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">${gridCards.join('')}</div>`;
    geoGridHtml = `
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:14px;">
  <h2 style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:3px;">
    Your Google Search Rank at Nearby Locations
    <span style="font-size:12px;font-weight:400;color:#64748b;margin-left:6px;">(${areaSqKm} sq. km. area)</span>
  </h2>
  <p style="font-size:11px;color:#94a3b8;margin-bottom:14px;margin-top:3px;">Grid spacing: ${gridSpacingKm} km &nbsp;·&nbsp; Showing top ${mapKws.length} keywords</p>
  ${rowContent}
</div>`;
  }

  // ── 5. PROFILE SCORE BREAKDOWN ───────────────────────────────────────────────
  const profileBreakdownHtml = `
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:14px;">
  <h2 style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:16px;">Your Profile Score (${overallScore}%)</h2>

  <!-- Row 1: SEO Score + Services/Categories -->
  <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:12px;">

    <!-- SEO Score -->
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;break-inside:avoid;">
      <p style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:12px;">Profile SEO Score</p>
      <div style="display:flex;align-items:flex-start;gap:16px;">
        <div style="flex-shrink:0;">
          ${svgRing(seoScore, seoColor, 96)}
          <p style="font-size:10px;text-align:center;color:#94a3b8;margin-top:5px;">Should be above 80%</p>
        </div>
        <div style="flex:1;padding-top:4px;">
          <p style="font-size:12px;font-weight:600;color:#374151;margin-bottom:10px;">Top searched keywords are missing in</p>
          <ul style="list-style:none;margin:0;padding:0;">
            ${missingFields.length > 0
              ? missingFields.map((f) =>
                  `<li style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span style="width:6px;height:6px;border-radius:50%;background:${BRAND_BAD};flex-shrink:0;display:inline-block;"></span>
                <span style="font-size:12px;color:${BRAND_BAD};font-weight:500;">${h(f)}</span>
              </li>`
                ).join('')
              : `<li style="font-size:12px;color:${BRAND_GOOD};font-weight:500;">No major SEO gaps detected</li>`}
          </ul>
        </div>
      </div>
    </div>

    <!-- Services + Categories -->
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px;flex:1;break-inside:avoid;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
          <span style="font-size:13px;font-weight:600;color:#1e293b;">
            ${servicesCnt !== null ? `${servicesCnt} Services Added` : 'Services'}
          </span>
          ${statusBadge(servicesOk ? 'Good' : 'Poor')}
        </div>
        <p style="font-size:10px;color:#94a3b8;">Should add up to 20 services</p>
      </div>
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px;flex:1;break-inside:avoid;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
          <span style="font-size:13px;font-weight:600;color:#1e293b;">
            ${categoriesCnt !== null ? `${categoriesCnt} Categories Added` : 'Categories'}
          </span>
          ${statusBadge(categoriesOk ? 'Good' : 'Poor')}
        </div>
        <p style="font-size:10px;color:#94a3b8;">Should have 5+ categories</p>
      </div>
    </div>

  </div>

  <!-- Row 2: Reviews/Week | Response % | Suspension Risk — mirrors
       AuditReportGrexa's hasReviews branch: with no reviews synced yet, every
       metric here derives from reviewCount, so showing them would read as
       hollow zeros / a false "High risk" instead of a real finding. -->
  ${hasReviews ? `
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">

    <!-- Reviews Per Week -->
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;break-inside:avoid;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:12px;font-weight:600;color:#374151;">Reviews Per Week</span>
        ${statusBadge(reviewsPerWeek >= industryAvg ? 'Good' : 'Poor')}
      </div>
      <div style="margin-bottom:4px;">
        <span style="font-size:38px;font-weight:900;color:#0f172a;">${reviewsPerWeek.toFixed(2)}</span>
        <span style="font-size:14px;font-weight:600;color:#94a3b8;margin-left:3px;">/Week</span>
      </div>
      <p style="font-size:10px;color:#94a3b8;">Industry avg <strong style="color:#64748b;">${industryAvg}</strong>/week &middot; based on last ${reviewPeriodDays} days</p>
    </div>

    <!-- Response Percentage -->
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;break-inside:avoid;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:12px;font-weight:600;color:#374151;">Response Rate</span>
        ${statusBadge(responseRatePct >= 80 ? 'Good' : 'Poor')}
      </div>
      <div style="display:flex;justify-content:center;margin-bottom:6px;">
        ${svgRing(responseRatePct, responseRatePct >= 80 ? BRAND_GOOD : BRAND_BAD, 80)}
      </div>
      <p style="font-size:10px;color:#94a3b8;text-align:center;">Should reply to <strong style="color:#64748b;">80%</strong> of reviews</p>
    </div>

    <!-- Suspension Risk -->
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;break-inside:avoid;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:12px;font-weight:600;color:#374151;">Suspension Risk</span>
        ${statusBadge(suspLevel)}
      </div>
      <div style="display:flex;justify-content:center;margin-bottom:6px;">
        ${svgRing(suspPct, suspColor, 80)}
      </div>
      <p style="font-size:10px;color:#94a3b8;text-align:center;">0 Policy Violation</p>
    </div>
  </div>` : `
  <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;display:flex;align-items:center;gap:10px;break-inside:avoid;">
    <div style="width:8px;height:8px;border-radius:50%;background:${BRAND_MID};flex-shrink:0;"></div>
    <p style="font-size:12px;color:#64748b;margin:0;">
      Review-based metrics (reviews/week, response rate, suspension risk) will appear once
      reviews have synced from your newly-connected Google Business Profile.
    </p>
  </div>`}

  </div>
</div>`;

  // ── 6. PROFILE COMPLETION ─────────────────────────────────────────────────────
  const checklistHtml = `
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:14px;">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
    <h2 style="font-size:15px;font-weight:700;color:#0f172a;">Your Profile Completion (${completionPct}% ${completionView.badgeCaption})</h2>
    <div style="display:flex;align-items:center;gap:14px;font-size:11px;color:#374151;flex-wrap:wrap;">
      <span style="color:#94a3b8;font-weight:500;">${h(completionView.label)}</span>
      <div style="display:flex;align-items:center;gap:5px;">
        <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${BRAND_GOOD}"/><path d="M8 12l3 3 5-5" stroke="white" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>
        <span>Complete</span>
      </div>
      <div style="display:flex;align-items:center;gap:5px;">
        <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${BRAND_MID}"/><path d="M12 7v5M12 16h.01" stroke="white" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>
        <span>Partially Complete</span>
      </div>
      <div style="display:flex;align-items:center;gap:5px;">
        <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${BRAND_BAD}"/><path d="M15 9l-6 6M9 9l6 6" stroke="white" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>
        <span>Incomplete</span>
      </div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid #f1f5f9;">
    <div style="padding-right:20px;border-right:1px solid #f1f5f9;">
      ${leftCL.map((item) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #f1f5f9;">
        <span style="font-size:12px;color:#374151;">${h(item.field)}</span>
        ${checkIcon(item.status)}
      </div>`).join('')}
    </div>
    <div style="padding-left:20px;">
      ${rightCL.map((item) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #f1f5f9;">
        <span style="font-size:12px;color:#374151;">${h(item.field)}</span>
        ${checkIcon(item.status)}
      </div>`).join('')}
    </div>
  </div>
</div>`;

  // ── 7. ACTION PLAN ────────────────────────────────────────────────────────────
  let actionPlanHtml = '';
  if (thirtyDayPlan.length > 0 || ninetyDayPlan.length > 0) {
    const periodsHtml = thirtyDayPlan.map((period: any, i: number) => `
    <div style="padding:14px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:12px;break-inside:avoid;">
      <h3 style="font-size:12px;font-weight:700;color:#0a8a3e;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">
        ${h(period.week || period.month || `Period ${i + 1}`)}
      </h3>
      <ul style="list-style:none;margin:0;padding:0;">
        ${(period.tasks || []).map((t: string) => `
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#374151;margin-bottom:5px;">
          <span style="width:5px;height:5px;border-radius:50%;background:${BRAND_MID};margin-top:5px;flex-shrink:0;display:inline-block;"></span>
          <span>${h(t)}</span>
        </li>`).join('')}
      </ul>
      ${period.expectedOutcome ? `<p style="font-size:11px;color:#94a3b8;margin-top:8px;">Expected outcome: ${h(period.expectedOutcome)}</p>` : ''}
    </div>`).join('');

    const ninetyHtml = ninetyDayPlan.length > 0 ? `
    <div style="padding-top:14px;border-top:1px solid #e2e8f0;">
      <h3 style="font-size:12px;font-weight:700;color:#0a8a3e;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px;">${h(extendedLabel)}</h3>
      ${ninetyDayPlan.map((phase: any) => `
      <div style="margin-bottom:10px;break-inside:avoid;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
          ${(phase.focusAreas || []).map((fa: string) =>
            `<span style="font-size:9px;font-weight:700;padding:2px 8px;background:${BRAND_MID};color:#fff;border-radius:4px;text-transform:uppercase;letter-spacing:0.5px;">${h(fa)}</span>`
          ).join('')}
        </div>
        <ul style="list-style:none;margin:0;padding:0;">
          ${(phase.tasks || []).map((t: string) => `
          <li style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#374151;margin-bottom:5px;">
            <span style="width:5px;height:5px;border-radius:50%;background:${BRAND_MID};margin-top:5px;flex-shrink:0;display:inline-block;"></span>
            <span>${h(t)}</span>
          </li>`).join('')}
        </ul>
      </div>`).join('')}
    </div>` : '';

    actionPlanHtml = `
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:14px;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
    <h2 style="font-size:15px;font-weight:700;color:#0f172a;">${h(planLabel)}</h2>
    <span style="font-size:10px;font-weight:700;padding:4px 10px;background:${BRAND_MID};color:#fff;border-radius:20px;text-transform:uppercase;letter-spacing:0.6px;">${planDurationDays}-Day Plan</span>
  </div>
  ${periodsHtml}
  ${ninetyHtml}
</div>`;
  }

  // ── Consultant sections (Key Finding → Data Required) ────────────────────────
  // Mirrors ConsultantSections.tsx on the web report. Rendered only when the
  // SEO-plan draft is present on the audit.
  const consultantHtml = renderConsultantSections(
    data.seoPlanDraft,
    data.keywordTable ?? [],
    audit.businessName,
    (audit as any).location?.split(',')[0]?.trim() || '',
  );
  const isFullAudit = (data.seoPlanDraft as any)?.depth === 'full';
  const confidentialFooter = isFullAudit
    ? `<div style="margin-top:14px;padding:14px 18px;background:#1e293b;color:#94a3b8;border-radius:12px;font-size:10px;line-height:1.6;">
        GrowwMatics AI · Powered by Desun Technology Pvt Ltd<br/>
        GBP Full Audit Report — ${h(audit.businessName)} · ${genDate}<br/>
        Confidential — prepared exclusively for the client named above.
      </div>`
    : '';

  // ── 8. CTA BANNER ─────────────────────────────────────────────────────────────
  const ctaHtml = `
<div style="border-radius:16px;overflow:hidden;background:linear-gradient(135deg,#62bd32 0%,#06b34c 100%);break-inside:avoid;">
  <div style="padding:26px 30px;display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;">
    <div>
      <h3 style="font-size:20px;font-weight:900;color:#fff;margin-bottom:5px;line-height:1.3;">
        Would you like to <span style="color:#fde047;">be on top in</span> Google local searches?
      </h3>
      <p style="font-size:12px;color:rgba(199,210,254,0.9);">Our AI platform optimizes your Google Business Profile automatically.</p>
    </div>
    <div style="background:#fbbf24;border-radius:10px;padding:12px 24px;font-weight:800;font-size:13px;color:#1e293b;flex-shrink:0;">
      Get in touch
    </div>
  </div>
  <div style="padding:8px 30px;background:rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:space-between;">
    <span style="font-size:10px;color:rgba(255,255,255,0.6);">GrowwMatics AI · AI-Powered Google Business Growth Platform</span>
    <span style="font-size:10px;color:rgba(255,255,255,0.4);">Report Generated ${genDate}</span>
  </div>
</div>`;

  // ── Final document ─────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>GrowwMatics AI Report – ${h(audit.businessName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"/>
<style>${css}</style>
</head>
<body>
${getBrandLogoDataUri() ? `<div class="gm-watermark"><img src="${getBrandLogoDataUri()}" alt="GrowwMatics"/></div>` : ''}
${headerHtml}
${heroHtml}
${rankAnalyticsHtml}
${geoGridHtml}
${profileBreakdownHtml}
${checklistHtml}
${consultantHtml}
${actionPlanHtml}
${ctaHtml}
${confidentialFooter}
</body>
</html>`;
}

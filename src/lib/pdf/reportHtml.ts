import type {
  IAudit, IAuditData, IChecklistItem, IGeoGridKeyword,
} from '@/models/Audit';
import { formatRank, rankBucket, resolveRankHeadline, resolveSuspensionRisk } from '@/services/audit/reportMath';
import { getBrandLogoDataUri } from '@/lib/brandAsset';
import { contentActivityLines } from '@/services/lifecycle/monthly';
import { formatProfileCompletionDisplay } from '@/lib/profileCompletion';
import { GROWWMATICS_CAPABILITIES } from '@/services/audit/findings';
import {
  ACTIONABILITY_LABEL,
  LEGACY_REPORT_NOTICE,
  RANK_BAND_HEX,
  RANK_LEGEND,
  buildRankMapUrl,
  completionBreakdown,
  completionSentence,
  isLegacyAudit,
  rankBand,
  rankLabel,
  rankingStatRows,
  reviewDisplay,
  suspensionDisplay,
  toRankValue,
  type RankValue,
} from '@/services/audit/reportDisplay';

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
  if (status === 'Unknown')
    return `<svg width="20" height="20" viewBox="0 0 24 24" style="flex-shrink:0;">
      <circle cx="12" cy="12" r="10" fill="#79747E"/>
      <text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="700" fill="white">?</text>
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

/** One point per searched location — never padded to a 3×3 grid. */
function pointValue(p: { rank: number | null; found?: boolean; status?: string }): RankValue {
  return p.found === undefined && p.status === undefined
    ? toRankValue(p.rank)
    : toRankValue({ found: p.found ?? p.rank != null, rank: p.rank, status: p.status });
}

function renderGeoGridMap(kw: IGeoGridKeyword, mapsApiKey?: string, gridSpacingKm = 1.5, center?: { lat: number; lng: number }): string {
  const pts = [...kw.points].sort((a, b) => b.lat - a.lat || a.lng - b.lng);
  const avg: RankValue = kw.avgRank != null ? toRankValue(kw.avgRank) : { state: 'not_found', rank: null };
  const zoom = gridSpacingKm <= 1 ? 14 : gridSpacingKm <= 2 ? 13 : 12;
  const mapUrl = mapsApiKey
    ? buildRankMapUrl({ points: pts, center: center ?? null, apiKey: mapsApiKey, size: '580x320', zoom: center ? zoom : undefined })
    : '';
  const chips = pts.map((p) => {
    const v = pointValue(p);
    return `<span style="display:inline-block;min-width:30px;padding:3px 6px;margin:0 4px 4px 0;border-radius:12px;background:${RANK_BAND_HEX[rankBand(v)]};color:#fff;font-size:10px;font-weight:800;text-align:center;">${h(v.state === 'found' ? String(v.rank) : v.state === 'not_found' ? 'NF' : 'N/A')}</span>`;
  }).join('');
  const legend = [{ hex: '#1d4ed8', label: 'You' }, ...RANK_LEGEND].map(({ hex, label }) =>
    `<div style="display:flex;align-items:center;gap:4px;"><div style="width:10px;height:10px;border-radius:50%;background:${hex};flex-shrink:0;"></div><span style="font-size:10px;color:#64748b;font-weight:600;">${h(label)}</span></div>`,
  ).join('');

  return `<div style="border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;break-inside:avoid;display:flex;flex-direction:column;">
  <div style="padding:12px 16px;background:linear-gradient(to right,#f8fafc,#fff);border-bottom:1px solid #e2e8f0;">
    <p style="margin:0 0 2px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.7px;">Keyword</p>
    <p style="margin:0;font-size:13px;font-weight:700;color:#2563eb;line-height:1.3;">${h(kw.keyword)}</p>
    <div style="display:flex;align-items:baseline;gap:5px;margin-top:5px;">
      <span style="font-size:11px;color:#64748b;">Avg observed rank</span>
      <span style="font-size:20px;font-weight:900;color:${RANK_BAND_HEX[rankBand(avg)]};">${h(rankLabel(avg))}</span>
    </div>
  </div>
  ${mapUrl ? `<img src="${mapUrl}" style="width:100%;display:block;" alt="map"/>` : ''}
  <div style="padding:8px 14px;border-top:1px solid #e2e8f0;"><div style="font-size:9px;color:#94a3b8;margin-bottom:4px;">Rank at each of the ${pts.length} point${pts.length === 1 ? '' : 's'} searched (NF = not found in the top 20)</div>${chips}</div>
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

const fmtR = (r?: number | null) => (r == null ? 'Not found' : rankLabel(toRankValue(r)));
const kwRankValue = (k: any): RankValue =>
  k.found !== undefined || k.rankStatus !== undefined
    ? toRankValue({ found: k.found, rank: k.rank ?? k.mapsRank ?? null, status: k.rankStatus })
    : toRankValue(k.mapsRank ?? null);
const bar = (n: number, title: string) =>
  `<div style="background:${NAVY};color:#fff;border-radius:10px;padding:12px 16px;font-weight:700;font-size:13px;margin:18px 0 10px;">${n}. ${h(title)}</div>`;
const card = (inner: string) =>
  `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;break-inside:avoid;margin-bottom:12px;">${inner}</div>`;
const pill = (t: string, c: string) =>
  `<span style="background:${c};color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;text-transform:uppercase;white-space:nowrap;">${h(t)}</span>`;

const TONE_HEX: Record<string, string> = { good: '#16a34a', warn: '#ca8a04', bad: '#dc2626' };

function renderConsultantSections(
  draft: any,
  keywordTable: any[],
  businessName: string,
  city: string,
): string {
  if (!draft) return '';
  const full = draft.depth === 'full';
  // Older drafts (no `grounded` marker) may hold AI-invented services,
  // attributes, Q&A answers and opportunity labels — never rendered.
  const grounded = !!draft.grounded;
  const showSearchVol = keywordTable.some((k) => k.searchVolume != null);
  const parts: string[] = [];
  let sn = 0;
  const sec = () => ++sn;
  const showMapsVol = keywordTable.some((k) => k.mapsVolume != null);
  // Sections are never dropped on a grounded report — an empty one says why.
  const status = (t: string) => `<p style="font-size:11px;color:#64748b;margin:0;">ⓘ ${h(t)}</p>`;
  const rankMeasured = keywordTable.some((k) => (k.rankStatus ?? 'ok') === 'ok');
  const proposed = (draft.proposedKeywords || []).length
    ? `<div style="margin-top:10px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#475569;margin-bottom:4px;">More phrases to track — proposed, not measured</div>${(draft.proposedKeywords || []).map((r: any) => `<span style="display:inline-block;font-size:10px;padding:3px 7px;border-radius:10px;border:1px dashed #94a3b8;color:#475569;margin:0 4px 4px 0;">${h(r.keyword)}</span>`).join('')}</div>`
    : '';
  const rankFailed = !rankMeasured && keywordTable.some((k) => k.rankStatus === 'unavailable');

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

  if (draft.keyFinding || grounded) {
    parts.push(card(
      `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#06b34c;margin-bottom:6px;">Key Finding</div>
       ${draft.keyFinding ? `<p style="font-size:12px;color:#374151;line-height:1.6;margin:0;">${h(draft.keyFinding)}</p>` : status('No summary could be written from verified facts for this report. The measured results below still apply.')}`,
    ));
  }

  const ws = draft.websiteSummary;
  if (ws?.status === 'none') {
    parts.push(card(
      `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#06b34c;margin-bottom:6px;">Your Website</div>${status('No website was available for analysis. The rest of this report uses your public Google listing, rankings and reviews.')}`,
    ));
  } else if (ws || (full && draft.websiteAssessment)) {
    const host = ws ? String(ws.url || '').replace(/^https?:\/\//, '') : '';
    const wsBody = !ws ? ''
      : ws.status === 'failed'
        ? status(`Your website (${host}) did not respond when we checked, so nothing from it is used in this report.`)
        : `<p style="font-size:10px;color:#64748b;margin:0 0 6px;">What your website says (${h(host)}) — taken from your pages, not verified on Google.</p>${
            (ws.services || []).length
              ? (ws.services || []).map((s: string) => `<span style="display:inline-block;font-size:10px;padding:3px 7px;border-radius:10px;background:#f1f5f9;color:#0f172a;margin:0 4px 4px 0;">${h(s)}</span>`).join('')
              : status('No clear list of services was found on the pages we read.')}`;
    parts.push(card(
      `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#06b34c;margin-bottom:6px;">Your Website</div>
       ${wsBody}
       ${full && draft.websiteAssessment ? `<p style="font-size:12px;color:#374151;line-height:1.6;margin:6px 0 0;">${h(draft.websiteAssessment)}</p>` : ''}`,
    ));
  }

  if (grounded && draft.criticalGap && !draft.criticalGap.rows?.length) {
    parts.push(
      `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:18px;break-inside:avoid;margin-bottom:12px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#92400e;margin-bottom:6px;">Critical Gap — Searches That Are Not Showing You</div>
        ${status(rankMeasured
          ? 'You were in the top 5 for every search we measured.'
          : rankFailed
            ? 'The ranking check could not be completed for this report, so no search gap can be shown. This is a data problem on our side, not a finding about your business.'
            : 'Google Maps ranking was not measured for this report, so no search gap can be shown — see Data Required below.')}
      </div>`,
    );
  }
  if (draft.criticalGap?.rows?.length) {
    const rows = draft.criticalGap.rows
      .map((r: any) => `<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px;border-top:1px solid #fde68a;"><span>${h(r.keyword)}</span><span style="color:${RANK_RED};font-weight:700;">${h(fmtR(r.mapsRank))}</span></div>`)
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

  if (grounded && !keywordTable.length) {
    parts.push(bar(sec(), 'KEYWORD SEARCH VOLUME ANALYSIS — GOOGLE MAPS') + card(
      status('Google Maps ranking and search demand were not measured for this report — see Data Required below for what is needed.') + proposed,
    ));
  }
  if (keywordTable.length) {
    const volCols = (showMapsVol || showSearchVol) ? `<th style="padding:4px 6px;text-align:right;">Search/mo</th>` : '';
    const rows = keywordTable
      .map((k) => {
        const v = kwRankValue(k);
        const measured = !!k.volumeBand && k.demandStatus !== 'unavailable';
        const demand = measured
          ? `<span style="display:inline-block;width:56px;height:5px;border-radius:3px;background:#e2e8f0;vertical-align:middle;overflow:hidden;"><span style="display:block;height:100%;width:${BAND_W[k.volumeBand] || '18%'};background:${BAND_C[k.volumeBand] || '#a78bfa'};"></span></span> <span style="font-size:10px;font-weight:700;color:${BAND_C[k.volumeBand] || '#a78bfa'};">${h(k.volumeBand)}${k.demandStatus === undefined && k.estimated ? '*' : ''}</span>`
          : `<span style="font-size:10px;color:#94a3b8;">Not available</span>`;
        return `<tr style="border-top:1px solid #f1f5f9;">
        <td style="padding:7px 6px;font-size:11px;color:#374151;">${h(k.keyword)}${k.source === 'website_service' ? '<div style="font-size:8px;color:#94a3b8;">from your website</div>' : k.source === 'owner' ? '<div style="font-size:8px;color:#94a3b8;">your service</div>' : ''}</td>
        ${(showMapsVol || showSearchVol) ? `<td style="padding:7px 6px;text-align:right;font-size:10px;color:#64748b;">${k.searchVolume != null ? h(k.searchVolume.toLocaleString('en-IN')) : 'Not available'}</td>` : ''}
        <td style="padding:7px 6px;">${demand}</td>
        <td style="padding:7px 6px;text-align:right;font-weight:700;font-size:11px;color:${RANK_BAND_HEX[rankBand(v)]};">${h(rankLabel(v))}</td>
      </tr>`;
      })
      .join('');
    const insights = (draft.keywordInsights || []).map((l: string) => `<li style="font-size:11px;color:#64748b;">${h(l)}</li>`).join('');
    parts.push(bar(sec(), 'KEYWORD SEARCH VOLUME ANALYSIS — GOOGLE MAPS') + card(
      `<p style="font-size:11px;color:#64748b;margin:0 0 8px;">Phrases people type around ${h(city || 'your area')}. Rank is live Google Maps data measured from your area; demand is Google Ads monthly search volume for the whole country (Google does not report volume for a single town, so local phrases usually show "Not available"). Neither is ever guessed. <span>Not available = Google Ads returned no volume${keywordTable.some((k) => k.demandStatus === undefined && k.estimated) ? ' · * = estimate (older report)' : ''}</span></p>
       <table style="width:100%;border-collapse:collapse;"><thead><tr style="text-align:left;font-size:9px;color:#94a3b8;text-transform:uppercase;"><th style="padding:4px 6px;">Keyword</th>${volCols}<th style="padding:4px 6px;">Demand</th><th style="padding:4px 6px;text-align:right;">Maps Rank</th></tr></thead><tbody>${rows}</tbody></table>
       ${insights ? `<ul style="margin:10px 0 0;padding-left:16px;">${insights}</ul>` : ''}${proposed}`,
    ));
  }

  if (grounded && !draft.competitorLandscape?.length) {
    parts.push(bar(sec(), 'COMPETITOR LANDSCAPE') + card(status(rankMeasured
      ? 'No other business was shown above you in the searches we ran.'
      : rankFailed
        ? 'Competitors come from the Google Maps searches, which could not be completed for this report.'
        : 'Competitors come from the Google Maps searches, which were not measured for this report.')));
  }
  if (draft.competitorLandscape?.length) {
    const rows = draft.competitorLandscape
      .map((c: any) => `<tr style="border-top:1px solid #f1f5f9;vertical-align:top;">
        <td style="padding:7px 6px;font-size:11px;font-weight:600;color:#0f172a;">${h(c.name)}${c.tierLabel ? `<div style="font-size:8px;color:${c.relevance === 'strong' ? '#dc2626' : '#94a3b8'};">${h(c.tierLabel)}</div>` : ''}</td>
        <td style="padding:7px 6px;font-size:11px;font-weight:700;color:#06b34c;white-space:nowrap;">${c.mapsRank != null ? h(fmtR(c.mapsRank)) : '—'}</td>
        <td style="padding:7px 6px;font-size:11px;color:#64748b;white-space:nowrap;">${c.rating != null ? h(`${c.rating}★`) : '—'}${c.reviewCount != null ? h(` · ${c.reviewCount}`) : ''}</td>
        <td style="padding:7px 6px;font-size:11px;color:#64748b;">${h(c.keyEdge || '')}</td>
      </tr>`)
      .join('');
    parts.push(bar(sec(), 'COMPETITOR LANDSCAPE') + card(
      `<table style="width:100%;border-collapse:collapse;"><thead><tr style="text-align:left;font-size:9px;color:#94a3b8;text-transform:uppercase;"><th style="padding:4px 6px;">Competitor</th><th style="padding:4px 6px;">Maps Rank</th><th style="padding:4px 6px;">Reviews</th><th style="padding:4px 6px;">Key Edge</th></tr></thead><tbody>${rows}</tbody></table>
       ${(draft.competitorInsights || []).length ? `<div style="margin-top:10px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#0f172a;margin-bottom:6px;">What the businesses above you do differently</div>${(draft.competitorInsights || []).map((ins: any) => `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:8px;margin-bottom:6px;font-size:11px;break-inside:avoid;"><div><b>Fact:</b> ${h(ins.fact)}</div><div style="color:#64748b;"><b style="color:#0f172a;">What it means:</b> ${h(ins.meaning)}</div><div style="color:#64748b;"><b style="color:#0f172a;">Recommended:</b> ${h(ins.recommendation)}</div><div style="font-size:9px;color:#94a3b8;">Source: ${h(ins.basis)}</div></div>`).join('')}</div>` : ''}
       ${draft.competitorCounterPosition ? `<p style="font-size:11px;color:#64748b;margin:10px 0 0;line-height:1.6;">${h(draft.competitorCounterPosition)}</p>` : ''}`,
    ));
  }

  const gbpFailed = (draft.failed || []).includes('gbpDrafts');
  if (draft.gbpGaps?.length || draft.suggestedTitle || gbpFailed) {
    const mark = (s?: string) => (s === 'ok' ? '✓' : s === 'unverified' ? '?' : '✕');
    const gaps = (gbpFailed ? `<div style="margin-bottom:8px;">${status('Additional AI analysis is temporarily unavailable. The measured results in this report are unaffected.')}</div>` : '') + (draft.gbpGaps || []).map((g: any) =>
      `<div style="margin-bottom:8px;"><div style="font-size:11px;font-weight:600;color:#0f172a;">${mark(g.status)} ${h(g.field)}</div><div style="font-size:10px;color:#94a3b8;">${h(g.whyItMatters || '')}</div><div style="font-size:11px;color:#374151;">${h(g.recommendation || '')}</div></div>`).join('');
    const chips = (arr: string[], bg: string, fg: string) => arr.map((s) => `<span style="display:inline-block;font-size:10px;padding:3px 7px;border-radius:4px;background:${bg};color:${fg};margin:0 4px 4px 0;">${h(s)}</span>`).join('');
    const services = grounded ? chips(draft.suggestedServices || [], '#dcfce7', '#166534') : '';
    const cats = chips(draft.suggestedCategories || [], '#f1f5f9', '#475569');
    const attrs = grounded ? chips(draft.suggestedAttributes || [], '#dbeafe', '#1e40af') : '';
    const descKw = chips(draft.descriptionKeywords || [], '#f1f5f9', '#475569');
    const platforms = (draft.platformGaps || []).map((p: any) => `<li style="font-size:11px;color:#64748b;"><b style="color:#0f172a;">${h(p.platform)}</b> — ${h(p.why || '')}</li>`).join('');
    parts.push(bar(sec(), 'GBP PROFILE GAP ANALYSIS') + card(
      `<p style="font-size:11px;color:#64748b;margin:0 0 10px;">Drafts for ${h(businessName)} only — nothing is changed on your listing from this report. Once connected, GrowwMatics can apply the title and description drafts; categories, services, hours and attributes are changed by you in Google.</p>
       ${gaps}
       ${descKw ? `<div style="margin-top:8px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">The 750-char description must embed</div>${descKw}</div>` : ''}
       ${attrs ? `<div style="margin-top:8px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${RANK_RED};margin-bottom:4px;">GBP attributes to set</div>${attrs}</div>` : ''}
       ${platforms ? `<div style="margin-top:8px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">List on these platforms too</div><ul style="margin:0;padding-left:16px;">${platforms}</ul></div>` : ''}
       ${draft.suggestedTitle ? `<div style="margin-top:10px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${RANK_RED};">Suggested title — your real business name without the flagged words</div><div style="font-size:12px;font-weight:600;color:#0f172a;">${h(draft.suggestedTitle)}</div></div>` : ''}
       ${draft.suggestedDescription ? `<div style="margin-top:8px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${RANK_RED};">Description — first 150 characters must be the USP</div><div style="font-size:11px;color:#374151;line-height:1.6;">${h(draft.suggestedDescription)}</div></div>` : ''}
       ${services ? `<div style="margin-top:10px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${RANK_RED};margin-bottom:4px;">Services we found on your listing, website or intake — add them in Google</div>${services}</div>` : ''}
       ${cats ? `<div style="margin-top:8px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">Extra Google categories to consider — only if they match services you offer</div>${cats}</div>` : ''}`,
    ));
  }

  if (grounded && !draft.marketOpportunities?.length) {
    parts.push(bar(sec(), 'MARKET OPPORTUNITY GAPS') + card(status('No searched phrase had both measured demand and a rank gap, so no opportunity is labelled. Labels are only given from measured data.')));
  }
  if (grounded && draft.marketOpportunities?.length) {
    const rows = draft.marketOpportunities.map((m: any) =>
      `<div style="padding:10px 0;border-top:1px solid #f1f5f9;"><div style="font-size:12px;font-weight:700;color:#0f172a;">${h(m.keyword)}</div><div style="margin:3px 0;">${pill(m.potential || 'HIGH POTENTIAL', POT_C[(m.potential || '').toUpperCase()] || '#2563eb')}</div><div style="font-size:11px;color:#64748b;">${h(m.rationale || '')}</div></div>`).join('');
    parts.push(bar(sec(), 'MARKET OPPORTUNITY GAPS') + card(rows));
  }

  if (grounded && !draft.actionPhases?.length) {
    parts.push(bar(sec(), 'PRIORITY ACTION PLAN — 30 / 60 / 90 DAYS') + card(status('The plan could not be built from verified facts for this report.')));
  }
  if (draft.actionPhases?.length) {
    const phases = draft.actionPhases.map((p: any) => {
      const items = (p.items || []).map((it: any, i: number) =>
        `<div style="display:flex;gap:8px;margin-bottom:6px;"><span style="font-size:10px;font-weight:700;color:#06b34c;">${i + 1}.</span><div style="flex:1;"><div style="display:flex;justify-content:space-between;gap:6px;"><span style="font-size:11px;font-weight:600;color:#0f172a;">${h(it.title)}</span>${pill(it.priority || 'MEDIUM', PRI_C[(it.priority || '').toUpperCase()] || '#ca8a04')}</div><div style="font-size:11px;color:#64748b;">${h(it.detail || '')}</div></div></div>`).join('');
      return `<div style="margin-bottom:12px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${RANK_RED};margin-bottom:6px;">${h(p.label)} (${h(p.window)})</div>${items}</div>`;
    }).join('');
    parts.push(bar(sec(), 'PRIORITY ACTION PLAN — 30 / 60 / 90 DAYS') + card(phases));
  }

  if (grounded && !draft.weeklyPostThemes?.length) {
    parts.push(bar(sec(), "THIS WEEK'S GOOGLE POSTS") + card(status('No post ideas could be written from verified services. Tell us your services (Data Required) and posts will be built from them.')));
  }
  if (draft.weeklyPostThemes?.length) {
    const cards = draft.weeklyPostThemes.map((t: any) =>
      `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:11px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;">${h(t.weekday)} · ${h(t.postType)}</div><div style="font-weight:600;color:#0f172a;margin-top:3px;">${h(t.theme)}</div><div style="color:#94a3b8;margin-top:2px;">Keyword: ${h(t.keyword)}</div></div>`).join('');
    parts.push(bar(sec(), "THIS WEEK'S GOOGLE POSTS") + card(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">${cards}</div>`));
  }

  if (grounded && !draft.suggestedQas?.length) {
    parts.push(bar(sec(), 'SUGGESTED GOOGLE Q&AS') + card(status('No customer questions could be answered from verified facts yet — they need your confirmed services and details.')));
  }
  if (grounded && draft.suggestedQas?.length) {
    const qas = draft.suggestedQas.map((qa: any) =>
      `<div style="padding:8px 0;border-top:1px solid #f1f5f9;"><div style="font-size:11px;font-weight:600;color:#0f172a;">${h(qa.q)}</div><div style="font-size:11px;color:#64748b;margin-top:2px;">${h(qa.a)}</div></div>`).join('');
    parts.push(bar(sec(), 'SUGGESTED GOOGLE Q&AS') + card(`<p style="font-size:11px;color:#64748b;margin:0 0 6px;">For you to add yourself — GrowwMatics does not post Q&amp;As. Answers marked [Owner to confirm] need your facts before use.</p>${qas}`));
  }

  // Projected improvement timeline — grounded drafts only (measured today +
  // work milestones). Older drafts carried fixed rank bands → "What we aim for".
  if (grounded && draft.rankTimeline?.length) {
    const ms = draft.rankTimeline.map((m: any, i: number) =>
      `<div style="border:1px solid ${i === 0 ? '#fde68a' : '#e2e8f0'};${i === 0 ? 'background:#fffbeb;' : ''}border-radius:10px;padding:12px;text-align:center;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;">${h(m.label)}</div><div style="font-size:16px;font-weight:800;color:${m.tone ? TONE_HEX[m.tone] || '#0f172a' : '#0f172a'};">${h(i === 0 && m.rank === '20+' ? 'Not found' : m.rank)}</div><div style="font-size:9px;color:#64748b;margin-top:4px;">${h(m.note)}</div></div>`).join('');
    parts.push(bar(sec(), 'PROJECTED IMPROVEMENT TIMELINE') + card(
      `<p style="font-size:11px;color:#64748b;margin:0 0 8px;">Work milestones, not a promised position — Google decides ranking. Each stage is re-measured on the same searches.</p><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">${ms}</div>`,
    ));
  } else if (draft.whatWeAimFor) {
    const ms = [
      `<div style="border:1px solid #fde68a;background:#fffbeb;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;">Today</div><div style="font-size:20px;font-weight:800;color:${RANK_RED};">${h(draft.whatWeAimFor.todayRank === '20+' ? 'Not found' : draft.whatWeAimFor.todayRank)}</div><div style="font-size:9px;color:#94a3b8;">Live Maps position we measured</div></div>`,
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
  const facts: any = (data as any).facts;
  const legacy = isLegacyAudit(data);
  // null = none of the weighted SEO items could be checked → "Not measured".
  const seoMeasured = typeof data.seoScore?.score === 'number';
  const seoScore: number = seoMeasured ? (data.seoScore!.score as number) : 0;
  const seoCoverage: string | null = (data.seoScore as any)?.checkedItems != null
    ? `Based on ${(data.seoScore as any).checkedItems} of ${(data.seoScore as any).totalItems} checks we could run`
    : null;
  const completionView = formatProfileCompletionDisplay(data.profileCompletion);
  const completionPct: number = completionView.pct;
  const checklist: IChecklistItem[] = data.profileCompletion?.checklist ?? [];
  // Mirrors AuditReportGrexa: no reviews synced yet means auditService deleted
  // reviewAnalysis entirely rather than leaving hollow zeros, so its presence
  // (not just reviewCount) is the real "do we have review data" signal.
  const hasReviews: boolean = !!data.reviewAnalysis;
  // Lifetime Google total. `metadata.reviewsActualCount` is only the synced
  // analysis window (e.g. last 14 days) and must never be shown as the total.
  const reviewCount: number = facts
    ? (data.reviewAnalysis?.reviewCount ?? 0)
    : ((audit as any).metadata?.reviewsActualCount ?? data.reviewAnalysis?.reviewCount ?? 0);
  const lifetimeKnown: boolean = facts ? typeof data.reviewAnalysis?.reviewCount === 'number' : reviewCount > 0;
  // The audit's own lifetime rating (facts) wins over the caller-supplied one.
  const avgRating: number = (facts ? data.reviewAnalysis?.averageRating : undefined) ?? businessRating ?? data.reviewAnalysis?.averageRating ?? 0;
  const reviewsPerWeek: number = data.reviewAnalysis?.reviewsPerWeek ?? 0;
  const recentSynced: boolean = facts ? facts.reviews?.recent?.status === 'verified' : hasReviews;
  const reviewView = reviewDisplay(facts?.reviews, (data.reviewAnalysis as any)?.reviewThemes === 'from-review-text'
    ? { praises: data.reviewAnalysis?.mostCommonPraises, complaints: data.reviewAnalysis?.mostCommonComplaints }
    : 'unknown');
  const breakdown = completionBreakdown(data.profileCompletion?.checklist ?? []);
  const industryAvg: number = data.reviewAnalysis?.industryAverage ?? 2;
  // No sourced benchmark exists for weekly review velocity — new audits
  // (facts layer present) show the number without grading it.
  const velocityBenchmark: number | null = (data as any).facts ? null : industryAvg;
  // null = not computable (no reviews in the synced window) — never "0%".
  const responseRateStr: string | null = data.reviewAnalysis?.responseRate ?? null;
  const responseRatePct: number = responseRateStr ? parseInt(responseRateStr, 10) || 0 : 0;
  const reviewPeriodDays: number = (audit as any).reviewPeriodDays ?? (audit as any).metadata?.reviewPeriodDays ?? 14;
  const rankHeadline = resolveRankHeadline(data);
  const visibilityPct: number | undefined = rankHeadline.visibilityPct ?? undefined;
  const thirtyDayPlan: any[] = (data as any).thirtyDayPlan ?? [];
  const ninetyDayPlan: any[] = (data as any).ninetyDayPlan ?? [];
  const actionPlanMeta: any = (data as any).actionPlan ?? {};
  const planDurationDays: number = actionPlanMeta.durationDays ?? (audit as any).actionPlanDurationDays ?? 30;
  const planLabel: string = actionPlanMeta.planLabel ?? `${planDurationDays}-Day Action Plan`;
  const extendedLabel: string = actionPlanMeta.extendedLabel ?? `Beyond ${planDurationDays} Days — Ongoing Roadmap`;
  // New audits: every keyword searched, from the facts layer (found /
  // not found / unavailable). Old audits: their stored grid (21 = not found).
  const keywordRows: Array<{ keyword: string; value: RankValue }> = facts
    ? (facts.ranking?.byKeyword ?? []).map((k: any) => ({
        keyword: k.kind === 'brand' ? `${k.keyword} (your own name — not counted)` : k.keyword,
        value: k.status === 'unavailable' ? { state: 'unavailable', rank: null } : k.averageObservedRank != null ? { state: 'found', rank: k.averageObservedRank } : { state: 'not_found', rank: null },
      }))
    : ((data.geoGridRank?.keywords?.length ? data.geoGridRank.keywords : (data.googleSearchRank?.topKeywords ?? []).map((k) => ({ keyword: k.keyword, avgRank: k.rank })))
        .map((k: any) => ({ keyword: k.keyword, value: toRankValue(k.avgRank) })));
  const geoGridKeywords = keywordRows;
  // Average over FOUND searches only (new audits); undefined when the
  // ranking check was unavailable so the section says so instead of "20+".
  const headlineValue: RankValue = rankHeadline.status === 'ok'
    ? (rankHeadline.value != null && rankHeadline.value <= 20 ? { state: 'found', rank: rankHeadline.value } : { state: 'not_found', rank: null })
    : { state: rankHeadline.status === 'unavailable' ? 'unavailable' : 'unknown', rank: null };
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
  const competitorFacts: any[] = facts && Array.isArray(data.competitors) ? (data.competitors as any[]) : [];
  const searchesChecked: number = facts?.competitorsAhead?.searchesChecked ?? 0;
  const profileFindings: any[] = Array.isArray((data as any).findings) ? (data as any).findings.filter((f: any) => f.category === 'profile') : [];
  const hasMapGrid = (data.geoGridRank?.keywords ?? []).some((k) => (k.points?.length ?? 0) > 0);

  // Missing SEO fields
  const missingFields: string[] = [];
  const opLower = missingOpps.map((o) => o.toLowerCase()).join(' ');
  void missingKeywords;
  if (opLower.includes('title'))       missingFields.push('Title');
  if (opLower.includes('categor'))     missingFields.push('Additional Category');
  if (opLower.includes('service'))     missingFields.push('Services');
  if (opLower.includes('description')) missingFields.push('Description');
  if (missingFields.length === 0 && missingOpps.length > 0) {
    missingFields.push(...missingOpps.slice(0, 4));
  }

  // Services / categories
  const servicesItem   = checklist.find((c) => c.field.toLowerCase().includes('service'));
  const categoriesItem = checklist.find((c) => c.field.toLowerCase().includes('categor'));
  // Unknown (not read from Google) is "Not checked" — never "Poor".
  const fieldBadge = (st?: string) => (st === 'Complete' || st === 'Partial' ? 'Good' : st === 'Missing' ? 'Poor' : 'Not checked');
  const servicesItem2   = checklist.find((c) => c.field === 'Services Listed') ?? servicesItem;
  const categoriesItem2 = checklist.find((c) => c.field === 'Additional Categories') ?? categoriesItem;
  const evidence: Record<string, any> = (data as any).evidence ?? {};
  const servicesCnt    = evidence.servicesCount    ?? null;
  const categoriesCnt  = evidence.categoriesCount  ?? null;

  // Suspension risk — shared with AuditReportGrexa via resolveSuspensionRisk
  // so the two never disagree. A category with reasons, never a percentage.
  const suspension = resolveSuspensionRisk(data, completionPct, reviewCount);
  // Old reports never ran a policy check → "Not assessed".
  const suspView = suspension.basis === 'heuristic' ? suspensionDisplay(suspension) : suspensionDisplay(null);
  const suspLevel = suspView.level;
  const suspColor = suspLevel === 'Low' ? BRAND_GOOD : suspLevel === 'Medium' ? BRAND_MID : suspLevel === 'High' ? BRAND_BAD : '#79747E';

  // Rank + colors
  const rankM        = { color: RANK_BAND_HEX[rankBand(headlineValue)], display: rankLabel(headlineValue) };
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
      <span style="font-weight:700;color:#1e293b;">${avgRating.toFixed(1)}</span>` : ''}
      ${lifetimeKnown ? `<span style="color:#94a3b8;">(${reviewCount} Google review${reviewCount === 1 ? '' : 's'})</span>` : ''}
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
    ${rankHeadline.status === 'ok' ? `
    <div style="margin-bottom:5px;">
      <span style="font-size:68px;font-weight:900;line-height:1;letter-spacing:-2px;color:${rankM.color};">${rankM.display}</span>
    </div>
    <p style="font-size:11px;color:#64748b;line-height:1.6;margin-bottom:10px;">
      ${facts ? 'Average observed position — only searches where you appeared in the top 20 are averaged.' : `Average rank across ${geoGridKeywords.length} tracked keywords.`}
      ${typeof visibilityPct === 'number' ? ` &middot; visible in <strong style="color:#374151;">${visibilityPct}%</strong> of searches` : ''}
    </p>
    ${facts ? `<table style="margin-bottom:10px;">${rankingStatRows(facts.ranking?.overall).map((r) => `<tr><td style="font-size:10px;color:#94a3b8;padding:1px 0;">${h(r.label)}</td><td style="font-size:10px;font-weight:700;color:#0f172a;text-align:right;">${h(r.value)}</td></tr>`).join('')}</table>` : ''}
    <div style="display:flex;gap:14px;flex-wrap:wrap;">
      ${RANK_LEGEND.slice(0, 3).map((l) => `<div style="display:flex;align-items:center;gap:5px;"><div style="width:11px;height:11px;border-radius:50%;background:${l.hex};flex-shrink:0;"></div><span style="font-size:11px;color:#374151;">${h(l.label)}</span></div>`).join('')}
    </div>` : `
    <div style="font-size:13px;color:#94a3b8;padding:20px 0;text-align:center;">${rankHeadline.status === 'not_measured' ? 'Not measured — Google lists this business only under a generic category, so there is no customer search term to rank for. Add your main service (or a specific Google category) and re-run.' : rankHeadline.status === 'unavailable' ? 'The ranking check did not complete for this report — position unknown, not bad.' : 'Ranking data unavailable'}</div>`}
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
          Profile completion: ${h(completionSentence(breakdown))}
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
        Your rank for ${Math.max(geoGridKeywords.length, 1)} keyword${geoGridKeywords.length === 1 ? '' : 's'} searched
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
          ${geoGridKeywords.slice(0, 8).map((kw) => {
            const m = { color: RANK_BAND_HEX[rankBand(kw.value)], display: rankLabel(kw.value) };
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
        ${facts ? 'Businesses shown above you in these searches' : 'Competitors ranking higher at your locations'}
      </p>
      ${localPackComps.length > 0 ? `
      <table>
        <thead>
          <tr style="border-bottom:2px solid #e2e8f0;">
            <th style="text-align:left;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;padding-bottom:8px;">NAME</th>
            <th style="text-align:right;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;padding-bottom:8px;">${facts ? 'ABOVE YOU IN' : 'AVG RANK'}</th>
          </tr>
        </thead>
        <tbody>
          ${localPackComps.slice(0, 5).map((c: any) => {
            const rank = c.avgRank != null ? Number(c.avgRank) : undefined;
            const cf = competitorFacts.find((x: any) => x.name === c.name);
            const m = facts
              ? { color: '#0f172a', display: cf ? `${cf.searchesAhead} of ${searchesChecked}` : '—' }
              : rankMeta(rank);
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
    const gridCards = mapKws.map((kw) => renderGeoGridMap(kw, ctx.mapsApiKey, gridSpacingKm, ctx.coordinates));
    const rowContent = gridCards.length === 1
      ? `<div style="max-width:480px;">${gridCards[0]}</div>`
      : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">${gridCards.join('')}</div>`;
    geoGridHtml = `
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:14px;">
  <h2 style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:3px;">
    Your Google Search Rank at Nearby Locations
    ${areaSqKm > 0 ? `<span style="font-size:12px;font-weight:400;color:#64748b;margin-left:6px;">(${areaSqKm} sq. km. area)</span>` : ''}
  </h2>
  <p style="font-size:11px;color:#94a3b8;margin-bottom:14px;margin-top:3px;">${gridSpacingKm > 0 ? `Grid spacing: ${gridSpacingKm} km &nbsp;·&nbsp; ` : ''}Showing ${mapKws.length} keyword${mapKws.length === 1 ? '' : 's'}</p>
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
          ${seoMeasured ? svgRing(seoScore, seoColor, 96) : `<div style="width:96px;height:96px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#94a3b8;text-align:center;">Not measured</div>`}
          <p style="font-size:10px;text-align:center;color:#94a3b8;margin-top:5px;">${h(seoCoverage ?? 'Our target: 80%+')}</p>
        </div>
        <div style="flex:1;padding-top:4px;">
          <p style="font-size:12px;font-weight:600;color:#374151;margin-bottom:10px;">${facts ? 'Profile gaps we verified' : 'Profile gaps found'}</p>
          <ul style="list-style:none;margin:0;padding:0;">
            ${facts
              ? (profileFindings.length > 0
                  ? profileFindings.map((f: any) => `<li style="margin-bottom:8px;">
                <div style="display:flex;align-items:center;gap:8px;"><span style="width:6px;height:6px;border-radius:50%;background:${BRAND_BAD};flex-shrink:0;display:inline-block;"></span><span style="font-size:12px;color:${BRAND_BAD};font-weight:500;">${h(f.title)}</span></div>
                <div style="font-size:10px;color:#94a3b8;margin-left:14px;">Evidence: ${h(f.evidence)} · ${h(ACTIONABILITY_LABEL[f.actionability] || f.actionability)} · ${h(f.growwmaticsCapability ? `GrowwMatics: ${(GROWWMATICS_CAPABILITIES as any)[f.growwmaticsCapability]?.label}` : 'changed by you in Google')}</div>
              </li>`).join('')
                  : `<li style="font-size:12px;color:${BRAND_GOOD};font-weight:500;">No gaps found in the fields we could check</li>`)
              : missingFields.length > 0
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
          ${statusBadge(fieldBadge(servicesItem2?.status))}
        </div>
        <p style="font-size:10px;color:#94a3b8;">${servicesItem2?.status === 'Unknown' || !servicesItem2 ? 'Not read from Google in this report' : 'From your Google profile'}</p>
      </div>
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px;flex:1;break-inside:avoid;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
          <span style="font-size:13px;font-weight:600;color:#1e293b;">
            ${categoriesCnt !== null ? `${categoriesCnt} Categories Added` : 'Additional categories'}
          </span>
          ${statusBadge(fieldBadge(categoriesItem2?.status))}
        </div>
        <p style="font-size:10px;color:#94a3b8;">${categoriesItem2?.status === 'Unknown' || !categoriesItem2 ? 'Not read from Google in this report' : 'From your Google profile'}</p>
      </div>
    </div>

  </div>

  <!-- Row 2: Reviews/Week | Response % | Suspension Risk — mirrors
       AuditReportGrexa's hasReviews branch: with no reviews synced yet, every
       metric here derives from reviewCount, so showing them would read as
       hollow zeros / a false "High risk" instead of a real finding. -->
  ${recentSynced ? `
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">

    <!-- Reviews Per Week -->
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;break-inside:avoid;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:12px;font-weight:600;color:#374151;">Reviews Per Week</span>
        ${velocityBenchmark != null ? statusBadge(reviewsPerWeek >= velocityBenchmark ? 'Good' : 'Poor') : ''}
      </div>
      <div style="margin-bottom:4px;">
        <span style="font-size:38px;font-weight:900;color:#0f172a;">${facts ? (data.reviewAnalysis?.reviewsPerWeek != null ? Number(data.reviewAnalysis.reviewsPerWeek).toFixed(1) : 'Unknown') : reviewsPerWeek.toFixed(2)}</span>
        ${!facts || data.reviewAnalysis?.reviewsPerWeek != null ? `<span style="font-size:14px;font-weight:600;color:#94a3b8;margin-left:3px;">/Week</span>` : ''}
      </div>
      <p style="font-size:10px;color:#94a3b8;">${velocityBenchmark != null ? `Industry avg <strong style="color:#64748b;">${velocityBenchmark}</strong>/week &middot; ` : ''}${facts ? `${h(reviewView.recentCount)} new reviews in the ` : 'based on '}last ${reviewPeriodDays} days</p>
    </div>

    <!-- Response Percentage -->
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;break-inside:avoid;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:12px;font-weight:600;color:#374151;">Response Rate</span>
        ${responseRateStr != null ? statusBadge(responseRatePct >= 80 ? 'Good' : 'Poor') : ''}
      </div>
      <div style="display:flex;justify-content:center;margin-bottom:6px;">
        ${responseRateStr != null ? svgRing(responseRatePct, responseRatePct >= 80 ? BRAND_GOOD : BRAND_BAD, 80) : `<div style="height:80px;display:flex;align-items:center;font-size:12px;font-weight:700;color:#94a3b8;">${h(reviewView.responseRate)}</div>`}
      </div>
      <p style="font-size:10px;color:#94a3b8;text-align:center;">We recommend replying to every review</p>
    </div>

    <!-- Suspension Risk -->
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;break-inside:avoid;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:12px;font-weight:600;color:#374151;">Suspension Risk</span>
        ${suspension.basis === 'heuristic' ? statusBadge(suspLevel) : ''}
      </div>
      <div style="display:flex;justify-content:center;margin-bottom:6px;">
        <span style="font-size:28px;font-weight:900;color:${suspColor};">${h(suspLevel)}</span>
      </div>
      <p style="font-size:10px;color:#94a3b8;text-align:center;">${h(suspView.note)}</p>
    </div>
  </div>` : `
  <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;display:flex;align-items:center;gap:10px;break-inside:avoid;">
    <div style="width:8px;height:8px;border-radius:50%;background:${BRAND_MID};flex-shrink:0;"></div>
    <p style="font-size:12px;color:#64748b;margin:0;">
      ${facts
        ? h(`Reviews per week and response rate need synced reviews, which this report doesn't have — they are unknown, not zero.${lifetimeKnown ? ` Lifetime: ${reviewCount} Google reviews${avgRating > 0 ? ` at ${avgRating}★` : ''}.` : ''} Suspension risk: ${suspView.level} — ${suspView.note} ${reviewView.themes}`)
        : 'Review-based metrics (reviews/week, response rate, suspension risk) will appear once reviews have synced from your newly-connected Google Business Profile.'}
    </p>
  </div>`}

  </div>
</div>`;

  // ── 6. PROFILE COMPLETION ─────────────────────────────────────────────────────
  const checklistHtml = `
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:14px;">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
    <h2 style="font-size:15px;font-weight:700;color:#0f172a;">Your Profile Completion (${facts && breakdown.pct == null ? 'not measured' : `${completionPct}% ${completionView.badgeCaption}`})</h2>
    <div style="display:flex;align-items:center;gap:14px;font-size:11px;color:#374151;flex-wrap:wrap;">
      <span style="color:#94a3b8;font-weight:500;">${h(facts ? completionSentence(breakdown) : completionView.label)}</span>
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
      <div style="display:flex;align-items:center;gap:5px;">
        <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#79747E"/><text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="700" fill="white">?</text></svg>
        <span>Could not be checked (not counted)</span>
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
  const monthlyHtml = renderMonthly((data as any).monthly);
  const isFullAudit = (data.seoPlanDraft as any)?.depth === 'full';
  const confidentialFooter = isFullAudit
    ? `<div style="margin-top:14px;padding:14px 18px;background:#1e293b;color:#94a3b8;border-radius:12px;font-size:10px;line-height:1.6;">
        GrowwMatics AI<br/>
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
${legacy ? `<div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px;margin-bottom:14px;font-size:11px;color:#475569;">${h(LEGACY_REPORT_NOTICE)}</div>` : ''}
${headerHtml}
${heroHtml}
${rankAnalyticsHtml}
${geoGridHtml}
${profileBreakdownHtml}
${checklistHtml}
${monthlyHtml}
${consultantHtml}
${actionPlanHtml}
${ctaHtml}
${confidentialFooter}
</body>
</html>`;
}

/** Monthly optimization report (same content as MonthlySections.tsx). Missing data is stated, never filled. */
function renderMonthly(m: any): string {
  if (!m) return '';
  const box = (title: string, body: string) => `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:10px;break-inside:avoid;"><div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:6px;">${h(title)}</div>${body}</div>`;
  const p = (t: string) => `<p style="font-size:11px;color:#64748b;margin:0;">${h(t)}</p>`;
  const li = (items: string[]) => `<ul style="margin:0;padding-left:16px;font-size:11px;color:#374151;">${items.map((x) => `<li>${h(x)}</li>`).join('')}</ul>`;
  const r = m.reviews || {};
  const perf = m.performance?.status === 'unavailable'
    ? p('Google performance data unavailable for this period.')
    : li((m.performance?.rows || []).map((x: any) => `${x.metric}: ${x.previous ?? 'not measured'} → ${x.current ?? 'not measured'}${x.pctChange != null ? ` (${x.pctChange > 0 ? '+' : ''}${x.pctChange}%)` : ''}`)) +
      p(`Current ${m.performance?.currentPeriod || ''}${m.performance?.previousPeriod ? ` · previous ${m.performance.previousPeriod}` : ' · no earlier measured period'} — engagement measurements, not revenue.`);
  return `<div style="margin:14px 0;">
    <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:8px;">Monthly optimization report</div>
    ${box('What changed this month', m.changes?.length ? li(m.changes.map((c: any) => `${c.what}: ${c.previous} → ${c.current} (${c.actor === 'Unknown' ? 'not recorded' : c.actor === 'Owner' ? 'you' : 'GrowwMatics'})`)) : p('No verified profile changes were detected between the two audits.'))}
    ${box('What GrowwMatics optimized', m.growwmaticsOptimized?.length ? li(m.growwmaticsOptimized.map((x: any) => `${x.count} ${x.what}`)) : p('No GrowwMatics actions reached your Google profile this period.'))}
    ${box('What you optimized', m.ownerOptimized?.length ? li(m.ownerOptimized.map((x: any) => `${x.count} ${x.what}`)) : p('No owner actions were recorded through GrowwMatics this period.'))}
    ${box('Google performance', perf)}
    ${box('Ranking progress', m.ranking?.length ? li(m.ranking.map((x: any) => `${x.metric}: ${x.before} → ${x.after} (${x.change})`)) : p('Ranking data unavailable for comparison.'))}
    ${box('Review activity', li([`New Google reviews: ${r.newReviews}`, `Rating: ${r.ratingBefore ?? 'unknown'}★ → ${r.ratingAfter ?? 'unknown'}★`, `Replied by GrowwMatics: ${r.repliedByGrowwMatics} · you approved: ${r.repliedByOwnerViaGrowwMatics} · on Google directly: ${r.repliedOnGoogleDirectly}`, `New reviews without a reply: ${r.unanswered}`, `Review requests sent: ${r.reviewRequestsSent}`]))}
    ${m.contentActivity ? box('Google posts this month', li(contentActivityLines(m.contentActivity))) : ''}
    ${box('Profile health', p(`${m.profileHealth?.completionPercentage != null ? `${m.profileHealth.completionPercentage}% of checked fields complete` : 'Profile completion not measured'}${m.profileHealth?.missing?.length ? ` · missing: ${m.profileHealth.missing.join(', ')}` : ''}${m.profileHealth?.unknown ? ` · ${m.profileHealth.unknown} could not be checked` : ''}`))}
    ${box('Completed plan', m.planCompleted?.length ? li(m.planCompleted.map((a: any) => `${a.action} — ${a.status}`)) : p('No plan actions have been completed with evidence yet.'))}
    ${box('Pending plan', m.planPending?.length ? li(m.planPending.map((a: any) => `${a.action} — ${a.status}${a.statusReason ? ` (${a.statusReason})` : ''}`)) : p('No pending plan actions.'))}
    ${box('Issues that remain', m.remainingIssues?.length ? li(m.remainingIssues) : p('No verified issues remain in this audit.'))}
  </div>`;
}

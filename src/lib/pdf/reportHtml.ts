import type {
  IAudit, IAuditData, IChecklistItem, IGeoGridKeyword,
} from '@/models/Audit';

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

function rankMeta(rank: number | undefined): { color: string; display: string } {
  if (rank === undefined) return { color: '#ef4444', display: '—' };
  if (rank <= 5)  return { color: '#22c55e', display: rank.toFixed(1) };
  if (rank <= 10) return { color: '#eab308', display: rank.toFixed(1) };
  return { color: '#ef4444', display: rank.toFixed(1) };
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
    Good:    'background:#22c55e;color:#fff;',
    Poor:    'background:#ef4444;color:#fff;',
    Average: 'background:#eab308;color:#fff;',
    Low:     'background:#22c55e;color:#fff;',
    High:    'background:#ef4444;color:#fff;',
    Medium:  'background:#eab308;color:#fff;',
  };
  const style = map[status] ?? 'background:#94a3b8;color:#fff;';
  return `<span style="font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;${style}">${h(status)}</span>`;
}

function checkIcon(status: IChecklistItem['status'] | string): string {
  if (status === 'Complete')
    return `<svg width="20" height="20" viewBox="0 0 24 24" style="flex-shrink:0;">
      <circle cx="12" cy="12" r="10" fill="#22c55e"/>
      <path d="M8 12l3 3 5-5" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`;
  if (status === 'Partial')
    return `<svg width="20" height="20" viewBox="0 0 24 24" style="flex-shrink:0;">
      <circle cx="12" cy="12" r="10" fill="#f97316"/>
      <path d="M12 7v5M12 16h.01" stroke="white" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    </svg>`;
  return `<svg width="20" height="20" viewBox="0 0 24 24" style="flex-shrink:0;">
    <circle cx="12" cy="12" r="10" fill="#ef4444"/>
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

// ── Main builder ───────────────────────────────────────────────────────────────

export function buildReportHtml(ctx: ReportContext): string {
  const { audit, businessRating } = ctx;
  const data = (audit.auditData ?? {}) as IAuditData & Record<string, unknown>;

  // ── Data extraction ──────────────────────────────────────────────────────────
  const overallScore: number = (audit as any).overallScore ?? data.profileScore?.overallScore ?? 0;
  const seoScore: number = data.seoScore?.score ?? 0;
  const completionPct: number = data.profileCompletion?.completionPercentage ?? 0;
  const checklist: IChecklistItem[] = data.profileCompletion?.checklist ?? [];
  const reviewCount: number = (audit as any).metadata?.reviewsActualCount ?? data.reviewAnalysis?.reviewCount ?? 0;
  const avgRating: number = businessRating ?? data.reviewAnalysis?.averageRating ?? 0;
  const reviewsPerWeek: number = data.reviewAnalysis?.reviewsPerWeek ?? 0;
  const industryAvg: number = data.reviewAnalysis?.industryAverage ?? 2;
  const responseRateStr: string = data.reviewAnalysis?.responseRate ?? '0%';
  const responseRatePct: number = parseInt(responseRateStr, 10) || 0;
  const geoGridKeywords: IGeoGridKeyword[] = data.geoGridRank?.keywords ?? [];
  const overallAvgRank: number | undefined = data.geoGridRank?.overallAvgRank;
  const areaSqKm: number = data.geoGridRank?.areaSqKm ?? 9;
  const gridSpacingKm: number = data.geoGridRank?.gridSpacingKm ?? 1.5;
  const localPackComps = (data.localPackCompetitors ?? []) as any[];
  const missingOpps: string[] = data.seoScore?.optimizationOpportunities ?? [];
  const missingKeywords: string[] = data.seoScore?.missingKeywords ?? [];
  const hasGeoGrid = geoGridKeywords.length > 0;

  // Missing SEO fields
  const missingFields: string[] = [];
  const opLower = missingOpps.map((o) => o.toLowerCase()).join(' ');
  if (opLower.includes('title')       || missingKeywords.length > 0) missingFields.push('Title');
  if (opLower.includes('categor')     || missingKeywords.length > 0) missingFields.push('Additional Category');
  if (opLower.includes('service')     || missingKeywords.length > 0) missingFields.push('Services');
  if (opLower.includes('description') || missingKeywords.length > 0) missingFields.push('Description');
  if (missingFields.length === 0 && seoScore < 80)
    missingFields.push('Title', 'Additional Category', 'Services', 'Description');

  // Services / categories
  const servicesItem   = checklist.find((c) => c.field.toLowerCase().includes('service'));
  const categoriesItem = checklist.find((c) => c.field.toLowerCase().includes('categor'));
  const servicesOk     = servicesItem?.status === 'Complete';
  const categoriesOk   = !(categoriesItem?.status === 'Missing' || categoriesItem?.status === 'Unknown');
  const evidence: Record<string, any> = (data as any).evidence ?? {};
  const servicesCnt    = evidence.servicesCount    ?? null;
  const categoriesCnt  = evidence.categoriesCount  ?? null;

  // Suspension risk
  let suspLevel: string, suspColor: string, suspPct: number;
  if (completionPct < 40 && reviewCount < 5) {
    suspLevel = 'High';   suspColor = '#ef4444'; suspPct = 85;
  } else if (completionPct < 70 || reviewCount < 10) {
    suspLevel = 'Medium'; suspColor = '#eab308'; suspPct = 45;
  } else {
    suspLevel = 'Low';    suspColor = '#22c55e'; suspPct = 0;
  }

  // Rank + colors
  const rankM        = rankMeta(overallAvgRank);
  const profileColor = overallScore >= 80 ? '#22c55e' : overallScore >= 60 ? '#eab308' : '#ef4444';
  const seoColor     = seoScore    >= 80 ? '#22c55e' : seoScore    >= 50 ? '#eab308' : '#ef4444';
  const genDate      = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  // Checklist columns
  const defaultChecklist: IChecklistItem[] = [
    { field: 'Title',                          status: 'Complete' },
    { field: 'Primary Category',               status: 'Complete' },
    { field: 'Additional Categories',          status: 'Missing'  },
    { field: 'Business Services',              status: 'Complete' },
    { field: 'Description',                    status: 'Partial'  },
    { field: 'Address',                        status: 'Complete' },
    { field: 'Phone',                          status: 'Complete' },
    { field: 'Listing Attributes/Service Options', status: 'Complete' },
    { field: 'Photos',                         status: 'Complete' },
    { field: 'Logo',                           status: 'Complete' },
    { field: 'Website',                        status: 'Complete' },
    { field: 'Service Area',                   status: 'Complete' },
    { field: 'Business Hours',                 status: 'Complete' },
    { field: 'Appointment/Ordering Links',     status: 'Complete' },
  ];
  const displayChecklist = checklist.length >= 4 ? checklist : defaultChecklist;
  const half   = Math.ceil(displayChecklist.length / 2);
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
  `;

  // ── 1. REPORT HEADER ─────────────────────────────────────────────────────────
  const headerHtml = `
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;margin-bottom:14px;break-inside:avoid;">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
    <div style="display:flex;align-items:center;gap:8px;">
      ${googleSvg(18)}
      <span style="font-size:13px;font-weight:600;color:#374151;">Google Search Rank Report for Your Business Profile</span>
    </div>
    <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:6px;padding:4px 10px;">
      <span style="font-size:11px;font-weight:700;color:#fff;letter-spacing:0.5px;">GMBBoost</span>
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
    ${hasGeoGrid ? `
    <div style="margin-bottom:5px;">
      <span style="font-size:68px;font-weight:900;line-height:1;letter-spacing:-2px;color:${rankM.color};">${rankM.display}</span>
    </div>
    <p style="font-size:11px;color:#64748b;line-height:1.6;margin-bottom:16px;">
      Overall average rank for the
      <strong style="color:#374151;">${geoGridKeywords.length} most searched keywords</strong>
      on Google for your business
    </p>
    <div style="display:flex;gap:14px;">
      <div style="display:flex;align-items:center;gap:5px;">
        <div style="width:11px;height:11px;border-radius:50%;background:#22c55e;flex-shrink:0;"></div>
        <span style="font-size:11px;color:#374151;">Top 5</span>
      </div>
      <div style="display:flex;align-items:center;gap:5px;">
        <div style="width:11px;height:11px;border-radius:50%;background:#eab308;flex-shrink:0;"></div>
        <span style="font-size:11px;color:#374151;">Under 10</span>
      </div>
      <div style="display:flex;align-items:center;gap:5px;">
        <div style="width:11px;height:11px;border-radius:50%;background:#ef4444;flex-shrink:0;"></div>
        <span style="font-size:11px;color:#374151;">Beyond 10</span>
      </div>
    </div>` : `
    <div style="font-size:13px;color:#94a3b8;padding:20px 0;text-align:center;">Geo-grid data unavailable</div>`}
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
  const rankAnalyticsHtml = hasGeoGrid ? `
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:14px;break-inside:avoid;">
  <h2 style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:16px;">Your Google Rank Analytics</h2>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">

    <!-- Keywords table -->
    <div style="padding-right:20px;border-right:1px solid #e2e8f0;">
      <p style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;">
        Your rank for top ${geoGridKeywords.length} keywords
      </p>
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
      </table>
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
            const rank = Number(c.avgRank ?? 21);
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
  if (hasGeoGrid) {
    const mapKws = geoGridKeywords.slice(0, 2);
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
            ${(missingFields.length > 0 ? missingFields : ['Title', 'Additional Category', 'Services', 'Description']).map((f) =>
              `<li style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span style="width:6px;height:6px;border-radius:50%;background:#ef4444;flex-shrink:0;display:inline-block;"></span>
                <span style="font-size:12px;color:#dc2626;font-weight:500;">${h(f)}</span>
              </li>`
            ).join('')}
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

  <!-- Row 2: Reviews/Week | Response % | Suspension Risk -->
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
      <p style="font-size:10px;color:#94a3b8;">Industry Average is <strong style="color:#64748b;">${industryAvg}</strong>/week</p>
    </div>

    <!-- Response Percentage -->
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;break-inside:avoid;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:12px;font-weight:600;color:#374151;">Response Percentage</span>
        ${statusBadge(responseRatePct >= 80 ? 'Good' : 'Poor')}
      </div>
      <div style="display:flex;justify-content:center;margin-bottom:6px;">
        ${svgRing(responseRatePct, responseRatePct >= 80 ? '#22c55e' : '#ef4444', 80)}
      </div>
      <p style="font-size:10px;color:#94a3b8;text-align:center;">Should reply to <strong style="color:#64748b;">80%</strong> of the reviews</p>
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

  </div>
</div>`;

  // ── 6. PROFILE COMPLETION ─────────────────────────────────────────────────────
  const checklistHtml = `
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:14px;">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
    <h2 style="font-size:15px;font-weight:700;color:#0f172a;">Your Profile Completion (${completionPct}%)</h2>
    <div style="display:flex;align-items:center;gap:14px;font-size:11px;color:#374151;flex-wrap:wrap;">
      <span style="color:#94a3b8;font-weight:500;">Should be 100%</span>
      <div style="display:flex;align-items:center;gap:5px;">
        <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#22c55e"/><path d="M8 12l3 3 5-5" stroke="white" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>
        <span>Complete</span>
      </div>
      <div style="display:flex;align-items:center;gap:5px;">
        <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#f97316"/><path d="M12 7v5M12 16h.01" stroke="white" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>
        <span>Partially Complete</span>
      </div>
      <div style="display:flex;align-items:center;gap:5px;">
        <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ef4444"/><path d="M15 9l-6 6M9 9l6 6" stroke="white" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>
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

  // ── 7. CTA BANNER ─────────────────────────────────────────────────────────────
  const ctaHtml = `
<div style="border-radius:16px;overflow:hidden;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);break-inside:avoid;">
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
    <span style="font-size:10px;color:rgba(255,255,255,0.6);">GMBBoost · AI-Powered Google Business Growth Platform</span>
    <span style="font-size:10px;color:rgba(255,255,255,0.4);">Report Generated ${genDate}</span>
  </div>
</div>`;

  // ── Final document ─────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>GMBBoost Report – ${h(audit.businessName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"/>
<style>${css}</style>
</head>
<body>
${headerHtml}
${heroHtml}
${rankAnalyticsHtml}
${geoGridHtml}
${profileBreakdownHtml}
${checklistHtml}
${ctaHtml}
</body>
</html>`;
}

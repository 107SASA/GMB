import type {
  IAudit, IAuditData, IChecklistItem, IGeoGridKeyword,
  IPriorityFix, IStrengthWeakness, IThirtyDayPlan, INinetyDayPlan,
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

function svgRing(pct: number, color: string, size = 110): string {
  const c = Math.min(100, Math.max(0, pct));
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  const fill = (c / 100) * circ;
  const cx = size / 2;
  const fontSize = Math.round(size * 0.19);
  const subSize = Math.round(size * 0.1);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block;margin:0 auto;">
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="#E8EDF4" stroke-width="10"/>
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${color}" stroke-width="10"
      stroke-dasharray="${fill.toFixed(1)} ${circ.toFixed(1)}" stroke-linecap="round"
      transform="rotate(-90 ${cx} ${cx})"/>
    <text x="${cx}" y="${cx - 4}" dominant-baseline="middle" text-anchor="middle"
      font-size="${fontSize}" font-weight="900" fill="${color}"
      font-family="Inter,-apple-system,sans-serif">${c}%</text>
    <text x="${cx}" y="${cx + fontSize * 0.75}" dominant-baseline="middle" text-anchor="middle"
      font-size="${subSize}" font-weight="500" fill="#94A3B8"
      font-family="Inter,-apple-system,sans-serif">score</text>
  </svg>`;
}

function rankMeta(rank: number | undefined) {
  if (rank === undefined || rank >= 21)
    return { text: '#94A3B8', bg: '#F1F5F9', label: 'Not in Top 20', display: '20+' };
  if (rank <= 5)
    return { text: '#059669', bg: '#DCFCE7', label: 'Good — Top 5', display: rank.toFixed(1) };
  if (rank <= 10)
    return { text: '#D97706', bg: '#FEF3C7', label: 'Average — Position 6–10', display: rank.toFixed(1) };
  return { text: '#DC2626', bg: '#FEE2E2', label: 'Poor — Position 11+', display: rank.toFixed(1) };
}

function rankBadge(rank: number): string {
  const m = rankMeta(rank);
  const display = rank >= 21 ? '20+' : rank.toFixed(1);
  return `<span style="display:inline-block;padding:3px 11px;border-radius:20px;font-size:10px;font-weight:800;
    background:${m.bg};color:${m.text};">${display}</span>`;
}

function starRow(rating: number): string {
  if (!rating) return '';
  const full = Math.floor(rating);
  const empty = 5 - full;
  return '★'.repeat(full) + '☆'.repeat(empty);
}

function checkIcon(status: IChecklistItem['status'] | string): string {
  if (status === 'Complete')
    return `<div style="width:20px;height:20px;border-radius:50%;background:#DCFCE7;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;">
      <svg width="11" height="11" viewBox="0 0 11 11">
        <path d="M2.5 5.5L4.5 7.5L8.5 3.5" stroke="#059669" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg></div>`;
  if (status === 'Partial')
    return `<div style="width:20px;height:20px;border-radius:50%;background:#FEF3C7;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#D97706;">~</div>`;
  if (status === 'Unknown')
    return `<div style="width:20px;height:20px;border-radius:50%;background:#FEF3C7;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#D97706;">?</div>`;
  return `<div style="width:20px;height:20px;border-radius:50%;background:#FEE2E2;flex-shrink:0;
    display:flex;align-items:center;justify-content:center;">
    <svg width="11" height="11" viewBox="0 0 11 11">
      <path d="M3 3L8 8M8 3L3 8" stroke="#DC2626" stroke-width="1.6" stroke-linecap="round"/>
    </svg></div>`;
}

function statusColor(s: string) {
  if (s === 'Complete') return { text: '#059669', bg: '#DCFCE7', border: '#BBF7D0', rowBg: '#F0FDF4' };
  if (s === 'Partial' || s === 'Unknown') return { text: '#D97706', bg: '#FEF3C7', border: '#FDE68A', rowBg: '#FFFBEB' };
  return { text: '#DC2626', bg: '#FEE2E2', border: '#FECACA', rowBg: '#FFF5F5' };
}

function impactStyle(level: string) {
  if (level === 'High') return { text: '#DC2626', bg: '#FEE2E2' };
  if (level === 'Medium') return { text: '#D97706', bg: '#FEF3C7' };
  return { text: '#059669', bg: '#DCFCE7' };
}

function effortStyle(level: string) {
  if (level === 'Low') return { text: '#059669', bg: '#DCFCE7' };
  if (level === 'Medium') return { text: '#D97706', bg: '#FEF3C7' };
  return { text: '#DC2626', bg: '#FEE2E2' };
}

function gridPointColor(rank: number): { bg: string; text: string } {
  if (rank >= 21) return { bg: '#F1F5F9', text: '#94A3B8' };
  if (rank <= 5) return { bg: '#DCFCE7', text: '#065F46' };
  if (rank <= 10) return { bg: '#FEF3C7', text: '#92400E' };
  return { bg: '#FEE2E2', text: '#991B1B' };
}

function renderGeoGrid(kw: IGeoGridKeyword): string {
  const m = rankMeta(kw.avgRank);
  const pts = [...kw.points];
  while (pts.length < 9) pts.push({ lat: 0, lng: 0, rank: 21 });

  const cells = pts.slice(0, 9).map((p, i) => {
    const c = gridPointColor(p.rank);
    const disp = p.rank >= 21 ? '20+' : String(p.rank);
    const isCenter = i === 4;
    return `<div style="background:${isCenter ? '#EFF6FF' : c.bg};color:${isCenter ? '#1D4ED8' : c.text};
      border-radius:8px;padding:10px 4px;text-align:center;font-weight:900;font-size:13px;line-height:1.1;
      ${isCenter ? 'border:2px solid #2563EB;' : ''}">
      ${disp}
      ${isCenter ? '<div style="font-size:6px;font-weight:700;color:#2563EB;margin-top:3px;text-transform:uppercase;letter-spacing:0.4px;">YOU</div>' : ''}
    </div>`;
  }).join('');

  return `<div style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:18px;break-inside:avoid;
    box-shadow:0 1px 4px rgba(0,0,0,0.05);">
    <div style="margin-bottom:10px;">
      <div style="font-size:9px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px;">Keyword</div>
      <div style="font-size:12px;font-weight:700;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">"${h(kw.keyword)}"</div>
    </div>
    <div style="display:inline-flex;align-items:center;gap:6px;margin-bottom:14px;padding:4px 10px;
      background:${m.bg};border-radius:20px;">
      <span style="font-size:9px;font-weight:600;color:${m.text};">Avg. Rank:</span>
      <span style="font-size:12px;font-weight:900;color:${m.text};">${m.display}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:12px;">${cells}</div>
    <div style="display:flex;gap:5px;flex-wrap:wrap;">
      <span style="background:#DCFCE7;color:#065F46;font-size:8px;font-weight:700;padding:2px 8px;border-radius:10px;">● 1–5 Good</span>
      <span style="background:#FEF3C7;color:#92400E;font-size:8px;font-weight:700;padding:2px 8px;border-radius:10px;">● 6–10 Avg</span>
      <span style="background:#FEE2E2;color:#991B1B;font-size:8px;font-weight:700;padding:2px 8px;border-radius:10px;">● 11+ Poor</span>
    </div>
  </div>`;
}

function staticMapUrl(
  cLat: number, cLng: number,
  points: Array<{ lat: number; lng: number; rank: number }>,
  apiKey: string,
): string {
  const base = 'https://maps.googleapis.com/maps/api/staticmap';
  const parts = [
    `center=${cLat},${cLng}`, 'zoom=13', 'size=560x300', 'scale=2', 'maptype=roadmap',
    `markers=color:blue%7Clabel:Y%7Csize:mid%7C${cLat},${cLng}`,
  ];
  for (const p of points) {
    const color = p.rank <= 5 ? 'green' : p.rank <= 10 ? 'orange' : p.rank < 21 ? 'red' : 'gray';
    const lbl = p.rank >= 1 && p.rank <= 9 ? `%7Clabel:${p.rank}` : '';
    parts.push(`markers=color:${color}%7Csize:mid${lbl}%7C${p.lat},${p.lng}`);
  }
  parts.push(`key=${encodeURIComponent(apiKey)}`);
  return `${base}?${parts.join('&')}`;
}

function gridCenter(pts: Array<{ lat: number; lng: number }>) {
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  return { lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) };
}

function sectionDivider(title: string, right = ''): string {
  return `
<div style="display:flex;align-items:center;justify-content:space-between;
  margin-bottom:16px;padding-bottom:10px;border-bottom:1.5px solid #E2E8F0;">
  <div style="display:flex;align-items:center;gap:10px;">
    <div style="width:4px;height:20px;background:linear-gradient(180deg,#2563EB,#7C3AED);border-radius:2px;flex-shrink:0;"></div>
    <span style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#0F172A;">${h(title)}</span>
  </div>
  ${right ? `<span style="font-size:10px;color:#94A3B8;font-weight:500;">${right}</span>` : ''}
</div>`;
}

// ── Main builder ───────────────────────────────────────────────────────────────

export function buildReportHtml(ctx: ReportContext): string {
  const { audit, businessRating, coordinates, mapsApiKey } = ctx;
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
  const gridSpacingKm: number = data.geoGridRank?.gridSpacingKm ?? 1.5;
  const areaSqKm: number = data.geoGridRank?.areaSqKm ?? 9;
  const hasGeoGrid = geoGridKeywords.length > 0;
  const localPackComps = (data.localPackCompetitors ?? []) as any[];
  const missingOpps: string[] = data.seoScore?.optimizationOpportunities ?? [];
  const missingKeywords: string[] = data.seoScore?.missingKeywords ?? [];

  // AI fields
  const strengths: IStrengthWeakness[] = data.strengths ?? [];
  const weaknesses: IStrengthWeakness[] = data.weaknesses ?? [];
  const priorityFixes: IPriorityFix[] = data.priorityFixes ?? [];
  const thirtyDayPlan: IThirtyDayPlan[] = data.thirtyDayPlan ?? [];
  const ninetyDayPlan: INinetyDayPlan[] = data.ninetyDayPlan ?? [];
  const executiveSummary: string = (data.executiveSummary as string) ?? '';
  const quickWins: string[] = (data.quickWins as string[]) ?? [];
  const businessTier: string = (data.businessTier as string) ?? '';
  const hasAiData = strengths.length > 0 || weaknesses.length > 0 || priorityFixes.length > 0;

  // Derived
  const rankM = rankMeta(overallAvgRank);
  const genDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const completeCount = checklist.filter(c => c.status === 'Complete').length;

  // Suspension risk
  let suspLevel: string, suspColor: string, suspBg: string, suspPct: number;
  if (completionPct < 40 && reviewCount < 5) {
    suspLevel = 'High'; suspColor = '#DC2626'; suspBg = '#FEE2E2'; suspPct = 85;
  } else if (completionPct < 70 || reviewCount < 10) {
    suspLevel = 'Medium'; suspColor = '#D97706'; suspBg = '#FEF3C7'; suspPct = 45;
  } else {
    suspLevel = 'Low'; suspColor = '#059669'; suspBg = '#DCFCE7'; suspPct = 0;
  }

  // Checklist status helpers
  const findChecklist = (keyword: string): IChecklistItem | undefined =>
    checklist.find(c => c.field.toLowerCase().includes(keyword.toLowerCase()));
  const servicesItem = findChecklist('service');
  const categoriesItem = findChecklist('categor');
  const servGood = servicesItem?.status === 'Complete';
  const catGood = categoriesItem?.status === 'Complete';

  // ── CSS ──────────────────────────────────────────────────────────────────────
  const css = `
    *, *::before, *::after {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body { margin: 0; padding: 0; background: #F1F5F9;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 12px; color: #0F172A; }
    @page { size: A4 portrait; margin: 12mm 14mm; }
    table { width: 100%; border-collapse: collapse; }
    img { max-width: 100%; display: block; }
    .nb { break-inside: avoid; }
    .pb { break-before: page; }
  `;

  // ── HEADER ───────────────────────────────────────────────────────────────────
  const headerHtml = `
<div class="nb" style="background:linear-gradient(135deg,#0F172A 0%,#1E3A8A 50%,#1D4ED8 100%);
  padding:30px 32px;border-radius:16px;margin-bottom:20px;color:#fff;">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:20px;">
    <div style="flex:1;min-width:0;">
      <div style="display:inline-flex;align-items:center;gap:8px;
        background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.18);
        border-radius:20px;padding:4px 14px;margin-bottom:14px;">
        <div style="width:16px;height:16px;background:#fff;border-radius:4px;
          display:flex;align-items:center;justify-content:center;
          font-size:9px;font-weight:900;color:#1E3A8A;">G</div>
        <span style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;
          color:rgba(255,255,255,0.65);">GMBBoost · Google Business Profile Audit</span>
      </div>
      <h1 style="font-size:24px;font-weight:900;margin:0 0 10px;line-height:1.2;letter-spacing:-0.3px;">${h(audit.businessName)}</h1>
      ${avgRating > 0 ? `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:17px;color:#FBBF24;letter-spacing:2px;">${starRow(avgRating)}</span>
        <span style="font-size:13px;font-weight:700;color:rgba(255,255,255,0.85);">${avgRating.toFixed(1)}</span>
        <span style="font-size:11px;color:rgba(255,255,255,0.5);">(${reviewCount} reviews)</span>
      </div>` : ''}
      ${audit.address ? `<div style="font-size:11px;color:rgba(255,255,255,0.55);display:flex;gap:5px;">
        <span>📍</span><span>${h(audit.address)}</span></div>` : ''}
      ${audit.location ? `<div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:4px;">${h(audit.location)}</div>` : ''}
    </div>
    <div style="text-align:right;flex-shrink:0;">
      <div style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);
        border-radius:12px;padding:10px 16px;">
        <div style="font-size:9px;color:rgba(255,255,255,0.45);text-transform:uppercase;
          letter-spacing:1px;margin-bottom:4px;">Report Generated</div>
        <div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.9);">${genDate}</div>
      </div>
    </div>
  </div>
</div>`;

  // ── HERO CARDS ───────────────────────────────────────────────────────────────
  const heroHtml = `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">

  <!-- Search Rank -->
  <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
    padding:24px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:18px;">
      <span style="font-size:16px;font-weight:900;
        background:linear-gradient(90deg,#4285F4,#EA4335,#FBBC05,#34A853);
        -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
        color:#4285F4;">Google</span>
      <span style="font-size:13px;font-weight:700;color:#374151;">Search Rank</span>
    </div>
    ${hasGeoGrid ? `
    <div style="font-size:62px;font-weight:900;color:${rankM.text};line-height:1;margin-bottom:8px;letter-spacing:-2px;">${rankM.display}</div>
    <div style="font-size:10px;color:#64748B;line-height:1.5;margin-bottom:16px;">
      Overall average rank for the <strong style="color:#374151;">${geoGridKeywords.length}</strong> most searched keywords on Google for your business
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:4px;padding:4px 11px;background:#DCFCE7;border-radius:20px;">
        <div style="width:7px;height:7px;border-radius:50%;background:#059669;"></div>
        <span style="font-size:9px;font-weight:700;color:#065F46;">Top 5</span>
      </div>
      <div style="display:flex;align-items:center;gap:4px;padding:4px 11px;background:#FEF3C7;border-radius:20px;">
        <div style="width:7px;height:7px;border-radius:50%;background:#D97706;"></div>
        <span style="font-size:9px;font-weight:700;color:#92400E;">Under 10</span>
      </div>
      <div style="display:flex;align-items:center;gap:4px;padding:4px 11px;background:#FEE2E2;border-radius:20px;">
        <div style="width:7px;height:7px;border-radius:50%;background:#DC2626;"></div>
        <span style="font-size:9px;font-weight:700;color:#991B1B;">Beyond 10</span>
      </div>
    </div>` : `<div style="font-size:13px;color:#94A3B8;padding:20px 0;text-align:center;">Geo-grid data unavailable</div>`}
  </div>

  <!-- Profile Score -->
  <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
    padding:24px;box-shadow:0 1px 4px rgba(0,0,0,0.05);
    text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:18px;">
      <span style="font-size:16px;font-weight:900;
        background:linear-gradient(90deg,#4285F4,#EA4335,#FBBC05,#34A853);
        -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
        color:#4285F4;">Google</span>
      <span style="font-size:13px;font-weight:700;color:#374151;">Profile Score</span>
    </div>
    ${svgRing(overallScore, '#2563EB', 130)}
    <div style="font-size:10px;color:#64748B;margin-top:14px;line-height:1.6;max-width:190px;">
      Based on 25+ parameters — SEO, Reviews, Completion, Rating.
    </div>
    <div style="margin-top:8px;font-size:10px;font-weight:700;padding:4px 14px;border-radius:20px;
      background:${overallScore >= 90 ? '#DCFCE7' : overallScore >= 60 ? '#FEF3C7' : '#FEE2E2'};
      color:${overallScore >= 90 ? '#059669' : overallScore >= 60 ? '#D97706' : '#DC2626'};">
      ${overallScore >= 90 ? '✓ Excellent' : overallScore >= 60 ? '⚠ Needs Improvement' : '✗ Poor — Action Required'}
    </div>
    <div style="font-size:9px;color:#94A3B8;margin-top:6px;">Good businesses score more than 90%</div>
  </div>

</div>`;

  // ── RANK ANALYTICS ────────────────────────────────────────────────────────────
  const rankAnalyticsHtml = `
<div style="margin-bottom:20px;">
  ${sectionDivider('Your Google Rank Analytics')}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">

    <!-- Keyword rank table -->
    <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
      padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
      <div style="font-size:9px;font-weight:700;color:#64748B;text-transform:uppercase;
        letter-spacing:1px;margin-bottom:10px;">Your rank for top keywords</div>
      ${hasGeoGrid ? `
      <table>
        <thead>
          <tr>
            <th style="font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;
              letter-spacing:.8px;padding:6px 8px;text-align:left;border-bottom:1.5px solid #F1F5F9;">KEYWORD</th>
            <th style="font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;
              letter-spacing:.8px;padding:6px 8px;text-align:center;border-bottom:1.5px solid #F1F5F9;white-space:nowrap;">AVG RANK</th>
          </tr>
        </thead>
        <tbody>
          ${geoGridKeywords.map((k, i) => `
          <tr style="background:${i % 2 === 0 ? '#FAFAFA' : '#fff'};">
            <td style="padding:9px 8px;font-size:11px;color:#334155;font-weight:500;
              max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
              border-bottom:1px solid #F1F5F9;">${h(k.keyword)}</td>
            <td style="padding:9px 8px;text-align:center;border-bottom:1px solid #F1F5F9;">${rankBadge(k.avgRank)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : `<div style="padding:16px;text-align:center;color:#94A3B8;font-size:11px;">No keyword data available</div>`}
    </div>

    <!-- Competitor table -->
    <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
      padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
      <div style="font-size:9px;font-weight:700;color:#64748B;text-transform:uppercase;
        letter-spacing:1px;margin-bottom:10px;">Competitors ranking higher at your locations</div>
      ${localPackComps.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th style="font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;
              letter-spacing:.8px;padding:6px 8px;text-align:left;border-bottom:1.5px solid #F1F5F9;">NAME</th>
            <th style="font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;
              letter-spacing:.8px;padding:6px 8px;text-align:center;border-bottom:1.5px solid #F1F5F9;white-space:nowrap;">AVG RANK</th>
          </tr>
        </thead>
        <tbody>
          ${localPackComps.slice(0, 6).map((c, i) => `
          <tr style="background:${i % 2 === 0 ? '#FAFAFA' : '#fff'};">
            <td style="padding:9px 8px;border-bottom:1px solid #F1F5F9;">
              <div style="display:flex;align-items:center;gap:7px;">
                <div style="width:22px;height:22px;border-radius:6px;background:#F1F5F9;
                  display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;">🏢</div>
                <span style="font-size:11px;color:#334155;font-weight:500;overflow:hidden;
                  text-overflow:ellipsis;white-space:nowrap;max-width:155px;">${h(String(c.name ?? ''))}</span>
              </div>
            </td>
            <td style="padding:9px 8px;text-align:center;border-bottom:1px solid #F1F5F9;">
              ${rankBadge(Number(c.avgRank ?? 21))}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>` : `<div style="padding:16px;text-align:center;color:#94A3B8;font-size:11px;">No competitor data available</div>`}
    </div>

  </div>
</div>`;

  // ── GEO-GRID MAPS ─────────────────────────────────────────────────────────────
  let mapSectionHtml = '';
  if (hasGeoGrid) {
    // Build grid visualizations for all keywords, 2-per-row
    const gridCards = geoGridKeywords.map(kw => renderGeoGrid(kw));
    const gridRows: string[] = [];
    for (let i = 0; i < gridCards.length; i += 2) {
      const pair = gridCards.slice(i, i + 2);
      if (pair.length < 2) pair.push('<div></div>');
      gridRows.push(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">${pair.join('')}</div>`);
    }

    // Optional: static maps for first 2 keywords if API key present
    let staticMaps = '';
    if (mapsApiKey) {
      const toMap = geoGridKeywords.slice(0, 2);
      const cards = toMap.map(kw => {
        const center = coordinates ?? gridCenter(kw.points);
        const mapSrc = staticMapUrl(center.lat, center.lng, kw.points, mapsApiKey);
        const m = rankMeta(kw.avgRank);
        return `
<div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
  overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
  <div style="padding:12px 16px;border-bottom:1px solid #F1F5F9;">
    <div style="font-size:9px;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:2px;">Street-level view</div>
    <div style="font-size:11px;font-weight:700;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">"${h(kw.keyword)}"</div>
    <div style="margin-top:4px;font-size:10px;font-weight:700;color:${m.text};">Avg. Rank: ${m.display} · ${m.label}</div>
  </div>
  <img src="${mapSrc}" alt="Map for ${h(kw.keyword)}"
    style="width:100%;height:200px;object-fit:cover;"
    onerror="this.parentElement.style.display='none'"/>
  <div style="padding:8px 16px;background:#F8FAFC;display:flex;gap:10px;align-items:center;font-size:9px;font-weight:700;">
    <span style="color:#1D4ED8;">Y = Your Location</span>
    <span style="color:#059669;">● 1–5</span>
    <span style="color:#D97706;">● 6–10</span>
    <span style="color:#DC2626;">● 11+</span>
  </div>
</div>`;
      });
      staticMaps = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">${cards.join('')}</div>`;
    }

    mapSectionHtml = `
<div style="margin-bottom:20px;break-before:page;">
  ${sectionDivider(
    `Your Google Search Rank at Nearby Locations (${areaSqKm} sq. km. area)`,
    `${gridSpacingKm} km spacing · ${geoGridKeywords.length} keywords tracked`,
  )}
  ${gridRows.join('')}
  ${staticMaps}
</div>`;
  }

  // ── PROFILE SCORE BREAKDOWN (Page 2) ─────────────────────────────────────────
  const profileBreakdownHtml = `
<div style="margin-bottom:20px;break-before:page;">
  ${sectionDivider(`Your Profile Score (${overallScore}%)`, 'Detailed breakdown across all audit dimensions')}

  <!-- Row 1: SEO Score + Services/Categories -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">

    <!-- SEO Score ring + missing areas -->
    <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
      padding:20px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
      <div style="font-size:9px;font-weight:700;color:#64748B;text-transform:uppercase;
        letter-spacing:1px;margin-bottom:14px;">Profile SEO Score</div>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;">
        ${svgRing(seoScore, '#7C3AED', 90)}
        <div>
          <div style="font-size:9px;color:#94A3B8;font-weight:600;margin-bottom:6px;">Should be above 80%</div>
          <div style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:9px;font-weight:700;
            background:${seoScore >= 80 ? '#DCFCE7' : '#FEE2E2'};
            color:${seoScore >= 80 ? '#059669' : '#DC2626'};">
            ${seoScore >= 80 ? 'Good' : 'Needs Improvement'}
          </div>
        </div>
      </div>
      ${(missingOpps.length > 0 || missingKeywords.length > 0) ? `
      <div style="border-top:1px solid #F1F5F9;padding-top:12px;">
        <div style="font-size:9px;font-weight:700;color:#64748B;margin-bottom:8px;
          text-transform:uppercase;letter-spacing:0.8px;">Top searched keywords are missing in:</div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          ${missingOpps.slice(0, 5).map(o => `
          <div style="display:flex;align-items:flex-start;gap:6px;padding:5px 9px;
            background:#FFF5F5;border-radius:7px;border-left:2px solid #FCA5A5;">
            <span style="color:#DC2626;font-size:9px;flex-shrink:0;margin-top:1px;font-weight:700;">•</span>
            <span style="font-size:10px;color:#374151;line-height:1.4;">${h(o)}</span>
          </div>`).join('')}
          ${missingKeywords.slice(0, 2).map(k => `
          <div style="display:flex;align-items:center;gap:6px;padding:4px 9px;
            background:#F8FAFC;border-radius:7px;">
            <span style="font-size:9px;font-weight:700;color:#94A3B8;">MISSING:</span>
            <span style="font-size:10px;color:#DC2626;font-weight:600;">${h(k)}</span>
          </div>`).join('')}
        </div>
      </div>` : `<div style="border-top:1px solid #F1F5F9;padding-top:12px;font-size:10px;color:#059669;font-weight:600;">
        ✓ All key areas covered</div>`}
    </div>

    <!-- Services + Categories + Tier boxes -->
    <div style="display:flex;flex-direction:column;gap:10px;">
      <!-- Services -->
      <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
        padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,0.05);
        display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:13px;font-weight:800;color:#0F172A;margin-bottom:3px;">Services</div>
          <div style="font-size:10px;color:#64748B;">Should add up to 20 services</div>
        </div>
        <div style="padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;
          background:${servGood ? '#DCFCE7' : '#FEE2E2'};color:${servGood ? '#059669' : '#DC2626'};">
          ${servGood ? 'Added ✓' : 'Missing ✗'}
        </div>
      </div>
      <!-- Additional Categories -->
      <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
        padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,0.05);
        display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:13px;font-weight:800;color:#0F172A;margin-bottom:3px;">Additional Categories</div>
          <div style="font-size:10px;color:#64748B;">Should have 5+ categories</div>
        </div>
        <div style="padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;
          background:${catGood ? '#DCFCE7' : '#FEE2E2'};color:${catGood ? '#059669' : '#DC2626'};">
          ${catGood ? 'Added ✓' : 'Missing ✗'}
        </div>
      </div>
      ${businessTier ? `
      <!-- Business Tier -->
      <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
        padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,0.05);
        display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:13px;font-weight:800;color:#0F172A;margin-bottom:3px;">Business Tier</div>
          <div style="font-size:10px;color:#64748B;">AI-classified market position</div>
        </div>
        <div style="padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;
          background:#EDE9FE;color:#6D28D9;">${h(businessTier)}</div>
      </div>` : ''}
    </div>

  </div>

  <!-- Row 2: Reviews/Week + Response Rate + Suspension Risk -->
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;">

    <!-- Reviews Per Week -->
    <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
      padding:18px;box-shadow:0 1px 4px rgba(0,0,0,0.05);text-align:center;">
      <div style="font-size:9px;font-weight:700;color:#64748B;text-transform:uppercase;
        letter-spacing:1px;margin-bottom:14px;">Reviews Per Week</div>
      <div style="font-size:40px;font-weight:900;line-height:1;margin-bottom:8px;
        color:${reviewsPerWeek >= industryAvg ? '#059669' : '#DC2626'};">${reviewsPerWeek.toFixed(2)}</div>
      <div style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:9px;font-weight:700;margin-bottom:8px;
        background:${reviewsPerWeek >= industryAvg ? '#DCFCE7' : '#FEE2E2'};
        color:${reviewsPerWeek >= industryAvg ? '#059669' : '#DC2626'};">
        ${reviewsPerWeek >= industryAvg ? 'Good' : 'Poor'}
      </div>
      <div style="font-size:9px;color:#94A3B8;">Industry average is <strong>${industryAvg}/week</strong></div>
    </div>

    <!-- Response Percentage -->
    <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
      padding:18px;box-shadow:0 1px 4px rgba(0,0,0,0.05);text-align:center;">
      <div style="font-size:9px;font-weight:700;color:#64748B;text-transform:uppercase;
        letter-spacing:1px;margin-bottom:12px;">Response Percentage</div>
      ${svgRing(responseRatePct, '#0891B2', 92)}
      <div style="margin-top:8px;display:inline-block;padding:3px 12px;border-radius:20px;font-size:9px;font-weight:700;
        background:${responseRatePct >= 80 ? '#DCFCE7' : '#FEE2E2'};
        color:${responseRatePct >= 80 ? '#059669' : '#DC2626'};">
        ${responseRatePct >= 80 ? 'Good' : 'Poor'}
      </div>
      <div style="font-size:9px;color:#94A3B8;margin-top:6px;">Should reply to 80% of reviews</div>
    </div>

    <!-- Suspension Risk -->
    <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
      padding:18px;box-shadow:0 1px 4px rgba(0,0,0,0.05);text-align:center;">
      <div style="font-size:9px;font-weight:700;color:#64748B;text-transform:uppercase;
        letter-spacing:1px;margin-bottom:12px;">Suspension Risk</div>
      ${svgRing(suspPct, suspColor, 92)}
      <div style="margin-top:8px;display:inline-block;padding:3px 12px;border-radius:20px;font-size:9px;font-weight:700;
        background:${suspBg};color:${suspColor};">
        ${suspLevel}
      </div>
      <div style="font-size:9px;color:#94A3B8;margin-top:6px;">0 Policy Violation</div>
    </div>

  </div>
</div>`;

  // ── PROFILE COMPLETION CHECKLIST ──────────────────────────────────────────────
  const half = Math.ceil(checklist.length / 2);
  const col1 = checklist.slice(0, half);
  const col2 = checklist.slice(half);

  const renderChecklistItem = (item: IChecklistItem) => {
    const sc = statusColor(item.status);
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:9px;
      margin-bottom:4px;break-inside:avoid;background:${sc.rowBg};border:1px solid ${sc.border};">
      ${checkIcon(item.status)}
      <span style="font-size:11px;font-weight:500;color:#1E293B;flex:1;">${h(item.field)}</span>
      <span style="font-size:9px;font-weight:700;color:${sc.text};">${item.status}</span>
    </div>`;
  };

  const checklistHtml = `
<div style="margin-bottom:20px;">
  <div style="display:flex;align-items:center;justify-content:space-between;
    margin-bottom:14px;padding-bottom:10px;border-bottom:1.5px solid #E2E8F0;">
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="width:4px;height:20px;background:linear-gradient(180deg,#2563EB,#7C3AED);border-radius:2px;flex-shrink:0;"></div>
      <span style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#0F172A;">Your Profile Completion</span>
    </div>
    <div style="display:flex;align-items:center;gap:14px;">
      <div style="display:flex;gap:8px;font-size:9px;">
        <span style="display:flex;align-items:center;gap:3px;">
          <span style="width:9px;height:9px;border-radius:50%;background:#DCFCE7;border:1.5px solid #059669;display:inline-block;"></span>
          <span style="font-weight:700;color:#059669;">Complete</span>
        </span>
        <span style="display:flex;align-items:center;gap:3px;">
          <span style="width:9px;height:9px;border-radius:50%;background:#FEF3C7;border:1.5px solid #D97706;display:inline-block;"></span>
          <span style="font-weight:700;color:#D97706;">Partial</span>
        </span>
        <span style="display:flex;align-items:center;gap:3px;">
          <span style="width:9px;height:9px;border-radius:50%;background:#FEE2E2;border:1.5px solid #DC2626;display:inline-block;"></span>
          <span style="font-weight:700;color:#DC2626;">Incomplete</span>
        </span>
      </div>
      <span style="font-size:14px;font-weight:900;color:#2563EB;">${completionPct}%</span>
    </div>
  </div>

  <!-- Progress bar -->
  <div style="height:7px;background:#E8EDF4;border-radius:4px;margin-bottom:16px;overflow:hidden;">
    <div style="height:100%;background:linear-gradient(90deg,#2563EB,#7C3AED);
      width:${completionPct}%;border-radius:4px;"></div>
  </div>

  ${checklist.length > 0 ? `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
    <div>${col1.map(renderChecklistItem).join('')}</div>
    <div>${col2.map(renderChecklistItem).join('')}</div>
  </div>
  <div style="margin-top:12px;padding:10px 14px;background:#EFF6FF;border-radius:9px;
    border:1px solid #BFDBFE;display:flex;align-items:center;gap:8px;">
    <span style="font-size:15px;">ℹ️</span>
    <span style="font-size:10px;color:#1D4ED8;font-weight:500;">
      ${completeCount} of ${checklist.length} profile fields complete.
      ${checklist.length - completeCount > 0 ? `Complete the remaining ${checklist.length - completeCount} fields to reach 100%.` : 'Your profile is fully complete!'}
    </span>
  </div>` : `<div style="padding:20px;background:#F8FAFC;border-radius:10px;color:#94A3B8;
    font-size:12px;text-align:center;">Profile completion checklist not available</div>`}
</div>`;

  // ── AI INSIGHTS PAGE ──────────────────────────────────────────────────────────
  let aiHtml = '';
  if (hasAiData) {
    aiHtml = `
<div style="break-before:page;">
  ${sectionDivider('AI-Powered Growth Intelligence', 'Actionable recommendations powered by GMBBoost AI')}

  ${executiveSummary ? `
  <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
    padding:18px 20px;margin-bottom:16px;border-left:4px solid #2563EB;
    box-shadow:0 1px 4px rgba(0,0,0,0.05);">
    <div style="font-size:9px;font-weight:700;color:#64748B;text-transform:uppercase;
      letter-spacing:1px;margin-bottom:8px;">Executive Summary</div>
    <div style="font-size:11px;color:#334155;line-height:1.65;">${h(executiveSummary)}</div>
  </div>` : ''}

  ${(strengths.length > 0 || weaknesses.length > 0) ? `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
    ${strengths.length > 0 ? `
    <div class="nb" style="background:#fff;border:1px solid #BBF7D0;border-radius:14px;
      padding:18px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:12px;">
        <div style="width:10px;height:10px;border-radius:50%;background:#059669;"></div>
        <span style="font-size:9px;font-weight:700;color:#064E3B;text-transform:uppercase;letter-spacing:1px;">Strengths</span>
      </div>
      ${strengths.slice(0, 4).map(s => `
      <div style="margin-bottom:8px;padding:9px 12px;background:#F0FDF4;border-radius:8px;
        border-left:2px solid #34D399;">
        <div style="font-size:10px;font-weight:700;color:#065F46;margin-bottom:2px;">${h(s.title)}</div>
        ${s.evidence ? `<div style="font-size:9px;color:#059669;line-height:1.4;">${h(s.evidence)}</div>` : ''}
      </div>`).join('')}
    </div>` : ''}
    ${weaknesses.length > 0 ? `
    <div class="nb" style="background:#fff;border:1px solid #FECACA;border-radius:14px;
      padding:18px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:12px;">
        <div style="width:10px;height:10px;border-radius:50%;background:#DC2626;"></div>
        <span style="font-size:9px;font-weight:700;color:#7F1D1D;text-transform:uppercase;letter-spacing:1px;">Weaknesses</span>
      </div>
      ${weaknesses.slice(0, 4).map(w => `
      <div style="margin-bottom:8px;padding:9px 12px;background:#FFF5F5;border-radius:8px;
        border-left:2px solid #FCA5A5;">
        <div style="font-size:10px;font-weight:700;color:#991B1B;margin-bottom:2px;">${h(w.title)}</div>
        ${w.evidence ? `<div style="font-size:9px;color:#DC2626;line-height:1.4;">${h(w.evidence)}</div>` : ''}
      </div>`).join('')}
    </div>` : ''}
  </div>` : ''}

  ${priorityFixes.length > 0 ? `
  <div style="margin-bottom:16px;">
    <div style="font-size:9px;font-weight:700;color:#64748B;text-transform:uppercase;
      letter-spacing:1px;margin-bottom:10px;">Priority Action Plan</div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${priorityFixes.slice(0, 5).map((fix, i) => {
        const imp = impactStyle(fix.impact);
        const eff = effortStyle(fix.effort);
        return `
      <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;
        padding:14px 16px;display:flex;align-items:flex-start;gap:12px;
        box-shadow:0 1px 4px rgba(0,0,0,0.05);">
        <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#1E3A8A,#2563EB);
          display:flex;align-items:center;justify-content:center;
          font-size:11px;font-weight:900;color:#fff;flex-shrink:0;">${i + 1}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:11px;font-weight:700;color:#0F172A;margin-bottom:4px;">${h(fix.title)}</div>
          <div style="font-size:10px;color:#64748B;margin-bottom:8px;line-height:1.45;">${h(fix.reason)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;">
            <span style="padding:2px 9px;border-radius:20px;font-size:8px;font-weight:700;
              background:${imp.bg};color:${imp.text};">Impact: ${fix.impact}</span>
            <span style="padding:2px 9px;border-radius:20px;font-size:8px;font-weight:700;
              background:${eff.bg};color:${eff.text};">Effort: ${fix.effort}</span>
            ${fix.expectedScoreGain ? `<span style="padding:2px 9px;border-radius:20px;font-size:8px;font-weight:700;
              background:#EDE9FE;color:#6D28D9;">Score: +${h(fix.expectedScoreGain)}</span>` : ''}
          </div>
        </div>
      </div>`;
      }).join('')}
    </div>
  </div>` : ''}

  ${quickWins.length > 0 ? `
  <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
    padding:16px 18px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
    <div style="font-size:9px;font-weight:700;color:#64748B;text-transform:uppercase;
      letter-spacing:1px;margin-bottom:10px;">⚡ Quick Wins</div>
    <div style="display:flex;flex-wrap:wrap;gap:7px;">
      ${quickWins.map(w => `<span style="padding:4px 12px;background:#EFF6FF;color:#1D4ED8;
        border:1px solid #BFDBFE;border-radius:20px;font-size:10px;font-weight:600;">${h(w)}</span>`).join('')}
    </div>
  </div>` : ''}

  ${(thirtyDayPlan.length > 0 || ninetyDayPlan.length > 0) ? `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
    ${thirtyDayPlan.length > 0 ? `
    <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
      padding:18px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
        <div style="width:30px;height:30px;border-radius:9px;background:#DBEAFE;
          display:flex;align-items:center;justify-content:center;font-size:14px;">📅</div>
        <span style="font-size:11px;font-weight:800;color:#1E3A8A;">30-Day Plan</span>
      </div>
      ${thirtyDayPlan.map(w => `
      <div style="margin-bottom:10px;">
        <div style="font-size:9px;font-weight:700;color:#2563EB;margin-bottom:4px;
          text-transform:uppercase;letter-spacing:0.5px;">${h(w.week)}</div>
        ${w.tasks.map(t => `<div style="font-size:10px;color:#475569;padding:2px 0;padding-left:12px;
          position:relative;"><span style="position:absolute;left:0;color:#94A3B8;">›</span>${h(t)}</div>`).join('')}
        ${w.expectedOutcome ? `<div style="font-size:9px;color:#059669;margin-top:5px;
          font-style:italic;">→ ${h(w.expectedOutcome)}</div>` : ''}
      </div>`).join('')}
    </div>` : ''}
    ${ninetyDayPlan.length > 0 ? `
    <div class="nb" style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;
      padding:18px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
        <div style="width:30px;height:30px;border-radius:9px;background:#EDE9FE;
          display:flex;align-items:center;justify-content:center;font-size:14px;">🗓️</div>
        <span style="font-size:11px;font-weight:800;color:#5B21B6;">90-Day Plan</span>
      </div>
      ${ninetyDayPlan.map(m => `
      <div style="margin-bottom:10px;">
        <div style="font-size:9px;font-weight:700;color:#7C3AED;margin-bottom:4px;
          text-transform:uppercase;letter-spacing:0.5px;">${h(m.month)}</div>
        ${m.tasks.slice(0, 3).map(t => `<div style="font-size:10px;color:#475569;padding:2px 0;padding-left:12px;
          position:relative;"><span style="position:absolute;left:0;color:#94A3B8;">›</span>${h(t)}</div>`).join('')}
      </div>`).join('')}
    </div>` : ''}
  </div>` : ''}
</div>`;
  }

  // ── FOOTER ────────────────────────────────────────────────────────────────────
  const footerHtml = `
<div class="nb" style="margin-top:24px;background:linear-gradient(135deg,#0F172A 0%,#1E3A8A 50%,#1D4ED8 100%);
  border-radius:16px;padding:22px 28px;color:#fff;
  display:flex;align-items:center;justify-content:space-between;">
  <div style="display:flex;align-items:center;gap:14px;">
    <div style="width:38px;height:38px;background:rgba(255,255,255,0.12);border-radius:10px;
      display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;">G</div>
    <div>
      <div style="font-size:15px;font-weight:900;letter-spacing:0.3px;margin-bottom:2px;">GMBBoost</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.5);">AI-Powered Google Business Growth Platform</div>
    </div>
  </div>
  <div style="text-align:right;">
    <div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.65);margin-bottom:3px;">Google Business Profile Audit Report</div>
    <div style="font-size:9px;color:rgba(255,255,255,0.35);">Confidential · Generated ${genDate}</div>
  </div>
</div>`;

  // ── Final document ─────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>GMBBoost Audit Report – ${h(audit.businessName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"/>
<style>${css}</style>
</head>
<body>
${headerHtml}
${heroHtml}
${rankAnalyticsHtml}
${mapSectionHtml}
${profileBreakdownHtml}
${checklistHtml}
${aiHtml}
${footerHtml}
</body>
</html>`;
}

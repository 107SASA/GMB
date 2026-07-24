'use client';

import { useState } from 'react';
import {
  IAudit,
  IAuditData,
  IChecklistItem,
  IGeoGridKeyword,
  ILocalPackCompetitor,
  IGeoGridPoint,
} from '@/models/Audit';
import { Download, RefreshCw, Share2, Copy, Check } from 'lucide-react';

/* ─── Google Logo ───────────────────────────────────────────────────────────── */
function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

/* ─── Star Rating ───────────────────────────────────────────────────────────── */
function StarRating({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} className={`w-4 h-4 ${i <= full ? 'text-yellow-400' : 'text-slate-200'}`} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}

/* ─── Circular Gauge ────────────────────────────────────────────────────────── */
function CircularGauge({ value, size = 96, color = '#3b82f6' }: { value: number; size?: number; color?: string }) {
  const strokeWidth = Math.round(size * 0.1);
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const v = Math.min(100, Math.max(0, value));
  const used = (v / 100) * circ;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={`${used.toFixed(1)} ${(circ - used).toFixed(1)}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-black text-slate-900" style={{ fontSize: Math.round(size * 0.22) }}>{v}%</span>
      </div>
    </div>
  );
}

/* ─── Status Badge ──────────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Good:    'bg-emerald-500 text-white',
    Poor:    'bg-red-500 text-white',
    Average: 'bg-amber-400 text-white',
    Low:     'bg-emerald-500 text-white',
    High:    'bg-red-500 text-white',
    Medium:  'bg-amber-400 text-white',
  };
  return (
    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${styles[status] ?? 'bg-slate-400 text-white'}`}>
      {status}
    </span>
  );
}

/* ─── Checklist Row ─────────────────────────────────────────────────────────── */
function ChecklistRow({ field, status }: { field: string; status: string }) {
  if (status === 'Complete')
    return (
      <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
        <span className="text-sm text-slate-700">{field}</span>
        <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#22c55e" /><path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
      </div>
    );
  if (status === 'Partial')
    return (
      <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
        <span className="text-sm text-slate-700">{field}</span>
        <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#f97316" /><path d="M12 7v5M12 16h.01" stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none" /></svg>
      </div>
    );
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-700">{field}</span>
      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ef4444" /><path d="M15 9l-6 6M9 9l6 6" stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none" /></svg>
    </div>
  );
}

/* ─── Rank colour helpers ───────────────────────────────────────────────────── */
function rankTextClass(rank: number) {
  if (rank <= 5)  return 'text-emerald-600';
  if (rank <= 10) return 'text-amber-500';
  return 'text-red-500';
}


/* ─── Geo Map Card ──────────────────────────────────────────────────────────── */
function GeoGridMap({
  auditId,
  kwIndex,
  keyword,
  avgRank,
}: {
  auditId: string;
  kwIndex: number;
  keyword: string;
  avgRank: number;
  points: IGeoGridPoint[];
}) {
  const [mapOk, setMapOk] = useState(true);
  const rankCls = rankTextClass(avgRank);

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-md flex flex-col">
      {/* Header */}
      <div className="px-5 py-3 bg-slate-900">
        <p className="text-xs text-slate-300 mb-0.5">
          Keyword: <span className="font-bold text-white">{keyword}</span>
        </p>
        <p className="text-sm text-slate-300">
          Avg Rank: <span className={`font-black text-base ${rankCls}`}>{avgRank.toFixed(1)}</span>
        </p>
      </div>

      {/* Map — full size, markers already baked in by geo-map API */}
      {mapOk ? (
        <img
          src={`/api/audit/${auditId}/geo-map?kwIndex=${kwIndex}`}
          className="w-full object-cover"
          style={{ minHeight: 320 }}
          alt={`Rank map for ${keyword}`}
          onError={() => setMapOk(false)}
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 bg-slate-100" style={{ minHeight: 320 }}>
          <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          <p className="text-xs text-slate-400 font-medium">Map preview unavailable</p>
          <p className="text-[10px] text-slate-400">Ensure GOOGLE_MAPS_API_KEY is configured</p>
        </div>
      )}

      {/* Legend */}
      <div className="px-4 py-2.5 bg-white border-t border-slate-100 flex items-center gap-4 flex-wrap">
        {[
          { bg: '#1d4ed8', label: 'You' },
          { bg: '#22c55e', label: '1–5' },
          { bg: '#f59e0b', label: '6–10' },
          { bg: '#ef4444', label: '20+' },
        ].map(({ bg, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: bg }} />
            <span className="text-[10px] font-semibold text-slate-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  MAIN COMPONENT                                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */
export default function AuditReportGrexa({
  audit,
  onDownload,
  onResync,
  onShare,
  isSyncing = false,
}: {
  audit: IAudit;
  onDownload: () => void;
  onResync?: () => void;
  onShare?: () => void;
  isSyncing?: boolean;
}) {
  const data = audit.auditData as IAuditData;
  if (!data) return <div className="p-8 text-center text-slate-500">No audit data available.</div>;

  const auditId = String((audit as any)._id ?? '');

  /* ── Data extraction ──────────────────────────────────────────────── */
  const geoGrid      = data.geoGridRank;
  const keywords     = geoGrid?.keywords ?? [];
  // Only show top 2 keywords in the map section
  const mapKeywords  = keywords.slice(0, 2);

  const overallRank  = geoGrid?.overallAvgRank ?? data.googleSearchRank?.averageRank ?? 0;
  const profilePct   = data.profileScore?.overallScore ?? 0;
  const seoPct       = data.seoScore?.score ?? 0;
  const optOps       = data.seoScore?.optimizationOpportunities ?? [];
  const missingKw    = data.seoScore?.missingKeywords ?? [];

  const reviews      = data.reviewAnalysis;
  const rating       = reviews?.averageRating ?? 0;
  const reviewCount  = reviews?.reviewCount ?? 0;
  const rpw          = reviews?.reviewsPerWeek ?? 0;
  const industryAvg  = reviews?.industryAverage ?? 2;
  const responseStr  = reviews?.responseRate ?? '0%';
  const responsePct  = parseInt(responseStr.replace('%', '')) || 0;

  const completion    = data.profileCompletion;
  const completionPct = completion?.completionPercentage ?? 0;
  const checklist     = (completion?.checklist ?? []) as IChecklistItem[];

  const localComps: ILocalPackCompetitor[] = data.localPackCompetitors ?? [];
  const fallbackComps = (data.competitors ?? [])
    .filter((c: any) => c.estimatedRank != null)
    .sort((a: any, b: any) => a.estimatedRank - b.estimatedRank)
    .slice(0, 5);

  /* ── Action Plan (Feature 2B) ─────────────────────────────────────── */
  const thirtyDayPlan = (data as any).thirtyDayPlan ?? [];
  const ninetyDayPlan = (data as any).ninetyDayPlan ?? [];
  const actionPlanMeta = (data as any).actionPlan ?? {};
  const planDurationDays = actionPlanMeta.durationDays ?? (audit as any).actionPlanDurationDays ?? 30;
  const planLabel = actionPlanMeta.planLabel ?? `${planDurationDays}-Day Action Plan`;
  const extendedLabel = actionPlanMeta.extendedLabel ?? `Beyond ${planDurationDays} Days — Ongoing Roadmap`;

  /* ── Review Analysis Period (Feature 2A) ──────────────────────────── */
  const reviewPeriodDays = (audit as any).reviewPeriodDays ?? (audit as any).metadata?.reviewPeriodDays ?? 14;


  /* ── Missing SEO fields ───────────────────────────────────────────── */
  const missingFields: string[] = [];
  const opLower = optOps.map((o: string) => o.toLowerCase()).join(' ');
  if (opLower.includes('title')       || missingKw.length > 0) missingFields.push('Title');
  if (opLower.includes('categor')     || missingKw.length > 0) missingFields.push('Additional Category');
  if (opLower.includes('service')     || missingKw.length > 0) missingFields.push('Services');
  if (opLower.includes('description') || missingKw.length > 0) missingFields.push('Description');
  if (missingFields.length === 0 && seoPct < 80)
    missingFields.push('Title', 'Additional Category', 'Services', 'Description');

  /* ── Services / Categories ────────────────────────────────────────── */
  const servicesItem   = checklist.find((c) => c.field.toLowerCase().includes('service'));
  const categoriesItem = checklist.find((c) => c.field.toLowerCase().includes('categor'));
  const servicesOk     = servicesItem?.status === 'Complete';
  const categoriesOk   = !(categoriesItem?.status === 'Missing' || categoriesItem?.status === 'Unknown');
  const evidence: Record<string, any> = (data as any).evidence ?? {};
  const servicesCnt    = evidence.servicesCount    ?? null;
  const categoriesCnt  = evidence.categoriesCount  ?? null;

  /* ── Suspension risk ──────────────────────────────────────────────── */
  const suspLevel = completionPct >= 70 && reviewCount >= 10 ? 'Low' : completionPct >= 40 ? 'Medium' : 'High';
  const suspPct   = suspLevel === 'High' ? 85 : suspLevel === 'Medium' ? 45 : 0;
  const suspColor = suspLevel === 'Low' ? '#22c55e' : suspLevel === 'Medium' ? '#f59e0b' : '#ef4444';

  /* ── Checklist display ────────────────────────────────────────────── */
  const defaultChecklist: IChecklistItem[] = [
    { field: 'Title',                              status: 'Complete' },
    { field: 'Primary Category',                   status: 'Complete' },
    { field: 'Additional Categories',              status: 'Missing'  },
    { field: 'Business Services',                  status: 'Complete' },
    { field: 'Description',                        status: 'Partial'  },
    { field: 'Address',                            status: 'Complete' },
    { field: 'Phone',                              status: 'Complete' },
    { field: 'Listing Attributes/Service Options', status: 'Complete' },
    { field: 'Photos',                             status: 'Complete' },
    { field: 'Logo',                               status: 'Complete' },
    { field: 'Website',                            status: 'Complete' },
    { field: 'Service Area',                       status: 'Complete' },
    { field: 'Business Hours',                     status: 'Complete' },
    { field: 'Appointment/Ordering Links',         status: 'Complete' },
  ];
  const displayChecklist = checklist.length >= 4 ? checklist : defaultChecklist;
  const half   = Math.ceil(displayChecklist.length / 2);
  const leftCL = displayChecklist.slice(0, half);
  const rightCL = displayChecklist.slice(half);

  /* ── Colors ───────────────────────────────────────────────────────── */
  const profileColor = profilePct >= 80 ? '#22c55e' : profilePct >= 60 ? '#f59e0b' : '#ef4444';
  const seoColor     = seoPct    >= 80 ? '#22c55e' : seoPct    >= 50 ? '#f59e0b' : '#ef4444';
  // Show actual number for overall rank (not capped at "20+")
  const rankDisplay  = overallRank > 0 ? overallRank.toFixed(1) : '—';
  const rankClass    = overallRank <= 5 ? 'text-emerald-500' : overallRank <= 10 ? 'text-amber-500' : 'text-red-500';

  /* ─── RENDER ──────────────────────────────────────────────────────── */
  return (
    <div className="max-w-5xl mx-auto pb-16 space-y-5 font-sans">

      {/* ══ 1. REPORT HEADER ═══════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-2">
            <GoogleLogo size={18} />
            <span className="text-sm font-semibold text-slate-700">
              Google Search Rank Report for Your Business Profile
            </span>
          </div>
          <div className="flex items-center gap-2">
            {onResync && (
              <button
                data-pdf-hide="true"
                onClick={onResync}
                disabled={isSyncing}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
                title="Re-sync reviews"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              </button>
            )}
            {onShare && (
              <button
                data-pdf-hide="true"
                onClick={onShare}
                className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold px-4 py-2 rounded-xl transition-colors shadow-sm"
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>
            )}
            <button
              data-pdf-hide="true"
              onClick={onDownload}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" />
              Download PDF
            </button>
          </div>
        </div>
        <div className="px-6 py-5">
          <h1 className="text-2xl font-extrabold text-slate-900 mb-2 leading-tight">{audit.businessName}</h1>
          <div className="flex items-center flex-wrap gap-2 text-sm text-slate-500">
            {rating > 0 && (
              <>
                <StarRating rating={rating} />
                <span className="font-bold text-slate-800">{rating.toFixed(1)}</span>
                {reviewCount > 0 && <span className="text-slate-400">({reviewCount} reviews)</span>}
              </>
            )}
            {audit.address && (
              <>
                {rating > 0 && <span className="text-slate-200">|</span>}
                <span className="text-slate-400 truncate max-w-lg">{audit.address}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ══ 2. HERO CARDS ══════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-5">

        {/* Google Search Rank */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col overflow-hidden relative">
          <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-5"
            style={{ background: 'radial-gradient(circle, #2563eb, transparent)', transform: 'translate(30%,-30%)' }} />
          <div className="flex items-center gap-2 mb-5">
            <GoogleLogo size={18} />
            <span className="text-sm font-bold text-slate-700">Google Search Rank</span>
          </div>
          {overallRank > 0 ? (
            <>
              <div className="mb-2">
                <span className={`text-7xl font-black leading-none tracking-tight ${rankClass}`}>
                  {rankDisplay}
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-5 leading-relaxed">
                Overall average rank for the{' '}
                <strong className="text-slate-700">{keywords.length} most searched keywords</strong>{' '}
                on Google for your business
              </p>
              <div className="flex gap-4 mt-auto text-xs text-slate-600">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 flex-shrink-0" />
                  <span>Top 5</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-amber-400 flex-shrink-0" />
                  <span>Under 10</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500 flex-shrink-0" />
                  <span>Beyond 10</span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
              Geo-grid data unavailable
            </div>
          )}
        </div>

        {/* Google Profile Score */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col overflow-hidden relative">
          <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-5"
            style={{ background: 'radial-gradient(circle, #7c3aed, transparent)', transform: 'translate(30%,-30%)' }} />
          <div className="flex items-center gap-2 mb-5">
            <GoogleLogo size={18} />
            <span className="text-sm font-bold text-slate-700">Google Profile Score</span>
          </div>
          <div className="flex items-center gap-5 flex-1">
            <CircularGauge value={profilePct} size={120} color={profileColor} />
            <div>
              <p className="text-xs text-slate-500 leading-relaxed mb-3">
                Based on 25+ parameters — SEO, Reviews, Completion, Rating.
              </p>
              <p className="text-xs font-semibold text-slate-700">
                Good businesses score more than 90%
              </p>
              <div className="mt-3">
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden w-32">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${profilePct}%`, background: profileColor }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ══ 3. RANK ANALYTICS ════════════════════════════════════════════ */}
      {keywords.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-base font-bold text-slate-900 mb-5">Your Google Rank Analytics</h2>
          <div className="grid grid-cols-2 gap-8">

            {/* Keywords table */}
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                Your rank for top {keywords.length} keywords
              </p>
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-slate-100">
                    <th className="text-left text-[10px] font-bold text-slate-400 uppercase pb-2 tracking-widest">KEYWORD</th>
                    <th className="text-right text-[10px] font-bold text-slate-400 uppercase pb-2 tracking-widest">AVG RANK</th>
                  </tr>
                </thead>
                <tbody>
                  {keywords.slice(0, 5).map((kw: IGeoGridKeyword, i: number) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <td className="py-3 pr-4">
                        <span className="text-sm text-blue-600 font-medium leading-snug">{kw.keyword}</span>
                      </td>
                      <td className="py-3 text-right">
                        <span className={`text-sm font-black ${rankTextClass(kw.avgRank)}`}>
                          {kw.avgRank.toFixed(1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Competitors table */}
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                Competitors ranking higher at your locations
              </p>
              {(localComps.length > 0 || fallbackComps.length > 0) ? (
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2 border-slate-100">
                      <th className="text-left text-[10px] font-bold text-slate-400 uppercase pb-2 tracking-widest">NAME</th>
                      <th className="text-right text-[10px] font-bold text-slate-400 uppercase pb-2 tracking-widest">AVG RANK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(localComps.length > 0 ? localComps : fallbackComps).slice(0, 5).map((c: any, i: number) => {
                      const rank = localComps.length > 0 ? c.avgRank : c.estimatedRank;
                      return (
                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0 text-[9px] font-bold text-slate-400">
                                {i + 1}
                              </div>
                              <span className="text-sm text-slate-700 leading-snug truncate max-w-[160px]">{c.name}</span>
                            </div>
                          </td>
                          <td className="py-3 text-right">
                            <span className={`text-sm font-black ${rankTextClass(rank ?? 15)}`}>
                              {rank != null ? Number(rank).toFixed(1) : '—'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="py-6 text-center text-sm text-slate-400 bg-slate-50 rounded-xl border border-slate-100">
                  No competitor data available
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ 4. GEO-GRID MAPS (top 2 keywords) ═══════════════════════════ */}
      {mapKeywords.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-base font-bold text-slate-900">
            Your Google Search Rank at Nearby Locations
            <span className="text-xs font-normal text-slate-400 ml-2">
              ({geoGrid?.areaSqKm ?? 9} sq. km. area)
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 mb-5">
            Showing top {mapKeywords.length} {mapKeywords.length === 1 ? 'keyword' : 'keywords'} · Search rank at surrounding locations
          </p>
          <div className={`grid gap-5 ${mapKeywords.length === 1 ? 'grid-cols-1 max-w-md' : 'grid-cols-2'}`}>
            {mapKeywords.map((kw: IGeoGridKeyword, i: number) => (
              <GeoGridMap
                key={i}
                auditId={auditId}
                kwIndex={i}
                keyword={kw.keyword}
                avgRank={kw.avgRank}
                points={kw.points}
              />
            ))}
          </div>
        </div>
      )}

      {/* ══ 5. PROFILE SCORE DETAILS ════════════════════════════════════ */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-base font-bold text-slate-900 mb-5">
          Your Profile Score ({profilePct}%)
        </h2>

        {/* Row 1: SEO Score + Services/Categories */}
        <div className="grid grid-cols-3 gap-4 mb-4">

          {/* Profile SEO Score */}
          <div className="col-span-2 border border-slate-100 rounded-2xl p-5 bg-slate-50/40">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Profile SEO Score</p>
            <div className="flex items-start gap-6">
              <div className="flex-shrink-0">
                <CircularGauge value={seoPct} size={96} color={seoColor} />
                <p className="text-[10px] text-center text-slate-400 mt-2">Should be above 80%</p>
              </div>
              <div className="flex-1 pt-1">
                <p className="text-sm font-semibold text-slate-700 mb-3">
                  Top searched keywords are missing in
                </p>
                <ul className="space-y-2">
                  {(missingFields.length > 0 ? missingFields : ['Title', 'Additional Category', 'Services', 'Description']).map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                      <span className="text-sm text-red-600 font-medium">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Services + Categories */}
          <div className="space-y-3">
            <div className="border border-slate-100 rounded-2xl p-4 bg-slate-50/40 flex flex-col justify-between h-[calc(50%-6px)]">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="text-sm font-bold text-slate-800 leading-tight">
                  {servicesCnt !== null ? `${servicesCnt} Services Added` : 'Services'}
                </span>
                <StatusBadge status={servicesOk ? 'Good' : 'Poor'} />
              </div>
              <p className="text-[11px] text-slate-400">Should add up to 20 services</p>
            </div>
            <div className="border border-slate-100 rounded-2xl p-4 bg-slate-50/40 flex flex-col justify-between h-[calc(50%-6px)]">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="text-sm font-bold text-slate-800 leading-tight">
                  {categoriesCnt !== null ? `${categoriesCnt} Categories Added` : 'Categories'}
                </span>
                <StatusBadge status={categoriesOk ? 'Good' : 'Poor'} />
              </div>
              <p className="text-[11px] text-slate-400">Should have 5+ categories</p>
            </div>
          </div>
        </div>

        {/* Row 2: Reviews/Week | Response % | Suspension Risk */}
        <div className="grid grid-cols-3 gap-4">

          {/* Reviews Per Week */}
          <div className="border border-slate-100 rounded-2xl p-5 bg-slate-50/40">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-slate-700">Reviews Per Week</span>
              <StatusBadge status={rpw >= industryAvg ? 'Good' : 'Poor'} />
            </div>
            <div className="mb-1.5">
              <span className="text-4xl font-black text-slate-900">{rpw.toFixed(2)}</span>
              <span className="text-sm font-semibold text-slate-400 ml-1">/Week</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden mb-2">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, (rpw / (industryAvg * 1.5)) * 100)}%`, background: rpw >= industryAvg ? '#22c55e' : '#ef4444' }}
              />
            </div>
            <p className="text-[10px] text-slate-400">
              Industry avg <strong className="text-slate-600">{industryAvg}</strong>/week · based on last {reviewPeriodDays} days
            </p>
          </div>

          {/* Response Percentage */}
          <div className="border border-slate-100 rounded-2xl p-5 bg-slate-50/40">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-slate-700">Response Rate</span>
              <StatusBadge status={responsePct >= 80 ? 'Good' : 'Poor'} />
            </div>
            <div className="flex justify-center my-1">
              <CircularGauge
                value={responsePct}
                size={80}
                color={responsePct >= 80 ? '#22c55e' : '#ef4444'}
              />
            </div>
            <p className="text-[10px] text-slate-400 text-center mt-1">
              Should reply to <strong className="text-slate-600">80%</strong> of reviews
            </p>
          </div>

          {/* Suspension Risk */}
          <div className="border border-slate-100 rounded-2xl p-5 bg-slate-50/40">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-slate-700">Suspension Risk</span>
              <StatusBadge status={suspLevel} />
            </div>
            <div className="flex justify-center my-1">
              <CircularGauge value={suspPct} size={80} color={suspColor} />
            </div>
            <p className="text-[10px] text-slate-400 text-center mt-1">0 Policy Violation</p>
          </div>

        </div>
      </div>

      {/* ══ 6. PROFILE COMPLETION ══════════════════════════════════════ */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Your Profile Completion
              <span className="ml-2 text-2xl font-black text-blue-600">{completionPct}%</span>
            </h2>
            <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden w-40">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${completionPct}%`, background: completionPct >= 90 ? '#22c55e' : completionPct >= 70 ? '#f59e0b' : '#ef4444' }}
              />
            </div>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-slate-600 flex-wrap">
            <span className="text-slate-400 font-medium">Should be 100%</span>
            {[
              { color: '#22c55e', icon: <svg className="w-4 h-4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#22c55e" /><path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none" /></svg>, label: 'Complete' },
              { color: '#f97316', icon: <svg className="w-4 h-4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#f97316" /><path d="M12 7v5M12 16h.01" stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none" /></svg>, label: 'Partial' },
              { color: '#ef4444', icon: <svg className="w-4 h-4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ef4444" /><path d="M15 9l-6 6M9 9l6 6" stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none" /></svg>, label: 'Incomplete' },
            ].map(({ icon, label }) => (
              <div key={label} className="flex items-center gap-1.5">{icon}<span>{label}</span></div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-0 border-t border-slate-100">
          <div className="pr-6 border-r border-slate-100">
            {leftCL.map((item: IChecklistItem, i: number) => (
              <ChecklistRow key={i} field={item.field} status={item.status} />
            ))}
          </div>
          <div className="pl-6">
            {rightCL.map((item: IChecklistItem, i: number) => (
              <ChecklistRow key={i} field={item.field} status={item.status} />
            ))}
          </div>
        </div>
      </div>

      {/* ══ 7. ACTION PLAN (Feature 2B — Improvement Plan Duration) ═════ */}
      {(thirtyDayPlan.length > 0 || ninetyDayPlan.length > 0) && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
            <h2 className="text-base font-bold text-slate-900">{planLabel}</h2>
            <span className="text-[10px] font-bold px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-full uppercase tracking-wider">
              {planDurationDays}-Day Plan
            </span>
          </div>

          <div className="space-y-5 mb-6">
            {thirtyDayPlan.map((period: any, i: number) => (
              <div key={i} className="p-4 bg-slate-50/60 rounded-xl border border-slate-100">
                <h3 className="font-bold text-indigo-600 text-sm uppercase tracking-wide mb-2">
                  {period.week || period.month || `Period ${i + 1}`}
                </h3>
                <ul className="space-y-1.5">
                  {(period.tasks || []).map((t: string, j: number) => (
                    <li key={j} className="text-sm text-slate-600 flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
                {period.expectedOutcome && (
                  <p className="text-xs text-slate-400 mt-2">Expected outcome: {period.expectedOutcome}</p>
                )}
              </div>
            ))}
          </div>

          {ninetyDayPlan.length > 0 && (
            <div className="pt-5 border-t border-slate-100">
              <h3 className="font-bold text-purple-600 text-sm uppercase tracking-wide mb-3">{extendedLabel}</h3>
              {ninetyDayPlan.map((phase: any, i: number) => (
                <div key={i} className="mb-3">
                  <div className="flex gap-2 mb-2 flex-wrap">
                    {(phase.focusAreas || []).map((fa: string, j: number) => (
                      <span key={j} className="text-[10px] font-bold px-2 py-0.5 bg-purple-50 text-purple-600 rounded uppercase tracking-wider">{fa}</span>
                    ))}
                  </div>
                  <ul className="space-y-1.5">
                    {(phase.tasks || []).map((t: string, j: number) => (
                      <li key={j} className="text-sm text-slate-600 flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0" />
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ 8. CTA BANNER ══════════════════════════════════════════════ */}
      <div
        className="rounded-2xl overflow-hidden shadow-lg"
        style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 60%, #9333ea 100%)' }}
      >
        <div className="px-8 py-8 flex items-center justify-between gap-6 flex-wrap">
          <div>
            <h3 className="text-xl font-black text-white mb-1.5 leading-tight">
              Would you like to{' '}
              <span className="text-yellow-300">be on top in</span>
              {' '}Google local searches?
            </h3>
            <p className="text-indigo-200 text-sm">
              Our AI platform optimizes your Google Business Profile automatically.
            </p>
          </div>
          <button
            data-pdf-hide="true"
            onClick={onDownload}
            className="bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-black text-sm px-6 py-3.5 rounded-xl transition-all shadow-xl flex-shrink-0 hover:scale-105"
          >
            Download Full Report
          </button>
        </div>
        <div className="px-8 py-2.5 flex items-center justify-between bg-black/20">
          <span className="text-xs text-indigo-200/70">GrowwMatics AI · AI-Powered Google Business Growth Platform</span>
        </div>
      </div>

    </div>
  );
}

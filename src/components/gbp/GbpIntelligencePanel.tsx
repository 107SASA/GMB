'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';

/**
 * Read-only GBP Intelligence view (FR-3.2 → FR-3.6): connection health, last
 * sync, "Sync now", what Google currently shows, changes made outside
 * GrowwMatics, health issues with the owner's fix steps, and possible
 * duplicate listings. Data comes from GET /api/gbp/intelligence (the stored
 * snapshot — no Google call on page load). Nothing here is editable: Google
 * data is changed in Google Business Profile, not in this view.
 */

type SectionMeta = { status: string; fetchedAt: string | null; lastSuccessfulFetchAt: string | null; error: { category: string } | null; note: string | null };
type Issue = { code: string; state: string; explanation: string; reason: string; recommendedAction: string; ownerActionRequired: boolean; helpUrl: string | null; detectedAt: string };
type Change = { field: string; label: string; previousValue: string | null; newValue: string | null; source: string; detectedAt: string };

interface IntelResponse {
  success: boolean;
  connection: { state: 'NOT_CONNECTED' | 'REAUTH_REQUIRED' | 'CONNECTED'; since?: string | null };
  snapshot: null | {
    fetchedAt: string | null;
    lastSuccessfulSyncAt: string | null;
    lastSyncOutcome: string | null;
    sectionStatus: Record<string, SectionMeta>;
    profile: null | {
      regularHours: string | null;
      specialHours: Array<{ startDate: string; endDate: string; closed: boolean; openTime: string | null; closeTime: string | null }>;
      additionalCategories: string[];
      primaryCategory: string | null;
      services: Array<{ name: string; description: string | null }>;
      serviceArea: string[];
      openStatus: string | null;
      postalCode: string | null;
    };
    attributes: Array<{ label: string; value: string }> | null;
    media: null | { photos: number; videos: number; hasLogo: boolean; hasCover: boolean };
    posts: null | { total: number; truncated: boolean; newestCreateTime: string | null };
    reviews: null | { storedCount: number; googleTotalCount: number | null; unrepliedCount: number; complete: boolean | null };
    products: { available: boolean; note: string | null };
    duplicates: null | { googleFlagged: boolean; candidates: Array<{ placeId: string; name: string; address: string | null; distanceMeters: number | null; signals: string[]; confidence: string }> };
    health: { state: string; issues: Issue[]; lastCheckedAt: string };
    externalChanges: Change[];
  };
}

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const day = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');

const HEALTH_LABEL: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  HEALTHY: { label: 'Healthy', tone: 'ok' },
  NEEDS_ATTENTION: { label: 'Needs attention', tone: 'warn' },
  VERIFICATION_PENDING: { label: 'Verification pending', tone: 'warn' },
  VERIFICATION_REQUIRED: { label: 'Verification required', tone: 'bad' },
  SUSPENDED: { label: 'Suspended by Google', tone: 'bad' },
  REAUTH_REQUIRED: { label: 'Reconnect needed', tone: 'bad' },
  SYNC_ERROR: { label: 'Sync problem', tone: 'warn' },
  UNKNOWN: { label: 'Not checked yet', tone: 'warn' },
};

const TONE_CLS = {
  ok: 'bg-secondary-container/40 text-on-secondary-container border-secondary-fixed',
  warn: 'bg-tertiary-container/40 text-on-tertiary-container border-outline-variant',
  bad: 'bg-error-container text-on-error-container border-error-container',
};

const SOURCE_LABEL: Record<string, string> = {
  GOOGLE_EXTERNAL_CHANGE: 'changed on Google',
  GOOGLE_SUGGESTED_EDIT: 'updated by Google',
  GROWMATICS_EDIT: 'edited in GrowwMatics',
};

function SectionNote({ meta }: { meta?: SectionMeta }) {
  if (!meta) return null;
  if (meta.status === 'FAILED') {
    return <p className="text-xs text-error mt-1">Couldn&apos;t refresh{meta.error ? ` (${meta.error.category.toLowerCase().replace('_', ' ')})` : ''} — showing data from {fmt(meta.lastSuccessfulFetchAt)}.</p>;
  }
  if (meta.status === 'NOT_FETCHED') return <p className="text-xs text-outline mt-1">Not read yet.</p>;
  return null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-outline uppercase tracking-wide">{label}</p>
      <div className="text-sm text-on-surface mt-1 break-words">{children}</div>
    </div>
  );
}

export default function GbpIntelligencePanel({ businessId }: { businessId?: string }) {
  const [data, setData] = useState<IntelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/gbp/intelligence');
      const json = await res.json();
      setData(json?.success ? json : null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setLoading(true); load(); }, [load, businessId]);

  const syncNow = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/gbp/sync', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(json?.error || 'Sync could not start. Please try again.');
      else if (!json.synced) setMessage('Sync started — it is still running and will finish in the background.');
      await load();
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return null;
  if (!data || data.connection.state === 'NOT_CONNECTED') return null;

  const s = data.snapshot;
  const healthState = data.connection.state === 'REAUTH_REQUIRED' ? 'REAUTH_REQUIRED' : s?.health.state || 'UNKNOWN';
  const h = HEALTH_LABEL[healthState] || HEALTH_LABEL.UNKNOWN;
  const issues = (s?.health.issues || []).filter((i) => !(data.connection.state === 'REAUTH_REQUIRED' && i.code === 'SYNC_FAILED'));
  const highDupes = (s?.duplicates?.candidates || []).filter((c) => c.confidence === 'high' || c.confidence === 'medium');
  const st = s?.sectionStatus || {};

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-on-surface">Google listing health &amp; sync</h2>
          <p className="text-xs text-on-surface-variant mt-1 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Last successful sync: {fmt(s?.lastSuccessfulSyncAt)} · syncs automatically every 6 hours
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${TONE_CLS[h.tone]}`}>{h.label}</span>
          {data.connection.state === 'REAUTH_REQUIRED' ? (
            <a href="/api/auth/google" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-white text-sm font-semibold">
              <ExternalLink className="w-4 h-4" /> Reconnect Google
            </a>
          ) : (
            <button onClick={syncNow} disabled={syncing} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant text-sm font-semibold text-on-surface hover:bg-surface-container disabled:opacity-60">
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
      </div>
      {message && <p className="text-xs text-on-surface-variant">{message}</p>}

      {issues.length > 0 && (
        <div className="space-y-3">
          {issues.map((i) => (
            <div key={i.code} className={`rounded-xl border px-4 py-3 ${TONE_CLS[HEALTH_LABEL[i.state]?.tone || 'warn']}`}>
              <p className="text-sm font-semibold flex items-center gap-2"><ShieldAlert className="w-4 h-4 shrink-0" /> {i.explanation}</p>
              <p className="text-xs mt-1">{i.recommendedAction}</p>
              <p className="text-[11px] mt-1 opacity-80">Source: {i.reason} · since {day(i.detectedAt)}{i.ownerActionRequired ? ' · owner action needed' : ''}</p>
              {i.helpUrl && (
                <a href={i.helpUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold underline mt-1">
                  Open Google Business Profile <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      {issues.length === 0 && s && healthState === 'HEALTHY' && (
        <p className="text-sm text-on-surface-variant flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Google reports no verification, suspension or duplicate issues.</p>
      )}

      {highDupes.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-on-surface flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Possible duplicate listings nearby</p>
          {highDupes.map((c) => (
            <div key={c.placeId} className="text-xs text-on-surface-variant border border-outline-variant rounded-lg px-3 py-2">
              <span className="font-semibold text-on-surface">{c.name}</span>{c.address ? ` — ${c.address}` : ''}
              {c.distanceMeters != null ? ` · ${c.distanceMeters} m away` : ''} · {c.signals.join(', ')} ({c.confidence} confidence)
            </div>
          ))}
          <p className="text-xs text-outline">Verify whether this Google listing represents the same business before taking action. GrowwMatics never merges or removes listings.</p>
        </div>
      )}

      {s && s.externalChanges.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-on-surface">Recent changes detected on Google</p>
          <ul className="space-y-1.5">
            {s.externalChanges.slice(0, 8).map((c, idx) => (
              <li key={`${c.field}-${c.detectedAt}-${idx}`} className="text-xs text-on-surface-variant">
                <span className="font-semibold text-on-surface">{c.label}</span> ({SOURCE_LABEL[c.source] || c.source}, {day(c.detectedAt)}): {c.previousValue || '(empty)'} → {c.newValue || '(empty)'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {s?.profile && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-4 border-t border-outline-variant">
          <Row label="Opening hours">
            {s.profile.regularHours ?? 'Not set on Google'}
            <SectionNote meta={st.location} />
          </Row>
          <Row label="Special hours (upcoming)">
            {s.profile.specialHours.length
              ? s.profile.specialHours.map((p) => `${p.startDate}${p.endDate !== p.startDate ? `–${p.endDate}` : ''}: ${p.closed ? 'closed' : `${p.openTime}–${p.closeTime}`}`).join('; ')
              : 'None'}
          </Row>
          <Row label="Additional categories">{s.profile.additionalCategories.join(', ') || 'None'}</Row>
          <Row label="PIN / postal code">{s.profile.postalCode || '—'}</Row>
          <Row label="Services on Google">{s.profile.services.map((x) => x.name).filter(Boolean).join(', ') || 'None listed'}</Row>
          <Row label="Service area">{s.profile.serviceArea.join(', ') || '—'}</Row>
          <Row label="Attributes">
            {s.attributes ? (s.attributes.length ? `${s.attributes.length} set` : 'None set') : 'Not read'}
            <SectionNote meta={st.attributes} />
          </Row>
          <Row label="Photos & videos">
            {s.media ? `${s.media.photos} photos, ${s.media.videos} videos · logo ${s.media.hasLogo ? '✓' : '—'} · cover ${s.media.hasCover ? '✓' : '—'}` : 'Not read'}
            <SectionNote meta={st.media} />
          </Row>
          <Row label="Google posts">
            {s.posts ? `${s.posts.total}${s.posts.truncated ? '+' : ''} posts · newest ${day(s.posts.newestCreateTime)}` : 'Not read'}
            <SectionNote meta={st.posts} />
          </Row>
          <Row label="Reviews">
            {s.reviews ? `${s.reviews.storedCount}${s.reviews.googleTotalCount != null ? ` of ${s.reviews.googleTotalCount}` : ''} synced · ${s.reviews.unrepliedCount} unreplied` : 'Not read'}
          </Row>
          <Row label="Products">Not available through the Google Business Profile API</Row>
          {s.profile.openStatus && s.profile.openStatus !== 'OPEN' && <Row label="Open status on Google">{s.profile.openStatus}</Row>}
        </div>
      )}
    </div>
  );
}

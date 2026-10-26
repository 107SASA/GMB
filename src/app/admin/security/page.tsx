'use client';

/**
 * Super Admin — Security Log. Sign-ins and failed attempts, OTP and password
 * reset steps, admin privilege actions, data exports and rejected webhook
 * signatures, with IP and browser. Data: GET /api/admin/security/events.
 */
import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Loader2, RefreshCw } from 'lucide-react';
import { RelTime } from '@/components/admin/conversion/primitives';

interface Ev { _id: string; at: string; type: string; label: string; outcome: string; severity: string; subject: string | null; user: string | null; role: string | null; ip: string | null; userAgent: string | null; path: string | null; status: number | null; detail: string | null }
interface Data {
  labels: Record<string, string>;
  summary: { failed24: number; blocked24: number; adminFailed24: number; webhook24: number; alerts: { _id: string; createdAt: string; detail: string }[] };
  events: Ev[];
  pagination: { page: number; total: number; pages: number };
  adminActions: { _id: string; at: string; action: string; admin: string; ip: string | null; metadata: any }[];
}

const sel = 'px-2 py-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs';
const OUTCOME_TONE: Record<string, string> = {
  success: 'text-secondary', failure: 'text-error', blocked: 'text-warning-text', info: 'text-on-surface-variant',
};

function browser(ua: string | null): string {
  if (!ua) return '—';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Mac OS/i.test(ua) ? 'Mac' : /Windows/i.test(ua) ? 'Windows' : /Linux/i.test(ua) ? 'Linux' : '';
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /okhttp|Expo|Dart/i.test(ua) ? 'App' : ua.split(/[\s/]/)[0];
  return [b, os].filter(Boolean).join(' · ');
}

export default function SecurityLogPage() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<'events' | 'admin'>('events');
  const [f, setF] = useState({ type: '', outcome: '', severity: '', q: '', days: '7', page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)]));
      const res = await fetch(`/api/admin/security/events?${params.toString()}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Request failed (${res.status})`);
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Could not load the security log');
    } finally {
      setLoading(false);
    }
  }, [f]);
  useEffect(() => { load(); }, [load]);

  const set = (k: keyof typeof f) => (v: string) => setF((cur) => ({ ...cur, [k]: v, page: 1 }));
  const s = data?.summary;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center"><ShieldAlert className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">Security Log</h1>
            <p className="text-sm text-on-surface-variant">Sign-ins, failed attempts, password resets, admin actions and rejected webhooks. Kept 12 months.</p>
          </div>
        </div>
        <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant text-xs font-semibold"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>

      {s && s.alerts.length > 0 && (
        <div role="alert" className="rounded-xl border border-error-container bg-error-container/40 p-4 text-sm text-on-error-container space-y-1">
          <strong>Security alerts (last 24h)</strong>
          {s.alerts.map((a) => <p key={a._id}>• {a.detail} — <RelTime date={a.createdAt} /></p>)}
        </div>
      )}

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['Failed attempts (24h)', s.failed24, 'failure'],
            ['Blocked (24h)', s.blocked24, 'blocked'],
            ['Failed super admin sign-ins (24h)', s.adminFailed24, 'admin'],
            ['Bad webhook signatures (24h)', s.webhook24, 'webhook'],
          ].map(([label, n]) => (
            <div key={String(label)} className={`rounded-xl border p-4 bg-surface-container-lowest ${Number(n) > 0 ? 'border-warning/50' : 'border-outline-variant'}`}>
              <p className="text-xs text-on-surface-variant">{label}</p>
              <p className="text-2xl font-bold text-on-surface">{Number(n).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1 border-b border-outline-variant">
        {(['events', 'admin'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-semibold border-b-2 ${tab === t ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant'}`}>
            {t === 'events' ? 'Security events' : 'Admin actions'}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="text-sm text-error">Couldn&apos;t load: {error} <button onClick={load} className="underline">Retry</button></p>}

      {tab === 'events' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input value={f.q} onChange={(e) => set('q')(e.target.value)} placeholder="Email, IP or text…" className={`${sel} w-48`} />
            <select className={sel} value={f.type} onChange={(e) => set('type')(e.target.value)}>
              <option value="">All events</option>
              {Object.entries(data?.labels ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className={sel} value={f.outcome} onChange={(e) => set('outcome')(e.target.value)}>
              <option value="">Any outcome</option>
              <option value="success">Success</option>
              <option value="failure">Failed</option>
              <option value="blocked">Blocked</option>
              <option value="info">Info</option>
            </select>
            <select className={sel} value={f.severity} onChange={(e) => set('severity')(e.target.value)}>
              <option value="">Any severity</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
            <select className={sel} value={f.days} onChange={(e) => set('days')(e.target.value)}>
              {[['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
            {loading && !data ? <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-container-low text-on-surface-variant whitespace-nowrap">
                      {['When', 'Event', 'Outcome', 'Who', 'IP', 'Device', 'Detail'].map((h) => <th key={h} className="text-left px-3 py-2">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {(data?.events ?? []).length === 0 && <tr><td colSpan={7} className="py-10 text-center text-outline">No events for these filters.</td></tr>}
                    {(data?.events ?? []).map((e) => (
                      <tr key={e._id} className={e.severity === 'critical' ? 'bg-error-container/20' : e.severity === 'warning' ? 'bg-warning/5' : ''}>
                        <td className="px-3 py-2 whitespace-nowrap" title={new Date(e.at).toLocaleString('en-IN')}><RelTime date={e.at} /></td>
                        <td className="px-3 py-2">{e.label}</td>
                        <td className={`px-3 py-2 font-semibold ${OUTCOME_TONE[e.outcome] || ''}`}>{e.outcome}{e.status ? ` (${e.status})` : ''}</td>
                        <td className="px-3 py-2">{e.user || e.subject || '—'}{e.role === 'SUPER_ADMIN' && <span className="ml-1 text-[10px] text-primary">admin</span>}</td>
                        <td className="px-3 py-2 font-mono">{e.ip || '—'}</td>
                        <td className="px-3 py-2" title={e.userAgent || ''}>{browser(e.userAgent)}</td>
                        <td className="px-3 py-2 text-on-surface-variant">{e.detail || e.path || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data && data.pagination.pages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-outline-variant text-xs">
                <span>{data.pagination.total.toLocaleString()} events</span>
                <span className="flex gap-2">
                  <button disabled={f.page <= 1} onClick={() => setF((c) => ({ ...c, page: c.page - 1 }))} className="underline disabled:opacity-40">Previous</button>
                  Page {f.page} / {data.pagination.pages}
                  <button disabled={f.page >= data.pagination.pages} onClick={() => setF((c) => ({ ...c, page: c.page + 1 }))} className="underline disabled:opacity-40">Next</button>
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'admin' && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-surface-container-low text-on-surface-variant">{['When', 'Action', 'Admin', 'IP', 'Detail'].map((h) => <th key={h} className="text-left px-3 py-2">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-outline-variant">
              {(data?.adminActions ?? []).length === 0 && <tr><td colSpan={5} className="py-10 text-center text-outline">No admin actions recorded.</td></tr>}
              {(data?.adminActions ?? []).map((a) => (
                <tr key={a._id}>
                  <td className="px-3 py-2"><RelTime date={a.at} /></td>
                  <td className="px-3 py-2">{a.action}</td>
                  <td className="px-3 py-2">{a.admin}</td>
                  <td className="px-3 py-2 font-mono">{a.ip || '—'}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{a.metadata ? JSON.stringify(a.metadata).slice(0, 160) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Pencil, RefreshCw, Server, BellOff, Mail } from 'lucide-react';

type Status = 'ok' | 'warning' | 'critical' | 'unconfigured' | 'error' | 'info';
type Cycle = 'free' | 'monthly' | 'yearly' | 'prepaid' | 'one_time' | 'usage';

interface Metric { label: string; used?: number; limit?: number; unit?: string; value?: string; status?: Status; source: 'live' | 'logs' | 'manual' | 'estimate' }
interface Service {
  key: string; name: string; category: string; powers: string; dashboardUrl?: string;
  status: Status; summary: string; metrics: Metric[];
  limits: Array<{ key: string; label: string; unit?: string; value?: number; isDefault: boolean }>;
  plan: { planName: string; billingCycle: Cycle; costAmount?: number; costCurrency: 'USD' | 'INR'; renewalDate?: string; renewalSource?: 'live' | 'manual'; daysToRenewal?: number; notes: string; alertsMuted: boolean };
  spend?: { amount: number; currency: 'USD' | 'INR'; includesPlan?: boolean; source: string };
  checkedAt: string;
}
interface Data { services: Service[]; totals: Record<string, { plans: number; usage: number }>; alertEmail: boolean; fetchedAt: string }

const STYLE: Record<Status, { label: string; badge: string; card: string; bar: string }> = {
  critical:     { label: 'Act now',      badge: 'text-on-error-container bg-error-container', card: 'border-error', bar: 'bg-error' },
  error:        { label: 'Check failed', badge: 'text-on-error-container bg-error-container', card: 'border-error-container', bar: 'bg-error' },
  warning:      { label: 'Upgrade soon', badge: 'text-primary bg-primary-fixed', card: 'border-primary-fixed-dim', bar: 'bg-primary-fixed-dim' },
  unconfigured: { label: 'Set up',       badge: 'text-on-surface-variant bg-surface-container', card: 'border-outline-variant', bar: 'bg-outline' },
  ok:           { label: 'Healthy',      badge: 'text-on-secondary-container bg-secondary-container/40', card: 'border-outline-variant', bar: 'bg-secondary' },
  info:         { label: 'Info',         badge: 'text-on-surface-variant bg-surface-container', card: 'border-outline-variant', bar: 'bg-outline' },
};
const SOURCE_LABEL: Record<Metric['source'], string> = { live: 'live', logs: 'our logs', manual: 'entered', estimate: 'estimate' };
const CYCLE_LABEL: Record<Cycle, string> = { free: 'Free', monthly: 'Monthly', yearly: 'Yearly', prepaid: 'Prepaid credit', one_time: 'One-time', usage: 'Pay per use' };
const ORDER: Status[] = ['critical', 'error', 'warning', 'unconfigured', 'ok', 'info'];
const CATEGORIES = ['Infrastructure', 'Messaging & email', 'Data & AI', 'Payments', 'Domain', 'Apps & code'];

const fmtMoney = (n: number, c: string) =>
  new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: c, maximumFractionDigits: n < 10 ? 2 : 0 }).format(n);
const fmtNum = (n: number) => (Math.abs(n) >= 100_000 ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : n.toLocaleString());

function MetricRow({ m }: { m: Metric }) {
  const s = STYLE[m.status || 'ok'];
  const hasBar = m.used != null && m.limit != null && m.limit > 0;
  const pct = hasBar ? Math.min(100, Math.round((m.used! / m.limit!) * 100)) : 0;
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-on-surface-variant">{m.label}</span>
        <span className={`font-semibold text-right ${m.status === 'critical' || m.status === 'error' ? 'text-error' : m.status === 'warning' ? 'text-primary' : 'text-on-surface'}`}>
          {m.value ?? (m.used != null ? `${fmtNum(m.used)}${m.limit != null ? ` / ${fmtNum(m.limit)}` : ''}${m.unit ? ` ${m.unit}` : ''}` : '—')}
        </span>
      </div>
      {hasBar && (
        <div className="mt-1 h-1.5 bg-surface-container rounded-full overflow-hidden" title={`${pct}% used`}>
          <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${Math.max(pct, 2)}%` }} />
        </div>
      )}
      <div className="text-[10px] uppercase tracking-wide text-outline mt-0.5">{SOURCE_LABEL[m.source]}{hasBar ? ` · ${pct}% used` : ''}</div>
    </div>
  );
}

function EditForm({ s, onSaved, onCancel }: { s: Service; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    planName: s.plan.planName,
    billingCycle: s.plan.billingCycle,
    costAmount: s.plan.costAmount != null ? String(s.plan.costAmount) : '',
    costCurrency: s.plan.costCurrency,
    renewalDate: s.plan.renewalSource === 'manual' && s.plan.renewalDate ? s.plan.renewalDate.slice(0, 10) : '',
    notes: s.plan.notes,
    alertsMuted: s.plan.alertsMuted,
    limits: Object.fromEntries(s.limits.map((l) => [l.key, l.isDefault ? '' : String(l.value ?? '')])) as Record<string, string>,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const input = 'w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary';

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/admin/services', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: s.key, ...form, renewalDate: s.plan.renewalSource === 'live' ? undefined : form.renewalDate || null }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      onSaved();
    } catch (e) {
      setErr(friendlyClientMessage(e, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 border-t border-outline-variant pt-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-xs text-on-surface-variant">Plan name
          <input className={input} value={form.planName} onChange={(e) => setForm({ ...form, planName: e.target.value })} placeholder="e.g. M10, Pro, Hobby" />
        </label>
        <label className="text-xs text-on-surface-variant">Billing
          <select className={input} value={form.billingCycle} onChange={(e) => setForm({ ...form, billingCycle: e.target.value as Cycle })}>
            {Object.entries(CYCLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs text-on-surface-variant">Plan cost
          <div className="flex gap-1">
            <select className={`${input} w-20 px-2`} value={form.costCurrency} onChange={(e) => setForm({ ...form, costCurrency: e.target.value as 'USD' | 'INR' })}>
              <option value="USD">$</option><option value="INR">₹</option>
            </select>
            <input className={input} inputMode="decimal" value={form.costAmount} onChange={(e) => setForm({ ...form, costAmount: e.target.value })} placeholder="0" />
          </div>
        </label>
        <label className="col-span-2 text-xs text-on-surface-variant">
          {s.plan.renewalSource === 'live' ? 'Renewal date (read automatically)' : 'Next renewal / expiry date'}
          <input type="date" className={input} disabled={s.plan.renewalSource === 'live'} value={s.plan.renewalSource === 'live' ? (s.plan.renewalDate || '').slice(0, 10) : form.renewalDate} onChange={(e) => setForm({ ...form, renewalDate: e.target.value })} />
        </label>
        {s.limits.map((l) => (
          <label key={l.key} className="col-span-2 sm:col-span-1 text-xs text-on-surface-variant">{l.label}{l.unit ? ` (${l.unit})` : ''}
            <input className={input} inputMode="decimal" value={form.limits[l.key]} placeholder={l.value != null && l.isDefault ? `default ${l.value}` : 'not set'}
              onChange={(e) => setForm({ ...form, limits: { ...form.limits, [l.key]: e.target.value } })} />
          </label>
        ))}
        <label className="col-span-2 text-xs text-on-surface-variant">Notes
          <textarea className={input} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Login owner, card used, upgrade plan…" />
        </label>
        <label className="col-span-2 flex items-center gap-2 text-sm text-on-surface">
          <input type="checkbox" checked={form.alertsMuted} onChange={(e) => setForm({ ...form, alertsMuted: e.target.checked })} /> Mute email alerts for this service
        </label>
      </div>
      {err && <p className="text-xs text-error">{err}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold disabled:opacity-60">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-on-surface-variant hover:bg-surface-container">Cancel</button>
      </div>
    </div>
  );
}

function ServiceCard({ s, onSaved }: { s: Service; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const st = STYLE[s.status];
  const cost = s.plan.costAmount ? `${fmtMoney(s.plan.costAmount, s.plan.costCurrency)}${s.plan.billingCycle === 'yearly' ? '/yr' : s.plan.billingCycle === 'monthly' ? '/mo' : ''}` : null;
  return (
    <div className={`bg-surface-container-lowest rounded-xl border p-5 card-shadow flex flex-col ${st.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-on-surface">{s.name}</div>
          <div className="text-xs text-outline">{s.powers}</div>
        </div>
        <span className="flex items-center gap-1 shrink-0">
          {s.plan.alertsMuted && <BellOff className="w-3.5 h-3.5 text-outline" aria-label="Alerts muted" />}
          <span className={`text-xs font-bold px-2 py-1 rounded-lg ${st.badge}`}>{st.label}</span>
        </span>
      </div>

      <p className={`text-sm mt-2 ${s.status === 'critical' || s.status === 'error' ? 'text-error font-medium' : s.status === 'warning' ? 'text-primary' : 'text-on-surface-variant'}`}>{s.summary}</p>

      {s.metrics.length > 0 && <div className="mt-2 divide-y divide-outline-variant/50">{s.metrics.map((m) => <MetricRow key={m.label} m={m} />)}</div>}

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-on-surface-variant">
        <span><b className="text-on-surface">{s.plan.planName || 'Plan not set'}</b> · {CYCLE_LABEL[s.plan.billingCycle]}{cost ? ` · ${cost}` : ''}</span>
        {s.plan.renewalDate && (
          <span className={s.plan.daysToRenewal != null && s.plan.daysToRenewal <= 30 ? 'text-primary font-semibold' : ''}>
            Renews {new Date(s.plan.renewalDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
            {s.plan.daysToRenewal != null ? ` (${s.plan.daysToRenewal < 0 ? `${-s.plan.daysToRenewal}d ago` : `${s.plan.daysToRenewal}d`})` : ''}
          </span>
        )}
        {s.spend && s.spend.amount > 0 && <span>This month: {fmtMoney(s.spend.amount, s.spend.currency)}{s.spend.source === 'estimate' ? ' (est.)' : ''}</span>}
      </div>
      {s.plan.notes && <p className="mt-1 text-xs text-outline italic">{s.plan.notes}</p>}

      {editing ? (
        <EditForm s={s} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved(); }} />
      ) : (
        <div className="mt-auto pt-3 flex gap-3 text-xs font-semibold">
          <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-primary hover:underline"><Pencil className="w-3 h-3" /> Edit plan & limits</button>
          {s.dashboardUrl && (
            <a href={s.dashboardUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
              Open dashboard <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function ServicesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention'>('all');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/admin/services');
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData(json.data);
    } catch (e) {
      setError(friendlyClientMessage(e, 'Failed to check services'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { act: 0, soon: 0, setup: 0, ok: 0 };
    for (const s of data?.services || []) {
      if (s.status === 'critical' || s.status === 'error') c.act++;
      else if (s.status === 'warning') c.soon++;
      else if (s.status === 'unconfigured') c.setup++;
      else c.ok++;
    }
    return c;
  }, [data]);

  const visible = (data?.services || [])
    .filter((s) => filter === 'all' || ['critical', 'error', 'warning', 'unconfigured'].includes(s.status));

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center"><Server className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">Services & Costs</h1>
            <p className="text-sm text-on-surface-variant">
              Every outside service we depend on: usage against limits, balances, renewals and spend.
              {data ? ` Checked ${new Date(data.fetchedAt).toLocaleTimeString()}.` : ''}
            </p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-primary-fixed text-primary rounded-xl text-sm font-medium disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {error && <div className="mb-6 p-4 bg-error-container rounded-xl text-on-error-container text-sm">{error}</div>}

      {data && !data.alertEmail && (
        <div className="mb-6 p-4 bg-primary-fixed border border-primary-fixed-dim rounded-xl text-sm text-on-surface flex gap-2">
          <Mail className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <span><b>Email alerts are off.</b> Set ADMIN_EMAIL on the server to get an email when a service runs low or a renewal is near (checked every 6 hours).</span>
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            {[
              { label: 'Act now', n: counts.act, cls: counts.act ? 'text-error' : 'text-on-surface' },
              { label: 'Upgrade / top up soon', n: counts.soon, cls: counts.soon ? 'text-primary' : 'text-on-surface' },
              { label: 'Needs setup', n: counts.setup, cls: 'text-on-surface' },
              { label: 'Healthy', n: counts.ok, cls: 'text-on-surface' },
            ].map((c) => (
              <div key={c.label} className="bg-surface-container-lowest rounded-xl border border-outline-variant p-4">
                <div className={`text-3xl font-bold ${c.cls}`}>{c.n}</div>
                <div className="text-sm text-on-surface-variant">{c.label}</div>
              </div>
            ))}
            <div className="col-span-2 lg:col-span-1 bg-surface-container-lowest rounded-xl border border-outline-variant p-4">
              <div className="text-sm text-on-surface-variant mb-1">Est. spend this month</div>
              {Object.entries(data.totals).filter(([, t]) => t.plans + t.usage > 0).map(([cur, t]) => (
                <div key={cur} className="text-lg font-bold text-on-surface" title={`Plans ${fmtMoney(t.plans, cur)} + usage ${fmtMoney(t.usage, cur)}`}>
                  {fmtMoney(t.plans + t.usage, cur)}
                </div>
              ))}
              <div className="text-[11px] text-outline">Plans (yearly ÷ 12) + usage so far</div>
            </div>
          </div>

          <div className="flex gap-2 mb-4">
            {(['all', 'attention'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === f ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-container'}`}>
                {f === 'all' ? `All (${data.services.length})` : `Needs attention (${counts.act + counts.soon + counts.setup})`}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="p-10 text-center text-on-surface-variant flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8 text-secondary" /> Everything is healthy.
            </div>
          ) : CATEGORIES.map((cat) => {
            const items = visible.filter((s) => s.category === cat).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
            if (!items.length) return null;
            return (
              <section key={cat} className="mb-8">
                <h2 className="font-semibold text-on-surface mb-3 flex items-center gap-2">
                  {cat}
                  {items.some((s) => s.status === 'critical' || s.status === 'error') && <AlertTriangle className="w-4 h-4 text-error" />}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {items.map((s) => <ServiceCard key={s.key} s={s} onSaved={load} />)}
                </div>
              </section>
            );
          })}

          <p className="text-xs text-outline mt-4">
            <b>live</b> = read from the provider just now · <b>our logs</b> = counted from our own records (calls made outside these paths are not included) ·
            <b> estimate</b> = our counts × list price · <b>entered</b> = typed in here. Warnings start at 80% of a limit, 30 days before a renewal, or below the low-balance amount.
          </p>
        </>
      ) : null}
    </div>
  );
}

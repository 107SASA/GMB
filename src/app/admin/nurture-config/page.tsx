'use client';

/**
 * SuperAdmin — Nurturing Configuration.
 *
 * Only settings the sender actually reads (services/nurture/nurtureAdminConfig.ts).
 * The sequence itself is fixed (lib/preSalesRules.ts): one invitation after
 * the free report, one follow-up 48h later if the lead hasn't replied.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Save, RefreshCw } from 'lucide-react';
import { RelTime } from '@/components/admin/conversion/primitives';

type Unit = 'hours' | 'days';

interface NurtureConfig {
  enabled: boolean;
  salesAgentEnabled: boolean;
  timezone: string;
  quietHours: { enabled: boolean; start: string; end: string };
  firstMessage: { enabled: boolean; delayMinutes: number };
  followUp: { enabled: boolean; configured?: boolean };
  rules: { minFirstDelayMinutes: number; followUpDelayMinutes: number; followUps: number };
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface Preview {
  name: string | null;
  leadScore: number;
  intent: string | null;
  nextBestAction: string | null;
  step: 'invitation' | 'follow-up' | 'done';
  nurtureEligible: boolean;
  reasonCode: string | null;
  reason: string;
  nextPossibleAction: string;
  dueAt: string | null;
}

interface Skipped { at: string; leadId: string | null; name: string | null; phone: string | null; reasonCode: string; reason: string; category: string; categoryLabel: string }

const cls = 'w-full px-3 py-2 rounded-lg border border-outline-variant text-sm bg-surface-container-lowest';

function displayDelay(minutes: number): { value: number; unit: Unit } {
  if (minutes % (24 * 60) === 0) return { value: minutes / (24 * 60), unit: 'days' };
  return { value: Math.round((minutes / 60) * 100) / 100, unit: 'hours' };
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${on ? 'bg-primary' : 'bg-outline'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-surface-container-lowest rounded-full transition-transform ${on ? 'translate-x-6' : ''}`} />
    </button>
  );
}

export default function NurtureConfigPage() {
  const [config, setConfig] = useState<NurtureConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [delay, setDelay] = useState<{ value: string; unit: Unit }>({ value: '2', unit: 'hours' });
  const [previewId, setPreviewId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [skipped, setSkipped] = useState<Skipped[] | null>(null);
  const [skippedError, setSkippedError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/nurture-config');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Request failed (${res.status})`);
      setConfig(json.config);
      const d = displayDelay(json.config.firstMessage.delayMinutes);
      setDelay({ value: String(d.value), unit: d.unit });
    } catch (e: any) {
      setError(e?.message || 'Could not load configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSkipped = useCallback(async () => {
    setSkippedError(null);
    try {
      const res = await fetch('/api/admin/nurture-config/skipped?limit=50');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Request failed (${res.status})`);
      setSkipped(json.skipped);
    } catch (e: any) {
      setSkipped(null);
      setSkippedError(e?.message || 'Could not load skipped messages');
    }
  }, []);

  useEffect(() => { load(); loadSkipped(); }, [load, loadSkipped]);

  const delayMinutes = Math.round(Number(delay.value) * (delay.unit === 'days' ? 24 * 60 : 60));

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        enabled: config.enabled,
        timezone: config.timezone,
        quietHours: config.quietHours,
        firstMessage: { enabled: config.firstMessage.enabled, delayMinutes },
        followUp: { enabled: config.followUp.enabled },
      };
      const res = await fetch('/api/admin/nurture-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Save failed (${res.status})`);
      setNotice(json.changes?.length ? `Saved as version ${json.version}: ${json.changes.join('; ')}.` : 'No changes to save.');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    setPreview(null);
    setPreviewError(null);
    try {
      const res = await fetch('/api/admin/nurture-config/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: previewId.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Preview failed (${res.status})`);
      setPreview(json.preview);
    } catch (e: any) {
      setPreviewError(e?.message || 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  if (loading && !config) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (!config) {
    return (
      <div role="alert" className="p-8 text-error">
        {error || 'Configuration unavailable'} <button onClick={load} className="underline font-semibold">Retry</button>
      </div>
    );
  }

  const minHours = config.rules.minFirstDelayMinutes / 60;
  const followHours = config.rules.followUpDelayMinutes / 60;

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="font-heading text-2xl font-bold text-on-surface">Nurturing Configuration</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Automated WhatsApp to free-report leads: <strong>one invitation</strong> at least {minHours} hours after the report, then <strong>one follow-up</strong> {followHours} hours later only if they haven&apos;t replied.
          Message wording is on the <Link href="/admin/sales-agent" className="underline">Sales Agent</Link> page.
        </p>
        <p className="text-xs text-outline mt-1">
          Version {config.version}{config.updatedAt ? <> · updated <RelTime date={config.updatedAt} /></> : null}
        </p>
      </div>

      {error && <div role="alert" className="rounded-xl border border-error-container bg-error-container/40 p-3 text-sm text-on-error-container">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-secondary-fixed bg-secondary-container/40 p-3 text-sm text-on-secondary-container">{notice}</div>}

      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-sm">Nurturing</h2>
            <p className="text-xs text-outline">Automated invitation and follow-up. Takes effect immediately, including for sequences already running. Does not affect the Sales agent answering people who message you.</p>
          </div>
          <Toggle label="Nurturing" on={config.enabled} onChange={(enabled) => setConfig({ ...config, enabled })} />
        </div>
        {!config.salesAgentEnabled && (
          <p className="text-xs rounded-lg bg-warning/10 text-warning-text p-2">
            The Sales agent itself is switched off, so nothing is sent and leads don&apos;t get live replies. Switch it on from the <Link href="/admin/sales-agent" className="underline font-semibold">Sales Agent</Link> page.
          </p>
        )}
      </section>

      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-sm">Quiet hours</h2>
            <p className="text-xs text-outline">When on, an invitation or follow-up due inside this window waits until it ends. When off, there is no time restriction. Applies to sequences that start after you save.</p>
          </div>
          <Toggle label="Quiet hours" on={config.quietHours.enabled} onChange={(enabled) => setConfig({ ...config, quietHours: { ...config.quietHours, enabled } })} />
        </div>
        {config.quietHours.enabled && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-sm">From
              <input type="time" className={cls} value={config.quietHours.start} onChange={(e) => setConfig({ ...config, quietHours: { ...config.quietHours, start: e.target.value } })} />
            </label>
            <label className="text-sm">Until
              <input type="time" className={cls} value={config.quietHours.end} onChange={(e) => setConfig({ ...config, quietHours: { ...config.quietHours, end: e.target.value } })} />
            </label>
            <label className="text-sm">Timezone
              <input className={cls} value={config.timezone} onChange={(e) => setConfig({ ...config, timezone: e.target.value })} placeholder="Asia/Kolkata" />
            </label>
          </div>
        )}
      </section>

      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-sm">Invitation</h2>
            <p className="text-xs text-outline">Sent after the free report completes. A number that has never messaged us first gets the approved “Reply YES” template; the findings follow only after they say yes.</p>
          </div>
          <Toggle label="Invitation" on={config.firstMessage.enabled} onChange={(enabled) => setConfig({ ...config, firstMessage: { ...config.firstMessage, enabled } })} />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Send after
            <input type="number" min={delay.unit === 'hours' ? minHours : 1} step="0.5" className={`${cls} w-28`} value={delay.value} onChange={(e) => setDelay({ ...delay, value: e.target.value })} />
          </label>
          <select className={`${cls} w-28`} value={delay.unit} onChange={(e) => setDelay({ ...delay, unit: e.target.value as Unit })} aria-label="Delay unit">
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
          <span className="text-xs text-outline pb-2">Minimum {minHours} hours, maximum 7 days.</span>
        </div>
      </section>

      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-sm">Follow-up</h2>
            <p className="text-xs text-outline">
              One follow-up {followHours} hours after the invitation, only if the lead hasn&apos;t replied. It is also skipped when a human has taken over, a demo is booked or being booked, they started a trial or paid, opted out, said they&apos;re not interested, or the AI has detected demo or purchase intent (those flows own the next step).
            </p>
          </div>
          {config.followUp.configured === false
            ? <span className="text-xs font-semibold text-outline shrink-0">Off</span>
            : <Toggle label="Follow-up" on={config.followUp.enabled} onChange={(enabled) => setConfig({ ...config, followUp: { ...config.followUp, enabled } })} />}
        </div>
        {config.followUp.configured === false && (
          <p className="mt-2 text-xs rounded-lg bg-warning/10 text-warning-text p-2">
            No follow-up message exists, so none is sent. Add one on the <Link href="/admin/sales-agent" className="underline font-semibold">Sales Agent</Link> page to switch it on here.
          </p>
        )}
      </section>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving || !Number.isFinite(delayMinutes)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-60">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
        </button>
      </div>

      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5 space-y-3">
        <h2 className="font-semibold text-sm">Preview a lead</h2>
        <p className="text-xs text-outline">Read only — runs the same checks the sender runs right before sending. Does not send, schedule, or change the lead. Paste a lead id from <Link href="/admin/leads" className="underline">Leads &amp; Pipeline</Link>.</p>
        <div className="flex gap-2">
          <input className={cls} value={previewId} onChange={(e) => setPreviewId(e.target.value)} placeholder="Lead id" />
          <button onClick={runPreview} disabled={previewing || !previewId.trim()} className="px-4 py-2 rounded-lg bg-primary-fixed text-primary text-sm font-semibold disabled:opacity-60">
            {previewing ? 'Checking…' : 'Preview'}
          </button>
        </div>
        {previewError && <p role="alert" className="text-xs text-error">{previewError}</p>}
        {preview && (
          <div className="text-sm border border-outline-variant rounded-lg p-3 space-y-1">
            <p><strong>{preview.name || 'Lead'}</strong> · score {preview.leadScore} · intent {preview.intent || '—'} · next action {preview.nextBestAction || '—'}</p>
            <p>Next automated message: <strong>{preview.step === 'done' ? 'none (sequence finished)' : preview.step}</strong></p>
            <p className={preview.nurtureEligible ? 'text-secondary' : 'text-warning-text'}>
              {preview.nurtureEligible ? 'Would send.' : 'Would not send.'} {preview.reason}
            </p>
            <p className="text-xs text-on-surface-variant">{preview.nextPossibleAction}</p>
          </div>
        )}
      </section>

      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-sm">Recently skipped messages</h2>
            <p className="text-xs text-outline">Sequences that never started after a free report, and consent requests, invitations and follow-ups that were due but not sent — with the reason.</p>
          </div>
          <button onClick={loadSkipped} className="inline-flex items-center gap-1 text-xs font-semibold text-primary"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
        </div>
        {skippedError ? (
          <p role="alert" className="text-xs text-error">Couldn&apos;t load: {skippedError}</p>
        ) : skipped === null ? (
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
        ) : skipped.length === 0 ? (
          <p className="text-xs text-outline">Nothing skipped yet.</p>
        ) : (
          <ul className="divide-y divide-outline-variant text-sm">
            {skipped.map((s, i) => (
              <li key={i} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {s.leadId
                    ? <Link href={`/admin/leads/${s.leadId}`} className="font-medium hover:text-primary">{s.name || s.phone || 'Lead'}</Link>
                    : <span className="font-medium">{s.phone || 'Unknown number'}</span>}
                  <p className="text-xs text-on-surface-variant">{s.reason} <span className="text-outline">({s.categoryLabel})</span></p>
                </div>
                <RelTime date={s.at} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

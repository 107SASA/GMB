'use client';

import { useEffect, useState } from 'react';
import { Loader2, CalendarCheck, Save, Info } from 'lucide-react';

interface Config {
  enabled: boolean;
  agentSystemPrompt: string;
  confirmationMessage: string;
  automatedBookingEnabled?: boolean;
  demoDurationMinutes?: number;
  timezone?: string;
  openingTime?: string;
  closingTime?: string;
  minAdvanceMinutes?: number;
  maxDaysAhead?: number;
  bufferMinutes?: number;
  assignmentStrategy?: 'first-available' | 'round-robin';
}

interface CalendarConnection {
  userId: string;
  googleEmail: string | null;
  status: string;
  connected: boolean;
  lastCheckedAt: string | null;
}

const cls = 'w-full px-3 py-2 rounded-lg border border-outline-variant focus:ring-2 focus:ring-primary focus:border-primary text-sm';
const area = `${cls} font-mono text-xs leading-relaxed`;

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative w-12 h-6 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-outline'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-surface-container-lowest rounded-full transition-transform ${on ? 'translate-x-6' : ''}`} />
    </button>
  );
}

export default function BookingAgentAdminPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [vars, setVars] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [calendars, setCalendars] = useState<CalendarConnection[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/booking-agent');
        const json = await res.json();
        if (json.success) { setConfig(json.config); setVars(json.variables || []); }
        const connections = await fetch('/api/admin/calendar/connections').then((r) => r.json());
        if (connections.success) setCalendars(connections.connections || []);
      } finally { setLoading(false); }
    })();
  }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/booking-agent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Save failed');
      setMsg({ ok: true, text: 'Saved.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Save failed' });
    } finally { setSaving(false); }
  };

  if (loading || !config) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center"><CalendarCheck className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">WhatsApp Booking Agent</h1>
            <p className="text-sm text-on-surface-variant">Handles &ldquo;Book a Demo&rdquo; chats — qualifies, books &amp; confirms the demo, files a CRM lead.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-on-surface-variant">{config.enabled ? 'Enabled' : 'Disabled'}</span>
          <Toggle on={config.enabled} onChange={(v) => setConfig({ ...config, enabled: v })} />
        </div>
      </div>

      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm ${msg.ok ? 'bg-secondary-container/40 text-on-secondary-container border border-secondary-fixed' : 'bg-error-container text-on-error-container border border-error-container'}`}>{msg.text}</div>
      )}

      <div className="flex items-start gap-2 bg-surface border border-outline-variant rounded-xl px-4 py-3 text-xs text-on-surface-variant mb-6">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-outline" />
        <div>
          Runs on the GrowwMatics WhatsApp number. The agent asks for name, business and a preferred day &amp; time, then books the demo automatically.
          Variables for the confirmation message: {vars.map((v) => <code key={v} className="mx-0.5 px-1 bg-surface-container-lowest border border-outline-variant rounded">{v}</code>)}
        </div>
      </div>

      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5 mb-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-on-surface">Salesperson Google Calendars</h2>
          <a href="/api/admin/calendar/connect" className="text-sm font-semibold text-primary">Connect my calendar</a>
        </div>
        <p className="text-xs text-on-surface-variant">Each salesperson connects their own Google account. This is separate from a customer&apos;s Google Business Profile connection. Tokens stay on the server.</p>
        <label className="flex items-center justify-between text-sm">
          <span>Automated booking from a time reply (for example, “10:30 today”)</span>
          <Toggle on={!!config.automatedBookingEnabled} onChange={(v) => setConfig({ ...config, automatedBookingEnabled: v })} />
        </label>
        {calendars.length === 0 && <p className="text-xs text-outline">No calendar is connected. A demo will not be confirmed until one is.</p>}
        <ul className="text-sm space-y-2">
          {calendars.map((row) => (
            <li key={row.userId} className="flex items-center justify-between gap-3">
              <span>{row.connected ? 'Connected' : 'Not connected'} · {row.googleEmail || 'Google account'} · {row.status}{row.lastCheckedAt ? ` · checked ${new Date(row.lastCheckedAt).toLocaleString()}` : ''}</span>
              {row.connected && (
                <button type="button" className="text-xs text-error" onClick={async () => {
                  await fetch('/api/admin/calendar/connections', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: row.userId }) });
                  setCalendars((list) => list.map((item) => item.userId === row.userId ? { ...item, connected: false, status: 'revoked' } : item));
                }}>Disconnect</button>
              )}
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>Duration (minutes)<input className={cls} type="number" value={config.demoDurationMinutes ?? 30} onChange={(e) => setConfig({ ...config, demoDurationMinutes: Number(e.target.value) })} /></label>
          <label>Timezone<input className={cls} value={config.timezone || 'Asia/Kolkata'} onChange={(e) => setConfig({ ...config, timezone: e.target.value })} /></label>
          <label>Opens<input className={cls} value={config.openingTime || '10:00'} onChange={(e) => setConfig({ ...config, openingTime: e.target.value })} /></label>
          <label>Closes<input className={cls} value={config.closingTime || '18:00'} onChange={(e) => setConfig({ ...config, closingTime: e.target.value })} /></label>
          <label>Minimum notice (minutes)<input className={cls} type="number" value={config.minAdvanceMinutes ?? 60} onChange={(e) => setConfig({ ...config, minAdvanceMinutes: Number(e.target.value) })} /></label>
          <label>Max days ahead<input className={cls} type="number" value={config.maxDaysAhead ?? 14} onChange={(e) => setConfig({ ...config, maxDaysAhead: Number(e.target.value) })} /></label>
          <label>Buffer (minutes)<input className={cls} type="number" value={config.bufferMinutes ?? 15} onChange={(e) => setConfig({ ...config, bufferMinutes: Number(e.target.value) })} /></label>
          <label>Assignment
            <select className={cls} value={config.assignmentStrategy || 'first-available'} onChange={(e) => setConfig({ ...config, assignmentStrategy: e.target.value as Config['assignmentStrategy'] })}>
              <option value="first-available">First available</option>
              <option value="round-robin">Round robin</option>
            </select>
          </label>
        </div>
      </section>

      {/* Agent persona */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5 mb-5 space-y-3">
        <h2 className="font-bold text-on-surface">Agent persona</h2>
        <p className="text-xs text-on-surface-variant">Tone &amp; style the agent uses while chatting. (The fields it must collect and the booking logic are fixed and can&apos;t be broken by edits here.)</p>
        <textarea rows={12} className={area} value={config.agentSystemPrompt} onChange={(e) => setConfig({ ...config, agentSystemPrompt: e.target.value })} />
      </section>

      {/* Confirmation message */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5 mb-6 space-y-3">
        <h2 className="font-bold text-on-surface">Confirmation message</h2>
        <p className="text-xs text-on-surface-variant">Fallback confirmation sent once the demo is booked (used if the AI doesn&apos;t produce its own).</p>
        <textarea rows={6} className={area} value={config.confirmationMessage} onChange={(e) => setConfig({ ...config, confirmationMessage: e.target.value })} />
      </section>

      <button onClick={save} disabled={saving}
        className="px-6 py-3 rounded-xl bg-primary hover:bg-primary-container text-white font-bold transition-colors disabled:opacity-60 flex items-center gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save configuration
      </button>
    </div>
  );
}

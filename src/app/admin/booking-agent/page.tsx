'use client';

import { useEffect, useState } from 'react';
import { Loader2, CalendarCheck, Save, Info } from 'lucide-react';

interface Config {
  enabled: boolean;
  agentSystemPrompt: string;
  confirmationMessage: string;
}

const cls = 'w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-violet-500 focus:border-violet-500 text-sm';
const area = `${cls} font-mono text-xs leading-relaxed`;

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative w-12 h-6 rounded-full transition-colors ${on ? 'bg-violet-600' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${on ? 'translate-x-6' : ''}`} />
    </button>
  );
}

export default function BookingAgentAdminPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [vars, setVars] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/booking-agent');
        const json = await res.json();
        if (json.success) { setConfig(json.config); setVars(json.variables || []); }
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
    return <div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-violet-600" /></div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-violet-600 rounded-xl flex items-center justify-center"><CalendarCheck className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">WhatsApp Booking Agent</h1>
            <p className="text-sm text-slate-500">Handles &ldquo;Book a Demo&rdquo; chats — qualifies, books &amp; confirms the demo, files a CRM lead.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-600">{config.enabled ? 'Enabled' : 'Disabled'}</span>
          <Toggle on={config.enabled} onChange={(v) => setConfig({ ...config, enabled: v })} />
        </div>
      </div>

      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>
      )}

      <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600 mb-6">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
        <div>
          Runs on the GrowwMatics WhatsApp number. The agent asks for name, business and a preferred day &amp; time, then books the demo automatically.
          Variables for the confirmation message: {vars.map((v) => <code key={v} className="mx-0.5 px-1 bg-white border border-slate-200 rounded">{v}</code>)}
        </div>
      </div>

      {/* Agent persona */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm mb-5 space-y-3">
        <h2 className="font-bold text-slate-900">Agent persona</h2>
        <p className="text-xs text-slate-500">Tone &amp; style the agent uses while chatting. (The fields it must collect and the booking logic are fixed and can&apos;t be broken by edits here.)</p>
        <textarea rows={12} className={area} value={config.agentSystemPrompt} onChange={(e) => setConfig({ ...config, agentSystemPrompt: e.target.value })} />
      </section>

      {/* Confirmation message */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm mb-6 space-y-3">
        <h2 className="font-bold text-slate-900">Confirmation message</h2>
        <p className="text-xs text-slate-500">Fallback confirmation sent once the demo is booked (used if the AI doesn&apos;t produce its own).</p>
        <textarea rows={6} className={area} value={config.confirmationMessage} onChange={(e) => setConfig({ ...config, confirmationMessage: e.target.value })} />
      </section>

      <button onClick={save} disabled={saving}
        className="px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold transition-colors disabled:opacity-60 flex items-center gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save configuration
      </button>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Loader2, Bot, Plus, Trash2, Save, Info } from 'lucide-react';

type Mode = 'ai' | 'template';
interface FollowUp { delayHours: number; mode: Mode; template: string; aiSystemPrompt?: string; onlyIfNoReply: boolean; }
interface Config {
  enabled: boolean;
  firstMessage: { mode: Mode; delayMinutes: number; template: string; aiSystemPrompt: string };
  followUps: FollowUp[];
  agentSystemPrompt: string;
  subscribeUrl: string;
  shopUrl: string;
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

export default function SalesAgentAdminPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [vars, setVars] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/sales-agent');
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
      const res = await fetch('/api/admin/sales-agent', {
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

  const setFirst = (patch: Partial<Config['firstMessage']>) => setConfig({ ...config, firstMessage: { ...config.firstMessage, ...patch } });
  const setFollowUp = (i: number, patch: Partial<FollowUp>) => {
    const followUps = config.followUps.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    setConfig({ ...config, followUps });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center"><Bot className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">WhatsApp Sales Agent</h1>
            <p className="text-sm text-on-surface-variant">Post-audit lead nurture — fully customizable.</p>
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
        <div>Available variables in templates: {vars.map((v) => <code key={v} className="mx-0.5 px-1 bg-surface-container-lowest border border-outline-variant rounded">{v}</code>)}</div>
      </div>

      {/* Links */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5 mb-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-semibold text-on-surface">Subscribe link</label>
          <input className={`${cls} mt-1`} value={config.subscribeUrl} onChange={(e) => setConfig({ ...config, subscribeUrl: e.target.value })} placeholder="https://…/dashboard/billing" />
        </div>
        <div>
          <label className="text-sm font-semibold text-on-surface">Platform / shop link</label>
          <input className={`${cls} mt-1`} value={config.shopUrl} onChange={(e) => setConfig({ ...config, shopUrl: e.target.value })} placeholder="https://…/pricing" />
        </div>
      </section>

      {/* First message */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5 mb-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-on-surface">First message (after audit)</h2>
          <div className="flex items-center gap-3 text-sm">
            <label className="text-on-surface-variant">Send after</label>
            <input type="number" min={0} className="w-20 px-2 py-1 rounded-lg border border-outline-variant text-sm" value={config.firstMessage.delayMinutes} onChange={(e) => setFirst({ delayMinutes: Number(e.target.value) })} />
            <span className="text-on-surface-variant">minutes</span>
          </div>
        </div>
        <div className="flex gap-2">
          {(['ai', 'template'] as Mode[]).map((m) => (
            <button key={m} type="button" onClick={() => setFirst({ mode: m })}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${config.firstMessage.mode === m ? 'bg-primary-container text-on-primary-container border-primary-container' : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant'}`}>
              {m === 'ai' ? 'AI-written' : 'Fixed template'}
            </button>
          ))}
        </div>
        {config.firstMessage.mode === 'template' ? (
          <div>
            <label className="text-xs font-semibold text-on-surface-variant">Template</label>
            <textarea rows={10} className={`${area} mt-1`} value={config.firstMessage.template} onChange={(e) => setFirst({ template: e.target.value })} />
          </div>
        ) : (
          <div>
            <label className="text-xs font-semibold text-on-surface-variant">AI instructions (system prompt)</label>
            <textarea rows={8} className={`${area} mt-1`} value={config.firstMessage.aiSystemPrompt} onChange={(e) => setFirst({ aiSystemPrompt: e.target.value })} />
          </div>
        )}
      </section>

      {/* Follow-ups */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5 mb-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-on-surface">Follow-up drip</h2>
          <button type="button" onClick={() => setConfig({ ...config, followUps: [...config.followUps, { delayHours: 24, mode: 'template', template: '', onlyIfNoReply: true }] })}
            className="flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary">
            <Plus className="w-4 h-4" /> Add follow-up
          </button>
        </div>
        {config.followUps.length === 0 && <p className="text-sm text-outline">No follow-ups. Add one to nudge leads who don&apos;t reply.</p>}
        {config.followUps.map((f, i) => (
          <div key={i} className="border border-outline-variant rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold text-on-surface">#{i + 1}</span>
              <label className="text-on-surface-variant">Send</label>
              <input type="number" min={0} className="w-20 px-2 py-1 rounded-lg border border-outline-variant" value={f.delayHours} onChange={(e) => setFollowUp(i, { delayHours: Number(e.target.value) })} />
              <span className="text-on-surface-variant">hours after previous</span>
              <div className="flex gap-1 ml-auto">
                {(['ai', 'template'] as Mode[]).map((m) => (
                  <button key={m} type="button" onClick={() => setFollowUp(i, { mode: m })}
                    className={`px-2 py-1 rounded-md text-xs font-medium border ${f.mode === m ? 'bg-primary-container text-on-primary-container border-primary-container' : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant'}`}>{m === 'ai' ? 'AI' : 'Template'}</button>
                ))}
                <button type="button" onClick={() => setConfig({ ...config, followUps: config.followUps.filter((_, idx) => idx !== i) })} className="p-1 text-outline hover:text-error"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-on-surface-variant">
              <input type="checkbox" checked={f.onlyIfNoReply} onChange={(e) => setFollowUp(i, { onlyIfNoReply: e.target.checked })} />
              Only send if the lead hasn&apos;t replied
            </label>
            {f.mode === 'template' ? (
              <textarea rows={5} className={area} value={f.template} onChange={(e) => setFollowUp(i, { template: e.target.value })} placeholder="Message template…" />
            ) : (
              <textarea rows={4} className={area} value={f.aiSystemPrompt ?? ''} onChange={(e) => setFollowUp(i, { aiSystemPrompt: e.target.value })} placeholder="AI instructions…" />
            )}
          </div>
        ))}
      </section>

      {/* Live agent persona */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5 mb-6 space-y-3">
        <h2 className="font-bold text-on-surface">Live reply agent</h2>
        <p className="text-xs text-on-surface-variant">How the AI talks when a lead replies — it always gets the lead&apos;s audit scores, competitors and your links as context.</p>
        <textarea rows={8} className={area} value={config.agentSystemPrompt} onChange={(e) => setConfig({ ...config, agentSystemPrompt: e.target.value })} />
      </section>

      <button onClick={save} disabled={saving}
        className="px-6 py-3 rounded-xl bg-primary hover:bg-primary-container text-white font-bold transition-colors disabled:opacity-60 flex items-center gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save configuration
      </button>
    </div>
  );
}

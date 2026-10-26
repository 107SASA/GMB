'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';

interface Template {
  id: string;
  contentSid: string;
  label: string;
  twilioName: string | null;
  category: string | null;
  body: string;
  placeholders: number[];
  approvalStatus: string;
  rejectionReason: string | null;
  checkedAt: string | null;
  active: boolean;
  usable: boolean;
  notUsableReason: string | null;
}

interface Campaign {
  id: string;
  name: string;
  templateLabel: string;
  status: 'sending' | 'done';
  counts: { total: number; sent: number; failed: number; skipped: number };
  createdAt: string;
}

const STATUS_STYLE: Record<string, string> = {
  approved: 'bg-secondary-container/40 text-on-secondary-container',
  pending: 'bg-primary-fixed text-primary',
  rejected: 'bg-error-container text-on-error-container',
  paused: 'bg-error-container text-on-error-container',
};

/**
 * Settings → WhatsApp templates: approved Twilio templates the team can send
 * to leads from Leads & Pipeline. Added by SID here — no server change. The
 * name, text, category and WhatsApp approval are read from Twilio.
 */
export function WhatsAppTemplatesCard() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [sid, setSid] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [t, c] = await Promise.all([
      fetch('/api/admin/whatsapp-templates').then((r) => r.json()).catch(() => null),
      fetch('/api/admin/crm/whatsapp/campaigns').then((r) => r.json()).catch(() => null),
    ]);
    if (t?.success) setTemplates(t.templates);
    if (c?.success) setCampaigns(c.campaigns);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const call = async (key: string, url: string, init: RequestInit, done: string) => {
    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) { setMsg({ ok: false, text: json?.error || 'That did not work.' }); return false; }
      setMsg({ ok: true, text: done });
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (await call('add', '/api/admin/whatsapp-templates', { method: 'POST', body: JSON.stringify({ contentSid: sid.trim(), label }) }, 'Template added.')) {
      setSid('');
      setLabel('');
    }
  };

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
      <h2 className="text-base font-bold text-on-surface">WhatsApp templates</h2>
      <p className="text-xs text-outline mt-1 mb-5">
        Approved templates the team can send from Leads &amp; Pipeline → Send WhatsApp. Create and submit the template in Twilio
        (Messaging → Content Template Builder), then paste its SID here. {'{{1}}'} is filled with the lead&apos;s first name and {'{{2}}'} with the message you type.
      </p>

      <div className="flex flex-wrap gap-2">
        <input value={sid} onChange={(e) => setSid(e.target.value)} placeholder="Template SID — HX…" className="flex-1 min-w-[260px] px-3 py-2 border border-outline-variant rounded-xl text-sm font-mono" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Name for the team (optional)" className="flex-1 min-w-[200px] px-3 py-2 border border-outline-variant rounded-xl text-sm" />
        <button onClick={add} disabled={!sid.trim() || busy === 'add'} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-semibold disabled:opacity-50">
          {busy === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
        </button>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-xs ${msg.ok ? 'text-secondary' : 'text-error'}`}>{msg.text}</p>}

      <div className="mt-5 space-y-3">
        {loading && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
        {!loading && templates.length === 0 && <p className="text-sm text-outline">No templates added yet.</p>}
        {templates.map((t) => (
          <div key={t.id} className={`rounded-xl border border-outline-variant p-4 ${t.active ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-sm text-on-surface">{t.label}</p>
                <p className="text-[11px] text-outline font-mono break-all">{t.twilioName ? `${t.twilioName} · ` : ''}{t.contentSid}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {t.category && <span className="rounded-full bg-surface-container px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant">{t.category}</span>}
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[t.approvalStatus] || 'bg-surface-container text-on-surface-variant'}`}>WhatsApp: {t.approvalStatus}</span>
                <button title="Check again with Twilio" onClick={() => call(`r-${t.id}`, `/api/admin/whatsapp-templates/${t.id}`, { method: 'PATCH', body: JSON.stringify({ refresh: true }) }, 'Checked with Twilio.')} className="p-1.5 rounded-lg hover:bg-surface-container">
                  {busy === `r-${t.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => call(`a-${t.id}`, `/api/admin/whatsapp-templates/${t.id}`, { method: 'PATCH', body: JSON.stringify({ active: !t.active }) }, t.active ? 'Switched off.' : 'Switched on.')} className="px-2 py-1 rounded-lg border border-outline-variant text-[11px] font-semibold">
                  {t.active ? 'Switch off' : 'Switch on'}
                </button>
                <button title="Remove" onClick={() => { if (confirm(`Remove "${t.label}" from the list? Past sends keep their record.`)) call(`d-${t.id}`, `/api/admin/whatsapp-templates/${t.id}`, { method: 'DELETE' }, 'Removed.'); }} className="p-1.5 rounded-lg hover:bg-error-container text-error">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {t.body && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-container p-3 text-xs text-on-surface">{t.body}</p>}
            {t.rejectionReason && <p className="mt-2 text-xs text-error">Meta: {t.rejectionReason}</p>}
            <p className={`mt-2 text-xs ${t.usable ? 'text-secondary' : 'text-error'}`}>
              {t.usable ? 'Ready to send to leads.' : t.notUsableReason}
              {t.usable && t.category === 'UTILITY' && ' (Utility template — use it for updates, not offers or promotions.)'}
            </p>
          </div>
        ))}
      </div>

      <h3 className="mt-7 text-sm font-bold text-on-surface">Recent sends</h3>
      {campaigns.length === 0 ? (
        <p className="mt-1 text-xs text-outline">Nothing sent yet. Select leads in Leads &amp; Pipeline and click Send WhatsApp.</p>
      ) : (
        <ul className="mt-2 divide-y divide-outline-variant text-xs">
          {campaigns.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="font-semibold text-on-surface">{c.name}</span>
                <span className="text-outline"> · {new Date(c.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
              </span>
              <span className="text-on-surface-variant">
                {c.status === 'sending' ? 'Sending… ' : ''}{c.counts.sent} sent · {c.counts.failed} failed · {c.counts.skipped} left out
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

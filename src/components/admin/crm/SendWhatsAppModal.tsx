'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Send, X } from 'lucide-react';

interface Template { id: string; label: string; category: string | null; body: string; placeholders: number[]; usable: boolean }
interface Preview {
  total: number;
  eligible: number;
  messageError: string | null;
  preview: { name: string; text: string } | null;
  skipped: { reason: string; label: string; count: number }[];
  skippedLeads: { id: string; name: string; phone: string; label: string }[];
}
interface Campaign {
  id: string;
  name: string;
  status: 'sending' | 'done';
  counts: { total: number; sent: number; failed: number; skipped: number };
  recipients: { leadId: string; name: string; phone: string; status: string; reason: string | null }[];
}

const MESSAGE_MAX = 900;
const input = 'w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-sm';
const RESULT_LABEL: Record<string, string> = { queued: 'Waiting', sending: 'Sending…', sent: 'Sent', failed: 'Failed', skipped: 'Left out' };

/**
 * Leads & Pipeline → Send WhatsApp: an approved template to the selected
 * leads, or to every lead matching the current filters. Shows who gets it and
 * who is left out (and why) before anything is sent; then the send's progress.
 */
export function SendWhatsAppModal({ selectedIds, filters, filteredTotal, onClose }: {
  selectedIds: string[];
  /** The page's query string — "all leads matching these filters". */
  filters: string;
  filteredTotal: number;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [audience, setAudience] = useState<'selected' | 'filtered'>(selectedIds.length ? 'selected' : 'filtered');
  const [templateId, setTemplateId] = useState('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [skipRecent, setSkipRecent] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);

  useEffect(() => {
    fetch('/api/admin/whatsapp-templates').then((r) => r.json()).then((j) => {
      const usable = (j?.templates ?? []).filter((t: Template) => t.usable);
      setTemplates(usable);
      if (usable.length === 1) setTemplateId(usable[0].id);
    }).catch(() => setTemplates([]));
  }, []);

  const template = useMemo(() => templates?.find((t) => t.id === templateId) || null, [templates, templateId]);
  const needsMessage = !!template?.placeholders.includes(2);
  // Anything changed after a preview needs a new preview before sending.
  useEffect(() => { setPreview(null); }, [audience, templateId, message, skipRecent]);

  const body = () => ({
    ...(audience === 'selected' ? { ids: selectedIds } : { filters }),
    templateId,
    message,
    skipRecent,
  });

  const post = async (url: string, payload: object) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) { setError(json?.error || 'That did not work.'); return null; }
      return json;
    } catch {
      setError('Network error.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    const json = await post('/api/admin/crm/whatsapp/preview', body());
    if (json) setPreview(json);
  };

  const send = async () => {
    if (!preview || !confirm(`Send this WhatsApp message to ${preview.eligible} lead${preview.eligible === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const json = await post('/api/admin/crm/whatsapp/campaigns', { ...body(), name });
    if (json) setCampaign({ id: json.campaignId, name: name || 'WhatsApp send', status: 'sending', counts: { total: json.queued + json.skipped, sent: 0, failed: 0, skipped: json.skipped }, recipients: [] });
  };

  // Progress, every 3 seconds until the send is done.
  useEffect(() => {
    if (!campaign || campaign.status === 'done') return;
    const timer = setInterval(async () => {
      const json = await fetch(`/api/admin/crm/whatsapp/campaigns/${campaign.id}`).then((r) => r.json()).catch(() => null);
      if (json?.success) setCampaign(json.campaign);
    }, 3000);
    return () => clearInterval(timer);
  }, [campaign]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-outline-variant">
          <div>
            <h2 className="font-bold text-on-surface">Send WhatsApp</h2>
            <p className="text-xs text-on-surface-variant">An approved template. Replies arrive in the WhatsApp Inbox.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-surface-container"><X className="w-4 h-4" /></button>
        </div>

        {campaign ? (
          <div className="p-5 space-y-3 text-sm">
            <p className="font-semibold text-on-surface">{campaign.status === 'done' ? 'Finished' : 'Sending…'} — {campaign.name}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-secondary-container/40 p-3"><p className="text-xl font-bold">{campaign.counts.sent}</p><p className="text-[11px]">Sent</p></div>
              <div className="rounded-xl bg-error-container p-3"><p className="text-xl font-bold">{campaign.counts.failed}</p><p className="text-[11px]">Failed</p></div>
              <div className="rounded-xl bg-surface-container p-3"><p className="text-xl font-bold">{campaign.counts.skipped}</p><p className="text-[11px]">Left out</p></div>
            </div>
            <p className="text-xs text-outline">
              &quot;Sent&quot; means WhatsApp accepted it. Delivery and read show on each chat in the WhatsApp Inbox. Some people may not receive
              marketing messages (WhatsApp limits how many marketing messages a person gets) — those show as not delivered there.
            </p>
            {campaign.recipients.length > 0 && (
              <ul className="max-h-64 overflow-y-auto divide-y divide-outline-variant text-xs border border-outline-variant rounded-xl">
                {campaign.recipients.map((r) => (
                  <li key={r.leadId} className="flex items-start justify-between gap-3 px-3 py-2">
                    <span className="min-w-0"><Link href={`/admin/leads/${r.leadId}`} className="font-medium text-primary hover:underline">{r.name || r.phone || 'Lead'}</Link> <span className="text-outline">{r.phone}</span></span>
                    <span className={`text-right ${r.status === 'failed' ? 'text-error' : r.status === 'sent' ? 'text-secondary' : 'text-on-surface-variant'}`}>
                      {RESULT_LABEL[r.status] || r.status}{r.reason ? ` — ${r.reason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end"><button onClick={onClose} className="px-4 py-2 rounded-xl border border-outline-variant text-sm font-semibold">Close</button></div>
          </div>
        ) : (
          <div className="p-5 space-y-4 text-sm">
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-semibold text-on-surface-variant mb-1">Send to</legend>
              <label className={`flex items-center gap-2 ${selectedIds.length ? '' : 'opacity-50'}`}>
                <input type="radio" disabled={!selectedIds.length} checked={audience === 'selected'} onChange={() => setAudience('selected')} />
                The {selectedIds.length} selected lead{selectedIds.length === 1 ? '' : 's'}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={audience === 'filtered'} onChange={() => setAudience('filtered')} />
                All {filteredTotal.toLocaleString()} lead{filteredTotal === 1 ? '' : 's'} matching the current filters
              </label>
            </fieldset>

            <label className="block text-xs font-semibold text-on-surface-variant">Template
              {templates === null ? <Loader2 className="mt-2 w-4 h-4 animate-spin text-primary" /> : templates.length === 0 ? (
                <p className="mt-1 font-normal text-error">No approved template yet. Add one in <Link href="/admin/settings" className="underline">Settings → WhatsApp templates</Link>.</p>
              ) : (
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={`${input} mt-1`}>
                  <option value="">Choose a template…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.label}{t.category ? ` (${t.category.toLowerCase()})` : ''}</option>)}
                </select>
              )}
            </label>
            {template && <p className="whitespace-pre-wrap rounded-lg bg-surface-container p-3 text-xs">{template.body}</p>}

            {needsMessage && (
              <label className="block text-xs font-semibold text-on-surface-variant">Your message ({'{{2}}'})
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={MESSAGE_MAX + 50} placeholder="e.g. It was great meeting you at the Pune Business Meet. Would you like a free report for your business?" className={`${input} mt-1 font-normal`} />
                <span className={`block text-right font-normal ${message.length > MESSAGE_MAX ? 'text-error' : 'text-outline'}`}>{message.length}/{MESSAGE_MAX} · line breaks become spaces (WhatsApp rule)</span>
              </label>
            )}

            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={skipRecent} onChange={(e) => setSkipRecent(e.target.checked)} />
              Leave out leads who got a WhatsApp send in the last 7 days (protects your number&apos;s rating)
            </label>
            <label className="block text-xs font-semibold text-on-surface-variant">Name for this send (optional)
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Pune Business Meet follow-up" className={`${input} mt-1 font-normal`} />
            </label>

            {preview && (
              <div className="rounded-xl border border-outline-variant p-3 space-y-2 text-xs">
                <p className="text-sm"><strong>{preview.eligible}</strong> of {preview.total} lead{preview.total === 1 ? '' : 's'} will get it.</p>
                {preview.messageError && <p className="text-error">{preview.messageError}</p>}
                {preview.preview && (
                  <div>
                    <p className="text-outline mb-1">What {preview.preview.name} will read:</p>
                    <p className="whitespace-pre-wrap rounded-lg bg-primary-fixed p-3 text-on-surface">{preview.preview.text}</p>
                  </div>
                )}
                {preview.skipped.length > 0 && (
                  <div>
                    <p className="font-semibold text-on-surface-variant">Left out</p>
                    <ul className="mt-1 space-y-0.5">{preview.skipped.map((s) => <li key={s.reason}>{s.count} — {s.label}</li>)}</ul>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-primary">Show who</summary>
                      <ul className="mt-1 max-h-40 overflow-y-auto">{preview.skippedLeads.map((l) => <li key={l.id}>{l.name || l.phone || 'Lead'} {l.phone && `· ${l.phone}`} — {l.label}</li>)}</ul>
                    </details>
                  </div>
                )}
              </div>
            )}
            {error && <p role="alert" className="text-xs text-error">{error}</p>}

            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-xl border border-outline-variant text-sm font-semibold">Cancel</button>
              <button onClick={check} disabled={busy || !templateId || (needsMessage && !message.trim())} className="px-4 py-2 rounded-xl border border-primary text-primary text-sm font-semibold disabled:opacity-50">
                {busy && !preview ? <Loader2 className="inline w-4 h-4 animate-spin" /> : 'Check recipients'}
              </button>
              <button onClick={send} disabled={busy || !preview || preview.eligible === 0 || !!preview.messageError} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-semibold disabled:opacity-50">
                {busy && preview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {preview ? `Send to ${preview.eligible}` : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

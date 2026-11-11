'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';
import { PartnerStageSelect } from '@/components/partner/crm/PartnerStageSelect';
import { FOLLOW_UP_TYPES } from '@/lib/admin/platformCrm';

interface Detail {
  lead: {
    _id: string;
    name: string;
    contactName: string | null;
    business: string | null;
    phone: string | null;
    email: string | null;
    city: string | null;
    currentStage: string;
    stageLabel: string;
    dealValue: number | null;
    lostReason: string | null;
    createdAt: string;
    viaReferral: boolean;
  };
  timeline: Array<{ id: string; type: string; text: string; by: 'you' | 'system'; at: string }>;
  followUps: Array<{ _id: string; type: string; note: string | null; dueAt: string; status: string; overdue: boolean }>;
}

const INPUT = 'w-full px-3 py-2 border border-outline-variant rounded-lg text-sm bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary';

function when(d: string) {
  return new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function PartnerLeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<null | { name: string; business: string; phone: string; email: string; city: string; dealValue: string }>(null);
  const [note, setNote] = useState('');
  const [fu, setFu] = useState({ dueAt: '', type: 'Call', note: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/partner/leads/${id}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData(json.data);
    } catch (err: any) {
      setError(err?.message || 'Could not load the lead');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const call = async (key: string, url: string, method: string, body: unknown) => {
    setBusy(key);
    setActionError(null);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Something went wrong');
      await load();
      return true;
    } catch (err: any) {
      setActionError(err?.message || 'Something went wrong');
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <MaterialIcon name="progress_activity" size={28} className="animate-spin text-primary" />
      </div>
    );
  }
  const { lead, timeline, followUps } = data;
  const isCustomer = lead.currentStage === 'CUSTOMER';

  return (
    <div className="max-w-5xl">
      <Link href="/partner/leads" className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary mb-4 min-h-11">
        <MaterialIcon name="arrow_back" size={16} /> My leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">{lead.name}</h1>
          <p className="text-sm text-on-surface-variant">{[lead.business && lead.business !== lead.name ? lead.business : null, lead.city].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex items-center gap-2">
          {isCustomer ? (
            <span className="text-xs font-bold px-3 py-1.5 rounded-lg bg-secondary-container/50 text-secondary">Customer</span>
          ) : lead.viaReferral ? (
            <span className="text-xs font-bold px-3 py-1.5 rounded-lg bg-surface-container text-on-surface">{lead.stageLabel}</span>
          ) : (
            <PartnerStageSelect value={lead.currentStage} disabled={busy === 'stage'} onChange={(s) => call('stage', `/api/partner/leads/${lead._id}`, 'PATCH', { stage: s })} className="py-2 text-sm" />
          )}
        </div>
      </div>

      {lead.viaReferral && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-outline-variant bg-primary-fixed/40 p-3 text-sm text-on-surface">
          <MaterialIcon name="link" size={18} className="text-primary shrink-0 mt-0.5" />
          This lead came in through your referral link, so it’s credited to you. Our team is handling the conversation —
          you can still add notes and follow-ups.
        </div>
      )}

      {actionError && (
        <p role="alert" className="mb-4 text-sm text-error flex items-start gap-1.5">
          <MaterialIcon name="error" size={16} className="shrink-0 mt-0.5" /> {actionError}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-5">
          <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-on-surface">Details</h2>
              {!edit && !lead.viaReferral && (
                <button
                  onClick={() => setEdit({
                    name: lead.contactName ?? lead.name,
                    business: lead.business ?? '',
                    phone: lead.phone ?? '',
                    email: lead.email ?? '',
                    city: lead.city ?? '',
                    dealValue: lead.dealValue != null ? String(lead.dealValue) : '',
                  })}
                  className="text-sm font-medium text-primary"
                >
                  Edit
                </button>
              )}
            </div>
            {edit ? (
              <div className="space-y-3">
                <label className="block"><span className="block text-xs font-semibold mb-1">Contact name</span><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={INPUT} /></label>
                <label className="block"><span className="block text-xs font-semibold mb-1">Business</span><input value={edit.business} onChange={(e) => setEdit({ ...edit, business: e.target.value })} className={INPUT} /></label>
                <div><span className="block text-xs font-semibold mb-1">Mobile</span><PhoneNumberInput value={edit.phone} onChange={(v) => setEdit({ ...edit, phone: v })} className="rounded-lg [&_input]:py-2 [&_select]:py-2" /></div>
                <label className="block"><span className="block text-xs font-semibold mb-1">Email</span><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} className={INPUT} /></label>
                <label className="block"><span className="block text-xs font-semibold mb-1">City</span><input value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} className={INPUT} /></label>
                <label className="block"><span className="block text-xs font-semibold mb-1">Expected deal value (₹)</span><input type="number" min={0} value={edit.dealValue} onChange={(e) => setEdit({ ...edit, dealValue: e.target.value })} className={INPUT} /></label>
                <div className="flex gap-2 pt-1">
                  <button
                    disabled={busy === 'edit'}
                    onClick={async () => { if (await call('edit', `/api/partner/leads/${lead._id}`, 'PATCH', edit)) setEdit(null); }}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-on-primary disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button onClick={() => setEdit(null)} className="px-4 py-2 rounded-lg text-sm font-medium bg-surface-container">Cancel</button>
                </div>
              </div>
            ) : (
              <dl className="text-sm grid grid-cols-[110px_1fr] gap-y-2">
                <dt className="text-on-surface-variant">Contact</dt><dd>{lead.contactName ?? '—'}</dd>
                <dt className="text-on-surface-variant">Mobile</dt><dd>{lead.phone ? <a href={`tel:${lead.phone}`} className="text-primary">{lead.phone}</a> : '—'}</dd>
                <dt className="text-on-surface-variant">Email</dt><dd className="break-all">{lead.email ? <a href={`mailto:${lead.email}`} className="text-primary">{lead.email}</a> : '—'}</dd>
                <dt className="text-on-surface-variant">City</dt><dd>{lead.city ?? '—'}</dd>
                <dt className="text-on-surface-variant">Deal value</dt><dd>{lead.dealValue != null ? `₹${lead.dealValue.toLocaleString('en-IN')}` : '—'}</dd>
                <dt className="text-on-surface-variant">Added</dt><dd>{new Date(lead.createdAt).toLocaleDateString('en-IN')}</dd>
              </dl>
            )}
          </section>

          <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
            <h2 className="font-semibold text-on-surface mb-3">Follow-ups</h2>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input type="datetime-local" value={fu.dueAt} onChange={(e) => setFu({ ...fu, dueAt: e.target.value })} aria-label="Follow-up date and time" className={`${INPUT} col-span-2 sm:col-span-1`} />
              <select value={fu.type} onChange={(e) => setFu({ ...fu, type: e.target.value })} aria-label="Follow-up type" className={`${INPUT} col-span-2 sm:col-span-1`}>
                {FOLLOW_UP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input value={fu.note} onChange={(e) => setFu({ ...fu, note: e.target.value })} placeholder="What to do (optional)" className={`${INPUT} col-span-2`} />
            </div>
            <button
              disabled={!fu.dueAt || busy === 'fu'}
              onClick={async () => {
                const ok = await call('fu', `/api/partner/leads/${lead._id}/follow-ups`, 'POST', { ...fu, dueAt: new Date(fu.dueAt).toISOString() });
                if (ok) setFu({ dueAt: '', type: 'Call', note: '' });
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-primary-fixed text-primary disabled:opacity-50"
            >
              Schedule follow-up
            </button>
            {followUps.length > 0 && (
              <ul className="mt-4 divide-y divide-outline-variant">
                {followUps.map((f) => (
                  <li key={f._id} className="py-2 flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className={f.status === 'completed' ? 'line-through text-on-surface-variant' : f.overdue ? 'text-error font-medium' : 'text-on-surface'}>
                        {f.type} · {when(f.dueAt)}
                      </p>
                      {f.note && <p className="text-xs text-on-surface-variant">{f.note}</p>}
                    </div>
                    {f.status === 'pending' && (
                      <button
                        onClick={() => call(`f-${f._id}`, `/api/partner/follow-ups/${f._id}`, 'PATCH', { status: 'completed' })}
                        disabled={busy === `f-${f._id}`}
                        className="text-xs font-medium text-primary shrink-0"
                      >
                        Mark done
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
          <h2 className="font-semibold text-on-surface mb-3">Notes & activity</h2>
          <div className="flex gap-2 mb-4">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder="Add a note — call summary, next step…" aria-label="New note" className={INPUT} />
            <button
              disabled={!note.trim() || busy === 'note'}
              onClick={async () => { if (await call('note', `/api/partner/leads/${lead._id}/notes`, 'POST', { text: note })) setNote(''); }}
              className="px-4 rounded-lg text-sm font-medium bg-primary text-on-primary disabled:opacity-50 shrink-0"
            >
              Add
            </button>
          </div>
          <ol className="space-y-3">
            {timeline.map((e) => (
              <li key={e.id} className="flex gap-3">
                <MaterialIcon
                  name={e.type === 'NOTE_ADDED' ? 'sticky_note_2' : e.type === 'STAGE_CHANGED' ? 'swap_horiz' : e.type.startsWith('PAYMENT') || e.type === 'CUSTOMER_ACTIVATED' ? 'payments' : 'history'}
                  size={18}
                  className="text-outline shrink-0 mt-0.5"
                />
                <div className="min-w-0">
                  <p className="text-sm text-on-surface whitespace-pre-line break-words">{e.text}</p>
                  <p className="text-[11px] text-on-surface-variant">{e.at ? when(e.at) : ''}{e.by === 'you' ? ' · you' : ''}</p>
                </div>
              </li>
            ))}
            {timeline.length === 0 && <p className="text-sm text-on-surface-variant">No activity yet.</p>}
          </ol>
        </section>
      </div>
    </div>
  );
}

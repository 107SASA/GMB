'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, StickyNote } from 'lucide-react';
import { CRM_SOURCES } from '@/lib/admin/platformCrm';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';
import { RelTime } from '@/components/admin/conversion/primitives';
import { StageSelect } from './StageSelect';

const input = 'w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-sm';

interface Note { text: string; at: string; by: string | null }

/**
 * The team's side of a lead: details, stage, owner, nurture pause, deal value
 * and notes. Saves through PATCH /api/admin/crm/leads/:id — every change lands
 * on the timeline with the team member's name.
 */
export function LeadCrmPanel({ lead, notes, onSaved }: { lead: any; notes: Note[]; onSaved: () => void }) {
  const initial = () => ({
    name: lead.name || '',
    phone: lead.phone || '',
    email: lead.email || '',
    businessType: lead.businessType || '',
    city: lead.city || '',
    source: lead.source || 'Manual',
    tags: (lead.tags || []).join(', '),
    stage: lead.currentStage || 'NEW',
    assignedUserId: lead.assignedUser?.id || '',
    nurtureStatus: lead.nurtureStatus || 'ACTIVE',
    dealValue: lead.dealValue != null ? String(lead.dealValue) : '',
    lostReason: lead.lostReason || '',
    subStageId: lead.subStageId || '',
  });
  const [form, setForm] = useState(initial);
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const [subStages, setSubStages] = useState<{ id: string; name: string; stage: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState('');
  const [noting, setNoting] = useState(false);

  useEffect(() => { setForm(initial()); }, [lead]);
  useEffect(() => {
    fetch('/api/admin/inbox/team').then((r) => r.json()).then((j) => setTeam(j?.team ?? [])).catch(() => {});
    fetch('/api/admin/crm/sub-stages').then((r) => r.json()).then((j) => setSubStages(j?.subStages ?? [])).catch(() => {});
  }, []);
  const subOptions = subStages.filter((s) => s.stage === form.stage);

  const set = (k: keyof ReturnType<typeof initial>) => (v: string) =>
    // A sub-stage belongs to one stage: changing the stage clears it.
    setForm((f) => ({ ...f, [k]: v, ...(k === 'stage' && v !== f.stage ? { subStageId: '' } : {}) }));
  const optedOut = lead.nurtureStatus === 'OPTED_OUT';
  const lostLike = form.stage === 'LOST' || form.stage === 'DO_NOT_CONTACT';

  const save = async () => {
    const before = initial();
    const patch: Record<string, unknown> = {};
    for (const k of Object.keys(form) as (keyof typeof form)[]) {
      if (form[k] === before[k]) continue;
      if (k === 'tags') patch.tags = String(form.tags).split(/[;,]/).map((t: string) => t.trim()).filter(Boolean);
      else if (k === 'assignedUserId') patch.assignedUserId = form.assignedUserId || null;
      else if (k === 'dealValue') patch.dealValue = form.dealValue === '' ? null : Number(form.dealValue);
      else if (k === 'subStageId') patch.subStageId = form.subStageId || null;
      else patch[k] = form[k];
    }
    if (!Object.keys(patch).length) { setMsg({ ok: true, text: 'Nothing changed.' }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/crm/leads/${lead._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) setMsg({ ok: false, text: json?.error || 'Could not save.' });
      else { setMsg({ ok: true, text: 'Saved.' }); onSaved(); }
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setNoting(true);
    try {
      const res = await fetch(`/api/admin/crm/leads/${lead._id}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: note }) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) setMsg({ ok: false, text: json?.error || 'Could not add the note.' });
      else { setNote(''); onSaved(); }
    } finally {
      setNoting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-4">
        <h2 className="font-semibold text-sm text-on-surface mb-3">Lead details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <label>Name<input className={`${input} mt-1`} value={form.name} onChange={(e) => set('name')(e.target.value)} /></label>
          <label>Business name<input className={`${input} mt-1`} value={form.businessType} onChange={(e) => set('businessType')(e.target.value)} placeholder="Not captured yet" /></label>
          <label>Phone<PhoneNumberInput value={form.phone} onChange={set('phone')} className="mt-1 rounded-lg" /></label>
          <label>Email<input type="email" className={`${input} mt-1`} value={form.email} onChange={(e) => set('email')(e.target.value)} /></label>
          <label>City<input className={`${input} mt-1`} value={form.city} onChange={(e) => set('city')(e.target.value)} /></label>
          <label>Source
            <select className={`${input} mt-1`} value={form.source} onChange={(e) => set('source')(e.target.value)}>
              {CRM_SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label>Stage
            <StageSelect value={form.stage} onChange={set('stage')} disabled={form.stage === 'HUMAN_HANDOFF'} className="mt-1 w-full py-2 text-sm" />
          </label>
          <label>Sub-stage
            <select className={`${input} mt-1`} value={subOptions.some((s) => s.id === form.subStageId) ? form.subStageId : ''} onChange={(e) => set('subStageId')(e.target.value)} disabled={!subOptions.length}>
              <option value="">{subOptions.length ? 'None' : 'None for this stage'}</option>
              {subOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Assigned to
            <select className={`${input} mt-1`} value={form.assignedUserId} onChange={(e) => set('assignedUserId')(e.target.value)}>
              <option value="">Unassigned</option>
              {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label>Automated messages
            <select className={`${input} mt-1`} value={optedOut ? 'OPTED_OUT' : form.nurtureStatus} disabled={optedOut} onChange={(e) => set('nurtureStatus')(e.target.value)}>
              {optedOut && <option value="OPTED_OUT">Opted out (by the person)</option>}
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="STOPPED">Stopped</option>
            </select>
          </label>
          <label>Deal value (₹)<input inputMode="numeric" className={`${input} mt-1`} value={form.dealValue} onChange={(e) => set('dealValue')(e.target.value.replace(/[^\d.]/g, ''))} /></label>
          <label className="sm:col-span-2">Tags <span className="text-outline">(comma-separated)</span>
            <input className={`${input} mt-1`} value={form.tags} onChange={(e) => set('tags')(e.target.value)} />
          </label>
          {lostLike && (
            <label className="sm:col-span-3">Why lost / do not contact
              <input className={`${input} mt-1`} value={form.lostReason} onChange={(e) => set('lostReason')(e.target.value)} />
            </label>
          )}
        </div>
        <p className="mt-3 text-[11px] text-outline">
          Customer hands the lead to the in-house team; Lost / Do not contact cancels queued automated messages. To take over the chat, use the WhatsApp Inbox.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save changes
          </button>
          {msg && <span role={msg.ok ? 'status' : 'alert'} className={`text-xs ${msg.ok ? 'text-secondary' : 'text-error'}`}>{msg.text}</span>}
        </div>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-4 flex flex-col">
        <h2 className="font-semibold text-sm text-on-surface mb-3 inline-flex items-center gap-1.5"><StickyNote className="w-4 h-4" /> Team notes</h2>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Call summary, next step…" className={input} />
        <button onClick={addNote} disabled={noting || !note.trim()} className="mt-2 self-end px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-50">
          {noting ? 'Adding…' : 'Add note'}
        </button>
        <ul className="mt-3 space-y-2 max-h-72 overflow-y-auto">
          {notes.length === 0 && <li className="text-xs text-outline">No notes yet.</li>}
          {notes.map((n, i) => (
            <li key={i} className="text-xs border-l-2 border-primary pl-2">
              <p className="whitespace-pre-wrap text-on-surface">{n.text}</p>
              <p className="text-outline mt-0.5">{n.by || 'Team'} · <RelTime date={n.at} /></p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

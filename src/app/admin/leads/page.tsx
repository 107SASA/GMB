'use client';

/**
 * SuperAdmin — Leads & Pipeline.
 *
 * REPLACES the legacy "GrowwMatics Pipeline" Kanban that was built on
 * Business.pipelineStage. This is the Lead Engine pipeline: every
 * platform-prospect Lead (tenantId 'gmbboost-internal') with its live
 * engine state — agent, stage, intent, score, NBA, nurture status, demo &
 * payment status, and AI/Human/Customer ownership.
 *
 * Data: GET /api/admin/conversion/pipeline (server-side filtered + paged —
 * every filter is applied before paging). ?segment=<key> is how the
 * Conversion Overview numbers link here (lib/admin/leadMilestones.ts).
 * The legacy Business.pipelineStage field and its /api/admin/sales-leads*
 * routes are left in place in the DB/codebase but no longer linked here.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Users, Search, ChevronLeft, ChevronRight, ArrowUpDown, Plus, Upload, Download, LayoutList, Columns, Layers, CalendarClock, MessageCircle } from 'lucide-react';
import { SubStagesModal } from '@/components/admin/crm/SubStagesModal';
import { FollowUpsPanel } from '@/components/admin/crm/FollowUpsPanel';
import { CRM_SOURCES } from '@/lib/admin/platformCrm';
import { StageSelect } from '@/components/admin/crm/StageSelect';
import { AddLeadModal } from '@/components/admin/crm/AddLeadModal';
import { ImportLeadsModal } from '@/components/admin/crm/ImportLeadsModal';
import { SendWhatsAppModal } from '@/components/admin/crm/SendWhatsAppModal';
import { LeadBoard } from '@/components/admin/crm/LeadBoard';
import {
  OwnershipBadge,
  StageBadge,
  ScoreBar,
  RelTime,
  RangePicker,
} from '@/components/admin/conversion/primitives';

interface Row {
  _id: string;
  name: string;
  phone: string | null;
  business: string | null;
  createdAt: string;
  currentAgent: string;
  currentStage: string;
  funnelStage: string;
  intent: string | null;
  leadScore: number;
  aiLeadScore: number | null;
  nextBestAction: string | null;
  nextActionAt: string | null;
  nurtureStatus: string;
  lastActivityAt: string | null;
  ownership: string;
  humanHandoff: { reason: string | null; since: string | null } | null;
  demoStatus: string | null;
  paymentStatus: string;
  trialEndsAt?: string | null;
  source: string | null;
  city: string | null;
  tags: string[];
  assignedUserId: string | null;
  captureSources: string[];
  subStage: string | null;
}

const AGENTS = ['NONE', 'SALES', 'DEMO', 'IN_HOUSE', 'HUMAN'];
const INTENTS = ['EXPLORING', 'LEARNING', 'PROBLEM_AWARE', 'SOLUTION_AWARE', 'DEMO_INTEREST', 'PURCHASE_INTEREST', 'READY_TO_BUY', 'NOT_INTERESTED'];
const NBAS = ['ASK_QUALIFICATION', 'EDUCATE', 'SHARE_USE_CASE', 'ANSWER_QUESTION', 'HANDLE_OBJECTION', 'SHOW_VALUE', 'OFFER_DEMO', 'SCHEDULE_DEMO', 'SEND_PRICING', 'FOLLOW_UP_AFTER_DEMO', 'OFFER_SUBSCRIPTION', 'REENGAGE', 'WAIT', 'HUMAN_HANDOFF', 'STOP'];
const NURTURE = ['ACTIVE', 'PAUSED', 'STOPPED', 'OPTED_OUT'];

const selectCls = 'px-2 py-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs text-on-surface';

export default function LeadsPipelinePage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [rows, setRows] = useState<Row[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [scope, setScope] = useState<string>('All leads (all time)');
  const [segment, setSegment] = useState<{ key: string; label: string; description: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [modal, setModal] = useState<'add' | 'import' | 'stages' | 'followups' | 'whatsapp' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const view = sp.get('view') === 'board' ? 'board' : 'list';

  useEffect(() => {
    fetch('/api/admin/inbox/team').then((r) => r.json()).then((j) => setTeam(j?.team ?? j?.data ?? [])).catch(() => {});
  }, []);

  // Keep the search box in step with the URL (Clear all, back/forward).
  useEffect(() => { setQ(sp.get('q') ?? ''); }, [sp]);

  // Filter state is the URL — so KPI-card deep links (?agent=SALES) work.
  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(Array.from(sp.entries()));
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      router.replace(`/admin/leads?${next.toString()}`);
    },
    [router, sp]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(Array.from(sp.entries()));
      params.delete('view');
      if (view === 'board') { params.set('pageSize', '500'); params.delete('page'); }
      const res = await fetch(`/api/admin/conversion/pipeline?${params.toString()}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Request failed (${res.status})`);
      setRows(json.rows);
      setPagination(json.pagination);
      setScope(json.range?.label ?? 'All leads (all time)');
      setSegment(json.segment ?? null);
      setSelected(new Set());
    } catch (err: any) {
      setRows([]);
      setError(err?.message || 'Could not load leads');
    } finally {
      setLoading(false);
    }
  }, [sp, view]);

  useEffect(() => { load(); }, [load]);

  /** One lead's stage, from the table or the board. */
  const changeStage = async (id: string, stage: string) => {
    setBusyId(id);
    setNotice(null);
    const before = rows;
    // Move it right away (the board card stays where it was dropped); undo on failure.
    setRows((cur) => cur.map((r) => (r._id === id ? { ...r, currentStage: stage, subStage: null } : r)));
    try {
      const res = await fetch(`/api/admin/crm/leads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setRows(before);
        setNotice({ ok: false, text: json?.error || 'Could not change the stage.' });
      } else await load();
    } catch {
      setRows(before);
      setNotice({ ok: false, text: 'Network error — the lead was not moved.' });
    } finally {
      setBusyId(null);
    }
  };

  const moveSelected = async () => {
    if (!bulkStage || !selected.size) return;
    setNotice(null);
    const res = await fetch('/api/admin/crm/leads/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [...selected], stage: bulkStage }) });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) setNotice({ ok: false, text: json?.error || 'Could not move the leads.' });
    else { setNotice({ ok: true, text: `${json.updated} lead${json.updated === 1 ? '' : 's'} moved.` }); setBulkStage(''); await load(); }
  };

  const exportHref = () => {
    const params = new URLSearchParams(Array.from(sp.entries()));
    ['view', 'page', 'pageSize'].forEach((k) => params.delete(k));
    return `/api/admin/crm/export?${params.toString()}`;
  };
  const toggleAll = () => setSelected((cur) => (cur.size === rows.length ? new Set() : new Set(rows.map((r) => r._id))));
  const toggleOne = (id: string) => setSelected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const val = (k: string) => sp.get(k) ?? '';
  const page = Number(sp.get('page')) || 1;
  const sort = sp.get('sort') || 'createdAt:desc';
  const toggleSort = (field: string) => {
    const [f, d] = sort.split(':');
    setParam('sort', f === field && d === 'desc' ? `${field}:asc` : `${field}:desc`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center shadow-sm">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">Leads &amp; Pipeline</h1>
            <p className="text-sm text-on-surface-variant">
              Every GrowwMatics prospect and its live Lead Engine state.{' '}
              <Link href="/admin/pipeline" className="underline font-semibold hover:text-primary">Conversion overview</Link>
              {' · '}
              <Link href="/admin/crm" className="underline font-semibold hover:text-primary">Customers&apos; own leads</Link>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setModal('add')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold"><Plus className="w-3.5 h-3.5" /> Add lead</button>
          <button onClick={() => setModal('import')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant text-xs font-semibold"><Upload className="w-3.5 h-3.5" /> Import CSV</button>
          <a href={exportHref()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant text-xs font-semibold"><Download className="w-3.5 h-3.5" /> Export CSV</a>
          <button onClick={() => setModal('whatsapp')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant text-xs font-semibold"><MessageCircle className="w-3.5 h-3.5" /> Send WhatsApp</button>
          <button onClick={() => setModal('followups')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant text-xs font-semibold"><CalendarClock className="w-3.5 h-3.5" /> Follow-ups</button>
          <button onClick={() => setModal('stages')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant text-xs font-semibold"><Layers className="w-3.5 h-3.5" /> Custom stages</button>
          <div className="inline-flex rounded-lg border border-outline-variant overflow-hidden">
            <button onClick={() => setParam('view', '')} aria-pressed={view === 'list'} className={`px-2.5 py-1.5 ${view === 'list' ? 'bg-primary text-white' : ''}`} title="List"><LayoutList className="w-3.5 h-3.5" /></button>
            <button onClick={() => setParam('view', 'board')} aria-pressed={view === 'board'} className={`px-2.5 py-1.5 ${view === 'board' ? 'bg-primary text-white' : ''}`} title="Board"><Columns className="w-3.5 h-3.5" /></button>
          </div>
          <RangePicker value={val('range') || 'all'} onChange={(v) => setParam('range', v === 'all' ? '' : v)} />
        </div>
      </div>

      {modal === 'add' && <AddLeadModal onClose={() => setModal(null)} onCreated={(id) => router.push(`/admin/leads/${id}`)} />}
      {modal === 'import' && <ImportLeadsModal onClose={() => setModal(null)} onImported={load} />}
      {modal === 'stages' && <SubStagesModal onClose={() => setModal(null)} onSaved={() => load()} />}
      {modal === 'whatsapp' && (
        <SendWhatsAppModal
          selectedIds={[...selected]}
          filters={new URLSearchParams(Array.from(sp.entries())).toString()}
          filteredTotal={pagination.total}
          onClose={() => { setModal(null); load(); }}
        />
      )}
      {modal === 'followups' && <FollowUpsPanel onClose={() => setModal(null)} />}
      {notice && <p role={notice.ok ? 'status' : 'alert'} className={`text-sm ${notice.ok ? 'text-secondary' : 'text-error'}`}>{notice.text}</p>}

      <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
        <span>{scope}</span>
        {segment && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary-fixed px-2.5 py-1 text-primary">
            <strong>{segment.label}</strong> — {segment.description}
            <button onClick={() => setParam('segment', '')} className="ml-1 underline">remove</button>
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-outline" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setParam('q', q)}
            onBlur={() => setParam('q', q)}
            placeholder="Name, business or phone…"
            className="pl-8 pr-2 py-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs w-44"
          />
        </div>
        <Filter label="Agent" value={val('agent')} options={AGENTS} onChange={(v) => setParam('agent', v)} />
        <StageSelect value={val('crmStage')} onChange={(v) => setParam('crmStage', v)} includeAll="Stage: all" />
        <Filter label="Source" value={val('source')} options={[...CRM_SOURCES]} onChange={(v) => setParam('source', v)} />
        <select className={selectCls} value={val('assigned')} onChange={(e) => setParam('assigned', e.target.value)}>
          <option value="">Assigned: anyone</option>
          <option value="none">Unassigned</option>
          {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <Filter label="Intent" value={val('intent')} options={INTENTS} onChange={(v) => setParam('intent', v)} />
        <Filter label="NBA" value={val('nba')} options={NBAS} onChange={(v) => setParam('nba', v)} />
        <Filter label="Nurture" value={val('nurture')} options={NURTURE} onChange={(v) => setParam('nurture', v)} />
        <Filter label="Ownership" value={val('ownership')} options={['ai', 'human', 'customer']} onChange={(v) => setParam('ownership', v)} />
        <Filter label="Demo" value={val('demo')} options={['any', 'scheduled', 'completed', 'none']} onChange={(v) => setParam('demo', v)} />
        <Filter label="Payment" value={val('payment')} options={['verified', 'trial', 'pending', 'none']} onChange={(v) => setParam('payment', v)} />
        <select className={selectCls} value={val('minScore')} onChange={(e) => setParam('minScore', e.target.value)}>
          <option value="">Any score</option>
          {[15, 30, 45, 60, 75].map((s) => <option key={s} value={s}>Score ≥ {s}</option>)}
        </select>
        {Array.from(sp.keys()).some((key) => !['page', 'sort'].includes(key)) && (
          <button onClick={() => { setQ(''); router.replace('/admin/leads'); }} className="text-xs font-medium text-primary hover:underline ml-1">
            Clear all
          </button>
        )}
      </div>

      {selected.size > 0 && view === 'list' && (
        <div className="flex flex-wrap items-center gap-2 bg-primary-fixed rounded-xl px-3 py-2 text-xs text-primary">
          <strong>{selected.size} selected</strong>
          <StageSelect value={bulkStage} onChange={setBulkStage} includeAll="Move to stage…" />
          <button onClick={moveSelected} disabled={!bulkStage} className="px-3 py-1.5 rounded-lg bg-primary text-white font-semibold disabled:opacity-50">Move</button>
          <button onClick={() => setModal('whatsapp')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-primary font-semibold"><MessageCircle className="w-3.5 h-3.5" /> Send WhatsApp</button>
          <button onClick={() => setSelected(new Set())} className="underline">Clear</button>
        </div>
      )}

      {view === 'board' && !loading && !error && (
        <>
          {pagination.total > rows.length && (
            <p className="text-xs text-warning-text">Showing the first {rows.length} of {pagination.total.toLocaleString()} leads — narrow the filters to see the rest.</p>
          )}
          <LeadBoard rows={rows} onStage={changeStage} busyId={busyId} />
        </>
      )}

      {/* Table */}
      <div className={`bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow overflow-hidden ${view === 'board' && !loading && !error ? 'hidden' : ''}`}>
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : error ? (
          <div role="alert" className="py-16 text-center text-sm text-error">
            Couldn&apos;t load leads: {error}. <button onClick={load} className="underline font-semibold">Retry</button>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-outline">No leads match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-label-sm text-on-surface-variant bg-surface-container-low whitespace-nowrap">
                  <th className="px-3 py-2.5"><input type="checkbox" aria-label="Select all" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} /></th>
                  <th className="text-left px-3 py-2.5">Lead</th>
                  <th className="text-left px-3 py-2.5">Owner</th>
                  <th className="text-left px-3 py-2.5">Stage</th>
                  <th className="text-left px-3 py-2.5">Intent</th>
                  <SortableTh label="Score" active={sort.startsWith('leadScore')} dir={sort.split(':')[1]} onClick={() => toggleSort('leadScore')} />
                  <th className="text-left px-3 py-2.5">Next best action</th>
                  <th className="text-left px-3 py-2.5">Nurture</th>
                  <th className="text-left px-3 py-2.5">Demo</th>
                  <th className="text-left px-3 py-2.5">Payment</th>
                  <SortableTh label="Last activity" active={sort.startsWith('lastActivityAt')} dir={sort.split(':')[1]} onClick={() => toggleSort('lastActivityAt')} />
                  <SortableTh label="Created" active={sort.startsWith('createdAt')} dir={sort.split(':')[1]} onClick={() => toggleSort('createdAt')} />
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {rows.map((r) => (
                  <tr key={r._id} className="hover:bg-surface transition-colors">
                    <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r._id)} onChange={() => toggleOne(r._id)} /></td>
                    <td className="px-3 py-2.5">
                      <Link href={`/admin/leads/${r._id}`} className="font-medium text-on-surface hover:text-primary">
                        {r.name}
                      </Link>
                      <div className="text-xs text-outline">{[r.business && r.business !== r.name ? r.business : null, r.phone].filter(Boolean).join(' · ')}</div>
                      {r.captureSources?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {r.captureSources.map((s) => <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">{s}</span>)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <OwnershipBadge ownership={r.ownership} />
                      {r.humanHandoff && <div className="text-xs text-warning-text mt-0.5">{r.humanHandoff.reason}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <StageSelect value={r.currentStage} disabled={busyId === r._id || r.currentStage === 'HUMAN_HANDOFF'} onChange={(stage) => changeStage(r._id, stage)} />
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {r.subStage && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary-fixed text-primary">{r.subStage}</span>}
                        <StageBadge stage={r.funnelStage} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-on-surface-variant">{r.intent || '—'}</td>
                    <td className="px-3 py-2.5"><ScoreBar score={r.leadScore} /></td>
                    <td className="px-3 py-2.5 text-xs text-on-surface-variant">{r.nextBestAction || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-medium ${r.nurtureStatus === 'OPTED_OUT' ? 'text-error' : r.nurtureStatus === 'ACTIVE' ? 'text-on-surface-variant' : 'text-warning-text'}`}>
                        {r.nurtureStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-on-surface-variant">{r.demoStatus || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-medium ${r.paymentStatus === 'verified' ? 'text-secondary' : r.paymentStatus === 'trial' ? 'text-primary' : r.paymentStatus === 'pending' ? 'text-warning-text' : 'text-outline'}`}>
                        {r.paymentStatus === 'trial' ? 'free trial' : r.paymentStatus}
                      </span>
                      {r.paymentStatus === 'trial' && r.trialEndsAt && (
                        <span className="block text-[11px] text-on-surface-variant">
                          ends {new Date(r.trialEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5"><RelTime date={r.lastActivityAt} /></td>
                    <td className="px-3 py-2.5"><RelTime date={r.createdAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className={`${view === 'board' ? 'hidden' : 'flex'} items-center justify-between px-4 py-3 border-t border-outline-variant text-xs text-on-surface-variant`}>
          <span>
            {pagination.total.toLocaleString()} lead{pagination.total === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setParam('page', String(page - 1))}
              className="p-1.5 rounded-lg border border-outline-variant disabled:opacity-40 hover:bg-surface-container"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>Page {page} / {pagination.totalPages}</span>
            <button
              disabled={page >= pagination.totalPages}
              onClick={() => setParam('page', String(page + 1))}
              className="p-1.5 rounded-lg border border-outline-variant disabled:opacity-40 hover:bg-surface-container"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Filter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}: all</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

function SortableTh({ label, active, dir, onClick }: { label: string; active: boolean; dir?: string; onClick: () => void }) {
  return (
    <th className="text-left px-3 py-2.5">
      <button onClick={onClick} className={`inline-flex items-center gap-1 ${active ? 'text-primary' : ''}`}>
        {label} <ArrowUpDown className="w-3 h-3" />
        {active && <span className="text-[10px]">{dir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}

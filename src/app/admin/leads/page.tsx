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
 * Data: GET /api/admin/conversion/pipeline (server-side filtered + paged).
 * The legacy Business.pipelineStage field and its /api/admin/sales-leads*
 * routes are left in place in the DB/codebase but no longer linked here.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Users, Search, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';
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
}

const AGENTS = ['NONE', 'SALES', 'DEMO', 'IN_HOUSE', 'HUMAN'];
const STAGES = [
  'NEW', 'QUALIFYING', 'NURTURING', 'DEMO_REQUESTED', 'DEMO_SCHEDULED', 'DEMO_COMPLETED',
  'CONVERSION_PENDING', 'PAYMENT_VERIFIED', 'CUSTOMER', 'COLD', 'UNRESPONSIVE',
  'LONG_TERM_NURTURE', 'LOST', 'DO_NOT_CONTACT', 'HUMAN_HANDOFF',
];
const INTENTS = ['EXPLORING', 'LEARNING', 'PROBLEM_AWARE', 'SOLUTION_AWARE', 'DEMO_INTEREST', 'PURCHASE_INTEREST', 'READY_TO_BUY', 'NOT_INTERESTED'];
const NBAS = ['ASK_QUALIFICATION', 'EDUCATE', 'SHARE_USE_CASE', 'ANSWER_QUESTION', 'HANDLE_OBJECTION', 'SHOW_VALUE', 'OFFER_DEMO', 'SCHEDULE_DEMO', 'SEND_PRICING', 'FOLLOW_UP_AFTER_DEMO', 'OFFER_SUBSCRIPTION', 'REENGAGE', 'WAIT', 'HUMAN_HANDOFF', 'STOP'];
const NURTURE = ['ACTIVE', 'PAUSED', 'STOPPED', 'OPTED_OUT'];

const selectCls = 'px-2 py-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs text-on-surface';

export default function LeadsPipelinePage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [rows, setRows] = useState<Row[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [note, setNote] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(sp.get('q') ?? '');

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
    try {
      const res = await fetch(`/api/admin/conversion/pipeline?${sp.toString()}`);
      const json = await res.json();
      if (json.success) {
        setRows(json.rows);
        setPagination(json.pagination);
        setNote(json.note);
      }
    } finally {
      setLoading(false);
    }
  }, [sp]);

  useEffect(() => { load(); }, [load]);

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
        <RangePicker value={val('range') || '30d'} onChange={(v) => setParam('range', v === '30d' ? '' : v)} />
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
            placeholder="Name or phone…"
            className="pl-8 pr-2 py-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs w-44"
          />
        </div>
        <Filter label="Agent" value={val('agent')} options={AGENTS} onChange={(v) => setParam('agent', v)} />
        <Filter label="Stage" value={val('stage')} options={STAGES} onChange={(v) => setParam('stage', v)} />
        <Filter label="Intent" value={val('intent')} options={INTENTS} onChange={(v) => setParam('intent', v)} />
        <Filter label="NBA" value={val('nba')} options={NBAS} onChange={(v) => setParam('nba', v)} />
        <Filter label="Nurture" value={val('nurture')} options={NURTURE} onChange={(v) => setParam('nurture', v)} />
        <Filter label="Ownership" value={val('ownership')} options={['ai', 'human', 'customer']} onChange={(v) => setParam('ownership', v)} />
        <Filter label="Demo" value={val('demo')} options={['any', 'scheduled', 'completed', 'none']} onChange={(v) => setParam('demo', v)} />
        <Filter label="Payment" value={val('payment')} options={['verified', 'pending', 'none']} onChange={(v) => setParam('payment', v)} />
        <select className={selectCls} value={val('minScore')} onChange={(e) => setParam('minScore', e.target.value)}>
          <option value="">Any score</option>
          {[15, 30, 45, 60, 75].map((s) => <option key={s} value={s}>Score ≥ {s}</option>)}
        </select>
        {Array.from(sp.keys()).some((key) => !['page', 'sort'].includes(key)) && (
          <button onClick={() => router.replace('/admin/leads')} className="text-xs font-medium text-primary hover:underline ml-1">
            Clear all
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-outline">No leads match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-label-sm text-on-surface-variant bg-surface-container-low whitespace-nowrap">
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
                    <td className="px-3 py-2.5">
                      <Link href={`/admin/leads/${r._id}`} className="font-medium text-on-surface hover:text-primary">
                        {r.name || '—'}
                      </Link>
                      <div className="text-xs text-outline">{r.business || r.phone || '—'}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <OwnershipBadge ownership={r.ownership} />
                      {r.humanHandoff && <div className="text-xs text-warning-text mt-0.5">{r.humanHandoff.reason}</div>}
                    </td>
                    <td className="px-3 py-2.5"><StageBadge stage={r.funnelStage} /></td>
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
                      <span className={`text-xs font-medium ${r.paymentStatus === 'verified' ? 'text-secondary' : r.paymentStatus === 'pending' ? 'text-warning-text' : 'text-outline'}`}>
                        {r.paymentStatus}
                      </span>
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
        <div className="flex items-center justify-between px-4 py-3 border-t border-outline-variant text-xs text-on-surface-variant">
          <span>
            {pagination.total.toLocaleString()} lead{pagination.total === 1 ? '' : 's'}
            {note && <span className="text-warning-text"> · {note}</span>}
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

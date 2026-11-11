'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { PartnerStageSelect } from '@/components/partner/crm/PartnerStageSelect';
import { AddPartnerLeadModal } from '@/components/partner/crm/AddPartnerLeadModal';
import { ImportPartnerLeadsModal } from '@/components/partner/crm/ImportPartnerLeadsModal';

/** CSV download (an API route, so a plain link — not client-side navigation). */
const EXPORT_URL = '/api/partner/leads/export';

interface Row {
  _id: string;
  name: string;
  business: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  currentStage: string;
  stageLabel: string;
  dealValue: number | null;
  createdAt: string;
}

export default function PartnerLeadsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (stage) params.set('stage', stage);
      const res = await fetch(`/api/partner/leads?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setRows(json.data);
    } catch (err: any) {
      setError(err?.message || 'Could not load your leads');
    } finally {
      setLoading(false);
    }
  }, [q, stage]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const changeStage = async (id: string, next: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/partner/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not change the stage');
      await load();
    } catch (err: any) {
      alert(err?.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">My leads</h1>
          <p className="text-sm text-on-surface-variant">Every business you bring to Growwmatics AI.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={EXPORT_URL} download className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-surface-container min-h-11">
            <MaterialIcon name="download" size={18} /> Export
          </a>
          <button onClick={() => setImporting(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-surface-container min-h-11">
            <MaterialIcon name="upload_file" size={18} /> Import
          </button>
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-on-primary min-h-11">
            <MaterialIcon name="add" size={18} /> Add lead
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <MaterialIcon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, business, phone, city"
            aria-label="Search leads"
            className="w-full pl-9 pr-3 py-2.5 border border-outline-variant rounded-lg text-sm bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <PartnerStageSelect value={stage} onChange={setStage} includeAll="All stages" className="py-2.5 text-sm" />
      </div>

      {error && <p className="mb-4 text-sm text-error">{error}</p>}

      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-16">
          <MaterialIcon name="progress_activity" size={28} className="animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-sm text-on-surface-variant bg-surface-container-lowest rounded-xl border border-outline-variant">
          {q || stage ? 'No leads match.' : 'No leads yet. Add your first one, or import a list.'}
        </div>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low text-left text-on-surface-variant">
                <th className="p-3">Lead</th>
                <th className="p-3">Phone</th>
                <th className="p-3">City</th>
                <th className="p-3">Stage</th>
                <th className="p-3">Added</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-b border-outline-variant last:border-0">
                  <td className="p-3">
                    <Link href={`/partner/leads/${r._id}`} className="font-semibold text-on-surface hover:text-primary">{r.name}</Link>
                    {r.business && r.business !== r.name && <p className="text-xs text-on-surface-variant">{r.business}</p>}
                  </td>
                  <td className="p-3 whitespace-nowrap">{r.phone}</td>
                  <td className="p-3">{r.city ?? '—'}</td>
                  <td className="p-3">
                    <PartnerStageSelect value={r.currentStage} disabled={busyId === r._id} onChange={(s) => changeStage(r._id, s)} />
                  </td>
                  <td className="p-3 whitespace-nowrap text-xs text-on-surface-variant">{new Date(r.createdAt).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && <AddPartnerLeadModal onClose={() => setAdding(false)} onAdded={load} />}
      {importing && <ImportPartnerLeadsModal onClose={() => setImporting(false)} onImported={load} />}
    </div>
  );
}

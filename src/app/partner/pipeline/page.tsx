'use client';

import { useCallback, useEffect, useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { PartnerBoard, type PartnerBoardRow } from '@/components/partner/crm/PartnerBoard';
import { AddPartnerLeadModal } from '@/components/partner/crm/AddPartnerLeadModal';

export default function PartnerPipelinePage() {
  const [rows, setRows] = useState<PartnerBoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/partner/leads');
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setRows(json.data);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not load your pipeline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onStage = async (id: string, stage: string) => {
    const before = rows;
    setRows((r) => r.map((x) => (x._id === id ? { ...x, currentStage: stage } : x)));
    setBusyId(id);
    try {
      const res = await fetch(`/api/partner/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not move the lead');
    } catch (err: any) {
      setRows(before);
      alert(err?.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">Pipeline</h1>
          <p className="text-sm text-on-surface-variant">Drag a lead to move it. It becomes a customer when their payment is received.</p>
        </div>
        <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-on-primary min-h-11">
          <MaterialIcon name="add" size={18} /> Add lead
        </button>
      </div>
      {error && <p className="mb-4 text-sm text-error">{error}</p>}
      {loading ? (
        <div className="flex justify-center py-16">
          <MaterialIcon name="progress_activity" size={28} className="animate-spin text-primary" />
        </div>
      ) : (
        <PartnerBoard rows={rows} onStage={onStage} busyId={busyId} />
      )}
      {adding && <AddPartnerLeadModal onClose={() => setAdding(false)} onAdded={load} />}
    </div>
  );
}

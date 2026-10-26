'use client';

import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Loader2 } from 'lucide-react';
import { CRM_STAGES, SUB_STAGE_COLORS, type CrmSubStage } from '@/lib/admin/platformCrm';

const DOT: Record<string, string> = { slate: 'bg-outline', blue: 'bg-primary', green: 'bg-secondary', amber: 'bg-warning', red: 'bg-error', purple: 'bg-tertiary' };

/**
 * The team's own sub-stages under each main stage (e.g. "Called twice" under
 * Qualifying). Main stages stay fixed because the AI agents rely on them.
 */
export function SubStagesModal({ onClose, onSaved }: { onClose: () => void; onSaved: (s: CrmSubStage[]) => void }) {
  const [list, setList] = useState<CrmSubStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/crm/sub-stages').then((r) => r.json()).then((j) => setList(j?.subStages ?? [])).catch(() => setError('Could not load sub-stages.')).finally(() => setLoading(false));
  }, []);

  const update = (i: number, patch: Partial<CrmSubStage>) => setList((cur) => cur.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const add = () => setList((cur) => [...cur, { id: '', name: '', stage: 'QUALIFYING', color: 'blue' }]);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/crm/sub-stages', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subStages: list }) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) { setError(json?.error || 'Could not save.'); return; }
      onSaved(json.subStages);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-outline-variant">
          <div>
            <h2 className="font-bold text-on-surface">Custom stages</h2>
            <p className="text-xs text-on-surface-variant">Your own sub-stages under a main stage. Deleting one clears it from the leads that had it; renaming updates them.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-surface-container"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-2">
          {loading ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : (
            <>
              {list.length === 0 && <p className="text-sm text-outline">No custom stages yet.</p>}
              {list.map((s, i) => (
                <div key={s.id || `new-${i}`} className="flex flex-wrap items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${DOT[s.color] || 'bg-outline'}`} />
                  <input value={s.name} maxLength={40} onChange={(e) => update(i, { name: e.target.value })} placeholder="e.g. Called twice" className="flex-1 min-w-[160px] px-3 py-1.5 rounded-lg border border-outline-variant text-sm" />
                  <select value={s.stage} onChange={(e) => update(i, { stage: e.target.value })} className="px-2 py-1.5 rounded-lg border border-outline-variant text-xs">
                    {CRM_STAGES.filter((st) => st.settable).map((st) => <option key={st.value} value={st.value}>under {st.label}</option>)}
                  </select>
                  <select value={s.color} onChange={(e) => update(i, { color: e.target.value })} className="px-2 py-1.5 rounded-lg border border-outline-variant text-xs">
                    {SUB_STAGE_COLORS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <button onClick={() => setList((cur) => cur.filter((_, idx) => idx !== i))} aria-label="Delete" className="p-1.5 rounded-lg hover:bg-error-container text-error"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <button onClick={add} className="inline-flex items-center gap-1 text-xs font-semibold text-primary mt-2"><Plus className="w-3.5 h-3.5" /> Add a sub-stage</button>
            </>
          )}
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-outline-variant">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm border border-outline-variant">Cancel</button>
          <button onClick={save} disabled={saving || loading} className="px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-white disabled:opacity-50">Save</button>
        </div>
      </div>
    </div>
  );
}

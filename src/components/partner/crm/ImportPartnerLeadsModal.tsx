'use client';

import { useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { CRM_CSV_TEMPLATE } from '@/lib/admin/platformCrm';

interface Summary {
  created: number;
  skipped: number;
  errors: Array<{ row: number; error: string }>;
}

export function ImportPartnerLeadsModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(CRM_CSV_TEMPLATE)}`;

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/partner/leads/import', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Import failed');
      setSummary(json.data);
      onImported();
    } catch (err: any) {
      setError(err?.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Import leads" className="bg-surface-container-lowest rounded-xl border border-outline-variant w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-lg text-on-surface mb-2">Import leads</h2>
        <p className="text-sm text-on-surface-variant mb-4">
          Upload a .csv or .xlsx file (up to 1,000 rows).{' '}
          <a href={templateHref} download="leads-template.csv" className="text-primary font-medium">Download the template</a>.
          Numbers already in our system are skipped.
        </p>

        {summary ? (
          <div className="space-y-3">
            <p className="text-sm text-on-surface">
              <strong>{summary.created}</strong> added · <strong>{summary.skipped}</strong> skipped
              {summary.errors.length ? ` · ${summary.errors.length} with problems` : ''}
            </p>
            {summary.errors.length > 0 && (
              <ul className="max-h-48 overflow-y-auto text-xs text-on-surface-variant border border-outline-variant rounded-lg divide-y divide-outline-variant">
                {summary.errors.map((e, i) => (
                  <li key={i} className="px-3 py-1.5">Row {e.row}: {e.error}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-error flex items-start gap-1.5">
            <MaterialIcon name="error" size={16} className="shrink-0 mt-0.5" />
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-surface-container">{summary ? 'Done' : 'Cancel'}</button>
          {!summary && (
            <button onClick={run} disabled={busy || !file} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-on-primary disabled:opacity-50">
              {busy && <MaterialIcon name="progress_activity" size={16} className="animate-spin" />}
              Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

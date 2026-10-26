'use client';

import { useRef, useState } from 'react';
import { X, Download, FileUp, Loader2, CheckCircle } from 'lucide-react';
import { CRM_CSV_TEMPLATE } from '@/lib/admin/platformCrm';

interface Summary { created: number; updated: number; skipped: number; errors: { row: number; error: string }[] }

/** Bulk upload existing leads from .csv / .xlsx, with a sample file to start from. */
export function ImportLeadsModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [updateStages, setUpdateStages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Summary | null>(null);

  const downloadSample = () => {
    const url = URL.createObjectURL(new Blob([CRM_CSV_TEMPLATE], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'growwmatics-leads-sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('updateStages', String(updateStages));
      const res = await fetch('/api/admin/crm/leads/import', { method: 'POST', body: fd });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) { setError(json?.error || 'Import failed.'); return; }
      setResult(json);
      if (json.created || json.updated) onImported();
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-outline-variant">
          <div>
            <h2 className="font-bold text-on-surface">Import leads</h2>
            <p className="text-xs text-on-surface-variant">CSV or Excel (.xlsx), up to 1,000 rows. Importing never messages anyone.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-surface-container"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <button onClick={downloadSample} className="inline-flex items-center gap-2 text-xs font-semibold text-primary">
            <Download className="w-3.5 h-3.5" /> Download sample CSV
          </button>
          <div className="text-xs text-on-surface-variant bg-surface border border-outline-variant rounded-xl p-3 leading-relaxed">
            <strong className="text-on-surface">Columns:</strong> phone <span className="text-error">*</span>, name or business <span className="text-error">*</span>,
            email, city, source (e.g. Referral, Phone Call), stage (e.g. New, Qualifying, Demo scheduled, Customer, Lost), tags (separated by ;), notes.
            A phone already in the CRM is matched — its empty fields are filled, never overwritten.
          </div>
          {!result && (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-outline-variant hover:border-primary rounded-2xl p-6 flex flex-col items-center gap-2"
              >
                <FileUp className="w-6 h-6 text-primary" />
                <span className="font-semibold">{file ? file.name : 'Choose a .csv or .xlsx file'}</span>
              </button>
              <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }} />
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={updateStages} onChange={(e) => setUpdateStages(e.target.checked)} className="mt-0.5" />
                Also change the stage of leads that already exist (from the file&apos;s stage column)
              </label>
            </>
          )}
          {error && <p role="alert" className="text-error">{error}</p>}
          {result && (
            <div className="space-y-2">
              <p className="flex items-center gap-2 font-semibold text-secondary"><CheckCircle className="w-4 h-4" /> Import finished</p>
              <p>{result.created} added · {result.updated} updated · {result.skipped} unchanged/skipped · {result.errors.length} with problems</p>
              {result.errors.length > 0 && (
                <ul className="max-h-40 overflow-y-auto text-xs text-error border border-error-container rounded-lg p-2 space-y-0.5">
                  {result.errors.map((e) => <li key={`${e.row}-${e.error}`}>Row {e.row}: {e.error}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-outline-variant">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm border border-outline-variant">{result ? 'Done' : 'Cancel'}</button>
          {!result && (
            <button onClick={upload} disabled={!file || busy} className="px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

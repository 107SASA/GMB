'use client';

import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { UploadCloud, CheckCircle2, AlertCircle, Loader2, X, AlertTriangle, Download, Send } from 'lucide-react';
import { normalizePhoneE164 } from '@/lib/phone';
import { makeColumnGetter, COLUMN_ALIASES } from '@/lib/csvColumns';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

interface CustomerUploadModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface ParsedRow {
  name: string;
  phone: string;
  email: string;
  service: string;
  serviceDate: string;
  tags: string[];
  notes: string;
  phoneValid: boolean;
}

/** A ready-to-fill file: the columns this importer reads, with two example rows. */
const SAMPLE_CSV = [
  'Name,Phone,Email,Service,Date,Tags,Notes',
  'Ravi Sharma,9876543210,ravi@example.com,Website development,2026-10-15,Website,Happy with delivery',
  'Priya Patel,+91 98765 43211,,Mobile app,2026-10-20,"App, Repeat",',
].join('\n');

function downloadSampleCsv() {
  const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'customers-sample.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function CustomerUploadModal({ onClose, onSuccess }: CustomerUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  // After the import: who can get a WhatsApp review request, and the send result.
  const [imported, setImported] = useState<{ imported: number; customerIds: string[]; withoutPhone: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse a chosen file. Column matching is delegated to the shared, tolerant
  // resolver the CRM importer uses (case-insensitive, trimmed, BOM-safe, alias
  // aware) so "Full Name" / "Phone Number" / "Email Address" headers — which
  // silently produced 0 rows here before — now map correctly.
  // Header-keyed rows (from CSV or Excel) → preview rows. Column matching is
  // the shared tolerant resolver the CRM importer uses (case-insensitive,
  // trimmed, BOM-safe, alias aware: "Full Name", "Mobile", "WhatsApp"…).
  const toPreview = (records: Record<string, unknown>[]) => {
    const mapped: ParsedRow[] = records
      .map((row) => {
        const get = makeColumnGetter(row);
        const rawPhone = get(...COLUMN_ALIASES.phone);
        // Shown and saved exactly as WhatsApp needs it (+91 added to 10-digit numbers).
        const normalized = rawPhone ? normalizePhoneE164(rawPhone) : null;
        const phone = normalized || rawPhone;
        return {
          name: get(...COLUMN_ALIASES.name),
          phone,
          email: get(...COLUMN_ALIASES.email),
          service: get(...COLUMN_ALIASES.service),
          serviceDate: get(...COLUMN_ALIASES.date),
          tags: (() => { const t = get(...COLUMN_ALIASES.tags); return t ? t.split(/[,;|]/).map(x => x.trim()).filter(Boolean) : []; })(),
          notes: get(...COLUMN_ALIASES.notes),
          phoneValid: !rawPhone || !!normalized,
        };
      })
      .filter(r => r.name && (r.phone || r.email));
    setParsedData(mapped);
    if (mapped.length === 0) {
      setError('No valid rows found. Make sure the file has a Name column and a Phone or Email column.');
    }
  };

  const parseFile = async (selected: File) => {
    setError('');
    setFile(selected);
    const ext = selected.name.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      // Excel is read on the server (bounded, content-checked reader).
      setLoading(true);
      try {
        const body = new FormData();
        body.append('file', selected);
        const res = await fetch('/api/campaigns/parse-file', { method: 'POST', body });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) throw new Error(json.message || 'Could not read the file.');
        toPreview(json.rows || []);
      } catch (e: any) {
        setFile(null);
        setError(e?.message || 'Could not read the file.');
      } finally {
        setLoading(false);
      }
      return;
    }
    Papa.parse(selected, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.replace(/^\uFEFF/, '').trim(),
      complete: (results) => toPreview(results.data as Record<string, unknown>[]),
      error: () => setError('Failed to parse CSV file.'),
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) parseFile(selected);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) parseFile(dropped);
  };

  const handleImport = async () => {
    if (parsedData.length === 0) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/campaigns/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // businessId and tenantId come from the session on the server side
        body: JSON.stringify({ customers: parsedData })
      });

      const json = await res.json();
      if (json.success) {
        setImported({ imported: json.imported ?? parsedData.length, customerIds: json.customerIds || [], withoutPhone: json.withoutPhone || 0 });
      } else {
        setError(json.error || 'Import failed');
      }
    } catch (e: any) {
      setError(friendlyClientMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const sendToAll = async () => {
    if (!imported?.customerIds.length) return;
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/campaigns/bulk-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerIds: imported.customerIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Could not start sending');
      setSendResult(json.message);
    } catch (e: any) {
      setError(friendlyClientMessage(e));
    } finally {
      setSending(false);
    }
  };

  const invalidCount = parsedData.filter(r => !r.phoneValid).length;
  const validCount = parsedData.length - invalidCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/50 backdrop-blur-sm p-4">
      <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

        <div className="flex justify-between items-center p-6 border-b border-outline-variant">
          <div>
            <h2 className="text-xl font-bold text-on-surface">Import Customers</h2>
            <p className="text-sm text-on-surface-variant">Upload an Excel (.xlsx) or CSV file to bulk import past customers.</p>
          </div>
          <button onClick={onClose} className="p-2 text-outline hover:text-on-surface-variant rounded-full hover:bg-surface transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {error && (
            <div className="mb-6 p-4 bg-error-container border border-error-container text-on-error-container rounded-xl flex items-center gap-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          {imported ? (
            <div className="py-6 text-center max-w-lg mx-auto space-y-4">
              <CheckCircle2 className="w-12 h-12 text-secondary mx-auto" />
              <h3 className="text-lg font-bold text-on-surface">{imported.imported} customer{imported.imported === 1 ? '' : 's'} imported</h3>
              {imported.withoutPhone > 0 && (
                <p className="text-sm text-on-surface-variant">{imported.withoutPhone} have no usable phone number, so they can&apos;t get a WhatsApp review request.</p>
              )}
              {sendResult ? (
                <p className="text-sm text-on-surface rounded-xl bg-secondary-container/40 border border-secondary-fixed px-4 py-3">{sendResult}</p>
              ) : imported.customerIds.length > 0 ? (
                <div className="rounded-xl border border-outline-variant p-4 text-left space-y-2">
                  <p className="text-sm font-bold text-on-surface">Ask all {imported.customerIds.length} for a Google review?</p>
                  <p className="text-xs text-on-surface-variant">
                    They go out automatically within your daily WhatsApp limit — a few each day, with reminders sent first — until everyone has been asked. Each customer gets at most one reminder, and anyone who replies STOP is never messaged again.
                  </p>
                </div>
              ) : null}
            </div>
          ) : !file ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center text-center transition-colors cursor-pointer ${dragActive ? 'border-primary bg-primary-fixed' : 'border-outline-variant hover:border-primary hover:bg-primary-fixed/50'}`}
            >
              <div className="w-16 h-16 bg-primary-fixed text-primary rounded-full flex items-center justify-center mb-4">
                <UploadCloud className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-on-surface mb-1">Click to upload Excel or CSV</h3>
              <p className="text-sm text-on-surface-variant max-w-sm">Required columns: Name, Phone (or Email). Optional: Service, Date, Tags, Notes.</p>
              <p className="text-xs text-outline mt-2">Phone numbers like 9876543210 or +91 98765 43210 are fine — we add +91 when it&apos;s missing.</p>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); downloadSampleCsv(); }}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              >
                <Download className="w-4 h-4" /> Download sample CSV
              </button>
              <input
                type="file"
                accept=".csv,.xlsx"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-on-surface flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-secondary" />
                  Found {parsedData.length} valid rows
                </h3>
                <button
                  onClick={() => { setFile(null); setParsedData([]); }}
                  className="text-sm font-medium text-on-surface-variant hover:text-on-surface underline"
                >
                  Upload different file
                </button>
              </div>

              {invalidCount > 0 && (
                <div className="mb-3 p-3 bg-primary-fixed border border-primary-fixed-dim text-primary rounded-xl flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    <strong>{validCount} rows ready</strong>, {invalidCount} row{invalidCount !== 1 ? 's' : ''} have a phone number we can&apos;t read — they&apos;ll be imported without a phone and can&apos;t get WhatsApp requests
                  </span>
                </div>
              )}

              <div className="border border-outline-variant rounded-xl overflow-hidden">
                <table className="w-full text-left text-sm text-on-surface-variant">
                  <thead className="bg-surface border-b border-outline-variant text-xs uppercase font-bold text-on-surface-variant">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Service</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {parsedData.slice(0, 10).map((row, i) => (
                      <tr key={i} className={row.phoneValid ? 'hover:bg-surface' : 'bg-error-container hover:bg-error-container'}>
                        <td className="px-4 py-3 font-medium text-on-surface">{row.name}</td>
                        <td className="px-4 py-3">
                          {row.phone ? (
                            <span className="flex items-center gap-1.5">
                              {!row.phoneValid && <AlertTriangle className="w-3.5 h-3.5 text-error shrink-0" />}
                              <span className={row.phoneValid ? '' : 'text-on-error-container'}>{row.phone}</span>
                            </span>
                          ) : (
                            <span className="text-outline">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">{row.email || <span className="text-outline">—</span>}</td>
                        <td className="px-4 py-3">{row.service || <span className="text-outline">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedData.length > 10 && (
                  <div className="p-3 text-center text-xs font-medium text-on-surface-variant bg-surface/50">
                    Showing 10 of {parsedData.length} rows
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-outline-variant flex justify-end gap-3 bg-surface/50">
          {imported ? (
            <>
              <button
                onClick={onSuccess}
                className="px-5 py-2.5 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high bg-surface-container rounded-xl transition-colors"
              >
                {sendResult ? 'Done' : 'Not now'}
              </button>
              {!sendResult && imported.customerIds.length > 0 && (
                <button
                  onClick={sendToAll}
                  disabled={sending}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-primary hover:bg-primary-container rounded-xl transition-all shadow-sm disabled:opacity-50"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send review requests to {imported.customerIds.length}
                </button>
              )}
            </>
          ) : (
          <>
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high bg-surface-container rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={loading || parsedData.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-primary hover:bg-primary-container rounded-xl transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            Import {parsedData.length} Customers
          </button>
          </>
          )}
        </div>

      </div>
    </div>
  );
}

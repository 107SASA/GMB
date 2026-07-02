'use client';

import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { UploadCloud, CheckCircle2, AlertCircle, Loader2, X, AlertTriangle } from 'lucide-react';

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

const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

function validatePhone(phone: string): boolean {
  if (!phone) return true; // empty phone is OK if email exists
  const normalized = phone.replace(/[\s\-()]/g, '');
  return PHONE_REGEX.test(normalized);
}

export default function CustomerUploadModal({ onClose, onSuccess }: CustomerUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      Papa.parse(selected, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const mapped: ParsedRow[] = (results.data as any[])
            .map((row) => {
              const phone = row['Phone'] || row['phone'] || '';
              return {
                name: row['Name'] || row['name'] || row['Customer Name'] || '',
                phone,
                email: row['Email'] || row['email'] || '',
                service: row['Service'] || row['service'] || row['Product'] || '',
                serviceDate: row['Date'] || row['date'] || row['Service Date'] || '',
                tags: row['Tags'] ? row['Tags'].split(',') : [],
                notes: row['Notes'] || row['notes'] || '',
                phoneValid: validatePhone(phone)
              };
            })
            .filter(r => r.name && (r.phone || r.email));

          setParsedData(mapped);
        },
        error: () => setError('Failed to parse CSV file.')
      });
    }
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
        onSuccess();
      } else {
        setError(json.error || 'Import failed');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const invalidCount = parsedData.filter(r => !r.phoneValid).length;
  const validCount = parsedData.length - invalidCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

        <div className="flex justify-between items-center p-6 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Import Customers</h2>
            <p className="text-sm text-slate-500">Upload a CSV to bulk import past customers.</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-50 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {error && (
            <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl flex items-center gap-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          {!file ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-2xl p-12 flex flex-col items-center justify-center text-center hover:border-indigo-400 hover:bg-indigo-50/50 transition-colors cursor-pointer"
            >
              <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-4">
                <UploadCloud className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Click to upload CSV</h3>
              <p className="text-sm text-slate-500 max-w-sm">Required columns: Name, Phone (or Email). Optional: Service, Date, Tags, Notes.</p>
              <p className="text-xs text-slate-400 mt-2">Phone must be in E.164 format (e.g. +919876543210)</p>
              <input
                type="file"
                accept=".csv"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  Found {parsedData.length} valid rows
                </h3>
                <button
                  onClick={() => { setFile(null); setParsedData([]); }}
                  className="text-sm font-medium text-slate-500 hover:text-slate-700 underline"
                >
                  Upload different file
                </button>
              </div>

              {invalidCount > 0 && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    <strong>{validCount} rows ready</strong>, {invalidCount} row{invalidCount !== 1 ? 's' : ''} have invalid phone numbers (will import without phone)
                  </span>
                </div>
              )}

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-sm text-slate-600">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Service</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedData.slice(0, 10).map((row, i) => (
                      <tr key={i} className={row.phoneValid ? 'hover:bg-slate-50' : 'bg-rose-50 hover:bg-rose-100'}>
                        <td className="px-4 py-3 font-medium text-slate-900">{row.name}</td>
                        <td className="px-4 py-3">
                          {row.phone ? (
                            <span className="flex items-center gap-1.5">
                              {!row.phoneValid && <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />}
                              <span className={row.phoneValid ? '' : 'text-rose-600'}>{row.phone}</span>
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">{row.email || <span className="text-slate-400">—</span>}</td>
                        <td className="px-4 py-3">{row.service || <span className="text-slate-400">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedData.length > 10 && (
                  <div className="p-3 text-center text-xs font-medium text-slate-500 bg-slate-50/50">
                    Showing 10 of {parsedData.length} rows
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/50">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={loading || parsedData.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            Import {parsedData.length} Customers
          </button>
        </div>

      </div>
    </div>
  );
}

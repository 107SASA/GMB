'use client';

import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { UploadCloud, CheckCircle2, AlertCircle, Loader2, X, AlertTriangle } from 'lucide-react';
import { makeColumnGetter, COLUMN_ALIASES } from '@/lib/csvColumns';

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
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse a chosen file. Column matching is delegated to the shared, tolerant
  // resolver the CRM importer uses (case-insensitive, trimmed, BOM-safe, alias
  // aware) so "Full Name" / "Phone Number" / "Email Address" headers — which
  // silently produced 0 rows here before — now map correctly.
  const parseFile = (selected: File) => {
    setError('');
    setFile(selected);
    Papa.parse(selected, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.replace(/^﻿/, '').trim(),
      complete: (results) => {
        const mapped: ParsedRow[] = (results.data as Record<string, unknown>[])
          .map((row) => {
            const get = makeColumnGetter(row);
            const phone = get(...COLUMN_ALIASES.phone);
            return {
              name: get(...COLUMN_ALIASES.name),
              phone,
              email: get(...COLUMN_ALIASES.email),
              service: get(...COLUMN_ALIASES.service),
              serviceDate: get(...COLUMN_ALIASES.date),
              tags: (() => { const t = get(...COLUMN_ALIASES.tags); return t ? t.split(/[,;|]/).map(s => s.trim()).filter(Boolean) : []; })(),
              notes: get(...COLUMN_ALIASES.notes),
              phoneValid: validatePhone(phone),
            };
          })
          .filter(r => r.name && (r.phone || r.email));

        setParsedData(mapped);
        if (mapped.length === 0) {
          setError('No valid rows found. Make sure the file has a Name column and a Phone or Email column.');
        }
      },
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/50 backdrop-blur-sm p-4">
      <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

        <div className="flex justify-between items-center p-6 border-b border-outline-variant">
          <div>
            <h2 className="text-xl font-bold text-on-surface">Import Customers</h2>
            <p className="text-sm text-on-surface-variant">Upload a CSV to bulk import past customers.</p>
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

          {!file ? (
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
              <h3 className="text-lg font-bold text-on-surface mb-1">Click to upload CSV</h3>
              <p className="text-sm text-on-surface-variant max-w-sm">Required columns: Name, Phone (or Email). Optional: Service, Date, Tags, Notes.</p>
              <p className="text-xs text-outline mt-2">Phone must be in E.164 format (e.g. +919876543210)</p>
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
                    <strong>{validCount} rows ready</strong>, {invalidCount} row{invalidCount !== 1 ? 's' : ''} have invalid phone numbers (will import without phone)
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
        </div>

      </div>
    </div>
  );
}

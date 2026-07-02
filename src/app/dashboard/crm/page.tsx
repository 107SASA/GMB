'use client';

import React, { useState, useEffect, useRef } from 'react';
import CRMStatsRow from '@/components/crm/CRMStatsRow';
import KanbanBoard from '@/components/crm/KanbanBoard';
import LeadListView from '@/components/crm/LeadListView';
import CRMFilterBar from '@/components/crm/CRMFilterBar';
import CRMAnalytics from '@/components/crm/CRMAnalytics';
import LeadDrawer from '@/components/crm/LeadDrawer';
import { LayoutList, Columns, Upload, X, FileUp, CheckCircle, AlertCircle, Download } from 'lucide-react';

type ViewMode = 'list' | 'kanban' | 'analytics';

const SOURCES = ['Google Business Profile', 'WhatsApp', 'Website', 'Manual', 'Instagram', 'Facebook', 'Referral'] as const;

// ─── Add Lead Modal ───────────────────────────────────────────────────────────

function AddLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (lead: any) => void }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'Manual', interest: '', notes: '', lifeCycleStage: 'initial' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstInputRef.current?.focus(); }, []);

  const set = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) { setError('Name and Phone are required.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/crm/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to create lead.'); return; }
      onCreated(data.lead);
      onClose();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Add New Lead</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Name <span className="text-red-500">*</span></label>
              <input
                ref={firstInputRef}
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="Jane Smith"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Phone <span className="text-red-500">*</span></label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                placeholder="+44 7700 000000"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder="jane@example.com"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Source <span className="text-red-500">*</span></label>
              <select
                value={form.source}
                onChange={e => set('source', e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Stage</label>
              <select
                value={form.lifeCycleStage}
                onChange={e => set('lifeCycleStage', e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                <option value="initial">Initial</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
                <option value="converted">Converted</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Interest / Course</label>
              <input
                type="text"
                value={form.interest}
                onChange={e => set('interest', e.target.value)}
                placeholder="e.g. AWS Certification, MBA Programme…"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Any context about this lead…"
                rows={3}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 font-semibold text-sm rounded-xl hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold text-sm rounded-xl transition-colors"
            >
              {submitting ? 'Creating…' : 'Create Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Import Leads Modal ───────────────────────────────────────────────────────

type ImportState = 'idle' | 'uploading' | 'done';

interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

function ImportLeadsModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ImportState>('idle');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setError('');
    setResult(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setError(''); setResult(null); }
  };

  const handleImport = async () => {
    if (!file) return;
    setState('uploading');
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/crm/leads/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Import failed.'); setState('idle'); return; }
      setResult(data);
      setState('done');
      if (data.created > 0) onImported();
    } catch {
      setError('Network error. Please try again.');
      setState('idle');
    }
  };

  const downloadTemplate = () => {
    const csv = 'name,phone,email,source,lifeCycleStage,interest,notes,tags\nJane Smith,+447700000000,jane@example.com,Manual,initial,AWS Certification,,tag1;tag2\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Import Leads</h2>
            <p className="text-xs text-slate-500 mt-0.5">Upload a CSV or Excel file — up to 1,000 rows</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Template download */}
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Download CSV template
          </button>

          {/* Columns hint */}
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 leading-relaxed">
            <span className="font-semibold text-slate-700">Supported columns:</span>{' '}
            name <span className="text-red-500">*</span>, phone, email, source, lifeCycleStage
            <span className="text-slate-400"> (initial / active / closed / converted)</span>,
            interest, notes, tags
            <span className="text-slate-400"> (semicolon-separated)</span>
          </div>

          {/* Drop zone */}
          {state !== 'done' && (
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-indigo-400 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors group"
            >
              <div className="w-12 h-12 bg-indigo-50 group-hover:bg-indigo-100 rounded-2xl flex items-center justify-center transition-colors">
                <FileUp className="w-6 h-6 text-indigo-500" />
              </div>
              {file ? (
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-800">{file.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-700">Drop file here or click to browse</p>
                  <p className="text-xs text-slate-400 mt-0.5">.csv, .xlsx, .xls accepted</p>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="hidden" />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Result */}
          {state === 'done' && result && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-center">
                  <p className="text-2xl font-black text-emerald-700">{result.created}</p>
                  <p className="text-xs text-emerald-600 font-semibold">Leads Created</p>
                </div>
                <div className="flex-1 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
                  <p className="text-2xl font-black text-amber-700">{result.skipped}</p>
                  <p className="text-xs text-amber-600 font-semibold">Skipped / Dupes</p>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-36 overflow-y-auto">
                  <p className="text-xs font-bold text-slate-600 mb-2">Row warnings:</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-slate-500 leading-relaxed">{e}</p>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 text-sm text-emerald-700 font-semibold">
                <CheckCircle className="w-4 h-4" />
                Import complete!
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 font-semibold text-sm rounded-xl hover:bg-slate-50 transition-colors"
          >
            {state === 'done' ? 'Close' : 'Cancel'}
          </button>
          {state !== 'done' && (
            <button
              onClick={handleImport}
              disabled={!file || state === 'uploading'}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-colors"
            >
              <Upload className="w-4 h-4" />
              {state === 'uploading' ? 'Importing…' : 'Import Leads'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-xl">
      {message}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function CRMDashboard() {
  const [leads, setLeads] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, converted: 0, conversionRate: 0, avgScore: 0 });
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // Default to list view (SSR-safe). On mobile, auto-switch back to list if user resizes down.
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => {
      if (!e.matches && viewMode === 'kanban') setViewMode('list');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [viewMode]);
  const [kanbanColumns, setKanbanColumns] = useState<string[]>([]);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [toast, setToast] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');

  const filteredLeads = React.useMemo(() => {
    return leads.filter(lead => {
      const matchesSearch = !searchQuery ||
        lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.phone?.includes(searchQuery);

      const matchesSource = sourceFilter === 'all' || lead.source === sourceFilter;
      const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
      const matchesStage = stageFilter === 'all' || (lead.lifeCycleStage || 'initial') === stageFilter;

      return matchesSearch && matchesSource && matchesStatus && matchesStage;
    });
  }, [leads, searchQuery, sourceFilter, statusFilter, stageFilter]);

  const fetchLeads = async () => {
    try {
      const res = await fetch(`/api/crm/leads`);
      const data = await res.json();
      if (data.success) {
        setLeads(data.leads);

        const total = data.leads.length;
        const converted = data.leads.filter((l: any) => l.lifeCycleStage === 'converted' || l.pipelineStage === 'Converted').length;
        const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

        const scoredLeads = data.leads.filter((l: any) => l.aiLeadScore);
        const avgScore = scoredLeads.length > 0
          ? Math.round(scoredLeads.reduce((acc: number, l: any) => acc + l.aiLeadScore, 0) / scoredLeads.length)
          : 0;

        setStats({ total, converted, conversionRate, avgScore });
      }
    } catch (e) {
      console.error('Failed to fetch leads', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchKanbanColumns = async () => {
    try {
      const res = await fetch('/api/business/kanban-columns');
      const data = await res.json();
      if (data.success) setKanbanColumns(data.kanbanColumns);
    } catch (e) {
      console.error('Failed to fetch kanban columns', e);
    }
  };

  const saveKanbanColumns = async (cols: string[]) => {
    try {
      await fetch('/api/business/kanban-columns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kanbanColumns: cols })
      });
    } catch (e) {
      console.error('Failed to save kanban columns', e);
    }
  };

  const handleSetKanbanColumns = (updater: string[] | ((prev: string[]) => string[])) => {
    setKanbanColumns(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveKanbanColumns(next);
      return next;
    });
  };

  useEffect(() => {
    fetchLeads();
    fetchKanbanColumns();
  }, []);

  const handleLeadCreated = (newLead: any) => {
    setLeads(prev => [newLead, ...prev]);
    setStats(prev => ({ ...prev, total: prev.total + 1 }));
    setToast(`Lead "${newLead.name}" created — AI scoring in progress…`);
  };

  const handleImportDone = () => {
    fetchLeads();
    setToast('Leads imported successfully!');
  };

  if (loading) return (
    <div className="p-8 text-center text-slate-500">Loading AI Lead Manager...</div>
  );

  return (
    <div className="min-h-screen bg-slate-50/50 p-4 pt-10">
      <div className="max-w-400 mx-auto relative">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">AI Lead Manager</h1>
            <p className="text-slate-500 mt-1">Intelligent CRM with automated follow-ups and LLaMA scoring.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View Toggle */}
            <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  viewMode === 'list' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <LayoutList className="w-4 h-4" />
                List
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  viewMode === 'kanban' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Columns className="w-4 h-4" />
                Kanban
              </button>
              <button
                onClick={() => setViewMode('analytics' as ViewMode)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  viewMode === ('analytics' as ViewMode) ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                Analytics
              </button>
            </div>

            {/* Import Leads */}
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 font-semibold text-sm rounded-xl shadow-sm transition-colors"
            >
              <Upload className="w-4 h-4" />
              Import
            </button>

            {/* Add Lead */}
            <button
              onClick={() => setShowAddLead(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-sm transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Lead
            </button>
          </div>
        </div>

        {/* Stats */}
        <CRMStatsRow stats={stats} />

        {/* Filters (Hidden in Analytics View) */}
        {viewMode !== 'analytics' && (
          <CRMFilterBar
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            sourceFilter={sourceFilter} setSourceFilter={setSourceFilter}
            statusFilter={statusFilter} setStatusFilter={setStatusFilter}
            stageFilter={stageFilter} setStageFilter={setStageFilter}
          />
        )}

        {/* View */}
        {viewMode === 'analytics' ? (
          <CRMAnalytics leads={leads} />
        ) : viewMode === 'list' ? (
          <LeadListView leads={filteredLeads} onLeadClick={setSelectedLead} />
        ) : (
          <KanbanBoard
            leads={filteredLeads}
            setLeads={setLeads}
            onLeadClick={setSelectedLead}
            columns={kanbanColumns}
            setColumns={handleSetKanbanColumns}
          />
        )}

        {/* Lead Drawer */}
        <LeadDrawer
          lead={selectedLead}
          isOpen={!!selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdate={fetchLeads}
        />

        {/* Add Lead Modal */}
        {showAddLead && (
          <AddLeadModal
            onClose={() => setShowAddLead(false)}
            onCreated={handleLeadCreated}
          />
        )}

        {/* Import Leads Modal */}
        {showImport && (
          <ImportLeadsModal
            onClose={() => setShowImport(false)}
            onImported={handleImportDone}
          />
        )}

        {/* Toast */}
        {toast && <Toast message={toast} onDone={() => setToast('')} />}
      </div>
    </div>
  );
}

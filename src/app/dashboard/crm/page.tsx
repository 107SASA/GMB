'use client';

import React, { useState, useEffect, useRef } from 'react';
import CRMStatsRow from '@/components/crm/CRMStatsRow';
import KanbanBoard from '@/components/crm/KanbanBoard';
import LeadListView from '@/components/crm/LeadListView';
import CRMFilterBar from '@/components/crm/CRMFilterBar';
import CRMAnalytics from '@/components/crm/CRMAnalytics';
import LeadDrawer from '@/components/crm/LeadDrawer';
import LeadStagesConfig from '@/components/crm/LeadStagesConfig';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';
import type { LeadStagesConfig as LeadStagesConfigType } from '@/lib/leadStages';
import { LayoutList, Columns, Layers, Upload, X, FileUp, CheckCircle, AlertCircle, Download } from 'lucide-react';
import { useBusiness } from '@/context/BusinessContext';

type ViewMode = 'list' | 'kanban' | 'analytics' | 'stages';

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
      <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-md border border-outline-variant">
        <div className="flex items-center justify-between p-6 border-b border-outline-variant">
          <h2 className="text-lg font-bold text-on-surface">Add New Lead</h2>
          <button onClick={onClose} className="p-2 hover:bg-surface-container rounded-full transition-colors">
            <X className="w-4 h-4 text-on-surface-variant" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-error bg-error-container border border-error-container rounded-lg px-4 py-2">{error}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Name <span className="text-error">*</span></label>
              <input
                ref={firstInputRef}
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="Jane Smith"
                className="w-full border border-outline-variant rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Phone <span className="text-error">*</span></label>
              <PhoneNumberInput
                value={form.phone}
                onChange={v => set('phone', v)}
                className="rounded-xl [&_input]:py-2.5 [&_select]:py-2.5"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder="jane@example.com"
                className="w-full border border-outline-variant rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Source <span className="text-error">*</span></label>
              <select
                value={form.source}
                onChange={e => set('source', e.target.value)}
                className="w-full border border-outline-variant rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-surface-container-lowest"
              >
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Stage</label>
              <select
                value={form.lifeCycleStage}
                onChange={e => set('lifeCycleStage', e.target.value)}
                className="w-full border border-outline-variant rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-surface-container-lowest"
              >
                <option value="initial">Initial</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
                <option value="converted">Converted</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Interest</label>
              <input
                type="text"
                value={form.interest}
                onChange={e => set('interest', e.target.value)}
                placeholder="What is this lead interested in?"
                className="w-full border border-outline-variant rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Any context about this lead…"
                rows={3}
                className="w-full border border-outline-variant rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-outline-variant text-on-surface font-semibold text-sm rounded-xl hover:bg-surface transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2.5 bg-primary hover:bg-primary-container disabled:opacity-60 text-white font-bold text-sm rounded-xl transition-colors"
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
      <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-lg border border-outline-variant">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-outline-variant">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Import Leads</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Upload a CSV or Excel file — up to 1,000 rows</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-container rounded-full transition-colors">
            <X className="w-4 h-4 text-on-surface-variant" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Template download */}
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-2 text-xs font-semibold text-primary hover:text-primary-container transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Download CSV template
          </button>

          {/* Columns hint */}
          <div className="text-xs text-on-surface-variant bg-surface border border-outline-variant rounded-xl px-4 py-3 leading-relaxed">
            <span className="font-semibold text-on-surface">Supported columns:</span>{' '}
            name <span className="text-error">*</span>, phone, email, source, lifeCycleStage
            <span className="text-outline"> (initial / active / closed / converted)</span>,
            interest, notes, tags
            <span className="text-outline"> (semicolon-separated)</span>
          </div>

          {/* Drop zone */}
          {state !== 'done' && (
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-outline-variant hover:border-primary-fixed-dim rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors group"
            >
              <div className="w-12 h-12 bg-primary-fixed group-hover:bg-primary-fixed rounded-2xl flex items-center justify-center transition-colors">
                <FileUp className="w-6 h-6 text-primary" />
              </div>
              {file ? (
                <div className="text-center">
                  <p className="text-sm font-semibold text-on-surface">{file.name}</p>
                  <p className="text-xs text-outline mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-sm font-semibold text-on-surface">Drop file here or click to browse</p>
                  <p className="text-xs text-outline mt-0.5">.csv, .xlsx, .xls accepted</p>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="hidden" />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 text-sm text-error bg-error-container border border-error-container rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Result */}
          {state === 'done' && result && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 bg-secondary-container/40 border border-secondary-fixed rounded-xl px-4 py-3 text-center">
                  <p className="text-2xl font-black text-on-secondary-container">{result.created}</p>
                  <p className="text-xs text-secondary font-semibold">Leads Created</p>
                </div>
                <div className="flex-1 bg-error-container border border-error-container rounded-xl px-4 py-3 text-center">
                  <p className="text-2xl font-black text-on-error-container">{result.skipped}</p>
                  <p className="text-xs text-error font-semibold">Skipped / Dupes</p>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="bg-surface border border-outline-variant rounded-xl p-3 max-h-36 overflow-y-auto">
                  <p className="text-xs font-bold text-on-surface-variant mb-2">Row warnings:</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-on-surface-variant leading-relaxed">{e}</p>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 text-sm text-on-secondary-container font-semibold">
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
            className="flex-1 px-4 py-2.5 border border-outline-variant text-on-surface font-semibold text-sm rounded-xl hover:bg-surface transition-colors"
          >
            {state === 'done' ? 'Close' : 'Cancel'}
          </button>
          {state !== 'done' && (
            <button
              onClick={handleImport}
              disabled={!file || state === 'uploading'}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-container disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-colors"
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
    <div className="fixed bottom-6 right-6 z-50 bg-primary text-white text-sm font-semibold px-5 py-3 rounded-2xl card-shadow">
      {message}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function CRMDashboard() {
  const { activeBusiness } = useBusiness();
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
  const [leadStages, setLeadStages] = useState<LeadStagesConfigType | null>(null);
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

  const fetchLeadStages = async () => {
    try {
      const res = await fetch('/api/business/lead-stages');
      const data = await res.json();
      if (data.success) setLeadStages(data.leadStages);
    } catch (e) {
      console.error('Failed to fetch lead stages', e);
    }
  };

  // /api/crm/leads and /api/business/lead-stages are both scoped to the
  // active business server-side, but this previously fetched once on mount
  // only — switching workspaces left the CRM showing the PREVIOUS
  // workspace's leads until a full reload.
  useEffect(() => {
    if (!activeBusiness?._id) return;
    fetchLeads();
    fetchLeadStages();
  }, [activeBusiness?._id]);

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
    <div className="p-8 text-center text-on-surface-variant">Loading AI Lead Manager...</div>
  );

  return (
    <div className="min-h-screen bg-surface/50 p-4 pt-10">
      <div className="max-w-400 mx-auto relative">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8">
          <div>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-on-surface tracking-tight">AI Lead Manager</h1>
            <p className="text-on-surface-variant mt-1">Intelligent CRM with automated follow-ups and LLaMA scoring.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View Toggle */}
            <div className="flex items-center bg-surface-container-lowest border border-outline-variant rounded-xl p-1 shadow-sm">
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                  viewMode === 'list' ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <LayoutList className="w-3.5 h-3.5" />
                List
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                  viewMode === 'kanban' ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Columns className="w-3.5 h-3.5" />
                Kanban
              </button>
              <button
                onClick={() => setViewMode('stages')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                  viewMode === 'stages' ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Lead Stages
              </button>
              <button
                onClick={() => setViewMode('analytics' as ViewMode)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                  viewMode === ('analytics' as ViewMode) ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                Analytics
              </button>
            </div>

            {/* Import Leads */}
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 py-2.5 bg-surface-container-lowest border border-outline-variant hover:border-primary-fixed-dim hover:bg-primary-fixed text-on-surface hover:text-primary font-semibold text-xs rounded-xl shadow-sm whitespace-nowrap transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              Import
            </button>

            {/* Add Lead */}
            <button
              onClick={() => setShowAddLead(true)}
              className="flex items-center gap-1.5 px-3.5 py-2.5 bg-primary hover:bg-primary-container text-white font-bold text-xs rounded-xl shadow-sm whitespace-nowrap transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Lead
            </button>
          </div>
        </div>

        {/* Stats */}
        <CRMStatsRow stats={stats} />

        {/* Filters (Hidden in Analytics & Stage-config Views) */}
        {viewMode !== 'analytics' && viewMode !== 'stages' && (
          <CRMFilterBar
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            sourceFilter={sourceFilter} setSourceFilter={setSourceFilter}
            statusFilter={statusFilter} setStatusFilter={setStatusFilter}
            stageFilter={stageFilter} setStageFilter={setStageFilter}
          />
        )}

        {/* View */}
        {viewMode === 'stages' ? (
          <LeadStagesConfig />
        ) : viewMode === 'analytics' ? (
          <CRMAnalytics leads={leads} />
        ) : viewMode === 'list' ? (
          <LeadListView leads={filteredLeads} onLeadClick={setSelectedLead} />
        ) : (
          <KanbanBoard
            leads={filteredLeads}
            setLeads={setLeads}
            onLeadClick={setSelectedLead}
            leadStages={leadStages}
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

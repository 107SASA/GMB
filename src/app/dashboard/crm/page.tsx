'use client';

import React, { useState, useEffect } from 'react';
import CRMStatsRow from '@/components/crm/CRMStatsRow';
import KanbanBoard from '@/components/crm/KanbanBoard';
import LeadListView from '@/components/crm/LeadListView';
import CRMFilterBar from '@/components/crm/CRMFilterBar';
import CRMAnalytics from '@/components/crm/CRMAnalytics';
import LeadDrawer from '@/components/crm/LeadDrawer';
import { LayoutList, Columns } from 'lucide-react';

type ViewMode = 'list' | 'kanban' | 'analytics';

export default function CRMDashboard() {
  const [leads, setLeads] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, converted: 0, conversionRate: 0, avgScore: 0 });
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [kanbanColumns, setKanbanColumns] = useState<string[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredLeads = React.useMemo(() => {
    return leads.filter(lead => {
      const matchesSearch = !searchQuery || 
        lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.phone?.includes(searchQuery);
      
      const matchesSource = sourceFilter === 'all' || lead.source === sourceFilter;
      const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
      
      return matchesSearch && matchesSource && matchesStatus;
    });
  }, [leads, searchQuery, sourceFilter, statusFilter]);

  const fetchLeads = async () => {
    try {
      const res = await fetch(`/api/crm/leads`);
      const data = await res.json();
      if (data.success) {
        setLeads(data.leads);

        const total = data.leads.length;
        const converted = data.leads.filter((l: any) => l.pipelineStage === 'Converted').length;
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
      if (data.success) {
        setKanbanColumns(data.kanbanColumns);
      }
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

  // Wrapper so every column change also saves to DB
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

  const handleCreateDummyLead = async () => {
    try {
      const newLead = {
        name: 'John Smith',
        phone: '+14155552671',
        source: 'WhatsApp',
      };
      const res = await fetch('/api/crm/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLead)
      });
      if (res.ok) fetchLeads();
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) return (
    <div className="p-8 text-center text-slate-500">Loading AI Lead Manager...</div>
  );

  return (
    <div className="min-h-screen bg-slate-50/50 p-4 pt-10">
      <div className="max-w-[1600px] mx-auto relative">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">AI Lead Manager</h1>
            <p className="text-slate-500 mt-1">Intelligent CRM with automated follow-ups and LLaMA scoring.</p>
          </div>

          <div className="flex items-center gap-3">
            {/* View Toggle */}
            <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  viewMode === 'list'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <LayoutList className="w-4 h-4" />
                List
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  viewMode === 'kanban'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Columns className="w-4 h-4" />
                Kanban
              </button>
              <button
                onClick={() => setViewMode('analytics' as ViewMode)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  viewMode === ('analytics' as ViewMode)
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                Analytics
              </button>
            </div>

            {/* Add Lead */}
            <button
              onClick={handleCreateDummyLead}
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
      </div>
    </div>
  );
}
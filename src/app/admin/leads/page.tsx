'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Users, UserCheck, Percent, X, Mail, Phone, Calendar, Columns } from 'lucide-react';
import KanbanBoard from '@/components/crm/KanbanBoard';

interface SalesLead {
  _id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string;
  aiLeadScore: null;
  subscriptionStatus: string;
  pipelineStage: string;
  createdAt: string;
}

/** Simple detail modal — a business's admin sales-lead card, click-to-expand. */
function LeadDetailModal({ lead, onClose }: { lead: SalesLead; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">{lead.name}</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <Mail className="w-4 h-4 text-slate-400" /> {lead.email ?? '—'}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <Phone className="w-4 h-4 text-slate-400" /> {lead.phone ?? '—'}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <Calendar className="w-4 h-4 text-slate-400" />
            First audit {new Date(lead.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <Columns className="w-4 h-4 text-slate-400" />
            Subscription: <span className="font-semibold capitalize">{lead.subscriptionStatus}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Inline column-name editor — mirrors KanbanBoard's own "Add Column" input, just for renaming. */
function ColumnsEditor({ columns, onSave }: { columns: string[]; onSave: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(columns);

  useEffect(() => { setDraft(columns); }, [columns]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2.5 bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 font-semibold text-xs rounded-xl shadow-sm transition-colors"
      >
        <Columns className="w-3.5 h-3.5" />
        Rename stages
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Rename pipeline stages</h2>
          <button onClick={() => setOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        <div className="p-6 space-y-3">
          {draft.map((col, i) => (
            <input
              key={i}
              value={col}
              onChange={(e) => setDraft((prev) => prev.map((c, j) => (j === i ? e.target.value : c)))}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          ))}
        </div>
        <div className="flex gap-3 p-6 pt-0">
          <button
            onClick={() => setOpen(false)}
            className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 font-semibold text-sm rounded-xl hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { onSave(draft.filter((c) => c.trim())); setOpen(false); }}
            className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminLeadsPage() {
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [stats, setStats] = useState({ total: 0, converted: 0, conversionRate: 0 });
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SalesLead | null>(null);

  const fetchLeads = async () => {
    try {
      const res = await fetch('/api/admin/sales-leads');
      const data = await res.json();
      if (data.success) {
        setLeads(data.leads);
        setStats(data.stats);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchColumns = async () => {
    const res = await fetch('/api/admin/sales-leads/columns');
    const data = await res.json();
    if (data.success) setColumns(data.columns);
  };

  useEffect(() => {
    fetchLeads();
    fetchColumns();
  }, []);

  const saveColumns = async (next: string[]) => {
    await fetch('/api/admin/sales-leads/columns', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns: next }),
    });
  };

  // KanbanBoard calls setColumns directly (Add/Delete Column buttons built
  // into the board itself) as well as our own ColumnsEditor modal — both
  // paths need to persist, so this wrapper is what actually gets passed down.
  const handleSetColumns: Dispatch<SetStateAction<string[]>> = (updater) => {
    setColumns((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: string[]) => string[])(prev) : updater;
      void saveColumns(next);
      return next;
    });
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading sales pipeline…</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Sales Leads</h1>
            <p className="text-sm text-slate-500">
              Every workspace that's tried the free audit, tracked through to paying customer.
            </p>
          </div>
        </div>
        <ColumnsEditor columns={columns} onSave={handleSetColumns} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Leads', value: stats.total, icon: Users, color: 'text-indigo-600 bg-indigo-50' },
          { label: 'Converted to Customer', value: stats.converted, icon: UserCheck, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Conversion Rate', value: `${stats.conversionRate}%`, icon: Percent, color: 'text-amber-600 bg-amber-50' },
        ].map((card) => (
          <div key={card.label} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-500">{card.label}</span>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${card.color}`}>
                <card.icon className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-900">{card.value}</p>
          </div>
        ))}
      </div>

      {leads.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center text-slate-400">
          No sales leads yet — they'll show up here the moment a signup completes its first free audit.
        </div>
      ) : (
        <KanbanBoard
          leads={leads}
          setLeads={setLeads as Dispatch<SetStateAction<any[]>>}
          onLeadClick={(lead) => setSelected(lead)}
          columns={columns}
          setColumns={handleSetColumns}
          updateEndpoint="/api/admin/sales-leads"
        />
      )}

      {selected && <LeadDetailModal lead={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

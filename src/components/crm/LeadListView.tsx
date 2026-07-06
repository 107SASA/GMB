import React from 'react';

interface LeadListViewProps {
  leads: any[];
  onLeadClick: (lead: any) => void;
}

const getScoreColor = (score: number) => {
  if (!score) return 'bg-slate-100 text-slate-500';
  if (score >= 80) return 'bg-emerald-100 text-emerald-700';
  if (score >= 50) return 'bg-amber-100 text-amber-700';
  return 'bg-rose-100 text-rose-700';
};

const getSourceBadge = (source: string) => {
  switch (source) {
    case 'WhatsApp': return 'bg-green-100 text-green-700';
    case 'Website': return 'bg-blue-100 text-blue-700';
    case 'Instagram': return 'bg-pink-100 text-pink-700';
    default: return 'bg-slate-100 text-slate-600';
  }
};

const STAGE_STYLES: Record<string, { bg: string; dot: string; label: string }> = {
  initial:   { bg: 'bg-slate-100 text-slate-600',    dot: 'bg-slate-400',   label: 'Initial' },
  active:    { bg: 'bg-blue-100 text-blue-700',      dot: 'bg-blue-500',    label: 'Active' },
  closed:    { bg: 'bg-rose-100 text-rose-700',      dot: 'bg-rose-500',    label: 'Closed' },
  converted: { bg: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', label: 'Converted' },
};

function StageBadge({ stage }: { stage?: string }) {
  const s = STAGE_STYLES[stage || 'initial'] ?? STAGE_STYLES.initial;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${s.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
      {s.label}
    </span>
  );
}

export default function LeadListView({ leads, onLeadClick }: LeadListViewProps) {
  if (leads.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-16 text-center">
        <div className="w-16 h-16 bg-slate-100 rounded-2xl mx-auto flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <p className="text-slate-500 font-medium">No leads yet</p>
        <p className="text-slate-400 text-sm mt-1">Add a dummy lead to get started</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Mobile: card layout (below md) */}
      <div className="md:hidden divide-y divide-slate-100">
        {leads.map((lead) => (
          <div
            key={lead._id}
            onClick={() => onLeadClick(lead)}
            className="p-4 hover:bg-indigo-50/30 cursor-pointer transition-colors active:bg-indigo-50"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 font-black text-sm flex items-center justify-center shrink-0">
                  {lead.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 text-sm truncate">{lead.name}</p>
                  <p className="text-xs text-slate-500 truncate">{lead.phone || lead.email || '—'}</p>
                </div>
              </div>
              <span className={`text-xs font-black px-2 py-0.5 rounded-full shrink-0 ${getScoreColor(lead.aiLeadScore)}`}>
                {lead.aiLeadScore || 'N/A'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2 ml-12">
              <StageBadge stage={lead.lifeCycleStage} />
              {lead.subStage && (
                <span className="text-xs font-semibold px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full border border-violet-100">{lead.subStage}</span>
              )}
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${getSourceBadge(lead.source)}`}>
                {lead.source || 'Manual'}
              </span>
              <span className="text-xs text-slate-400">
                {new Date(lead.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: 12-column grid table (md and above) */}
      <div className="hidden md:block">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
          <div className="col-span-3">Lead</div>
          <div className="col-span-2">Phone / Email</div>
          <div className="col-span-2">Source</div>
          <div className="col-span-2">Stage</div>
          <div className="col-span-1">Pipeline</div>
          <div className="col-span-1 text-center">AI Score</div>
          <div className="col-span-1 text-right">Added</div>
        </div>

        {/* Table Rows */}
        <div className="divide-y divide-slate-100">
          {leads.map((lead) => (
            <div
              key={lead._id}
              onClick={() => onLeadClick(lead)}
              className="grid grid-cols-12 gap-4 px-6 py-4 hover:bg-indigo-50/30 cursor-pointer transition-colors group items-center"
            >
              {/* Name + Avatar */}
              <div className="col-span-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 font-black text-sm flex items-center justify-center shrink-0">
                  {lead.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <span className="font-semibold text-slate-900 text-sm group-hover:text-indigo-600 transition-colors truncate">
                  {lead.name}
                </span>
              </div>

              {/* Phone / Email */}
              <div className="col-span-2 text-sm text-slate-500 truncate">
                {lead.phone || lead.email || '—'}
              </div>

              {/* Source */}
              <div className="col-span-2">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${getSourceBadge(lead.source)}`}>
                  {lead.source || 'Manual'}
                </span>
              </div>

              {/* Life Cycle Stage */}
              <div className="col-span-2 flex flex-wrap items-center gap-1">
                <StageBadge stage={lead.lifeCycleStage} />
                {lead.subStage && (
                  <span className="text-xs font-semibold px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full border border-violet-100 truncate max-w-full">{lead.subStage}</span>
                )}
              </div>

              {/* Pipeline Stage */}
              <div className="col-span-1">
                {lead.pipelineStage ? (
                  <span className="text-xs font-semibold px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 truncate block max-w-20">
                    {lead.pipelineStage}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400 italic">—</span>
                )}
              </div>

              {/* AI Score */}
              <div className="col-span-1 flex justify-center">
                <span className={`text-xs font-black px-2 py-0.5 rounded-full ${getScoreColor(lead.aiLeadScore)}`}>
                  {lead.aiLeadScore || 'N/A'}
                </span>
              </div>

              {/* Date */}
              <div className="col-span-1 text-xs text-slate-400 text-right">
                {new Date(lead.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

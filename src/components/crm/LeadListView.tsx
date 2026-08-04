import React from 'react';

interface LeadListViewProps {
  leads: any[];
  onLeadClick: (lead: any) => void;
}

const getScoreColor = (score: number) => {
  if (!score) return 'bg-surface-container text-on-surface-variant';
  if (score >= 80) return 'bg-secondary-container text-on-secondary-container';
  if (score >= 50) return 'bg-error-container text-on-error-container';
  return 'bg-error-container text-on-error-container';
};

const getSourceBadge = (source: string) => {
  switch (source) {
    case 'WhatsApp': return 'bg-secondary-container text-on-secondary-container';
    case 'Website': return 'bg-primary-fixed text-primary';
    case 'Instagram': return 'bg-primary-fixed text-primary';
    default: return 'bg-surface-container text-on-surface-variant';
  }
};

const STAGE_STYLES: Record<string, { bg: string; dot: string; label: string }> = {
  initial:   { bg: 'bg-surface-container text-on-surface-variant',    dot: 'bg-outline',   label: 'Initial' },
  active:    { bg: 'bg-primary-fixed text-primary',      dot: 'bg-primary',    label: 'Active' },
  closed:    { bg: 'bg-error-container text-on-error-container',      dot: 'bg-error',    label: 'Closed' },
  converted: { bg: 'bg-secondary-container text-on-secondary-container', dot: 'bg-secondary', label: 'Converted' },
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
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-16 text-center">
        <div className="w-16 h-16 bg-surface-container rounded-2xl mx-auto flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-outline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <p className="text-on-surface-variant font-medium">No leads yet</p>
        <p className="text-outline text-sm mt-1">Add a dummy lead to get started</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
      {/* Mobile: card layout (below md) */}
      <div className="md:hidden divide-y divide-outline-variant">
        {leads.map((lead) => (
          <div
            key={lead._id}
            onClick={() => onLeadClick(lead)}
            className="p-4 hover:bg-primary-fixed/30 cursor-pointer transition-colors active:bg-primary-fixed"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-primary-fixed text-primary font-black text-sm flex items-center justify-center shrink-0">
                  {lead.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-on-surface text-sm truncate">{lead.name}</p>
                  <p className="text-xs text-on-surface-variant truncate">{lead.phone || lead.email || '—'}</p>
                </div>
              </div>
              <span className={`text-xs font-black px-2 py-0.5 rounded-full shrink-0 ${getScoreColor(lead.aiLeadScore)}`}>
                {lead.aiLeadScore || 'N/A'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2 ml-12">
              <StageBadge stage={lead.lifeCycleStage} />
              {lead.subStage && (
                <span className="text-xs font-semibold px-2 py-0.5 bg-primary-fixed text-primary rounded-full border border-primary-fixed-dim">{lead.subStage}</span>
              )}
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${getSourceBadge(lead.source)}`}>
                {lead.source || 'Manual'}
              </span>
              <span className="text-xs text-outline">
                {new Date(lead.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: 12-column grid table (md and above) */}
      <div className="hidden md:block">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-surface border-b border-outline-variant text-xs font-bold text-on-surface-variant uppercase tracking-wider">
          <div className="col-span-3">Lead</div>
          <div className="col-span-2">Phone / Email</div>
          <div className="col-span-2">Source</div>
          <div className="col-span-2">Stage</div>
          <div className="col-span-1">Pipeline</div>
          <div className="col-span-1 text-center">AI Score</div>
          <div className="col-span-1 text-right">Added</div>
        </div>

        {/* Table Rows */}
        <div className="divide-y divide-outline-variant">
          {leads.map((lead) => (
            <div
              key={lead._id}
              onClick={() => onLeadClick(lead)}
              className="grid grid-cols-12 gap-4 px-6 py-4 hover:bg-primary-fixed/30 cursor-pointer transition-colors group items-center"
            >
              {/* Name + Avatar */}
              <div className="col-span-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary-fixed text-primary font-black text-sm flex items-center justify-center shrink-0">
                  {lead.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <span className="font-semibold text-on-surface text-sm group-hover:text-primary transition-colors truncate">
                  {lead.name}
                </span>
              </div>

              {/* Phone / Email */}
              <div className="col-span-2 text-sm text-on-surface-variant truncate">
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
                  <span className="text-xs font-semibold px-2 py-0.5 bg-primary-fixed text-primary rounded-full border border-primary-fixed-dim truncate max-w-full">{lead.subStage}</span>
                )}
              </div>

              {/* Pipeline Stage */}
              <div className="col-span-1">
                {lead.pipelineStage ? (
                  <span className="text-xs font-semibold px-2 py-1 rounded-full bg-primary-fixed text-primary border border-primary-fixed-dim truncate block max-w-20">
                    {lead.pipelineStage}
                  </span>
                ) : (
                  <span className="text-xs text-outline italic">—</span>
                )}
              </div>

              {/* AI Score */}
              <div className="col-span-1 flex justify-center">
                <span className={`text-xs font-black px-2 py-0.5 rounded-full ${getScoreColor(lead.aiLeadScore)}`}>
                  {lead.aiLeadScore || 'N/A'}
                </span>
              </div>

              {/* Date */}
              <div className="col-span-1 text-xs text-outline text-right">
                {new Date(lead.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

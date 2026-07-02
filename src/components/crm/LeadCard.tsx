import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface LeadCardProps {
  lead: any;
  onClick: (lead: any) => void;
}

export default function LeadCard({ lead, onClick }: LeadCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead._id, data: lead });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 1,
    opacity: isDragging ? 0.4 : 1,
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'WhatsApp': return <div className="w-5 h-5 bg-green-100 text-green-600 rounded flex items-center justify-center text-[10px] font-black">WA</div>;
      case 'Website': return <div className="w-5 h-5 bg-blue-100 text-blue-600 rounded flex items-center justify-center text-[10px] font-black">WB</div>;
      case 'Instagram': return <div className="w-5 h-5 bg-pink-100 text-pink-600 rounded flex items-center justify-center text-[10px] font-black">IG</div>;
      default: return <div className="w-5 h-5 bg-slate-100 text-slate-600 rounded flex items-center justify-center text-[10px] font-black">MN</div>;
    }
  };

  const getScoreColor = (score: number) => {
    if (!score) return 'bg-slate-100 text-slate-600';
    if (score >= 80) return 'bg-emerald-100 text-emerald-700';
    if (score >= 50) return 'bg-amber-100 text-amber-700';
    return 'bg-rose-100 text-rose-700';
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(lead)}
      className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing group relative mb-3"
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <h4 className="font-bold text-slate-900 text-sm group-hover:text-indigo-600 transition-colors">{lead.name}</h4>
          <p className="text-xs text-slate-500 mt-0.5">{lead.phone || lead.email || 'No contact info'}</p>
        </div>
        <div className="flex-shrink-0">
          {getSourceIcon(lead.source)}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
        <div className={`text-[10px] font-black px-2 py-0.5 rounded-full ${getScoreColor(lead.aiLeadScore)}`}>
          SCORE: {lead.aiLeadScore || 'N/A'}
        </div>
        <div className="text-[10px] font-medium text-slate-400">
          {new Date(lead.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </div>
      </div>
    </div>
  );
}

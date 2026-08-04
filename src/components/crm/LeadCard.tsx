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
      case 'WhatsApp': return <div className="w-5 h-5 bg-secondary-container text-secondary rounded flex items-center justify-center text-[10px] font-black">WA</div>;
      case 'Website': return <div className="w-5 h-5 bg-primary-fixed text-primary rounded flex items-center justify-center text-[10px] font-black">WB</div>;
      case 'Instagram': return <div className="w-5 h-5 bg-primary-fixed text-primary rounded flex items-center justify-center text-[10px] font-black">IG</div>;
      default: return <div className="w-5 h-5 bg-surface-container text-on-surface-variant rounded flex items-center justify-center text-[10px] font-black">MN</div>;
    }
  };

  const getScoreColor = (score: number) => {
    if (!score) return 'bg-surface-container text-on-surface-variant';
    if (score >= 80) return 'bg-secondary-container text-on-secondary-container';
    if (score >= 50) return 'bg-error-container text-on-error-container';
    return 'bg-error-container text-on-error-container';
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(lead)}
      className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant shadow-sm hover:card-shadow transition-shadow cursor-grab active:cursor-grabbing group relative mb-3"
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <h4 className="font-bold text-on-surface text-sm group-hover:text-primary transition-colors">{lead.name}</h4>
          <p className="text-xs text-on-surface-variant mt-0.5">{lead.phone || lead.email || 'No contact info'}</p>
        </div>
        <div className="flex-shrink-0">
          {getSourceIcon(lead.source)}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-outline-variant">
        <div className={`text-[10px] font-black px-2 py-0.5 rounded-full ${getScoreColor(lead.aiLeadScore)}`}>
          SCORE: {lead.aiLeadScore || 'N/A'}
        </div>
        <div className="text-[10px] font-medium text-outline">
          {new Date(lead.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </div>
      </div>
    </div>
  );
}

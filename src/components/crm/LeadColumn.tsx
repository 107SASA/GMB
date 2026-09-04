import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import LeadCard from './LeadCard';

interface LeadColumnProps {
  id: string;
  title: string;
  leads: any[];
  onLeadClick: (lead: any) => void;
  /** Tailwind bg class for the header status dot (sub-stage colour). */
  dotClass?: string;
  isSystem?: boolean;
}

export default function LeadColumn({ id, title, leads, onLeadClick, dotClass, isSystem }: LeadColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex flex-col bg-surface rounded-2xl w-[280px] flex-shrink-0 border border-outline-variant/60 h-full max-h-full overflow-hidden">
      {/* Column Header */}
      <div className="p-4 border-b border-outline-variant/60 bg-surface/50 backdrop-blur-sm sticky top-0 z-10 flex justify-between items-center gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {(isSystem || dotClass) && (
            <div className={`w-2 h-2 rounded-full shrink-0 ${dotClass ?? 'bg-outline'}`} />
          )}
          <h3 className="font-bold text-sm text-on-surface uppercase tracking-wider truncate">{title}</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="bg-surface-container-lowest text-on-surface-variant text-xs font-bold px-2 py-1 rounded-full shadow-sm">
            {leads.length}
          </span>
        </div>
      </div>

      {/* Drop Zone */}
      <div
        ref={setNodeRef}
        className={`flex-1 p-3 overflow-y-auto transition-colors ${isOver ? 'bg-primary-fixed/60' : ''}`}
      >
        <SortableContext items={leads.map(l => l._id)} strategy={verticalListSortingStrategy}>
          {leads.map(lead => (
            <LeadCard key={lead._id} lead={lead} onClick={onLeadClick} />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <div className="h-full min-h-[100px] flex items-center justify-center border-2 border-dashed border-outline-variant rounded-xl m-1">
            <span className="text-xs text-outline font-medium">Drop here</span>
          </div>
        )}
      </div>
    </div>
  );
}
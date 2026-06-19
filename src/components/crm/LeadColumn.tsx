import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import LeadCard from './LeadCard';

interface LeadColumnProps {
  id: string;
  title: string;
  leads: any[];
  onLeadClick: (lead: any) => void;
  onDelete?: () => void;
  isSystem?: boolean;
}

export default function LeadColumn({ id, title, leads, onLeadClick, onDelete, isSystem }: LeadColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex flex-col bg-slate-50 rounded-2xl w-[280px] flex-shrink-0 border border-slate-200/60 h-full max-h-full overflow-hidden">
      {/* Column Header */}
      <div className="p-4 border-b border-slate-200/60 bg-slate-50/50 backdrop-blur-sm sticky top-0 z-10 flex justify-between items-center gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isSystem && (
            <div className="w-2 h-2 rounded-full bg-slate-400 flex-shrink-0" />
          )}
          <h3 className="font-bold text-sm text-slate-700 uppercase tracking-wider truncate">{title}</h3>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="bg-white text-slate-500 text-xs font-bold px-2 py-1 rounded-full shadow-sm">
            {leads.length}
          </span>
          {!isSystem && onDelete && (
            <button
              onClick={onDelete}
              title="Delete column"
              className="w-6 h-6 flex items-center justify-center rounded-full text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Drop Zone */}
      <div
        ref={setNodeRef}
        className={`flex-1 p-3 overflow-y-auto transition-colors ${isOver ? 'bg-indigo-50/60' : ''}`}
      >
        <SortableContext items={leads.map(l => l._id)} strategy={verticalListSortingStrategy}>
          {leads.map(lead => (
            <LeadCard key={lead._id} lead={lead} onClick={onLeadClick} />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <div className="h-full min-h-[100px] flex items-center justify-center border-2 border-dashed border-slate-200 rounded-xl m-1">
            <span className="text-xs text-slate-400 font-medium">Drop here</span>
          </div>
        )}
      </div>
    </div>
  );
}
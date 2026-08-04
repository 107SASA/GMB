'use client';

import React, { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import LeadColumn from './LeadColumn';
import LeadCard from './LeadCard';

interface KanbanBoardProps {
  leads: any[];
  setLeads: React.Dispatch<React.SetStateAction<any[]>>;
  onLeadClick: (lead: any) => void;
  columns: string[];
  setColumns: React.Dispatch<React.SetStateAction<string[]>>;
  /** Base path for per-lead PATCH calls (`${updateEndpoint}/${leadId}`) — lets
   * the admin sales-pipeline board reuse this component against its own API
   * instead of the business-owner CRM's `/api/crm/leads`. */
  updateEndpoint?: string;
}

export default function KanbanBoard({
  leads,
  setLeads,
  onLeadClick,
  columns,
  setColumns,
  updateEndpoint = '/api/crm/leads',
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newColumnName, setNewColumnName] = useState('');
  const [showInput, setShowInput] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleAddColumn = () => {
    const trimmed = newColumnName.trim();
    if (!trimmed) return;
    if (columns.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
      alert('A column with this name already exists.');
      return;
    }
    setColumns(prev => [...prev, trimmed]);
    setNewColumnName('');
    setShowInput(false);
  };

  const handleDeleteColumn = async (colName: string) => {
    const leadsInColumn = leads.filter(lead => lead.pipelineStage === colName);
    await Promise.all(
      leadsInColumn.map(lead =>
        fetch(`${updateEndpoint}/${lead._id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pipelineStage: null })
        })
      )
    );
    setLeads(prev =>
      prev.map(lead =>
        lead.pipelineStage === colName ? { ...lead, pipelineStage: null } : lead
      )
    );
    setColumns(prev => prev.filter(c => c !== colName));
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  // Helper — given any droppable/sortable id, find which column it belongs to
  const getColumnForId = (id: string): string | null => {
    // It's a column id directly
    if (id === 'unassigned') return null;
    if (columns.includes(id)) return id;
    // It's a lead id — find which column that lead is in
    const lead = leads.find(l => l._id === id);
    if (lead) return lead.pipelineStage ?? null;
    return null;
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const targetColumn = getColumnForId(over.id as string);
    const activeLeadId = active.id as string;
    setLeads(prev => {
      const idx = prev.findIndex(l => l._id === activeLeadId);
      if (idx === -1) return prev;
      const newLeads = [...prev];
      newLeads[idx] = { ...newLeads[idx], pipelineStage: targetColumn };
      return newLeads;
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeLeadId = active.id as string;
    const targetColumn = getColumnForId(over.id as string);
    const activeLead = leads.find(l => l._id === activeLeadId);
    if (!activeLead) return;

    // Save to DB
    try {
      await fetch(`${updateEndpoint}/${activeLeadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineStage: targetColumn })
      });
    } catch (err) {
      console.error('Failed to update lead stage:', err);
    }
  };

  const activeLead = activeId ? leads.find(l => l._id === activeId) : null;
  const unassignedLeads = leads.filter(l => !l.pipelineStage || !columns.includes(l.pipelineStage));

  return (
    <div className="h-[calc(100vh-300px)] min-h-[500px] flex flex-col">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex h-full gap-5 overflow-x-auto pb-4 hide-scrollbar items-start pt-1">

          <LeadColumn
            id="unassigned"
            title="Unassigned"
            leads={unassignedLeads}
            onLeadClick={onLeadClick}
            isSystem
          />

          {columns.map(col => (
            <LeadColumn
              key={col}
              id={col}
              title={col}
              leads={leads.filter(l => l.pipelineStage === col)}
              onLeadClick={onLeadClick}
              onDelete={() => handleDeleteColumn(col)}
            />
          ))}

          <div className="flex-shrink-0 w-[280px]">
            {showInput ? (
              <div className="bg-surface-container-lowest border-2 border-primary-fixed-dim rounded-2xl p-4 shadow-sm">
                <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-3">New Column Name</p>
                <input
                  autoFocus
                  type="text"
                  value={newColumnName}
                  onChange={e => setNewColumnName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAddColumn();
                    if (e.key === 'Escape') { setShowInput(false); setNewColumnName(''); }
                  }}
                  placeholder="e.g. Hot Leads, Demo Done..."
                  className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-xl text-sm font-medium text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary mb-3"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleAddColumn}
                    className="flex-1 py-2 bg-primary hover:bg-primary-container text-white text-sm font-bold rounded-lg transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setShowInput(false); setNewColumnName(''); }}
                    className="flex-1 py-2 bg-surface-container hover:bg-surface-container-high text-on-surface-variant text-sm font-bold rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowInput(true)}
                className="w-full h-16 flex items-center justify-center gap-2 border-2 border-dashed border-outline-variant hover:border-primary-fixed-dim hover:bg-primary-fixed/50 rounded-2xl text-outline hover:text-primary font-bold text-sm transition-all group"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Column
              </button>
            )}
          </div>

        </div>

        <DragOverlay>
          {activeLead ? <LeadCard lead={activeLead} onClick={() => {}} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
'use client';

import React, { useMemo, useState } from 'react';
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
  DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import LeadColumn from './LeadColumn';
import LeadCard from './LeadCard';
import {
  DEFAULT_LEAD_STAGES,
  type LeadStagesConfig,
  type SubStageGroup,
} from '@/lib/leadStages';

interface KanbanBoardProps {
  leads: any[];
  setLeads: React.Dispatch<React.SetStateAction<any[]>>;
  onLeadClick: (lead: any) => void;
  /** The business's configured lead stages — drives the fixed columns.
   *  Sub-stages are edited in the "Lead Stages" tab, never from the board. */
  leadStages: LeadStagesConfig | null;
  /** Base path for per-lead PATCH calls (`${updateEndpoint}/${leadId}`). */
  updateEndpoint?: string;
}

type LifeCycle = 'initial' | SubStageGroup;

interface BoardColumn {
  /** Stable droppable id, e.g. `initial`, `active:__`, `active:Interested`. */
  key: string;
  title: string;
  lifeCycleStage: LifeCycle;
  subStage: string | null;
  /** SUB_STAGE_COLORS token, for the header dot. */
  colorToken?: string;
}

const GROUP_META: Record<SubStageGroup, { label: string; headerClass: string }> = {
  active: { label: 'Active', headerClass: 'bg-primary-fixed text-primary' },
  converted: { label: 'Converted', headerClass: 'bg-secondary-container/50 text-on-secondary-container' },
  closed: { label: 'Closed', headerClass: 'bg-error-container text-on-error-container' },
};

const DOT_CLASS: Record<string, string> = {
  slate: 'bg-outline', stone: 'bg-outline', rose: 'bg-error', orange: 'bg-error',
  amber: 'bg-error', lime: 'bg-secondary', emerald: 'bg-secondary', teal: 'bg-secondary',
  sky: 'bg-primary', indigo: 'bg-primary', violet: 'bg-primary', pink: 'bg-primary',
};

export default function KanbanBoard({
  leads,
  setLeads,
  onLeadClick,
  leadStages,
  updateEndpoint = '/api/crm/leads',
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const config = leadStages ?? DEFAULT_LEAD_STAGES;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ── Column key helpers ────────────────────────────────────────────────────
  const colKeyForLead = (lead: any): string => {
    const lc: string = lead.lifeCycleStage || 'initial';
    if (lc === 'initial' || !(lc in GROUP_META)) return lc === 'initial' ? 'initial' : `${lc}:__`;
    const subs = config[lc as SubStageGroup] ?? [];
    if (lead.subStage && subs.some((s) => s.name === lead.subStage)) return `${lc}:${lead.subStage}`;
    return `${lc}:__`;
  };

  // ── Group blocks (category → sub-category columns) ─────────────────────────
  const groups = useMemo(() => {
    const initialGroup = {
      id: 'initial' as const,
      label: config.initialLabel,
      headerClass: 'bg-surface-container-high text-on-surface',
      columns: [
        { key: 'initial', title: config.initialLabel, lifeCycleStage: 'initial', subStage: null } as BoardColumn,
      ],
    };

    const subGroups = (['active', 'converted', 'closed'] as SubStageGroup[]).map((g) => {
      const subs = config[g] ?? [];
      const catchAllHasLeads = leads.some((l) => (l.lifeCycleStage || 'initial') === g &&
        !(l.subStage && subs.some((s) => s.name === l.subStage)));
      const columns: BoardColumn[] = [];
      // Show the "unsorted" catch-all only when it's needed (leads with no /
      // stale sub-stage) or when the group has no sub-stages configured.
      if (catchAllHasLeads || subs.length === 0) {
        columns.push({ key: `${g}:__`, title: `${GROUP_META[g].label} · unsorted`, lifeCycleStage: g, subStage: null });
      }
      subs.forEach((s) =>
        columns.push({ key: `${g}:${s.name}`, title: s.name, lifeCycleStage: g, subStage: s.name, colorToken: s.color })
      );
      return { id: g, label: GROUP_META[g].label, headerClass: GROUP_META[g].headerClass, columns };
    });

    return [initialGroup, ...subGroups];
  }, [config, leads]);

  const allColumns = useMemo(() => groups.flatMap((g) => g.columns), [groups]);
  const columnByKey = useMemo(() => new Map(allColumns.map((c) => [c.key, c])), [allColumns]);

  // ── DnD ──────────────────────────────────────────────────────────────────
  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as string);

  const targetColumnFor = (overId: string): BoardColumn | null => {
    if (columnByKey.has(overId)) return columnByKey.get(overId)!;
    const lead = leads.find((l) => l._id === overId);
    if (lead) return columnByKey.get(colKeyForLead(lead)) ?? null;
    return null;
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const col = targetColumnFor(over.id as string);
    if (!col) return;
    const activeLeadId = active.id as string;
    setLeads((prev) => {
      const idx = prev.findIndex((l) => l._id === activeLeadId);
      if (idx === -1) return prev;
      const cur = prev[idx];
      if (cur.lifeCycleStage === col.lifeCycleStage && (cur.subStage ?? null) === col.subStage) return prev;
      const next = [...prev];
      next[idx] = { ...cur, lifeCycleStage: col.lifeCycleStage, subStage: col.subStage };
      return next;
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const col = targetColumnFor(over.id as string);
    const activeLeadId = active.id as string;
    if (!col || !leads.some((l) => l._id === activeLeadId)) return;

    try {
      await fetch(`${updateEndpoint}/${activeLeadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lifeCycleStage: col.lifeCycleStage, subStage: col.subStage }),
      });
    } catch (err) {
      console.error('Failed to update lead stage:', err);
    }
  };

  const activeLead = activeId ? leads.find((l) => l._id === activeId) : null;

  return (
    <div className="h-[calc(100vh-300px)] min-h-[500px] flex flex-col">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex h-full gap-6 overflow-x-auto pb-4 hide-scrollbar items-start pt-1">
          {groups.map((group) => (
            <div key={group.id} className="flex flex-col h-full shrink-0">
              <div className={`mb-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider text-center ${group.headerClass}`}>
                {group.label}
              </div>
              <div className="flex gap-3 h-full min-h-0">
                {group.columns.map((col) => (
                  <LeadColumn
                    key={col.key}
                    id={col.key}
                    title={col.title}
                    dotClass={col.colorToken ? DOT_CLASS[col.colorToken] ?? 'bg-outline' : undefined}
                    isSystem={col.key === 'initial'}
                    leads={leads.filter((l) => colKeyForLead(l) === col.key)}
                    onLeadClick={onLeadClick}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <DragOverlay>{activeLead ? <LeadCard lead={activeLead} onClick={() => {}} /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CRM_STAGES, CRM_STAGE_GROUPS } from '@/lib/admin/platformCrm';
import { PARTNER_STAGES } from '@/lib/partners/partnerCrmRules';
import { PartnerStageSelect } from './PartnerStageSelect';

export interface PartnerBoardRow {
  _id: string;
  name: string;
  business: string | null;
  phone: string | null;
  currentStage: string;
  dealValue: number | null;
}

const GROUP_TONE: Record<string, string> = {
  open: 'bg-surface-container text-on-surface-variant',
  demo: 'bg-primary-fixed text-primary',
  closing: 'bg-warning/15 text-warning-text',
  won: 'bg-secondary-container/50 text-on-secondary-container',
  inactive: 'bg-surface-container text-outline',
  lost: 'bg-error-container/60 text-on-error-container',
};

const PARTNER_SETTABLE = new Set(PARTNER_STAGES.map((s) => s.value as string));
const SHOWN = new Set([...PARTNER_SETTABLE, 'CUSTOMER']);

/**
 * The partner's pipeline: one column per stage. Drag a card (or use its
 * picker) to move a lead. "Customer" fills itself when a payment lands —
 * nothing can be dropped there, and customer cards don't move.
 */
export function PartnerBoard({ rows, onStage, busyId }: { rows: PartnerBoardRow[]; onStage: (id: string, stage: string) => void; busyId: string | null }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const [dragId, setDragId] = useState<string | null>(null);
  const dragging = rows.find((r) => r._id === dragId) ?? null;

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const target = e.over?.id ? String(e.over.id) : null;
    const lead = rows.find((r) => r._id === String(e.active.id));
    if (!target || !lead || lead.currentStage === target || !PARTNER_SETTABLE.has(target)) return;
    onStage(lead._id, target);
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
      <div className="flex gap-4 overflow-x-auto pb-3">
        {CRM_STAGE_GROUPS.map((g) => {
          const stages = CRM_STAGES.filter((s) => s.group === g.key && (SHOWN.has(s.value) || rows.some((r) => r.currentStage === s.value)));
          if (!stages.length) return null;
          return (
            <div key={g.key} className="shrink-0">
              <div className={`mb-2 px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider text-center ${GROUP_TONE[g.key]}`}>{g.label}</div>
              <div className="flex gap-2">
                {stages.map((s) => (
                  <Column
                    key={s.value}
                    stage={s.value}
                    label={s.label}
                    droppable={PARTNER_SETTABLE.has(s.value)}
                    rows={rows.filter((r) => (r.currentStage || 'NEW') === s.value)}
                    onStage={onStage}
                    busyId={busyId}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <DragOverlay>{dragging ? <Card row={dragging} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ stage, label, droppable, rows, onStage, busyId }: { stage: string; label: string; droppable: boolean; rows: PartnerBoardRow[]; onStage: (id: string, stage: string) => void; busyId: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, disabled: !droppable });
  return (
    <div ref={setNodeRef} className={`w-[230px] shrink-0 rounded-xl border bg-surface-container-low transition-colors ${isOver ? 'border-primary bg-primary-fixed/40' : 'border-outline-variant'}`}>
      <div className="px-3 py-2 border-b border-outline-variant flex items-center justify-between">
        <span className="text-xs font-semibold text-on-surface">{label}</span>
        <span className="text-xs text-outline">{rows.length}</span>
      </div>
      <div className="p-2 space-y-2 max-h-[62vh] min-h-[80px] overflow-y-auto">
        {rows.length === 0 && (
          <p className="text-[11px] text-outline text-center py-3">{droppable ? 'Drop a lead here' : 'Fills when a payment is received'}</p>
        )}
        {rows.map((r) => <DraggableCard key={r._id} row={r} onStage={onStage} busy={busyId === r._id} />)}
      </div>
    </div>
  );
}

function DraggableCard({ row, onStage, busy }: { row: PartnerBoardRow; onStage: (id: string, stage: string) => void; busy: boolean }) {
  const locked = row.currentStage === 'CUSTOMER' || row.currentStage === 'PAYMENT_VERIFIED' || busy;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row._id, disabled: locked });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={`${isDragging ? 'opacity-40' : ''} ${locked ? '' : 'cursor-grab active:cursor-grabbing'}`}>
      <Card row={row} onStage={onStage} busy={busy} />
    </div>
  );
}

function Card({ row, onStage, busy, overlay }: { row: PartnerBoardRow; onStage?: (id: string, stage: string) => void; busy?: boolean; overlay?: boolean }) {
  return (
    <div className={`bg-surface-container-lowest rounded-lg border border-outline-variant p-2.5 space-y-1.5 ${overlay ? 'shadow-lg rotate-1 w-[214px]' : ''}`}>
      <Link href={`/partner/leads/${row._id}`} onPointerDown={(e) => e.stopPropagation()} className="block font-medium text-sm text-on-surface hover:text-primary truncate">
        {row.name}
      </Link>
      <p className="text-xs text-outline truncate">{[row.business && row.business !== row.name ? row.business : null, row.phone].filter(Boolean).join(' · ')}</p>
      {row.dealValue ? <p className="text-[11px] text-on-surface-variant">₹{row.dealValue.toLocaleString('en-IN')}</p> : null}
      {onStage && !overlay && (
        <div onPointerDown={(e) => e.stopPropagation()}>
          <PartnerStageSelect value={row.currentStage || 'NEW'} disabled={busy} onChange={(s) => onStage(row._id, s)} className="w-full" />
        </div>
      )}
    </div>
  );
}

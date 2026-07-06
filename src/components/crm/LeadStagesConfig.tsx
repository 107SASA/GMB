'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pencil, Trash2, Plus, Check, X, Layers } from 'lucide-react';
import {
  LeadStagesConfig as StagesConfig,
  LeadSubStage,
  SubStageGroup,
  DEFAULT_LEAD_STAGES,
  MAX_SUB_STAGES,
  MAX_NAME_LENGTH,
  SUB_STAGE_COLORS,
} from '@/lib/leadStages';

// ─── Color tokens → tailwind classes ─────────────────────────────────────────

const COLOR_CLASSES: Record<string, { row: string; swatch: string }> = {
  slate:   { row: 'bg-slate-200/70',   swatch: 'bg-slate-300' },
  stone:   { row: 'bg-stone-200/80',   swatch: 'bg-stone-300' },
  rose:    { row: 'bg-rose-100',       swatch: 'bg-rose-300' },
  orange:  { row: 'bg-orange-100',     swatch: 'bg-orange-300' },
  amber:   { row: 'bg-amber-100',      swatch: 'bg-amber-300' },
  lime:    { row: 'bg-lime-100',       swatch: 'bg-lime-300' },
  emerald: { row: 'bg-emerald-100',    swatch: 'bg-emerald-300' },
  teal:    { row: 'bg-teal-100',       swatch: 'bg-teal-300' },
  sky:     { row: 'bg-sky-100',        swatch: 'bg-sky-300' },
  indigo:  { row: 'bg-indigo-100',     swatch: 'bg-indigo-300' },
  violet:  { row: 'bg-violet-100',     swatch: 'bg-violet-300' },
  pink:    { row: 'bg-pink-100',       swatch: 'bg-pink-300' },
};

const rowColor = (token: string) => (COLOR_CLASSES[token] ?? COLOR_CLASSES.slate).row;

// ─── Inline sub-stage editor (shared by "add" and "edit") ────────────────────

function SubStageEditor({
  initialName,
  initialColor,
  onSave,
  onCancel,
  validateName,
}: {
  initialName: string;
  initialColor: string;
  onSave: (name: string, color: string) => void;
  onCancel: () => void;
  validateName: (name: string) => string | null;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSave = () => {
    const trimmed = name.trim();
    const err = validateName(trimmed);
    if (err) { setError(err); return; }
    onSave(trimmed, color);
  };

  return (
    <div className="bg-white border-2 border-indigo-300 rounded-xl p-3 shadow-sm space-y-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={e => { setName(e.target.value); setError(''); }}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="Sub-stage name…"
          className="flex-1 min-w-0 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button onClick={handleSave} title="Save" className="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
          <Check className="w-3.5 h-3.5" />
        </button>
        <button onClick={onCancel} title="Cancel" className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SUB_STAGE_COLORS.map(token => (
          <button
            key={token}
            onClick={() => setColor(token)}
            title={token}
            className={`w-5 h-5 rounded-full ${COLOR_CLASSES[token].swatch} transition-transform ${
              color === token ? 'ring-2 ring-offset-1 ring-indigo-500 scale-110' : 'hover:scale-110'
            }`}
          />
        ))}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ─── Sortable sub-stage row ──────────────────────────────────────────────────

function SortableSubStageRow({
  id,
  sub,
  onEdit,
  onDelete,
}: {
  id: string;
  sub: LeadSubStage;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl ${rowColor(sub.color)} ${isDragging ? 'opacity-60 shadow-lg z-10 relative' : ''}`}
    >
      <button
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-700 touch-none"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="flex-1 text-sm font-medium text-slate-800 truncate">{sub.name}</span>
      <button onClick={onEdit} title="Edit" className="p-1 text-slate-500 hover:text-slate-800 transition-colors">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button onClick={onDelete} title="Delete" className="p-1 text-slate-500 hover:text-red-600 transition-colors">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── One main-stage panel with editable sub-stages ───────────────────────────

const PANEL_THEME: Record<SubStageGroup, { header: string; border: string; accent: string }> = {
  active:    { header: 'bg-sky-50 text-sky-800',         border: 'border-sky-200',     accent: 'text-sky-700' },
  converted: { header: 'bg-emerald-50 text-emerald-800', border: 'border-emerald-300', accent: 'text-emerald-700' },
  closed:    { header: 'bg-rose-50 text-rose-800',       border: 'border-rose-300',    accent: 'text-rose-700' },
};

const PANEL_TITLES: Record<SubStageGroup, { title: string; hint: string }> = {
  active:    { title: 'Active stage',    hint: 'Leads you are working on' },
  converted: { title: 'Converted stage', hint: 'Won — deal closed' },
  closed:    { title: 'Closed stage',    hint: 'Lost — reasons for closing' },
};

function StagePanel({
  group,
  subStages,
  onChange,
}: {
  group: SubStageGroup;
  subStages: LeadSubStage[];
  onChange: (next: LeadSubStage[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const theme = PANEL_THEME[group];
  const { title, hint } = PANEL_TITLES[group];

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const validateName = (excludeIndex: number | null) => (name: string): string | null => {
    if (!name) return 'Name is required.';
    const clash = subStages.some((s, i) => i !== excludeIndex && s.name.toLowerCase() === name.toLowerCase());
    return clash ? 'A sub-stage with this name already exists.' : null;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = subStages.findIndex(s => s.name === active.id);
    const to = subStages.findIndex(s => s.name === over.id);
    if (from === -1 || to === -1) return;
    onChange(arrayMove(subStages, from, to));
  };

  const handleDelete = (index: number) => {
    const sub = subStages[index];
    if (!window.confirm(`Delete sub-stage "${sub.name}"? Leads tagged with it will keep working — they just lose this sub-tag.`)) return;
    onChange(subStages.filter((_, i) => i !== index));
    setEditingIndex(null);
  };

  const nextColor = SUB_STAGE_COLORS[subStages.length % SUB_STAGE_COLORS.length];

  return (
    <div className={`bg-white border-2 ${theme.border} rounded-2xl shadow-sm flex flex-col overflow-hidden`}>
      <div className={`px-4 py-3 ${theme.header} flex items-center justify-between`}>
        <div>
          <h3 className="text-sm font-bold">{title}</h3>
          <p className="text-[11px] opacity-70">{hint}</p>
        </div>
        <span className={`text-xs font-bold ${theme.accent}`}>
          {subStages.length}<span className="opacity-50">/{MAX_SUB_STAGES}</span>
        </span>
      </div>

      <div className="p-3 space-y-2 flex-1">
        {adding ? (
          <SubStageEditor
            initialName=""
            initialColor={nextColor}
            validateName={validateName(null)}
            onCancel={() => setAdding(false)}
            onSave={(name, color) => {
              onChange([...subStages, { name, color }]);
              setAdding(false);
            }}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            disabled={subStages.length >= MAX_SUB_STAGES}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 rounded-xl text-slate-500 hover:text-indigo-600 text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            Add sub-stage
          </button>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={subStages.map(s => s.name)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {subStages.map((sub, index) =>
                editingIndex === index ? (
                  <SubStageEditor
                    key={`edit-${sub.name}`}
                    initialName={sub.name}
                    initialColor={sub.color}
                    validateName={validateName(index)}
                    onCancel={() => setEditingIndex(null)}
                    onSave={(name, color) => {
                      const next = [...subStages];
                      next[index] = { name, color };
                      onChange(next);
                      setEditingIndex(null);
                    }}
                  />
                ) : (
                  <SortableSubStageRow
                    key={sub.name}
                    id={sub.name}
                    sub={sub}
                    onEdit={() => { setAdding(false); setEditingIndex(index); }}
                    onDelete={() => handleDelete(index)}
                  />
                )
              )}
            </div>
          </SortableContext>
        </DndContext>

        {subStages.length === 0 && !adding && (
          <p className="text-xs text-slate-400 text-center py-4">No sub-stages yet — add one above.</p>
        )}
      </div>
    </div>
  );
}

// ─── Initial stage panel (fixed default, rename only) ────────────────────────

function InitialStagePanel({
  label,
  onRename,
}: {
  label: string;
  onRename: (label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed) onRename(trimmed);
    setEditing(false);
  };

  return (
    <div className="bg-white border-2 border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 text-slate-700 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold">Initial stage</h3>
          <p className="text-[11px] opacity-70">Where every new lead starts</p>
        </div>
      </div>
      <div className="p-3">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              type="text"
              value={draft}
              maxLength={MAX_NAME_LENGTH}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') { setDraft(label); setEditing(false); }
              }}
              className="flex-1 min-w-0 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button onClick={save} title="Save" className="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => { setDraft(label); setEditing(false); }} title="Cancel" className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-200/70">
            <span className="flex-1 text-sm font-medium text-slate-800 truncate">{label}</span>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full italic">Default</span>
            <button onClick={() => { setDraft(label); setEditing(true); }} title="Rename" className="p-1 text-slate-500 hover:text-slate-800 transition-colors">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <p className="text-xs text-slate-400 mt-3 leading-relaxed">
          This stage is fixed — new leads land here automatically. Sub-stages are not available for the initial stage.
        </p>
      </div>
    </div>
  );
}

// ─── Main config screen ──────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function LeadStagesConfig() {
  const [config, setConfig] = useState<StagesConfig | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/business/lead-stages');
        const data = await res.json();
        setConfig(data.success ? data.leadStages : DEFAULT_LEAD_STAGES);
      } catch {
        setConfig(DEFAULT_LEAD_STAGES);
      }
    })();
    return () => { if (savedTimer.current) clearTimeout(savedTimer.current); };
  }, []);

  const persist = async (next: StagesConfig) => {
    setConfig(next);
    setSaveState('saving');
    if (savedTimer.current) clearTimeout(savedTimer.current);
    try {
      const res = await fetch('/api/business/lead-stages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadStages: next }),
      });
      setSaveState(res.ok ? 'saved' : 'error');
    } catch {
      setSaveState('error');
    }
    savedTimer.current = setTimeout(() => setSaveState('idle'), 2500);
  };

  if (!config) {
    return <div className="p-12 text-center text-slate-500">Loading lead stages…</div>;
  }

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
            <Layers className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Lead stages</h2>
            <p className="text-xs text-slate-500">
              Configure your sales pipeline — add sub-tags inside the Active, Converted and Closed stages.
            </p>
          </div>
        </div>
        <span
          className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-opacity ${
            saveState === 'saving' ? 'bg-amber-50 text-amber-700'
            : saveState === 'saved' ? 'bg-emerald-50 text-emerald-700'
            : saveState === 'error' ? 'bg-red-50 text-red-700'
            : 'opacity-0'
          }`}
        >
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : saveState === 'error' ? 'Save failed — retry your last change' : ''}
        </span>
      </div>

      {/* 4 main stage panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 items-start">
        <InitialStagePanel
          label={config.initialLabel}
          onRename={label => persist({ ...config, initialLabel: label })}
        />
        <StagePanel
          group="active"
          subStages={config.active}
          onChange={next => persist({ ...config, active: next })}
        />
        <StagePanel
          group="converted"
          subStages={config.converted}
          onChange={next => persist({ ...config, converted: next })}
        />
        <StagePanel
          group="closed"
          subStages={config.closed}
          onChange={next => persist({ ...config, closed: next })}
        />
      </div>
    </div>
  );
}

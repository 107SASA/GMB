'use client';

import { useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronLeft,
  ChevronRight,
  X,
  Pencil,
  Check,
  Trash2,
  LayoutGrid,
  CalendarDays,
} from 'lucide-react';

// ─── Props ────────────────────────────────────────────────────────────────────
interface WeeklyCalendarProps {
  posts: any[];
  onPublish: (id: string) => void;
  onReschedule: (postId: string, newDate: Date) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toLocalDateStr(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/** Build a grid of Date objects for the given month (fills incomplete first/last rows). */
function generateMonthGrid(year: number, month: number): Date[][] {
  const startWeekday = new Date(year, month, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Date[] = [];

  // Pad start with days from previous month
  for (let i = 0; i < startWeekday; i++) {
    cells.push(new Date(year, month, 1 - (startWeekday - i)));
  }
  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }
  // Pad end to complete the last row
  let next = 1;
  while (cells.length % 7 !== 0) cells.push(new Date(year, month + 1, next++));

  const grid: Date[][] = [];
  for (let i = 0; i < cells.length; i += 7) grid.push(cells.slice(i, i + 7));
  return grid;
}

// ─── Chip colours ─────────────────────────────────────────────────────────────
const CHIP_COLORS: Record<string, string> = {
  published: 'bg-emerald-100 text-emerald-800 border-l-[3px] border-l-emerald-500',
  scheduled: 'bg-blue-100 text-blue-800 border-l-[3px] border-l-blue-500',
  draft:     'bg-amber-100 text-amber-800 border-l-[3px] border-l-amber-400',
  failed:    'bg-rose-100 text-rose-800 border-l-[3px] border-l-rose-500',
};

const STATUS_BADGE: Record<string, string> = {
  published: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-blue-100 text-blue-700',
  draft:     'bg-amber-100 text-amber-700',
  failed:    'bg-rose-100 text-rose-700',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Draggable chip (used in both month cells and week columns) ───────────────
function DraggableChip({
  post,
  onClick,
}: {
  post: any;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: post._id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? CSS.Translate.toString(transform) : undefined,
        opacity: isDragging ? 0.3 : 1,
        touchAction: 'none',
      }}
      className={`text-xs px-2 py-0.5 rounded mb-0.5 truncate font-medium cursor-pointer select-none hover:brightness-95 active:brightness-90 ${CHIP_COLORS[post.status] ?? CHIP_COLORS.draft}`}
      onClick={e => { e.stopPropagation(); onClick(); }}
      {...attributes}
      {...listeners}
    >
      {post.title || 'Untitled'}
    </div>
  );
}

// ─── Droppable month day cell ─────────────────────────────────────────────────
function DroppableMonthCell({
  date,
  isCurrentMonth,
  children,
}: {
  date: Date;
  isCurrentMonth: boolean;
  children: ReactNode;
}) {
  const dateStr = toLocalDateStr(date);
  const { setNodeRef, isOver } = useDroppable({ id: dateStr });
  const isToday = dateStr === toLocalDateStr(new Date());

  return (
    <div
      ref={setNodeRef}
      className={`min-h-24 p-1.5 border-r border-b border-slate-100 transition-colors duration-100 last:border-r-0
        ${isOver ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : isCurrentMonth ? 'bg-white' : 'bg-slate-50/70'}
      `}
    >
      <div
        className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-semibold mb-1
          ${isToday ? 'bg-blue-600 text-white' : isCurrentMonth ? 'text-slate-900' : 'text-slate-400'}
        `}
      >
        {date.getDate()}
      </div>
      {children}
    </div>
  );
}

// ─── Droppable week column ────────────────────────────────────────────────────
function DroppableWeekColumn({
  date,
  children,
}: {
  date: Date;
  children: ReactNode;
}) {
  const dateStr = toLocalDateStr(date);
  const { setNodeRef, isOver } = useDroppable({ id: dateStr });

  return (
    <div
      ref={setNodeRef}
      className={`p-2 border-r border-slate-100 last:border-r-0 min-h-48 flex flex-col gap-1 transition-colors duration-100
        ${isOver ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : 'bg-white'}
      `}
    >
      {children}
      {isOver && (
        <div className="mt-1 border-2 border-dashed border-blue-300 rounded-lg h-10 flex items-center justify-center text-xs text-blue-500 font-medium">
          Drop to schedule
        </div>
      )}
    </div>
  );
}

// ─── Post detail modal ────────────────────────────────────────────────────────
function PostDetailModal({
  post,
  onClose,
  onPublish,
  onReschedule,
  onEditSave,
  onDelete,
}: {
  post: any;
  onClose: () => void;
  onPublish: (id: string) => void;
  onReschedule: (postId: string, newDate: Date) => Promise<void>;
  onEditSave: (postId: string, updates: Partial<any>) => void;
  onDelete: (postId: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'reschedule'>('view');
  const [editTitle, setEditTitle] = useState(post.title ?? '');
  const [editContent, setEditContent] = useState(post.content ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Default reschedule date: today (or existing scheduledDate)
  const defaultDate = post.scheduledDate
    ? toLocalDateStr(new Date(post.scheduledDate))
    : toLocalDateStr(new Date());
  const [rescheduleDate, setRescheduleDate] = useState(defaultDate);
  const [rescheduling, setRescheduling] = useState(false);

  const badge = STATUS_BADGE[post.status] ?? STATUS_BADGE.draft;

  const scheduledLabel = post.scheduledDate
    ? new Date(post.scheduledDate).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const saveEdit = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/scheduler/posts/${post._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle, content: editContent }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Save failed');
      }
      onEditSave(post._id, { title: editTitle, content: editContent });
      setMode('view');
    } catch (err: any) {
      alert(err.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(post._id);
      onClose();
    } catch (err: any) {
      alert(err.message ?? 'Failed to delete');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const doReschedule = async () => {
    setRescheduling(true);
    try {
      const d = new Date(`${rescheduleDate}T09:00:00`);
      if (d.getTime() <= Date.now()) d.setTime(Date.now() + 2 * 60 * 1000);
      await onReschedule(post._id, d);
      onClose();
    } catch (err: any) {
      alert(err.message ?? 'Reschedule failed');
    } finally {
      setRescheduling(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${badge}`}>
              {post.status}
            </span>
            {post.aiGenerated && (
              <span className="text-xs bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full font-bold">
                AI Generated
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {mode === 'view' && (
            <>
              <div>
                <h2 className="text-xl font-bold text-slate-900 leading-snug">
                  {post.title || 'Untitled Post'}
                </h2>
                {scheduledLabel && (
                  <p className="text-sm text-blue-600 font-medium mt-1">{scheduledLabel}</p>
                )}
              </div>
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                {post.content}
              </p>
              {(post.hashtags?.length ?? 0) > 0 && (
                <p className="text-sm text-indigo-600 font-medium">
                  {post.hashtags.map((h: string) => `#${h}`).join(' ')}
                </p>
              )}
              {post.cta && (
                <div className="bg-slate-50 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">CTA</p>
                  <p className="text-sm text-slate-700">{post.cta}</p>
                </div>
              )}
            </>
          )}

          {mode === 'edit' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Title
                </label>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="Post title"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Content
                </label>
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={6}
                  className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                  placeholder="Post content…"
                />
              </div>
            </div>
          )}

          {mode === 'reschedule' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  New Date
                </label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={e => setRescheduleDate(e.target.value)}
                  min={toLocalDateStr(new Date())}
                  className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <p className="text-xs text-slate-500">
                Post will be scheduled for 9:00 AM on the selected date.
              </p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-slate-100 flex gap-2 justify-end">
          {mode === 'view' && (
            <>
              {post.status !== 'published' && (
                confirmDelete ? (
                  <>
                    <span className="text-sm text-rose-600 font-medium self-center mr-auto">Delete this post?</span>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="px-4 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={doDelete}
                      disabled={deleting}
                      className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      {deleting ? 'Deleting…' : 'Yes, Delete'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors mr-auto"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                )
              )}
              <button
                onClick={() => { setEditTitle(post.title ?? ''); setEditContent(post.content ?? ''); setMode('edit'); }}
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                <Pencil className="w-4 h-4" />
                Edit
              </button>
              {post.status !== 'published' && (
                <button
                  onClick={() => setMode('reschedule')}
                  className="px-4 py-2.5 text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
                >
                  Reschedule
                </button>
              )}
              {post.status === 'scheduled' && (
                <button
                  onClick={() => { onPublish(post._id); onClose(); }}
                  className="px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors"
                >
                  Publish Now
                </button>
              )}
            </>
          )}

          {mode === 'edit' && (
            <>
              <button
                onClick={() => setMode('view')}
                className="px-4 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </>
          )}

          {mode === 'reschedule' && (
            <>
              <button
                onClick={() => setMode('view')}
                className="px-4 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doReschedule}
                disabled={rescheduling}
                className="px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-50"
              >
                {rescheduling ? 'Rescheduling…' : 'Confirm Reschedule'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main calendar ────────────────────────────────────────────────────────────
export default function WeeklyCalendar({ posts, onPublish, onReschedule }: WeeklyCalendarProps) {
  const today = new Date();

  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  // displayDate drives the month view; always the 1st of the displayed month
  const [displayDate, setDisplayDate] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [localPosts, setLocalPosts] = useState<any[]>(posts);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<any>(null);

  useEffect(() => { setLocalPosts(posts); }, [posts]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  // ── Derived data ────────────────────────────────────────────────────────────
  const monthGrid = generateMonthGrid(displayDate.getFullYear(), displayDate.getMonth());

  // Current week: Sun → Sat
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const getPostsForDate = (date: Date) =>
    localPosts.filter(p => {
      if (!p.scheduledDate || p.status === 'draft') return false;
      return toLocalDateStr(new Date(p.scheduledDate)) === toLocalDateStr(date);
    });

  const drafts = localPosts.filter(p => p.status === 'draft');
  const activeDragPost = activeDragId ? localPosts.find(p => p._id === activeDragId) : null;

  // ── Drag handlers ───────────────────────────────────────────────────────────
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over) return;

      const postId = active.id as string;
      const targetDateStr = over.id as string;

      const currentPost = localPosts.find(p => p._id === postId);
      if (
        currentPost?.scheduledDate &&
        toLocalDateStr(new Date(currentPost.scheduledDate)) === targetDateStr
      ) return;

      const targetDate = new Date(`${targetDateStr}T09:00:00`);
      if (targetDate.getTime() <= Date.now()) targetDate.setTime(Date.now() + 2 * 60 * 1000);

      const snapshot = localPosts.slice();
      setLocalPosts(prev =>
        prev.map(p =>
          p._id === postId
            ? { ...p, status: 'scheduled', scheduledDate: targetDate.toISOString() }
            : p
        )
      );

      try {
        await onReschedule(postId, targetDate);
      } catch (err: any) {
        setLocalPosts(snapshot);
        console.error('[Calendar] Reschedule rolled back:', err.message);
      }
    },
    [localPosts, onReschedule]
  );

  const handleEditSave = useCallback((postId: string, updates: Partial<any>) => {
    setLocalPosts(prev => prev.map(p => (p._id === postId ? { ...p, ...updates } : p)));
    setSelectedPost((prev: any) => (prev?._id === postId ? { ...prev, ...updates } : prev));
  }, []);

  const handleDelete = useCallback(async (postId: string) => {
    const res = await fetch(`/api/scheduler/posts/${postId}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? 'Delete failed');
    }
    setLocalPosts(prev => prev.filter(p => p._id !== postId));
  }, []);

  const monthLabel = displayDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <DndContext
      sensors={sensors}
      onDragStart={e => setActiveDragId(e.active.id as string)}
      onDragEnd={handleDragEnd}
    >
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">

        {/* ── Toolbar ───────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            {viewMode === 'month' && (
              <>
                <button
                  onClick={() => setDisplayDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-base font-bold text-slate-900 w-44 text-center">
                  {monthLabel}
                </span>
                <button
                  onClick={() => setDisplayDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}
            {viewMode === 'week' && (
              <span className="text-base font-bold text-slate-900">
                Week of{' '}
                {weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )}
          </div>

          {/* View toggle */}
          <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm font-semibold">
            <button
              onClick={() => setViewMode('month')}
              className={`flex items-center gap-1.5 px-3.5 py-2 transition-colors ${
                viewMode === 'month'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              Month
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`flex items-center gap-1.5 px-3.5 py-2 border-l border-slate-200 transition-colors ${
                viewMode === 'week'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <CalendarDays className="w-4 h-4" />
              Week
            </button>
          </div>
        </div>

        {/* ── Month view ─────────────────────────────────────────────────────── */}
        {viewMode === 'month' && (
          <>
            {/* Day-of-week header */}
            <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
              {WEEKDAYS.map(d => (
                <div
                  key={d}
                  className="py-2.5 text-center text-xs font-bold text-slate-500 uppercase tracking-wider border-r border-slate-100 last:border-r-0"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Rows */}
            {monthGrid.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7">
                {week.map((day, di) => {
                  const isCurrentMonth = day.getMonth() === displayDate.getMonth();
                  const dayPosts = getPostsForDate(day);
                  const visible = dayPosts.slice(0, 3);
                  const overflow = dayPosts.length - visible.length;
                  return (
                    <DroppableMonthCell key={di} date={day} isCurrentMonth={isCurrentMonth}>
                      {visible.map(post => (
                        <DraggableChip key={post._id} post={post} onClick={() => setSelectedPost(post)} />
                      ))}
                      {overflow > 0 && (
                        <button className="text-[10px] text-blue-600 font-semibold px-1 hover:underline">
                          +{overflow} more
                        </button>
                      )}
                    </DroppableMonthCell>
                  );
                })}
              </div>
            ))}
          </>
        )}

        {/* ── Week view ──────────────────────────────────────────────────────── */}
        {viewMode === 'week' && (
          <>
            {/* Header */}
            <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
              {weekDays.map((day, i) => {
                const isToday = toLocalDateStr(day) === toLocalDateStr(today);
                return (
                  <div key={i} className="py-3 text-center border-r border-slate-100 last:border-r-0">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {WEEKDAYS[day.getDay()]}
                    </div>
                    <div
                      className={`mx-auto mt-1 w-9 h-9 flex items-center justify-center rounded-full text-base font-bold ${
                        isToday ? 'bg-blue-600 text-white' : 'text-slate-900'
                      }`}
                    >
                      {day.getDate()}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {day.toLocaleDateString('en-US', { month: 'short' })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Columns */}
            <div className="grid grid-cols-7">
              {weekDays.map((day, i) => {
                const dayPosts = getPostsForDate(day);
                return (
                  <DroppableWeekColumn key={i} date={day}>
                    {dayPosts.map(post => (
                      <DraggableChip key={post._id} post={post} onClick={() => setSelectedPost(post)} />
                    ))}
                    {dayPosts.length === 0 && (
                      <div className="h-full min-h-10 flex items-center justify-center border-2 border-dashed border-slate-100 rounded-lg text-[10px] text-slate-300 font-medium">
                        Empty
                      </div>
                    )}
                  </DroppableWeekColumn>
                );
              })}
            </div>
          </>
        )}

        {/* ── Drafts tray ────────────────────────────────────────────────────── */}
        {drafts.length > 0 && (
          <div className="px-6 py-5 border-t border-slate-100 bg-slate-50">
            <div className="flex items-baseline gap-2 mb-1">
              <h3 className="text-sm font-bold text-slate-900">Unscheduled Drafts</h3>
              <span className="text-xs text-slate-500">({drafts.length})</span>
            </div>
            <p className="text-xs text-slate-400 mb-3">Click to view · Drag to a day to schedule</p>
            <div className="flex flex-wrap gap-2">
              {drafts.map(post => (
                <div key={post._id} className="w-52">
                  <DraggableChip post={post} onClick={() => setSelectedPost(post)} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Drag overlay ghost */}
      <DragOverlay>
        {activeDragPost ? (
          <div
            className={`text-xs px-2 py-1 rounded font-medium shadow-xl rotate-2 opacity-90 pointer-events-none w-36 truncate ${
              CHIP_COLORS[activeDragPost.status] ?? CHIP_COLORS.draft
            }`}
          >
            {activeDragPost.title || 'Untitled'}
          </div>
        ) : null}
      </DragOverlay>

      {/* Post detail modal */}
      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onPublish={id => { onPublish(id); setSelectedPost(null); }}
          onReschedule={onReschedule}
          onEditSave={handleEditSave}
          onDelete={handleDelete}
        />
      )}
    </DndContext>
  );
}

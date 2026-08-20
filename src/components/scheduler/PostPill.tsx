'use client';

import { useState } from 'react';
import { Pencil, X, Check } from 'lucide-react';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

type StopProp = { stopPropagation(): void };

interface PostPillProps {
  post: any;
  onPublish: (id: string) => void;
  onEditSave: (postId: string, updates: Partial<any>) => void;
  onEditingChange: (postId: string, isEditing: boolean) => void;
}

const STATUS_COLORS: Record<string, string> = {
  published: 'bg-secondary-container text-on-secondary-container border-secondary-fixed',
  scheduled:  'bg-primary-fixed text-primary border-primary-fixed-dim',
  draft:      'bg-error-container text-on-error-container border-error-container',
  failed:     'bg-error-container text-error border-error-container',
};

export default function PostPill({ post, onPublish, onEditSave, onEditingChange }: PostPillProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  const statusColor = STATUS_COLORS[post.status] ?? STATUS_COLORS.draft;

  const scheduledTime =
    post.scheduledDate && post.status === 'scheduled'
      ? new Date(post.scheduledDate).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })
      : null;

  const openEdit = (e: StopProp) => {
    e.stopPropagation();
    setEditTitle(post.title ?? '');
    setEditContent(post.content ?? '');
    setIsEditing(true);
    onEditingChange(post._id, true);
  };

  const cancelEdit = (e: StopProp) => {
    e.stopPropagation();
    setIsEditing(false);
    onEditingChange(post._id, false);
  };

  const saveEdit = async (e: StopProp) => {
    e.stopPropagation();
    setSaving(true);
    try {
      const res = await fetch(`/api/scheduler/posts/${post._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle, content: editContent }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? 'Save failed');
      }
      onEditSave(post._id, { title: editTitle, content: editContent });
      setIsEditing(false);
      onEditingChange(post._id, false);
    } catch (err: any) {
      alert(friendlyClientMessage(err, 'Failed to save changes'));
    } finally {
      setSaving(false);
    }
  };

  // ── Edit mode ─────────────────────────────────────────────────────────────
  if (isEditing) {
    return (
      <div
        className={`p-3 rounded-lg border shadow-sm mb-2 flex flex-col gap-2 bg-surface-container-lowest ${statusColor}`}
        // Swallow pointer-down so the DraggablePost wrapper never sees it
        onPointerDown={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <span className="text-xs font-bold uppercase tracking-wider opacity-60">
            {post.status}
          </span>
          <div className="flex gap-1">
            <button
              onClick={saveEdit}
              disabled={saving}
              className="text-[10px] font-bold text-on-secondary-container bg-secondary-container/40 hover:bg-secondary-fixed px-2 py-1 rounded flex items-center gap-0.5 disabled:opacity-50"
            >
              <Check className="w-2.5 h-2.5" />
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={cancelEdit}
              className="text-[10px] font-bold text-on-surface-variant bg-surface-container hover:bg-surface-container-high px-2 py-1 rounded flex items-center gap-0.5"
            >
              <X className="w-2.5 h-2.5" />
              Cancel
            </button>
          </div>
        </div>

        <input
          value={editTitle}
          onChange={e => setEditTitle(e.target.value)}
          onPointerDown={e => e.stopPropagation()}
          className="text-sm font-semibold text-on-surface border border-outline-variant rounded px-2 py-1 w-full focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Title"
        />
        <textarea
          value={editContent}
          onChange={e => setEditContent(e.target.value)}
          onPointerDown={e => e.stopPropagation()}
          className="text-xs text-on-surface border border-outline-variant rounded px-2 py-1 w-full resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          rows={3}
          placeholder="Content"
        />
      </div>
    );
  }

  // ── Normal mode ───────────────────────────────────────────────────────────
  return (
    <div
      className={`p-3 rounded-lg border shadow-sm mb-2 transition-transform hover:-translate-y-0.5 flex flex-col gap-2 ${statusColor} bg-surface-container-lowest bg-opacity-50 hover:bg-opacity-100`}
    >
      <div className="flex justify-between items-start">
        <span className="text-xs font-bold uppercase tracking-wider">{post.status}</span>
        <div className="flex items-center gap-1">
          {post.aiGenerated && (
            <span className="text-[10px] bg-primary-fixed text-primary px-1.5 py-0.5 rounded font-bold">
              AI
            </span>
          )}
          <button
            onClick={openEdit}
            title="Edit post"
            className="text-outline hover:text-on-surface hover:bg-surface-container p-0.5 rounded"
          >
            <Pencil className="w-3 h-3" />
          </button>
        </div>
      </div>

      <h4 className="text-sm font-semibold text-on-surface leading-snug line-clamp-2">
        {post.title}
      </h4>
      <p className="text-xs text-on-surface-variant truncate">{post.content}</p>

      {scheduledTime && (
        <span className="text-[10px] text-on-surface-variant font-medium">{scheduledTime}</span>
      )}

      <div className="mt-1 flex gap-1 justify-end border-t border-black/5 pt-2">
        {post.status === 'scheduled' && (
          <button
            onClick={e => { e.stopPropagation(); onPublish(post._id); }}
            className="text-[10px] font-bold text-on-secondary-container bg-secondary-container/40 hover:bg-secondary-fixed px-2 py-1 rounded"
          >
            Publish Now
          </button>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';

interface HistoryPost {
  _id: string;
  title?: string;
  content: string;
  contentType?: string;
  hashtags?: string[];
  cta?: string;
  status: string;
  scheduledDate?: string;
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  scheduled: 'bg-blue-50 text-blue-700',
  published: 'bg-green-50 text-green-700',
  pending_approval: 'bg-amber-50 text-amber-700',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// Local "YYYY-MM-DD" / "HH:MM" helpers — mirrors the same date/time split
// used by the Auto Scheduling calendar's reschedule UI, so behavior (and the
// underlying /api/scheduler/schedule call) stays identical across the app.
function toLocalDateStr(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}
function toLocalTimeStr(d: Date): string {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function getTomorrowParts(): { date: string; time: string } {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return { date: toLocalDateStr(d), time: '09:00' };
}

export default function ContentHistoryTab() {
  const [posts, setPosts] = useState<HistoryPost[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Per-item action state (only one row is ever in edit/schedule mode at a time)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; content: string; cta: string; hashtags: string }>({
    title: '',
    content: '',
    cta: '',
    hashtags: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState('');

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const fetchPosts = async (pg: number, append: boolean) => {
    if (pg === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      const res = await fetch(`/api/content/posts?page=${pg}&limit=20`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load history');
      setPosts((prev) => (append ? [...prev, ...data.posts] : data.posts));
      setTotal(data.total);
      setHasMore(data.hasMore);
      setPage(pg);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchPosts(1, false);
  }, []);

  const closeAllRowActions = () => {
    setEditingId(null);
    setSchedulingId(null);
    setEditError('');
    setScheduleError('');
  };

  const startEdit = (post: HistoryPost) => {
    closeAllRowActions();
    setEditDraft({
      title: post.title || '',
      content: post.content || '',
      cta: post.cta || '',
      hashtags: (post.hashtags || []).join(' '),
    });
    setEditingId(post._id);
    setExpandedId(post._id);
  };

  const saveEdit = async (id: string) => {
    setSavingEdit(true);
    setEditError('');
    try {
      const res = await fetch(`/api/scheduler/posts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editDraft.title,
          content: editDraft.content,
          cta: editDraft.cta,
          hashtags: editDraft.hashtags.split(/\s+/).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save changes');

      setPosts((prev) =>
        prev.map((p) =>
          p._id === id
            ? { ...p, title: data.post.title, content: data.post.content, cta: data.post.cta, hashtags: data.post.hashtags }
            : p
        )
      );
      setEditingId(null);
    } catch (err: any) {
      setEditError(err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const startSchedule = (post: HistoryPost) => {
    closeAllRowActions();
    const parts = post.scheduledDate
      ? { date: toLocalDateStr(new Date(post.scheduledDate)), time: toLocalTimeStr(new Date(post.scheduledDate)) }
      : getTomorrowParts();
    setScheduleDate(parts.date);
    setScheduleTime(parts.time);
    setSchedulingId(post._id);
    setExpandedId(post._id);
  };

  const confirmSchedule = async (id: string) => {
    if (!scheduleDate || !scheduleTime) return;
    setSavingSchedule(true);
    setScheduleError('');
    try {
      // Reuses the exact same scheduling endpoint the Auto Scheduling module
      // uses — no separate scheduling system is introduced here.
      const isoDate = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
      const res = await fetch('/api/scheduler/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: id, scheduledDate: isoDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to schedule post');

      setPosts((prev) =>
        prev.map((p) => (p._id === id ? { ...p, status: 'scheduled', scheduledDate: isoDate } : p))
      );
      setSchedulingId(null);
    } catch (err: any) {
      setScheduleError(err.message);
    } finally {
      setSavingSchedule(false);
    }
  };

  const deletePost = async (id: string) => {
    setDeletingId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/scheduler/posts/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete post');

      setPosts((prev) => prev.filter((p) => p._id !== id));
      setTotal((t) => Math.max(0, t - 1));
      setConfirmDeleteId(null);
    } catch (err: any) {
      setRowError({ id, message: err.message });
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 text-sm">{error}</p>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="text-center py-16">
        <svg
          className="w-12 h-12 mx-auto mb-4 text-slate-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p className="font-medium text-slate-700">No content generated yet</p>
        <p className="text-sm text-slate-400 mt-1">
          Generate your first batch of posts to see them here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-xl font-bold text-slate-900">Content History</h3>
          <p className="text-slate-500 text-sm mt-1">
            {total} AI-generated {total === 1 ? 'post' : 'posts'} for this business.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {posts.map((post) => {
          const isPublished = post.status === 'published';
          const isEditingRow = editingId === post._id;
          const isSchedulingRow = schedulingId === post._id;

          return (
            <div
              key={post._id}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm"
            >
              <div className="px-5 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span
                      className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-md ${
                        STATUS_STYLES[post.status] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {post.status.replace('_', ' ')}
                    </span>
                    {post.contentType && (
                      <span className="text-xs text-slate-500 border border-slate-200 px-2 py-0.5 rounded-md">
                        {post.contentType}
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-slate-900 truncate">
                    {post.title || '(Untitled)'}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Created {formatDate(post.createdAt)}
                    {post.scheduledDate && (
                      <>
                        {' · '}
                        {post.status === 'published' ? 'Published' : 'Scheduled for'} {formatDate(post.scheduledDate)}
                      </>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => {
                      closeAllRowActions();
                      setExpandedId((id) => (id === post._id ? null : post._id));
                    }}
                    className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors whitespace-nowrap"
                  >
                    {expandedId === post._id ? 'Hide' : 'View'}
                  </button>
                  <button
                    onClick={() => startEdit(post)}
                    className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors whitespace-nowrap"
                  >
                    Edit
                  </button>
                  {!isPublished && (
                    <button
                      onClick={() => startSchedule(post)}
                      className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors whitespace-nowrap"
                    >
                      Schedule
                    </button>
                  )}
                  {!isPublished && (
                    <button
                      onClick={() => { closeAllRowActions(); setConfirmDeleteId(post._id); }}
                      className="text-sm font-medium text-red-500 hover:text-red-700 transition-colors whitespace-nowrap"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {expandedId === post._id && !isEditingRow && (
                <div className="px-5 pb-5 border-t border-slate-100 bg-slate-50/50">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed pt-3">
                    {post.content}
                  </p>
                  {!!post.cta && (
                    <p className="text-sm text-slate-800 font-semibold mt-3">CTA: <span className="font-normal text-slate-600">{post.cta}</span></p>
                  )}
                  {!!post.hashtags?.length && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {post.hashtags.map((tag, i) => (
                        <span key={i} className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-sm">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Inline edit form */}
              {isEditingRow && (
                <div className="px-5 pb-5 border-t border-slate-100 bg-slate-50/50 pt-3 space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Title</label>
                    <input
                      value={editDraft.title}
                      onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Content</label>
                    <textarea
                      value={editDraft.content}
                      onChange={(e) => setEditDraft({ ...editDraft, content: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 h-28 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">CTA</label>
                      <input
                        value={editDraft.cta}
                        onChange={(e) => setEditDraft({ ...editDraft, cta: e.target.value })}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Hashtags</label>
                      <input
                        value={editDraft.hashtags}
                        onChange={(e) => setEditDraft({ ...editDraft, hashtags: e.target.value })}
                        placeholder="#seo #local"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                  </div>
                  {editError && <p className="text-xs text-red-500">{editError}</p>}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => { setEditingId(null); setEditError(''); }}
                      className="px-4 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => saveEdit(post._id)}
                      disabled={savingEdit}
                      className="px-4 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-60"
                    >
                      {savingEdit ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              )}

              {/* Inline schedule form */}
              {isSchedulingRow && (
                <div className="px-5 pb-5 border-t border-slate-100 bg-slate-50/50 pt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Date</label>
                      <input
                        type="date"
                        value={scheduleDate}
                        min={toLocalDateStr(new Date())}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Time</label>
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                  </div>
                  {scheduleError && <p className="text-xs text-red-500">{scheduleError}</p>}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => { setSchedulingId(null); setScheduleError(''); }}
                      className="px-4 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => confirmSchedule(post._id)}
                      disabled={savingSchedule}
                      className="px-4 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-60"
                    >
                      {savingSchedule ? 'Saving…' : 'Confirm Schedule'}
                    </button>
                  </div>
                </div>
              )}

              {/* Delete confirmation */}
              {confirmDeleteId === post._id && (
                <div className="px-5 pb-5 border-t border-slate-100 bg-red-50/50 pt-3 space-y-2">
                  <p className="text-sm text-slate-700">Delete this generated content? This can't be undone.</p>
                  {rowError?.id === post._id && (
                    <p className="text-xs text-red-500">{rowError.message}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-4 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors bg-white"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deletePost(post._id)}
                      disabled={deletingId === post._id}
                      className="px-4 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60"
                    >
                      {deletingId === post._id ? 'Deleting…' : 'Delete Permanently'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div className="text-center mt-6">
          <button
            onClick={() => fetchPosts(page + 1, true)}
            disabled={loadingMore}
            className="px-6 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors"
          >
            {loadingMore ? 'Loading…' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  );
}

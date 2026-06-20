'use client';

import { useState, useEffect } from 'react';

interface HistoryPost {
  _id: string;
  title?: string;
  content: string;
  contentType?: string;
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

export default function ContentHistoryTab() {
  const [posts, setPosts] = useState<HistoryPost[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        {posts.map((post) => (
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
                    <> · Scheduled for {formatDate(post.scheduledDate)}</>
                  )}
                </p>
              </div>
              <button
                onClick={() =>
                  setExpandedId((id) => (id === post._id ? null : post._id))
                }
                className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                {expandedId === post._id ? 'Hide' : 'View'}
              </button>
            </div>
            {expandedId === post._id && (
              <div className="px-5 pb-5 border-t border-slate-100 bg-slate-50/50">
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed pt-3">
                  {post.content}
                </p>
              </div>
            )}
          </div>
        ))}
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

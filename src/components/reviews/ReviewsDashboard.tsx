'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import ReviewAnalyticsCards from './ReviewAnalyticsCards';
import ReviewFilterBar from './ReviewFilterBar';
import ReviewCard from './ReviewCard';
import { useBusiness } from '@/context/BusinessContext';

export default function ReviewsDashboard() {
  const { activeBusiness, loading: businessLoading } = useBusiness();
  const [reviews, setReviews] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Full sync from provider — use for "Sync Reviews" button only
  const fetchReviews = useCallback(async () => {
    if (!activeBusiness?._id) return;
    try {
      const res = await fetch('/api/reviews/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: activeBusiness._id })
      });
      const data = await res.json();
      if (data.success) {
        setReviews(data.reviews || []);
        setAnalytics(data.analytics || null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [activeBusiness?._id]);

  // Lightweight DB refresh — use after approve/post to stay in sync without re-syncing from Google
  const refreshReviewList = useCallback(async () => {
    try {
      const res = await fetch('/api/reviews');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setReviews(data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (!businessLoading && activeBusiness?._id) {
      fetchReviews();
    } else if (!businessLoading && !activeBusiness) {
      setLoading(false);
    }
  }, [activeBusiness?._id, businessLoading, fetchReviews]);

  const handleSync = () => {
    setSyncing(true);
    fetchReviews();
  };

  const handleGenerateReply = async (reviewId: string, tone: string) => {
    try {
      const res = await fetch('/api/reviews/generate-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, tone })
      });
      const data = await res.json();
      if (data.success) {
        setReviews(prev => prev.map(r =>
          r._id === reviewId ? { ...r, aiSuggestedReply: data.reply, replyTone: tone } : r
        ));
      } else {
        alert(data.error || 'Failed to generate reply');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleApproveReply = async (reviewId: string, replyText: string) => {
    try {
      const res = await fetch(`/api/reviews/${reviewId}/approve-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiSuggestedReply: replyText })
      });
      const data = await res.json();
      if (data.success) {
        setReviews(prev => prev.map(r =>
          r._id === reviewId ? { ...r, replyStatus: 'APPROVED', aiSuggestedReply: replyText } : r
        ));
        await refreshReviewList();
      } else {
        alert(data.error || 'Failed to approve reply');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handlePostReply = async (reviewId: string) => {
    try {
      const res = await fetch(`/api/reviews/${reviewId}/post-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        setReviews(prev => prev.map(r =>
          r._id === reviewId
            ? { ...r, replyStatus: 'POSTED', response: data.review?.aiSuggestedReply ?? r.aiSuggestedReply }
            : r
        ));
        await refreshReviewList();
      } else {
        alert(data.error || 'Failed to post reply');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const filteredReviews = useMemo(() => {
    return reviews.filter(r => {
      if (activeFilter === 'all') return true;
      if (activeFilter === 'unanswered') return r.replyStatus !== 'POSTED';
      if (activeFilter === 'critical') return r.sentiment === 'critical';
      if (activeFilter === '5-star') return r.rating === 5;
      if (activeFilter === 'positive') return r.sentiment === 'positive';
      if (activeFilter === 'negative') return r.sentiment === 'negative';
      return true;
    });
  }, [reviews, activeFilter]);

  const counts = useMemo(() => ({
    all: reviews.length,
    unanswered: reviews.filter(r => r.replyStatus !== 'POSTED').length,
    critical: reviews.filter(r => r.sentiment === 'critical').length,
    '5-star': reviews.filter(r => r.rating === 5).length,
    positive: reviews.filter(r => r.sentiment === 'positive').length,
    negative: reviews.filter(r => r.sentiment === 'negative').length,
  }), [reviews]);

  if (loading) return <div className="p-8 text-center text-slate-500">Loading Reputation Agent...</div>;

  if (!activeBusiness) {
    return (
      <div className="p-8 text-center text-slate-500">
        No business selected. Please select a business to view reviews.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">AI Reputation Agent</h1>
          <p className="text-slate-500 mt-1">Monitor, analyze, and intelligently respond to customer reviews.</p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-sm transition-colors disabled:opacity-70"
        >
          {syncing ? (
            <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {syncing ? 'Syncing...' : 'Sync Reviews'}
        </button>
      </div>

      {analytics ? (
        <ReviewAnalyticsCards analytics={analytics} />
      ) : (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm text-center">
          <p className="text-slate-500 font-medium">Click "Sync Reviews" to initialize your reputation dashboard.</p>
        </div>
      )}

      {reviews.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm min-h-[500px]">
          <ReviewFilterBar activeFilter={activeFilter} onFilterChange={setActiveFilter} counts={counts} />

          <div className="mt-4">
            {filteredReviews.length === 0 ? (
              <div className="text-center py-12 text-slate-400 font-medium">
                No reviews match the selected filter.
              </div>
            ) : (
              filteredReviews.map(review => (
                <ReviewCard
                  key={review._id}
                  review={review}
                  onGenerateReply={handleGenerateReply}
                  onApproveReply={handleApproveReply}
                  onPostReply={handlePostReply}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

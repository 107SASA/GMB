'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import ReviewAnalyticsCards from './ReviewAnalyticsCards';
import ReviewFilterBar from './ReviewFilterBar';
import ReviewCard from './ReviewCard';
import { useBusiness } from '@/context/BusinessContext';
import UpgradeLimitModal from '@/components/ui/UpgradeLimitModal';

function SkeletonPulse({ className }: { className: string }) {
  return <div className={`bg-surface-container-high rounded animate-pulse ${className}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-end mb-2">
        <SkeletonPulse className="h-10 w-36 rounded-xl" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant card-shadow flex flex-col justify-between">
            <SkeletonPulse className="h-3 w-20 mb-3" />
            <SkeletonPulse className="h-7 w-14" />
          </div>
        ))}
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="p-5 border-b border-outline-variant last:border-0 space-y-3">
            <div className="flex items-start gap-3">
              <SkeletonPulse className="w-10 h-10 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <SkeletonPulse className="h-4 w-36" />
                <SkeletonPulse className="h-3 w-24" />
              </div>
              <SkeletonPulse className="h-6 w-16 rounded-full" />
            </div>
            <div className="space-y-1.5 ml-13">
              <SkeletonPulse className="h-3 w-full" />
              <SkeletonPulse className="h-3 w-5/6" />
              <SkeletonPulse className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ReviewsDashboard() {
  const { activeBusiness, loading: businessLoading } = useBusiness();
  const [reviews, setReviews] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [upgradeMsg, setUpgradeMsg] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  // Fast initial load from DB — no external Google call
  const loadFromDB = useCallback(async () => {
    try {
      const res = await fetch('/api/reviews');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.reviews) && data.reviews.length > 0) {
        setReviews(data.reviews);
        setAnalytics(data.analytics ?? null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Full sync from Google — "Sync Reviews" button only
  const fetchReviews = useCallback(async () => {
    const businessId = activeBusiness?._id;
    if (!businessId) return;
    setSyncing(true);
    setSyncError(null);
    setSyncNote(null);
    try {
      const res = await fetch('/api/reviews/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setReviews(data.reviews || []);
        setAnalytics(data.analytics || null);
        if ((data.synced ?? 0) === 0 && (data.reviews || []).length === 0) {
          setSyncNote('No reviews were returned from Google for this business yet. If it has reviews on Google, try again shortly.');
        }
      } else if (data.needsConnection) {
        // Not connected to Google — reviews (and replies) require the official
        // Google Business Profile API, so prompt the user to connect.
        setSyncError('Connect your Google Business Profile to sync reviews and reply on Google. Go to Settings → Business Profile to connect.');
      } else {
        // Surface the real reason (e.g. "Google connection expired")
        // instead of silently showing an empty dashboard.
        setSyncError(data.error || 'Could not sync reviews. Please try again.');
      }
    } catch (err) {
      console.error(err);
      setSyncError('Network error while syncing reviews. Please try again.');
    } finally {
      setSyncing(false);
    }
  }, [activeBusiness?._id]);

  // Lightweight DB refresh — use after approve/post
  const refreshReviewList = useCallback(async () => {
    try {
      const res = await fetch('/api/reviews');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.reviews)) {
        setReviews(data.reviews);
        setAnalytics(data.analytics ?? null);
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (!businessLoading && activeBusiness?._id) {
      loadFromDB();
    } else if (!businessLoading && !activeBusiness) {
      setLoading(false);
    }
  }, [activeBusiness?._id, businessLoading, loadFromDB]);

  const handleSync = () => {
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
      if (data.code === 'UPGRADE_REQUIRED') {
        setUpgradeMsg(data.error);
        return;
      }
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

  if (loading) return <LoadingSkeleton />;

  if (!activeBusiness) {
    return (
      <div className="p-8 text-center text-on-surface-variant">
        No business selected. Please select a business to view reviews.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end mb-2">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary text-white font-bold rounded-lg card-shadow transition-colors disabled:opacity-70"
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

      {syncError && (
        <div className="bg-error-container border border-error-container rounded-xl px-4 py-3 text-sm text-on-error-container flex items-start gap-2">
          <span className="font-bold shrink-0">Sync failed:</span>
          <span>{syncError}</span>
        </div>
      )}
      {syncNote && !syncError && (
        <div className="bg-error-container border border-error-container rounded-xl px-4 py-3 text-sm text-on-error-container">
          {syncNote}
        </div>
      )}

      {analytics ? (
        <ReviewAnalyticsCards analytics={analytics} />
      ) : (
        <div className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant shadow-sm text-center">
          <p className="text-on-surface-variant font-medium">Click "Sync Reviews" to initialize your reputation dashboard.</p>
        </div>
      )}

      {reviews.length > 0 && (
        <div className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant shadow-sm min-h-[500px]">
          <ReviewFilterBar activeFilter={activeFilter} onFilterChange={setActiveFilter} counts={counts} />

          <div className="mt-4">
            {filteredReviews.length === 0 ? (
              <div className="text-center py-12 text-outline font-medium">
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

      {upgradeMsg && (
        <UpgradeLimitModal message={upgradeMsg} onClose={() => setUpgradeMsg(null)} />
      )}
    </div>
  );
}

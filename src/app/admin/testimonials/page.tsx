'use client';

import { useEffect, useState } from 'react';
import { Star, CheckCircle, XCircle, Clock, MessageSquareQuote, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface TestimonialItem {
  _id: string;
  businessId: { _id: string; name: string } | null;
  reviewerName: string;
  rating: number;
  reviewText: string;
  photoUrl?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  createdAt: string;
}

const TABS: { key: string; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`w-3.5 h-3.5 ${s <= rating ? 'text-primary-fixed-dim fill-primary-fixed-dim' : 'text-outline-variant fill-outline-variant'}`}
        />
      ))}
    </span>
  );
}

export default function AdminTestimonialsPage() {
  const [items, setItems] = useState<TestimonialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async (status: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/testimonials?status=${status}`);
      const json = await res.json();
      if (json.success) setItems(json.testimonials);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(tab);
  }, [tab]);

  const decide = async (id: string, status: 'approved' | 'rejected') => {
    let rejectionReason: string | undefined;
    if (status === 'rejected') {
      rejectionReason = window.prompt('Reason for rejecting this testimonial (shown to the business):') || undefined;
      if (rejectionReason === undefined) return; // cancelled
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/testimonials/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, rejectionReason }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Update failed.');
      toast.success(status === 'approved' ? 'Approved — now live on the showcase page.' : 'Rejected.');
      await load(tab);
    } catch (err: any) {
      toast.error(err.message || 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string, isLive: boolean) => {
    if (!window.confirm(isLive
      ? 'Remove this from the live showcase page? It will disappear from growwmatics.com/showcase immediately.'
      : 'Delete this testimonial permanently?')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/testimonials/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Delete failed.');
      toast.success('Deleted.');
      await load(tab);
    } catch (err: any) {
      toast.error(err.message || 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center shadow-sm">
          <MessageSquareQuote className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">Testimonial Approvals</h1>
          <p className="text-sm text-on-surface-variant">Client reviews of GrowwMatics — approve to publish on growwmatics.com/showcase.</p>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-outline-variant">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-10 text-center text-on-surface-variant">Loading…</div>
      ) : items.length === 0 ? (
        <div className="p-12 text-center text-on-surface-variant bg-surface-container-lowest rounded-xl border border-outline-variant">
          Nothing here.
        </div>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow divide-y divide-outline-variant">
          {items.map((item) => (
            <div key={item._id} className="p-5 flex items-start gap-4">
              {item.photoUrl ? (
                <img src={item.photoUrl} alt={item.reviewerName || 'Reviewer'} className="w-12 h-12 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-primary-fixed text-primary flex items-center justify-center font-bold shrink-0">
                  {item.reviewerName?.charAt(0)?.toUpperCase() || '?'}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm text-on-surface">{item.reviewerName || 'A GrowwMatics client'}</p>
                  <Stars rating={item.rating} />
                  <span className="text-[11px] text-outline">{item.businessId?.name ?? 'Unknown business'}</span>
                </div>
                <p className="text-sm text-on-surface-variant mt-1.5">{item.reviewText}</p>
                <p className="text-[11px] text-outline mt-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {new Date(item.createdAt).toLocaleString()}
                </p>
                {item.status === 'rejected' && item.rejectionReason && (
                  <p className="text-xs text-error mt-2">Rejected: {item.rejectionReason}</p>
                )}
              </div>
              {item.status === 'pending' && (
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => decide(item._id, 'approved')}
                    disabled={busyId === item._id}
                    className="p-2 text-secondary hover:bg-secondary-container/40 rounded-lg transition-colors disabled:opacity-50"
                    title="Approve"
                  >
                    <CheckCircle size={18} />
                  </button>
                  <button
                    onClick={() => decide(item._id, 'rejected')}
                    disabled={busyId === item._id}
                    className="p-2 text-on-error-container hover:bg-error-container rounded-lg transition-colors disabled:opacity-50"
                    title="Reject"
                  >
                    <XCircle size={18} />
                  </button>
                </div>
              )}
              {item.status !== 'pending' && (
                <button
                  onClick={() => remove(item._id, item.status === 'approved')}
                  disabled={busyId === item._id}
                  className="p-2 text-outline hover:text-error hover:bg-error-container rounded-lg transition-colors disabled:opacity-50 shrink-0"
                  title={item.status === 'approved' ? 'Remove from showcase' : 'Delete'}
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

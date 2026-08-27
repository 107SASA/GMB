'use client';

import { useEffect, useState } from 'react';
import { Camera, CheckCircle, XCircle, Clock, Film, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface ShowcaseItem {
  _id: string;
  businessId: { _id: string; name: string } | null;
  mediaType: 'photo' | 'video';
  url: string;
  caption?: string;
  featureBusinessName: boolean;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  createdAt: string;
}

const TABS: { key: string; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

export default function AdminShowcasePage() {
  const [items, setItems] = useState<ShowcaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async (status: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/showcase?status=${status}`);
      const json = await res.json();
      if (json.success) setItems(json.assets);
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
      rejectionReason = window.prompt('Reason for rejecting this upload (shown to the business):') || undefined;
      if (rejectionReason === undefined) return; // cancelled
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/showcase/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, rejectionReason }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Update failed.');
      toast.success(status === 'approved' ? 'Approved — now live on the showcase.' : 'Rejected.');
      await load(tab);
    } catch (err: any) {
      toast.error(err.message || 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string, isLive: boolean) => {
    if (!window.confirm(isLive
      ? 'Remove this from the live showcase? It will disappear from growwmatics.com/showcase immediately.'
      : 'Delete this upload permanently?')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/showcase/${id}`, { method: 'DELETE' });
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
          <Camera className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">Showcase Approvals</h1>
          <p className="text-sm text-on-surface-variant">Client photo/video uploads — approve to publish on growwmatics.com/showcase.</p>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((item) => (
            <div key={item._id} className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
              <div className="aspect-video bg-surface-container relative">
                {item.mediaType === 'video' ? (
                  <video src={item.url} controls className="w-full h-full object-cover" />
                ) : (
                  <img src={item.url} alt={item.caption || 'Showcase upload'} className="w-full h-full object-cover" />
                )}
                <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-on-surface/60 text-white text-[10px] font-semibold backdrop-blur-sm">
                  {item.mediaType === 'video' ? <Film className="w-3 h-3" /> : <Camera className="w-3 h-3" />}
                  {item.mediaType}
                </span>
              </div>
              <div className="p-4">
                <p className="font-semibold text-sm text-on-surface truncate">{item.businessId?.name ?? 'Unknown business'}</p>
                {item.caption && <p className="text-xs text-on-surface-variant mt-1 line-clamp-2">{item.caption}</p>}
                <p className="text-[11px] text-outline mt-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {new Date(item.createdAt).toLocaleString()}
                  {item.featureBusinessName && ' · opted in to be credited'}
                </p>
                {item.status === 'rejected' && item.rejectionReason && (
                  <p className="text-xs text-error mt-2">Rejected: {item.rejectionReason}</p>
                )}
                {item.status === 'pending' && (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => decide(item._id, 'approved')}
                      disabled={busyId === item._id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-secondary-container/40 text-on-secondary-container text-xs font-bold hover:bg-secondary-container/60 transition-colors disabled:opacity-50"
                    >
                      <CheckCircle size={14} /> Approve
                    </button>
                    <button
                      onClick={() => decide(item._id, 'rejected')}
                      disabled={busyId === item._id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-error-container text-on-error-container text-xs font-bold hover:opacity-90 transition-colors disabled:opacity-50"
                    >
                      <XCircle size={14} /> Reject
                    </button>
                  </div>
                )}
                {item.status !== 'pending' && (
                  <button
                    onClick={() => remove(item._id, item.status === 'approved')}
                    disabled={busyId === item._id}
                    className="w-full flex items-center justify-center gap-1.5 py-2 mt-3 rounded-lg text-outline hover:text-error hover:bg-error-container text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={14} /> {item.status === 'approved' ? 'Remove from showcase' : 'Delete'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

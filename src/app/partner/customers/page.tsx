'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface Row {
  _id: string;
  name: string;
  business: string | null;
  phone: string | null;
  city: string | null;
  createdAt: string;
  lastActivityAt: string | null;
}

interface Referred {
  _id: string;
  name: string;
  city: string | null;
  status: string;
  paying: boolean;
  createdAt: string;
}

/** Leads that paid and became Growwmatics AI customers, plus workspaces that signed up through the partner's link. */
export default function PartnerCustomersPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [referred, setReferred] = useState<Referred[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/partner/leads?view=customers')
      .then((r) => r.json())
      .then((json) => (json.success ? setRows(json.data) : setError(json.error)))
      .catch(() => setError('Could not load your customers'));
    fetch('/api/partner/referrals')
      .then((r) => r.json())
      .then((json) => { if (json.success) setReferred(json.data); })
      .catch(() => {});
  }, []);

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-heading text-2xl font-bold text-on-surface">My customers</h1>
        <p className="text-sm text-on-surface-variant">Businesses you brought that are now paying Growwmatics AI customers.</p>
      </div>
      {error && <p className="mb-4 text-sm text-error">{error}</p>}
      {!rows ? (
        !error && (
          <div className="flex justify-center py-16">
            <MaterialIcon name="progress_activity" size={28} className="animate-spin text-primary" />
          </div>
        )
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-sm text-on-surface-variant bg-surface-container-lowest rounded-xl border border-outline-variant">
          No customers yet. When one of your leads pays, they’ll appear here.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <Link key={r._id} href={`/partner/leads/${r._id}`} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 hover:border-primary transition-colors">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-on-surface">{r.name}</p>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-secondary-container/50 text-secondary shrink-0">Customer</span>
              </div>
              {r.business && r.business !== r.name && <p className="text-sm text-on-surface-variant">{r.business}</p>}
              <p className="text-xs text-on-surface-variant mt-2">{[r.phone, r.city].filter(Boolean).join(' · ')}</p>
            </Link>
          ))}
        </div>
      )}

      {referred.length > 0 && (
        <section className="mt-8">
          <h2 className="font-semibold text-on-surface mb-1">Signed up through your link</h2>
          <p className="text-sm text-on-surface-variant mb-3">Workspaces created after someone opened your referral link.</p>
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low text-left text-on-surface-variant">
                  <th className="p-3">Business</th>
                  <th className="p-3">City</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Signed up</th>
                </tr>
              </thead>
              <tbody>
                {referred.map((b) => (
                  <tr key={b._id} className="border-b border-outline-variant last:border-0">
                    <td className="p-3 font-medium text-on-surface">{b.name}</td>
                    <td className="p-3">{b.city ?? '—'}</td>
                    <td className="p-3">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${b.paying ? 'bg-secondary-container/50 text-secondary' : 'bg-surface-container text-on-surface-variant'}`}>{b.status}</span>
                    </td>
                    <td className="p-3 text-xs text-on-surface-variant whitespace-nowrap">{new Date(b.createdAt).toLocaleDateString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

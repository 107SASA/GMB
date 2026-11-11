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

/** Leads that paid and became Growwmatics AI customers. Commission details arrive with the commissions page. */
export default function PartnerCustomersPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/partner/leads?view=customers')
      .then((r) => r.json())
      .then((json) => (json.success ? setRows(json.data) : setError(json.error)))
      .catch(() => setError('Could not load your customers'));
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
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert, LogOut } from 'lucide-react';

/**
 * Red bar shown across the customer dashboard while a SUPER_ADMIN is logged
 * in as a customer (see src/lib/adminViewAs.ts). Rendered only by the
 * dashboard layout after it has confirmed the SUPER_ADMIN role server-side.
 */
export default function AdminViewAsBanner({
  businessName,
  ownerName,
  expiresAt,
}: {
  businessName: string;
  ownerName?: string;
  /** ISO time the 2h window closes. */
  expiresAt: string;
}) {
  const [exiting, setExiting] = useState(false);
  const [minutesLeft, setMinutesLeft] = useState(() => minsUntil(expiresAt));

  useEffect(() => {
    const t = setInterval(() => setMinutesLeft(minsUntil(expiresAt)), 30_000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const exit = async () => {
    setExiting(true);
    try {
      await fetch('/api/admin/impersonate', { method: 'DELETE' });
    } finally {
      // Full navigation so every client cache (business context, SWR, …)
      // drops the customer's workspace.
      window.location.href = '/admin/customers';
    }
  };

  // Window closed while the page was open — send the admin back out.
  useEffect(() => {
    if (minutesLeft <= 0 && !exiting) exit();
  }, [minutesLeft]);

  return (
    <div className="sticky top-0 z-[60] bg-error text-on-error px-4 py-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm shadow-md">
      <span className="flex items-center gap-2 font-semibold">
        <ShieldAlert className="w-4 h-4 shrink-0" />
        You&apos;re viewing <strong className="font-extrabold">{businessName}</strong>
        {ownerName ? <span className="font-normal opacity-90">({ownerName})</span> : null}
        as admin
      </span>
      <span className="opacity-90 text-xs">
        Everything you change here is logged under your name · ends in {minutesLeft} min
      </span>
      <button
        onClick={exit}
        disabled={exiting}
        className="flex items-center gap-1.5 rounded-lg bg-white/15 hover:bg-white/25 px-3 py-1 text-xs font-bold transition-colors disabled:opacity-60"
      >
        <LogOut className="w-3.5 h-3.5" />
        {exiting ? 'Exiting…' : 'Exit to admin'}
      </button>
    </div>
  );
}

function minsUntil(iso: string): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 60000));
}

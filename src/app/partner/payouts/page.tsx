'use client';

import { useEffect, useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface Payout {
  _id: string;
  grossAmount: number;
  tdsPercent: number;
  tdsAmount: number;
  netAmount: number;
  method: string;
  reference: string;
  paidAt: string;
  note: string | null;
  bank: { accountLast4?: string; bankName?: string } | null;
  count: number;
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function PartnerPayoutsPage() {
  const [rows, setRows] = useState<Payout[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/partner/payouts')
      .then((r) => r.json())
      .then((json) => (json.success ? setRows(json.data) : setError(json.error)))
      .catch(() => setError('Could not load payouts'));
  }, []);

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-heading text-2xl font-bold text-on-surface">Payouts</h1>
        <p className="text-sm text-on-surface-variant">Money we have sent to your bank account.</p>
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
          No payouts yet. Approved commissions are paid to your verified bank account.
        </div>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low text-left text-on-surface-variant">
                <th className="p-3">Paid on</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3">To</th>
                <th className="p-3">Reference (UTR)</th>
                <th className="p-3">Commissions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p._id} className="border-b border-outline-variant last:border-0 align-top">
                  <td className="p-3 whitespace-nowrap">{new Date(p.paidAt).toLocaleDateString('en-IN')}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <span className="font-semibold">{inr(p.netAmount)}</span>
                    {p.tdsAmount > 0 && <span className="block text-[11px] text-on-surface-variant">{inr(p.grossAmount)} − TDS {p.tdsPercent}%</span>}
                  </td>
                  <td className="p-3">{p.bank?.bankName ?? '—'}{p.bank?.accountLast4 ? ` ····${p.bank.accountLast4}` : ''}</td>
                  <td className="p-3 font-mono text-xs break-all">{p.reference}</td>
                  <td className="p-3">{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

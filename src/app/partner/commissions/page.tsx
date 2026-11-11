'use client';

import { useEffect, useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { COMMISSION_STAGE_LABEL } from '@/lib/partners/commissionRules';

interface Commission {
  _id: string;
  kind: 'first' | 'recurring' | 'adjustment';
  customerName: string;
  invoiceNumber: string | null;
  attribution: 'lead' | 'referral' | null;
  paidAt: string;
  paymentAmount: number;
  baseAmount: number;
  ratePercent: number;
  amount: number;
  availableAt: string;
  stage: keyof typeof COMMISSION_STAGE_LABEL;
  reversalReason: string | null;
}

interface Summary { onHold: number; ready: number; approved: number; paid: number; lifetime: number }

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const date = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const STAGE_TONE: Record<string, string> = {
  on_hold: 'bg-surface-container text-on-surface-variant',
  ready: 'bg-primary-fixed text-primary',
  approved: 'bg-primary-fixed text-primary',
  paid: 'bg-secondary-container/50 text-secondary',
  reversed: 'bg-error-container text-on-error-container',
};

export default function PartnerCommissionsPage() {
  const [data, setData] = useState<{ summary: Summary; commissions: Commission[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/partner/commissions')
      .then((r) => r.json())
      .then((json) => (json.success ? setData(json.data) : setError(json.error)))
      .catch(() => setError('Could not load commissions'));
  }, []);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <MaterialIcon name="progress_activity" size={28} className="animate-spin text-primary" />
      </div>
    );
  }
  const { summary, commissions } = data;
  const cards = [
    { label: 'On hold', value: summary.onHold, hint: 'in the refund window' },
    { label: 'Awaiting payout', value: summary.ready + summary.approved, hint: 'hold period over' },
    { label: 'Paid', value: summary.paid, hint: 'to your bank' },
    { label: 'Lifetime earned', value: summary.lifetime, hint: 'all time' },
  ];

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-heading text-2xl font-bold text-on-surface">Commissions</h1>
        <p className="text-sm text-on-surface-variant">Earned on every payment your customers make — first payment and renewals.</p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
            <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">{c.label}</p>
            <p className="font-heading text-2xl font-bold text-on-surface mt-1">{inr(c.value)}</p>
            <p className="text-[11px] text-on-surface-variant mt-0.5">{c.hint}</p>
          </div>
        ))}
      </div>

      {commissions.length === 0 ? (
        <div className="p-10 text-center text-sm text-on-surface-variant bg-surface-container-lowest rounded-xl border border-outline-variant">
          No commissions yet. You earn one each time a customer you brought makes a payment.
        </div>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low text-left text-on-surface-variant">
                <th className="p-3">Customer</th>
                <th className="p-3">Payment</th>
                <th className="p-3">Type</th>
                <th className="p-3 text-right">Paid by customer</th>
                <th className="p-3 text-right">Your commission</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((c) => (
                <tr key={c._id} className="border-b border-outline-variant last:border-0 align-top">
                  <td className="p-3">
                    <p className="font-medium text-on-surface">{c.customerName}</p>
                    {c.invoiceNumber && <p className="text-[11px] text-on-surface-variant">{c.invoiceNumber}</p>}
                  </td>
                  <td className="p-3 whitespace-nowrap">{date(c.paidAt)}</td>
                  <td className="p-3">{c.kind === 'first' ? 'First payment' : c.kind === 'recurring' ? 'Renewal' : 'Adjustment'}</td>
                  <td className="p-3 text-right whitespace-nowrap">{c.kind === 'adjustment' ? '—' : inr(c.baseAmount)}</td>
                  <td className="p-3 text-right whitespace-nowrap font-semibold">
                    {inr(c.amount)}
                    {c.kind !== 'adjustment' && <span className="block text-[11px] font-normal text-on-surface-variant">{c.ratePercent}%</span>}
                  </td>
                  <td className="p-3">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${STAGE_TONE[c.stage]}`}>{COMMISSION_STAGE_LABEL[c.stage]}</span>
                    {c.stage === 'on_hold' && <p className="text-[11px] text-on-surface-variant mt-0.5">until {date(c.availableAt)}</p>}
                    {c.reversalReason && <p className="text-[11px] text-on-surface-variant mt-0.5">{c.reversalReason}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-on-surface-variant mt-4">
        Commission is calculated on the amount received excluding GST. Payouts are made to your verified bank account.
      </p>
    </div>
  );
}

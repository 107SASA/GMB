'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, CheckCircle2, Undo2, Banknote, Download } from 'lucide-react';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';
import { COMMISSION_STAGE_LABEL, payoutTotals } from '@/lib/partners/commissionRules';

/**
 * Super admin: Growth Partner commissions and payouts — totals per partner,
 * approve commissions whose hold period is over, reverse (refunds), record a
 * payout with its UTR, and the payout history (CSV for accounts).
 */

type Stage = keyof typeof COMMISSION_STAGE_LABEL;

interface PartnerTotals {
  _id: string;
  companyName: string;
  partnerCode: string;
  kycStatus: string;
  status: string;
  tdsPercent: number | null;
  bank: { accountHolderName?: string; accountLast4?: string; ifsc?: string; bankName?: string } | null;
  summary: { onHold: number; ready: number; approved: number; paid: number; lifetime: number };
  payable: number;
}

interface Commission {
  _id: string;
  partnerId: string;
  partnerName: string;
  kind: 'first' | 'recurring' | 'adjustment';
  customerName: string;
  invoiceNumber: string | null;
  attribution: 'lead' | 'referral' | null;
  paidAt: string;
  baseAmount: number;
  ratePercent: number;
  amount: number;
  availableAt: string;
  stage: Stage;
  reversalReason: string | null;
}

interface Payout {
  _id: string;
  partnerName: string;
  partnerCode: string | null;
  grossAmount: number;
  tdsAmount: number;
  netAmount: number;
  reference: string;
  paidAt: string;
  count: number;
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const date = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const INPUT = 'w-full px-3 py-2 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-surface-container-lowest';
const EXPORT_URL = '/api/admin/growth-partners/payouts/export';

async function send(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || 'Request failed');
  return json.data;
}

export function CommissionsPanel() {
  const [partners, setPartners] = useState<PartnerTotals[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'' | Stage>('');
  const [partnerFilter, setPartnerFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<PartnerTotals | null>(null);
  const [payForm, setPayForm] = useState({ reference: '', method: 'bank_transfer', paidAt: new Date().toISOString().slice(0, 10), tdsPercent: '', note: '' });
  const [payError, setPayError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, p] = await Promise.all([
        fetch('/api/admin/growth-partners/commissions').then((r) => r.json()),
        fetch('/api/admin/growth-partners/payouts').then((r) => r.json()),
      ]);
      if (!c.success) throw new Error(c.error);
      setPartners(c.data.partners);
      setCommissions(c.data.commissions);
      setPayouts(p.success ? p.data : []);
      setSelected(new Set());
    } catch (err: any) {
      setError(friendlyClientMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(
    () => commissions.filter((c) => (!stage || c.stage === stage) && (!partnerFilter || c.partnerId === partnerFilter)),
    [commissions, stage, partnerFilter]
  );
  const readyIds = (partnerId?: string) => commissions.filter((c) => c.stage === 'ready' && (!partnerId || c.partnerId === partnerId)).map((c) => c._id);

  const approve = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await send('/api/admin/growth-partners/commissions/approve', { ids });
      if (r.skipped) alert(`${r.approved} approved. ${r.skipped} skipped (still on hold or already handled).`);
      await load();
    } catch (err: any) {
      alert(friendlyClientMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reverse = async (c: Commission) => {
    const reason = prompt(
      c.stage === 'paid'
        ? `This commission (${inr(c.amount)}) was already paid. Reversing it takes ${inr(c.amount)} off ${c.partnerName}'s next payout. Reason?`
        : `Reverse ${inr(c.amount)} for ${c.customerName}? Reason (e.g. refund)`
    );
    if (!reason) return;
    try {
      await send(`/api/admin/growth-partners/commissions/${c._id}/reverse`, { reason });
      await load();
    } catch (err: any) {
      alert(friendlyClientMessage(err));
    }
  };

  const pay = async () => {
    if (!paying) return;
    setBusy(true);
    setPayError(null);
    try {
      await send(`/api/admin/growth-partners/${paying._id}/payouts`, payForm);
      setPaying(null);
      await load();
    } catch (err: any) {
      setPayError(friendlyClientMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (error) return <p className="text-sm text-error">{error}</p>;

  const preview = paying ? payoutTotals([paying.payable], payForm.tdsPercent === '' ? 0 : Number(payForm.tdsPercent)) : null;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-semibold text-on-surface mb-3">By partner</h2>
        {partners.length === 0 ? (
          <div className="p-8 text-center text-outline text-sm bg-surface-container-lowest rounded-xl border border-outline-variant">
            No commissions yet. They appear here when a partner’s customer pays.
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low text-left text-on-surface-variant">
                  <th className="p-3">Partner</th>
                  <th className="p-3 text-right">On hold</th>
                  <th className="p-3 text-right">Ready</th>
                  <th className="p-3 text-right">Approved (payable)</th>
                  <th className="p-3 text-right">Paid</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p._id} className="border-b border-outline-variant last:border-0">
                    <td className="p-3">
                      <p className="font-semibold text-on-surface">{p.companyName}</p>
                      <p className="text-xs text-on-surface-variant">{p.partnerCode} · KYC {p.kycStatus.replace('_', ' ')}{p.status === 'suspended' ? ' · suspended' : ''}</p>
                    </td>
                    <td className="p-3 text-right">{inr(p.summary.onHold)}</td>
                    <td className="p-3 text-right">{inr(p.summary.ready)}</td>
                    <td className="p-3 text-right font-semibold">{inr(p.payable)}</td>
                    <td className="p-3 text-right">{inr(p.summary.paid)}</td>
                    <td className="p-3">
                      <div className="flex gap-2 justify-end">
                        {readyIds(p._id).length > 0 && (
                          <button onClick={() => approve(readyIds(p._id))} disabled={busy} className="flex items-center gap-1 px-3 py-1.5 bg-primary-fixed text-primary rounded-lg text-xs font-medium">
                            <CheckCircle2 className="w-3 h-3" /> Approve ready
                          </button>
                        )}
                        {p.payable > 0 && (
                          <button
                            onClick={() => {
                              setPaying(p);
                              setPayError(null);
                              setPayForm({ reference: '', method: 'bank_transfer', paidAt: new Date().toISOString().slice(0, 10), tdsPercent: p.tdsPercent != null ? String(p.tdsPercent) : '', note: '' });
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-primary text-on-primary rounded-lg text-xs font-medium"
                          >
                            <Banknote className="w-3 h-3" /> Record payout
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold text-on-surface">Commissions</h2>
          <div className="flex flex-wrap gap-2">
            <select value={partnerFilter} onChange={(e) => setPartnerFilter(e.target.value)} className="px-3 py-1.5 rounded-lg border border-outline-variant text-xs bg-surface-container-lowest" aria-label="Partner">
              <option value="">All partners</option>
              {partners.map((p) => <option key={p._id} value={p._id}>{p.companyName}</option>)}
            </select>
            <select value={stage} onChange={(e) => setStage(e.target.value as Stage | '')} className="px-3 py-1.5 rounded-lg border border-outline-variant text-xs bg-surface-container-lowest" aria-label="Status">
              <option value="">All statuses</option>
              {(Object.keys(COMMISSION_STAGE_LABEL) as Stage[]).map((s) => <option key={s} value={s}>{COMMISSION_STAGE_LABEL[s]}</option>)}
            </select>
            {selected.size > 0 && (
              <button onClick={() => approve([...selected])} disabled={busy} className="flex items-center gap-1 px-3 py-1.5 bg-primary text-on-primary rounded-lg text-xs font-medium">
                <CheckCircle2 className="w-3 h-3" /> Approve selected ({selected.size})
              </button>
            )}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No commissions match.</p>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low text-left text-on-surface-variant">
                  <th className="p-3 w-8"></th>
                  <th className="p-3">Partner</th>
                  <th className="p-3">Customer / invoice</th>
                  <th className="p-3">Paid</th>
                  <th className="p-3 text-right">Base × rate</th>
                  <th className="p-3 text-right">Commission</th>
                  <th className="p-3">Status</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c._id} className="border-b border-outline-variant last:border-0 align-top">
                    <td className="p-3">
                      {c.stage === 'ready' && (
                        <input
                          type="checkbox"
                          aria-label="Select"
                          checked={selected.has(c._id)}
                          onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(c._id); else n.delete(c._id); return n; })}
                        />
                      )}
                    </td>
                    <td className="p-3">{c.partnerName}</td>
                    <td className="p-3">
                      <p className="text-on-surface">{c.customerName}</p>
                      <p className="text-[11px] text-on-surface-variant">
                        {c.invoiceNumber ?? ''}{c.kind !== 'adjustment' ? ` · ${c.kind === 'first' ? 'first payment' : 'renewal'}` : ''}{c.attribution === 'referral' ? ' · via link' : ''}
                      </p>
                    </td>
                    <td className="p-3 whitespace-nowrap">{date(c.paidAt)}</td>
                    <td className="p-3 text-right whitespace-nowrap">{c.kind === 'adjustment' ? '—' : `${inr(c.baseAmount)} × ${c.ratePercent}%`}</td>
                    <td className={`p-3 text-right font-semibold whitespace-nowrap ${c.amount < 0 ? 'text-error' : ''}`}>{inr(c.amount)}</td>
                    <td className="p-3">
                      <span className="text-[11px] font-bold">{COMMISSION_STAGE_LABEL[c.stage]}</span>
                      {c.stage === 'on_hold' && <p className="text-[11px] text-on-surface-variant">until {date(c.availableAt)}</p>}
                      {c.reversalReason && <p className="text-[11px] text-on-surface-variant">{c.reversalReason}</p>}
                    </td>
                    <td className="p-3">
                      {c.kind !== 'adjustment' && c.stage !== 'reversed' && (
                        <button onClick={() => reverse(c)} className="flex items-center gap-1 text-xs text-error font-medium" title="Reverse (refund / chargeback)">
                          <Undo2 className="w-3 h-3" /> Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-on-surface">Payouts</h2>
          <a href={EXPORT_URL} download className="flex items-center gap-1 text-xs font-medium text-primary"><Download className="w-3.5 h-3.5" /> Export CSV</a>
        </div>
        {payouts.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No payouts recorded yet.</p>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low text-left text-on-surface-variant">
                  <th className="p-3">Paid on</th>
                  <th className="p-3">Partner</th>
                  <th className="p-3 text-right">Gross</th>
                  <th className="p-3 text-right">TDS</th>
                  <th className="p-3 text-right">Net</th>
                  <th className="p-3">UTR</th>
                  <th className="p-3">Items</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p._id} className="border-b border-outline-variant last:border-0">
                    <td className="p-3 whitespace-nowrap">{date(p.paidAt)}</td>
                    <td className="p-3">{p.partnerName}</td>
                    <td className="p-3 text-right">{inr(p.grossAmount)}</td>
                    <td className="p-3 text-right">{inr(p.tdsAmount)}</td>
                    <td className="p-3 text-right font-semibold">{inr(p.netAmount)}</td>
                    <td className="p-3 font-mono text-xs break-all">{p.reference}</td>
                    <td className="p-3">{p.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {paying && preview && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setPaying(null)}>
          <div role="dialog" aria-modal="true" aria-label="Record payout" className="bg-surface-container-lowest rounded-xl border border-outline-variant w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold text-lg text-on-surface mb-1">Record payout — {paying.companyName}</h2>
            <p className="text-sm text-on-surface-variant mb-4">
              Send the money from your bank first, then record it here. This pays all approved commissions for this partner.
            </p>
            {paying.bank && (
              <div className="mb-4 rounded-lg bg-surface-container-low border border-outline-variant p-3 text-sm">
                <p className="font-semibold">{paying.bank.accountHolderName}</p>
                <p className="text-on-surface-variant">{paying.bank.bankName} · ····{paying.bank.accountLast4} · {paying.bank.ifsc}</p>
                <p className="text-[11px] text-on-surface-variant mt-1">Full account number: Partners tab → KYC.</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block col-span-2"><span className="block text-xs font-semibold mb-1">Bank reference / UTR *</span><input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} className={INPUT} /></label>
              <label className="block"><span className="block text-xs font-semibold mb-1">Paid on</span><input type="date" value={payForm.paidAt} onChange={(e) => setPayForm({ ...payForm, paidAt: e.target.value })} className={INPUT} /></label>
              <label className="block"><span className="block text-xs font-semibold mb-1">Method</span>
                <select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} className={INPUT}>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="upi">UPI</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="block"><span className="block text-xs font-semibold mb-1">TDS % (optional)</span><input type="number" min={0} max={30} step="0.01" value={payForm.tdsPercent} onChange={(e) => setPayForm({ ...payForm, tdsPercent: e.target.value })} className={INPUT} placeholder="0" /></label>
              <label className="block"><span className="block text-xs font-semibold mb-1">Note</span><input value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} className={INPUT} /></label>
            </div>
            <div className="mt-4 rounded-lg bg-surface-container-low p-3 text-sm space-y-0.5">
              <p className="flex justify-between"><span>Approved commissions</span><span>{inr(preview.gross)}</span></p>
              {preview.tds > 0 && <p className="flex justify-between text-on-surface-variant"><span>TDS {preview.tdsPercent}%</span><span>− {inr(preview.tds)}</span></p>}
              <p className="flex justify-between font-semibold"><span>Net paid</span><span>{inr(preview.net)}</span></p>
            </div>
            {paying.kycStatus !== 'verified' && <p className="mt-3 text-sm text-error">KYC isn’t verified yet — verify it before paying out.</p>}
            {payError && <p className="mt-3 text-sm text-error">{payError}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setPaying(null)} className="px-4 py-2 rounded-xl text-sm font-medium bg-surface-container">Cancel</button>
              <button onClick={pay} disabled={busy || payForm.reference.trim().length < 4} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-on-primary disabled:opacity-50">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Record payout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

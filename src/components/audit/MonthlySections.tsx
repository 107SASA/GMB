'use client';

/**
 * Monthly optimization report sections (rendered inside the existing dashboard
 * report for monthly audits). Every row comes from auditData.monthly, which is
 * built from two stored audits + execution records — nothing here is
 * estimated. Missing data is stated, never filled.
 */

import { contentActivityLines } from '@/services/lifecycle/monthly';

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-sm p-6">
    <h3 className="text-sm font-bold text-on-surface mb-3">{title}</h3>
    {children}
  </div>
);
const Empty = ({ text }: { text: string }) => <p className="text-sm text-on-surface-variant">{text}</p>;
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const STATUS_LABEL: Record<string, string> = { VERIFIED: 'Verified', EXECUTED: 'Done — awaiting re-measure', READY: 'Ready', PLANNED: 'Planned', BLOCKED: 'Blocked' };

export default function MonthlySections({ monthly }: { monthly: any }) {
  if (!monthly) return null;
  const m = monthly;
  const r = m.reviews || {};
  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4 bg-primary-fixed/40 border border-outline-variant">
        <div className="text-xs font-bold uppercase tracking-wide text-primary">Monthly optimization report</div>
        <div className="text-sm text-on-surface-variant">
          {fmtDate(m.period?.start)} – {fmtDate(m.period?.end)} · compared with your previous connected audit
        </div>
      </div>

      <Card title="What changed this month">
        {m.changes?.length ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-outline uppercase"><th className="py-1 pr-2">Change</th><th className="py-1 px-2">Before</th><th className="py-1 px-2">Now</th><th className="py-1 pl-2">By</th></tr></thead>
            <tbody>
              {m.changes.map((c: any, i: number) => (
                <tr key={i} className="border-t border-outline-variant align-top">
                  <td className="py-2 pr-2 text-on-surface">{c.what}<span className="block text-[10px] text-outline">{c.evidence}</span></td>
                  <td className="py-2 px-2 text-on-surface-variant">{c.previous}</td>
                  <td className="py-2 px-2 text-on-surface-variant">{c.current}</td>
                  <td className="py-2 pl-2 text-on-surface-variant">{c.actor === 'Unknown' ? 'Not recorded' : c.actor === 'Owner' ? 'You' : 'GrowwMatics'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty text="No verified profile changes were detected between the two audits." />}
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="What GrowwMatics optimized">
          {m.growwmaticsOptimized?.length
            ? <ul className="space-y-1 text-sm">{m.growwmaticsOptimized.map((x: any, i: number) => <li key={i}><strong>{x.count}</strong> {x.what}<span className="block text-[10px] text-outline">{x.evidence}</span></li>)}</ul>
            : <Empty text="No GrowwMatics actions reached your Google profile this period (only actions with a confirmed Google write are counted)." />}
        </Card>
        <Card title="What you optimized">
          {m.ownerOptimized?.length
            ? <ul className="space-y-1 text-sm">{m.ownerOptimized.map((x: any, i: number) => <li key={i}><strong>{x.count}</strong> {x.what}<span className="block text-[10px] text-outline">{x.evidence}</span></li>)}</ul>
            : <Empty text="No owner actions were recorded through GrowwMatics this period." />}
        </Card>
      </div>

      <Card title="Google performance">
        {m.performance?.status === 'unavailable' ? (
          <Empty text="Google performance data unavailable for this period." />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-outline uppercase"><th className="py-1 pr-2">Metric</th><th className="py-1 px-2 text-right">Previous period</th><th className="py-1 px-2 text-right">Current period</th><th className="py-1 pl-2 text-right">Change</th></tr></thead>
              <tbody>
                {m.performance.rows.map((row: any, i: number) => (
                  <tr key={i} className="border-t border-outline-variant">
                    <td className="py-2 pr-2">{row.metric}</td>
                    <td className="py-2 px-2 text-right">{row.previous ?? 'Not measured'}</td>
                    <td className="py-2 px-2 text-right">{row.current ?? 'Not measured'}</td>
                    <td className="py-2 pl-2 text-right">{row.pctChange != null ? `${row.pctChange > 0 ? '+' : ''}${row.pctChange}%` : row.change != null ? `${row.change > 0 ? '+' : ''}${row.change}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-outline mt-2">
              Google Business Profile Performance · current {m.performance.currentPeriod}{m.performance.previousPeriod ? ` · previous ${m.performance.previousPeriod}` : ' · no earlier measured period to compare'}.
              These are engagement measurements, not revenue.
            </p>
          </>
        )}
      </Card>

      <Card title="Ranking progress">
        {m.ranking?.length ? (
          <ul className="space-y-1 text-sm">
            {m.ranking.map((x: any, i: number) => (
              <li key={i}>{x.metric}: {x.before} → {x.after} <span className="text-on-surface-variant">({x.change})</span>{x.note && <span className="block text-[10px] text-outline">{x.note}</span>}</li>
            ))}
          </ul>
        ) : <Empty text="Ranking data unavailable for comparison." />}
      </Card>

      <Card title="Review activity">
        <ul className="grid sm:grid-cols-2 gap-1 text-sm">
          <li>New Google reviews: <strong>{r.newReviews}</strong>{r.newReviews === 0 ? ' — no new reviews detected' : ''}</li>
          <li>Rating: {r.ratingBefore ?? 'unknown'}★ → {r.ratingAfter ?? 'unknown'}★</li>
          <li>Lifetime reviews: {r.lifetimeBefore ?? 'unknown'} → {r.lifetimeAfter ?? 'unknown'}</li>
          <li>Replied by GrowwMatics: {r.repliedByGrowwMatics}</li>
          <li>Replies you approved: {r.repliedByOwnerViaGrowwMatics}</li>
          <li>Replied on Google directly: {r.repliedOnGoogleDirectly}</li>
          <li>New reviews without a reply: {r.unanswered}{r.replyUnknown ? ` (${r.replyUnknown} not yet checked)` : ''}</li>
          <li>Review requests sent: {r.reviewRequestsSent}</li>
        </ul>
      </Card>

      {m.contentActivity && (
        <Card title="Google posts this month">
          <ul className="space-y-1 text-sm">
            {contentActivityLines(m.contentActivity).map((l) => <li key={l}>{l}</li>)}
          </ul>
          <p className="text-xs text-on-surface-variant mt-2">Counts of what was posted. Post engagement is shown under Google performance; no revenue is inferred.</p>
        </Card>
      )}

      <Card title="Profile health">
        <p className="text-sm">
          {m.profileHealth?.completionPercentage != null ? `${m.profileHealth.completionPercentage}% of checked fields complete` : 'Profile completion not measured'}
          {m.profileHealth?.missing?.length ? ` · missing: ${m.profileHealth.missing.join(', ')}` : ''}
          {m.profileHealth?.unknown ? ` · ${m.profileHealth.unknown} could not be checked` : ''}
        </p>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Completed plan">
          {m.planCompleted?.length
            ? <ul className="space-y-1 text-sm">{m.planCompleted.map((a: any, i: number) => <li key={i}>{a.action} <span className="text-[11px] text-outline">· {STATUS_LABEL[a.status] || a.status}{a.statusReason ? ` — ${a.statusReason}` : ''}</span></li>)}</ul>
            : <Empty text="No plan actions have been completed with evidence yet." />}
        </Card>
        <Card title="Pending plan">
          {m.planPending?.length
            ? <ul className="space-y-1 text-sm">{m.planPending.map((a: any, i: number) => <li key={i}>{a.action} <span className="text-[11px] text-outline">· {STATUS_LABEL[a.status] || a.status}{a.statusReason ? ` — ${a.statusReason}` : ''}</span></li>)}</ul>
            : <Empty text="No pending plan actions." />}
        </Card>
      </div>

      <Card title="Issues that remain">
        {m.remainingIssues?.length
          ? <ul className="list-disc pl-5 space-y-1 text-sm">{m.remainingIssues.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>
          : <Empty text="No verified issues remain in this audit." />}
        <p className="text-[11px] text-outline mt-2">Next month&apos;s plan is in the Priority Action Plan below — built from these verified findings.</p>
      </Card>
    </div>
  );
}

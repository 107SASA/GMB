'use client';

/**
 * Monthly optimization report sections (rendered inside the existing dashboard
 * report for monthly audits). Every row comes from auditData.monthly, which is
 * built from two stored audits + execution records — nothing here is
 * estimated. Missing data is stated, never filled.
 */

import { contentActivityLines, keywordRankingSummary } from '@/services/lifecycle/monthly';

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-sm p-6">
    <h3 className="text-sm font-bold text-on-surface mb-3">{title}</h3>
    {children}
  </div>
);
const Empty = ({ text }: { text: string }) => <p className="text-sm text-on-surface-variant">{text}</p>;
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const OUTCOME_LABEL: Record<string, string> = {
  not_yet_measurable: 'Done — too early to measure', positive: 'Done — tracked keywords improved', negative: 'Done — tracked keywords declined',
  no_change: 'Done — no measurable change', insufficient_evidence: 'Done — not enough comparable data',
};
const STATUS_LABEL: Record<string, string> = { VERIFIED: 'Verified', EXECUTED: 'Done — awaiting re-measure', READY: 'Ready', PLANNED: 'Planned', BLOCKED: 'Blocked' };

/** Fixed since last report / New this month / Still open — issue by issue (buildIssueProgress). */
function IssueProgressSections({ progress, improved }: { progress: any; improved: string[] }) {
  const fixed: any[] = progress.fixed || [];
  const added: any[] = progress.added || [];
  const open: any[] = progress.stillOpen || [];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card title={`✅ Fixed since last report (${fixed.length})`}>
        {fixed.length
          ? <ul className="space-y-1.5 text-sm">{fixed.map((x) => <li key={x.findingId}>{x.title}<span className="block text-[10px] text-outline">{x.how}</span></li>)}</ul>
          : <Empty text="Nothing from last report is fixed yet." />}
        {improved.length > 0 && (
          <div className="mt-3 border-t border-outline-variant pt-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-outline">Measured changes</p>
            <ul className="mt-1 space-y-1 text-sm">{improved.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </div>
        )}
      </Card>
      <Card title={`🆕 New this month (${added.length})`}>
        {added.length
          ? <ul className="space-y-1.5 text-sm">{added.map((x) => <li key={x.findingId}>{x.title}</li>)}</ul>
          : <Empty text="No new issues found." />}
      </Card>
      <Card title={`⏳ Still open (${open.length})`}>
        {open.length
          ? <ul className="space-y-1.5 text-sm">{open.map((x) => <li key={x.findingId}>{x.title}<span className={`block text-[10px] ${x.waitingForOwner ? 'text-primary font-semibold' : 'text-outline'}`}>{x.reason}</span></li>)}</ul>
          : <Empty text="Nothing left over from last report." />}
      </Card>
    </div>
  );
}

const MOVE_CLASS: Record<string, string> = { improved: 'text-secondary', declined: 'text-error' };

/** Every tracked keyword: last month, now, places moved, and its comparable history. */
function KeywordRankingsCard({ rankings }: { rankings: any }) {
  return (
    <Card title="Keyword rankings">
      <p className="mb-3 text-xs text-on-surface-variant">
        {keywordRankingSummary(rankings)} · same keyword, same location and same search grid as last month — anything else is marked not comparable.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-outline">
              <th className="py-1 pr-2">Keyword</th><th className="py-1 px-2">Last month</th><th className="py-1 px-2">Now</th><th className="py-1 px-2">Change</th><th className="py-1 pl-2">History</th>
            </tr>
          </thead>
          <tbody>
            {rankings.rows.map((r: any, i: number) => (
              <tr key={`${r.keyword}-${r.area}-${i}`} className="border-t border-outline-variant align-top">
                <td className="py-2 pr-2 text-on-surface">{r.keyword}<span className="block text-[10px] text-outline">{r.area}</span></td>
                <td className="py-2 px-2 text-on-surface-variant">{r.previous}</td>
                <td className="py-2 px-2 font-semibold text-on-surface">{r.current}</td>
                <td className={`py-2 px-2 ${MOVE_CLASS[r.change] || 'text-on-surface-variant'}`}>
                  {r.movement || '—'}<span className="block text-[10px] text-outline">{r.status}</span>
                </td>
                <td className="py-2 pl-2 text-xs text-on-surface-variant">{r.history || 'First comparable month'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

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

      {m.issueProgress && <IssueProgressSections progress={m.issueProgress} improved={m.improved || []} />}

      {m.keywordRankings?.rows?.length > 0 && <KeywordRankingsCard rankings={m.keywordRankings} />}

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
                  <td className="py-2 pl-2 text-on-surface-variant">{c.actor === 'Unknown' ? 'Not recorded' : c.actor === 'Owner' ? 'You' : 'Growwmatics AI'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty text="No verified profile changes were detected between the two audits." />}
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="What Growwmatics AI optimized">
          {m.growwmaticsOptimized?.length
            ? <ul className="space-y-1 text-sm">{m.growwmaticsOptimized.map((x: any, i: number) => <li key={i}><strong>{x.count}</strong> {x.what}<span className="block text-[10px] text-outline">{x.evidence}</span></li>)}</ul>
            : <Empty text="No Growwmatics AI actions reached your Google profile this period (only actions with a confirmed Google write are counted)." />}
        </Card>
        <Card title="What you optimized">
          {m.ownerOptimized?.length
            ? <ul className="space-y-1 text-sm">{m.ownerOptimized.map((x: any, i: number) => <li key={i}><strong>{x.count}</strong> {x.what}<span className="block text-[10px] text-outline">{x.evidence}</span></li>)}</ul>
            : <Empty text="No owner actions were recorded through Growwmatics AI this period." />}
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
          <li>Replied by Growwmatics AI: {r.repliedByGrowwMatics}</li>
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

      {m.seo && (
        <Card title="SEO actions and their results">
          {m.seo.actions?.length
            ? <ul className="space-y-1 text-sm">{m.seo.actions.map((a: any, i: number) => <li key={i}>{a.action} — <span className="font-semibold">{OUTCOME_LABEL[a.outcome] || a.outcome}</span><span className="block text-[11px] text-outline">{a.basis}</span></li>)}</ul>
            : <Empty text="No SEO action was completed since the last plan." />}
          {m.seo.weakServices?.length > 0 && <p className="text-sm mt-2">Services needing the most work: {m.seo.weakServices.join(', ')}.</p>}
          <p className="text-[11px] text-outline mt-2">Outcomes are correlations with tracked keyword movement, not proof of cause.</p>
        </Card>
      )}

      {m.areas && (
        <Card title="Service areas since last month">
          {([
            ['Improving visibility', m.areas.improving],
            ['Declining visibility', m.areas.declining],
            ['Not ranking yet', m.areas.notRanking],
            ['New competitors', m.areas.newCompetitors],
            ['Competitors gaining', m.areas.competitorsGaining],
            ['Keyword opportunities', (m.areas.opportunities || []).slice(0, 6)],
          ] as Array<[string, string[]]>)
            .filter(([, list]) => list?.length)
            .map(([label, list]) => (
              <div key={label} className="mb-3 last:mb-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-outline mb-1">{label}</div>
                <ul className="list-disc pl-5 space-y-0.5 text-sm">{list.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            ))}
          {!['improving', 'declining', 'notRanking', 'newCompetitors', 'competitorsGaining', 'opportunities'].some((k) => m.areas[k]?.length) && (
            <Empty text="No service-area changes to report — areas are compared only when both audits searched them." />
          )}
        </Card>
      )}

      <Card title="Issues that remain">
        {m.remainingIssues?.length
          ? <ul className="list-disc pl-5 space-y-1 text-sm">{m.remainingIssues.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>
          : <Empty text="No verified issues remain in this audit." />}
        <p className="text-[11px] text-outline mt-2">Next month&apos;s plan is in the Priority Action Plan below — built from these verified findings.</p>
      </Card>
    </div>
  );
}

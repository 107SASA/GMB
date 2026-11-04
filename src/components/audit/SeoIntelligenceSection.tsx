'use client';

import { intelligenceView } from '@/services/seo/intelligenceView';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

/**
 * "SEO intelligence" — what changed since the last plan, visibility per
 * service, service × area, keyword tracking and website recommendations.
 * Rendered from the stored facts.tracking through intelligenceView(), the
 * same rows the PDF prints. Renders nothing when the audit has no tracking
 * (free reports, older audits).
 */
const STATUS_CLASS: Record<string, string> = {
  strong: 'text-primary', moderate: 'text-secondary', weak: 'text-error', not_visible: 'text-error',
  unavailable: 'text-outline', not_measured: 'text-outline',
};

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-outline-variant p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2">
        <MaterialIcon name={icon} size={18} className="text-primary" />
        <h3 className="font-bold text-on-surface">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function SeoIntelligenceSection({ tracking }: { tracking: any }) {
  const v = intelligenceView(tracking);
  if (!v) return null;
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-4 sm:p-6 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <MaterialIcon name="insights" size={20} className="text-primary" />
          <h2 className="font-heading text-lg sm:text-xl font-bold text-on-surface">SEO intelligence</h2>
        </div>
        <p className="text-xs text-on-surface-variant">{v.period}. {v.coverage}. Positions are real Google Maps results; monthly searches are Google Ads volume for the whole country.</p>
      </div>

      {v.history && (
        <Card title="What changed since the last plan" icon="history">
          {v.history.previousPlan && <p className="text-sm text-on-surface-variant mb-2">Previous: {v.history.previousPlan}. Keywords: {v.history.movement}.</p>}
          {v.history.priorities.length > 0 && (
            <ul className="text-sm space-y-0.5 mb-2">{v.history.priorities.map((p, i) => <li key={i}><span className="font-medium">{p.keyword}</span> <span className="text-on-surface-variant">— {p.result}</span></li>)}</ul>
          )}
          {v.history.actions.length > 0 && (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-outline mt-2 mb-1">Completed actions and measured outcome</div>
              <ul className="text-sm space-y-1">{v.history.actions.map((a, i) => <li key={i}>{a.action} — <span className="font-semibold">{a.outcome}</span><span className="block text-xs text-outline">{a.basis}</span></li>)}</ul>
            </>
          )}
          {v.history.openActions.length > 0 && (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-outline mt-2 mb-1">Still needs attention</div>
              <ul className="list-disc pl-5 text-sm space-y-0.5">{v.history.openActions.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </>
          )}
          <p className="text-[11px] text-outline mt-2">An outcome shows how tracked keywords moved after an action — a correlation, not proof the action caused it.</p>
        </Card>
      )}

      <Card title="Visibility by service" icon="design_services">
        <div className="space-y-3">
          {v.services.map((s, i) => (
            <div key={i} className="border-t border-outline-variant pt-3 first:border-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-bold text-on-surface">{s.service} <span className="text-xs font-normal text-outline">· {s.source}</span></div>
                <div className={`text-sm font-bold ${STATUS_CLASS[s.statusKey] || ''}`}>{s.status}</div>
              </div>
              <p className="text-xs text-outline mb-1">{s.coverage}{s.impressions ? ` · ${s.impressions}` : ''}</p>
              {s.keywords.length > 0 && (
                <div className="overflow-x-auto -mx-2">
                  <table className="w-full text-sm min-w-90">
                    <thead><tr className="text-left text-xs text-outline uppercase tracking-wide"><th className="px-2 py-1 font-medium">Keyword</th><th className="px-2 py-1 font-medium">Position</th><th className="px-2 py-1 font-medium">Change</th><th className="px-2 py-1 font-medium">Monthly searches</th></tr></thead>
                    <tbody>{s.keywords.map((k, j) => (
                      <tr key={j} className="border-t border-outline-variant"><td className="px-2 py-1.5 break-words">{k.keyword}</td><td className="px-2 py-1.5 font-semibold whitespace-nowrap">{k.position}</td><td className="px-2 py-1.5 whitespace-nowrap text-on-surface-variant">{k.change}</td><td className="px-2 py-1.5 whitespace-nowrap text-on-surface-variant">{k.demand}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {s.presence.length > 0 && <p className="text-xs text-on-surface-variant mt-1">{s.presence.join(' · ')}</p>}
              {s.competitors.length > 0 && <p className="text-xs text-on-surface-variant mt-1">Above you: {s.competitors.join('; ')}</p>}
              {s.recommendations.length > 0 && <ul className="list-disc pl-5 text-sm mt-1 space-y-0.5">{s.recommendations.map((r, j) => <li key={j}>{r}</li>)}</ul>}
            </div>
          ))}
        </div>
      </Card>

      {v.matrix && (
        <Card title="Services × service areas" icon="grid_on">
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm min-w-90">
              <thead><tr className="text-left text-xs text-outline uppercase tracking-wide"><th className="px-2 py-1 font-medium">Service</th>{v.matrix.areas.map((a) => <th key={a} className="px-2 py-1 font-medium">{a}</th>)}</tr></thead>
              <tbody>{v.matrix.rows.map((r, i) => (
                <tr key={i} className="border-t border-outline-variant"><td className="px-2 py-1.5 font-medium">{r.service}</td>{r.cells.map((c, j) => <td key={j} className="px-2 py-1.5 whitespace-nowrap" title={c.keyword}>{c.text}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
          <p className="text-[11px] text-outline mt-1">Each cell is one Google Maps search for &ldquo;service + area&rdquo; run at that area&apos;s location.</p>
        </Card>
      )}

      {v.keywordChanges.length > 0 && (
        <Card title="Tracked keyword changes" icon="playlist_add">
          <ul className="text-sm space-y-1">{v.keywordChanges.map((c, i) => <li key={i}><span className="font-semibold">{c.change}:</span> {c.keyword}<span className="block text-xs text-outline">{c.reason}</span></li>)}</ul>
        </Card>
      )}

      {v.website && (
        <Card title="Website SEO recommendations" icon="language">
          <p className="text-xs text-outline mb-2">{v.website.status}</p>
          {v.website.items.length > 0
            ? <ul className="text-sm space-y-1.5">{v.website.items.map((w, i) => <li key={i}><span className={`text-[10px] font-bold uppercase mr-1 ${w.priority === 'high' ? 'text-error' : 'text-outline'}`}>{w.priority}</span>{w.issue}{w.page ? <span className="text-xs text-outline"> · {w.page}</span> : null}<span className="block text-xs text-on-surface-variant">{w.recommendation}</span></li>)}</ul>
            : <p className="text-sm text-on-surface-variant">No issues found on the crawled pages.</p>}
        </Card>
      )}
    </div>
  );
}

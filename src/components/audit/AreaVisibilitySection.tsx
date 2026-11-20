'use client';

import { areaVisibilityView, type AreaRowView } from '@/services/audit/areaVisibility';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

/**
 * "Competitors and visibility by service area" — rendered from the stored
 * facts.areaVisibility by every report variant (free, full, V6/V7, dashboard)
 * through the same areaVisibilityView() the PDF uses, so all of them show the
 * same saved numbers. Renders nothing for audits without service-area data.
 */
export default function AreaVisibilitySection({ areaVisibility, businessName }: { areaVisibility: any; businessName: string }) {
  const view = areaVisibilityView(areaVisibility);
  if (!view) return null;
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-2">
        <MaterialIcon name="travel_explore" size={20} className="text-primary" />
        <h2 className="font-heading text-lg sm:text-xl font-bold text-on-surface">
          {view.source === 'website' ? 'Visibility in the areas you serve' : view.source === 'city' ? 'Visibility across your city' : 'Competitors and visibility by service area'}
        </h2>
      </div>
      {view.coverage && view.coverage.missing.length > 0 && (
        <div className="rounded-lg bg-error-container border border-error-container p-3 sm:p-4 mb-4">
          <p className="font-bold text-error">
            {view.source === 'city'
              ? `Searched from the centre of ${view.coverage.missing.join(', ')}, ${businessName} is not in the top 20.`
              : `${view.source === 'website' ? 'Your website lists' : 'You serve'} ${view.coverage.measured} area${view.coverage.measured > 1 ? 's' : ''}, but ${businessName} shows up in the top 20 in only ${view.coverage.visibleIn}.`}
          </p>
          <p className="text-sm text-on-surface-variant mt-1">
            Not found when customers search in: {view.coverage.missing.join(', ')}. Those customers are shown other businesses.
          </p>
        </div>
      )}
      <p className="text-sm text-on-surface-variant mb-5">
        Real Google Maps searches run from inside each area {businessName} {view.source === 'website' ? 'says it serves on its website' : view.source === 'city' ? 'serves (its city centre — the address is not shown on Google)' : 'serves on Google'}. Position is where {businessName} appeared there;
        monthly searches are Google Ads volume for the whole country (Google rarely reports a single town, so local phrases often show &ldquo;Not enough data&rdquo;).
        Only businesses in the same trade are listed.
      </p>
      <div className="space-y-4">
        <AreaCard row={view.primary} primary />
        {view.areas.map((row, i) => (
          <AreaCard key={i} row={row} />
        ))}
      </div>
    </div>
  );
}

function AreaCard({ row, primary = false }: { row: AreaRowView; primary?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 sm:p-4 ${primary ? 'border-primary bg-primary-fixed/30' : 'border-outline-variant'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div className="font-bold text-on-surface break-words">
          {row.area}
          {row.distance && <span className="ml-2 text-xs font-normal text-outline">{row.distance}</span>}
        </div>
        <div className={`text-sm font-bold ${row.position.startsWith('Best') ? 'text-primary' : 'text-error'}`}>{row.position}</div>
      </div>
      {row.status && <p className="text-xs text-on-surface-variant mb-2">{row.status}</p>}
      {row.phrases.length > 0 && (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm min-w-90">
            <thead>
              <tr className="text-left text-xs text-outline uppercase tracking-wide">
                <th className="px-2 py-1.5 font-medium">Search phrase</th>
                <th className="px-2 py-1.5 font-medium">Your position</th>
                <th className="px-2 py-1.5 font-medium">Monthly searches</th>
              </tr>
            </thead>
            <tbody>
              {row.phrases.map((p, i) => (
                <tr key={i} className="border-t border-outline-variant">
                  <td className="px-2 py-2 text-on-surface break-words">{p.keyword}</td>
                  <td className="px-2 py-2 font-semibold text-on-surface whitespace-nowrap">{p.position}</td>
                  <td className="px-2 py-2 text-on-surface-variant whitespace-nowrap">{p.demand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!primary && row.competitors.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-outline mb-1.5">Same-trade competitors here</div>
          <ul className="space-y-1.5">
            {row.competitors.map((c, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium text-on-surface">{c.name}</span>
                <span className="text-on-surface-variant"> · {c.position} here · {c.relevance}</span>
                {c.foundIn && <span className="block text-xs text-outline">Found: {c.foundIn}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!primary && row.status === '' && row.competitors.length === 0 && (
        <p className="mt-2 text-xs text-on-surface-variant">No same-trade competitors found in this area&apos;s searches.</p>
      )}
    </div>
  );
}

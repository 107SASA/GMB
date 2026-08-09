import { useQuery } from '@tanstack/react-query';

import { fetchAudit, fetchAudits, type AuditKeywordRank } from '@/api/endpoints/audit';
import { useBusiness } from '@/business/BusinessContext';

/**
 * Previous audit's rank per keyword — feeds the Performance tab's keyword
 * table "(Change)" column. Computed client-side from two audit snapshots (no
 * backend change needed — each audit already permanently records its
 * keyword ranks at that point in time); the caller computes the actual
 * delta (previousRank - currentRank) since it already has the current rank
 * per row.
 *
 * Sign convention to apply at the call site: "lower rank number is better"
 * everywhere else in this app, so change = previousRank - currentRank —
 * positive means the rank number went DOWN (improved). A keyword absent
 * from the map (newly tracked, no previous audit yet) has nothing to
 * compare against — treat missing as "no data", not a real 0.
 */
export function useKeywordChanges(): {
  previousRankByKeyword: Map<string, number>;
  isLoading: boolean;
} {
  const { activeBusinessId } = useBusiness();

  const list = useQuery({
    queryKey: ['audits', activeBusinessId],
    queryFn: fetchAudits,
    enabled: !!activeBusinessId,
  });

  const completed = (list.data ?? []).filter((a) => a.status === 'COMPLETED');
  const previousId = completed[1]?._id ?? null;

  const previous = useQuery({
    queryKey: ['audit-detail', previousId],
    queryFn: () => fetchAudit(previousId!),
    enabled: !!previousId,
  });

  const previousRankByKeyword = new Map<string, number>();
  const prevKeywords = (previous.data?.auditData?.googleSearchRank?.topKeywords ?? []).filter(
    (k): k is AuditKeywordRank => !!k && !!k.keyword
  );
  for (const pk of prevKeywords) {
    const prevRank = pk.rank ?? pk.avgRank;
    if (prevRank != null) previousRankByKeyword.set(pk.keyword, prevRank);
  }

  return {
    previousRankByKeyword,
    isLoading: list.isLoading || (!!previousId && previous.isLoading),
  };
}

import { useQuery } from '@tanstack/react-query';

import { fetchAudit, fetchAudits, type Audit } from '@/api/endpoints/audit';
import { useBusiness } from '@/business/BusinessContext';

/**
 * The newest COMPLETED audit's full detail — rank, keywords, competitors and
 * review analysis all live on the audit document. Powers the GBP Performance
 * tab. Both queries are cached per business.
 */
export function useLatestAudit(): {
  audit: Audit | null;
  isLoading: boolean;
  isError: boolean;
} {
  const { activeBusinessId } = useBusiness();

  const list = useQuery({
    queryKey: ['audits', activeBusinessId],
    queryFn: () => fetchAudits(activeBusinessId!),
    enabled: !!activeBusinessId,
    staleTime: 0,
  });

  const latestId = (list.data ?? []).find((a) => a.status === 'COMPLETED')?._id ?? null;

  const detail = useQuery({
    queryKey: ['audit-detail', activeBusinessId, latestId],
    queryFn: () => fetchAudit(latestId!, activeBusinessId!),
    enabled: !!latestId && !!activeBusinessId,
    staleTime: 0,
  });

  return {
    audit: detail.data ?? null,
    isLoading: list.isPending || (!!latestId && detail.isPending),
    isError: list.isError || detail.isError,
  };
}

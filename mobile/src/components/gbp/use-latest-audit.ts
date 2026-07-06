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
} {
  const { activeBusinessId } = useBusiness();

  const list = useQuery({
    queryKey: ['audits', activeBusinessId],
    queryFn: fetchAudits,
    enabled: !!activeBusinessId,
  });

  const latestId = (list.data ?? []).find((a) => a.status === 'COMPLETED')?._id ?? null;

  const detail = useQuery({
    queryKey: ['audit-detail', latestId],
    queryFn: () => fetchAudit(latestId!),
    enabled: !!latestId,
  });

  return {
    audit: detail.data ?? null,
    isLoading: list.isLoading || (!!latestId && detail.isLoading),
  };
}

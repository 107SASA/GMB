import { Suspense } from 'react';
import GrowthReport from '@/components/crm/GrowthReport';

// The report reads ?month= on the client (useSearchParams), so it sits in a
// Suspense boundary per the Next.js guidance for client search params.
export default function GrowthReportPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-on-surface-variant">Loading report…</div>}>
      <GrowthReport />
    </Suspense>
  );
}

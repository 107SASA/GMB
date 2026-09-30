'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { ReportGeneratingAnimation } from '@/components/graphics/ReportGeneratingAnimation';
import { usePublicPlan } from '@/components/billing/useRazorpayCheckout';
import { pickDuration } from '@/components/billing/DurationPicker';
import FreeReportView from '@/components/audit/FreeReportView';

interface AuditDoc {
  _id: string;
  status: string;
  businessName: string;
  location: string;
  website?: string;
  overallScore?: number;
  auditData?: any;
  createdAt: string;
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 95; // ~4.75 minutes — just inside the 5-minute stale-PENDING cleanup (live audits took 74–144s)

export default function FreeReportResultPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <MaterialIcon name="progress_activity" size={40} className="animate-spin text-primary" />
        </div>
      }
    >
      <FreeReportResultContent />
    </Suspense>
  );
}

function FreeReportResultContent() {
  const searchParams = useSearchParams();
  const auditId = searchParams.get('auditId');

  const [audit, setAudit] = useState<AuditDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attempts = useRef(0);

  // Real price for the hero CTA button — same source AuditPaywallSidebar
  // reads, so the two never disagree. Prefers the yearly duration (matches
  // Grexa's "₹X/year · ₹Y/day" framing) when the plan offers one.
  const { plan: heroPlan } = usePublicPlan();
  const heroDuration = pickDuration(heroPlan?.durations, 'yearly');
  const heroPrice = heroDuration?.priceInr ?? heroPlan?.priceInr;
  const heroCycleLabel = heroDuration?.label ?? heroPlan?.billingCycle ?? 'year';
  const heroDailyRate = heroPrice != null && heroDuration?.months
    ? Math.round(heroPrice / (heroDuration.months * 30))
    : null;

  useEffect(() => {
    if (!auditId) {
      setError('Missing report reference.');
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/audit/${auditId}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.success) {
          setError(json.error || 'Could not load your report.');
          return;
        }
        setAudit(json.audit);
        if (json.audit.status === 'COMPLETED' || json.audit.status === 'FAILED') return;

        attempts.current += 1;
        if (attempts.current >= MAX_POLL_ATTEMPTS) {
          setError('This is taking longer than usual. Refresh the page in a minute to check again.');
          return;
        }
        setTimeout(poll, POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) setError('Network error while loading your report.');
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [auditId]);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <MaterialIcon name="cancel" size={56} className="text-error mx-auto mb-4" />
          <h1 className="font-heading text-xl font-bold text-on-surface mb-2">Report unavailable</h1>
          <p className="text-on-surface-variant text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const generating = !audit || audit.status === 'PENDING' || audit.status === 'PROCESSING';

  // No pricing card here on purpose — it only mounts once the report is
  // actually COMPLETED, alongside the report itself, further down.
  if (generating) {
    return <ReportGeneratingAnimation />;
  }

  if (audit!.status === 'FAILED') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <MaterialIcon name="cancel" size={56} className="text-error mx-auto mb-4" />
          <h1 className="font-heading text-xl font-bold text-on-surface mb-2">We couldn't generate this report</h1>
          <p className="text-on-surface-variant text-sm">Please try again from the form.</p>
        </div>
      </div>
    );
  }

  // The report itself lives in FreeReportView so the exact customer-facing
  // markup can also be rendered from a stored audit (tests / QA scripts).
  return (
    <FreeReportView
      audit={audit!}
      pricing={{ heroPrice, heroCycleLabel, heroDailyRate, cycle: heroDuration?.cycle }}
    />
  );
}

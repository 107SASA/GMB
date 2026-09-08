'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useBusiness } from '@/context/BusinessContext';
import { Clock, ChevronRight, CheckCircle2, AlertTriangle, FileText, Loader2 } from 'lucide-react';

export default function AuditDashboardPage() {
  const router = useRouter();
  const { activeBusiness } = useBusiness();
  const [audits, setAudits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Freemium signups get their one report generated FOR them — see autoStart().
  const [autoStarting, setAutoStarting] = useState(false);
  const [autoError, setAutoError] = useState('');
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (activeBusiness) {
      fetchAudits();
    }
  }, [activeBusiness]);

  const fetchAudits = async () => {
    try {
      const res = await fetch('/api/audit');
      const data = await res.json();
      if (Array.isArray(data)) {
        setAudits(data);
        await maybeAutoStart(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Manual audits were removed — a subscribed workspace's reports are
   * generated automatically (first one on subscribe + Google connect, then
   * monthly; see src/lib/auditAutopilot.ts). The ONE exception is a
   * brand-new, unsubscribed workspace: it still gets a single free trial
   * report generated FOR it here so it can see value before paying.
   *
   * Guarded by a ref so React StrictMode's double-effect (and any re-fetch)
   * cannot fire two audits.
   */
  const maybeAutoStart = async (existing: any[]) => {
    if (autoStartedRef.current || existing.length > 0 || !activeBusiness) return;

    let gated = false;
    try {
      const statusRes = await fetch('/api/billing/status');
      const status = await statusRes.json();
      const ws = status?.workspace;
      gated = !!ws && !ws.isActive && !ws.freeAuditUsed;
    } catch {
      return;
    }
    if (!gated) return;

    autoStartedRef.current = true;
    setAutoStarting(true);
    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: (activeBusiness as any)._id }),
      });
      const json = await res.json();
      if (!res.ok || !json.auditId) {
        setAutoError(json.error || 'Could not start your report automatically.');
        setAutoStarting(false);
        return;
      }
      router.push(`/dashboard/audit/${json.auditId}`);
    } catch {
      setAutoError('Could not reach the server to start your report.');
      setAutoStarting(false);
    }
  };

  if (autoStarting) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <Loader2 className="mb-6 h-10 w-10 animate-spin text-primary" />
        <h2 className="text-2xl font-bold tracking-tight text-on-surface">
          Building your free audit report
        </h2>
        <p className="mt-2 max-w-md text-on-surface-variant">
          We&apos;re analysing {activeBusiness?.name}&apos;s Google Business Profile. This
          usually takes a minute or two — you&apos;ll be taken to the report automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-on-surface tracking-tight">AI Audits</h1>
          <p className="text-on-surface-variant mt-1">
            Your Google Business Profile health report is generated automatically — the first once your
            subscription is active and Google is connected, then refreshed every month.
          </p>
        </div>
      </div>

      {autoError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-error-container bg-error-container p-4 text-sm font-medium text-on-error-container"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{autoError} It will retry automatically shortly.</span>
        </div>
      )}

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-on-surface-variant">Loading audits...</div>
        ) : audits.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-16 h-16 bg-primary-fixed text-primary rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-on-surface mb-2">No report yet</h3>
            <p className="text-on-surface-variant mb-6 max-w-md mx-auto">
              {activeBusiness?.name}&apos;s first report will be generated automatically once your
              subscription is active and your Google Business Profile is connected. Nothing to do here —
              we&apos;ll notify you when it&apos;s ready.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {audits.map((audit) => (
              <Link
                href={`/dashboard/audit/${audit._id}`}
                key={audit._id}
                className="block hover:bg-surface/50 transition-colors"
              >
                <div className="p-4 sm:p-6 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-xl flex items-center justify-center border ${
                      audit.status === 'COMPLETED' ? 'bg-secondary-container/40 border-secondary-fixed text-secondary' :
                      audit.status === 'FAILED' ? 'bg-error-container border-error-container text-error' :
                      'bg-primary-fixed border-primary-fixed-dim text-primary'
                    }`}>
                      {audit.status === 'COMPLETED' ? <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6" /> :
                       audit.status === 'FAILED' ? <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6" /> :
                       <Clock className="w-5 h-5 sm:w-6 sm:h-6 animate-pulse" />}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-on-surface text-base sm:text-lg flex flex-wrap items-center gap-2">
                        <span className="truncate">
                          {new Date(audit.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                        {audit.status === 'PENDING' && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary-fixed text-primary shrink-0">Processing...</span>
                        )}
                        {audit.status === 'FAILED' && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-error-container text-on-error-container shrink-0">Failed</span>
                        )}
                      </h4>
                      <p className="text-sm text-on-surface-variant mt-0.5 truncate">{audit.businessName}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 sm:gap-6 shrink-0">
                    {audit.status === 'COMPLETED' && audit.overallScore && (
                      <div className="text-right">
                        <div className="text-[10px] sm:text-sm font-semibold text-on-surface-variant uppercase tracking-wider">Score</div>
                        <div className="text-xl sm:text-2xl font-black text-on-surface">{audit.overallScore}/100</div>
                      </div>
                    )}
                    <ChevronRight className="text-outline w-5 h-5" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

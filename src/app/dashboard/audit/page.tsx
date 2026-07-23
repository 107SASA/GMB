'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useBusiness } from '@/context/BusinessContext';
import { Zap, Clock, ExternalLink, ChevronRight, CheckCircle2, AlertTriangle, FileText, Loader2 } from 'lucide-react';
import AuditForm from '@/components/audit/AuditForm';

export default function AuditDashboardPage() {
  const router = useRouter();
  const { activeBusiness } = useBusiness();
  const [audits, setAudits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewAudit, setShowNewAudit] = useState(false);
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
   * A brand-new (freemium-gated) user should never have to hunt for a "Run
   * Audit" button — the report is the whole point of signing up. If they are
   * gated and have no audits yet, generate the first one automatically and
   * send them straight to the report, where the pricing card sits alongside it.
   *
   * Guarded by a ref so React StrictMode's double-effect (and any re-fetch)
   * cannot fire two audits — the free tier allows exactly one.
   */
  const maybeAutoStart = async (existing: any[]) => {
    if (autoStartedRef.current || existing.length > 0 || !activeBusiness) return;

    // Auto-run the one free audit only for a workspace that is NOT subscribed
    // and has not yet used its free audit (per-workspace gate).
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
        <Loader2 className="mb-6 h-10 w-10 animate-spin text-blue-600" />
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Building your free audit report
        </h2>
        <p className="mt-2 max-w-md text-slate-500">
          We&apos;re analysing {activeBusiness?.name}&apos;s Google Business Profile. This
          usually takes a minute or two — you&apos;ll be taken to the report automatically.
        </p>
      </div>
    );
  }

  if (showNewAudit) {
    return (
      <div className="space-y-6">
        <button 
          onClick={() => setShowNewAudit(false)}
          className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1"
        >
          &larr; Back to Audits
        </button>
        <AuditForm />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">AI Audits</h1>
          <p className="text-slate-500 mt-1">Review AI-generated health reports for your Google Business Profile.</p>
        </div>
        <button
          onClick={() => setShowNewAudit(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow-sm flex items-center gap-2 self-start sm:self-auto"
        >
          <Zap className="w-5 h-5" />
          Run New Audit
        </button>
      </div>

      {autoError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{autoError} You can start it manually with “Run New Audit”.</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500">Loading audits...</div>
        ) : audits.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">No Audits Found</h3>
            <p className="text-slate-500 mb-6 max-w-md mx-auto">You haven't generated any AI audits for {activeBusiness?.name} yet.</p>
            <button
              onClick={() => setShowNewAudit(true)}
              className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-xl font-bold transition-all"
            >
              Generate First Audit
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {audits.map((audit) => (
              <Link 
                href={`/dashboard/audit/${audit._id}`} 
                key={audit._id}
                className="block hover:bg-slate-50/50 transition-colors"
              >
                <div className="p-4 sm:p-6 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-xl flex items-center justify-center border ${
                      audit.status === 'COMPLETED' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' :
                      audit.status === 'FAILED' ? 'bg-red-50 border-red-100 text-red-600' :
                      'bg-blue-50 border-blue-100 text-blue-600'
                    }`}>
                      {audit.status === 'COMPLETED' ? <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6" /> :
                       audit.status === 'FAILED' ? <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6" /> :
                       <Clock className="w-5 h-5 sm:w-6 sm:h-6 animate-pulse" />}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-slate-900 text-base sm:text-lg flex flex-wrap items-center gap-2">
                        <span className="truncate">
                          {new Date(audit.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                        {audit.status === 'PENDING' && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 shrink-0">Processing...</span>
                        )}
                        {audit.status === 'FAILED' && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 shrink-0">Failed</span>
                        )}
                      </h4>
                      <p className="text-sm text-slate-500 mt-0.5 truncate">{audit.businessName}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 sm:gap-6 shrink-0">
                    {audit.status === 'COMPLETED' && audit.overallScore && (
                      <div className="text-right">
                        <div className="text-[10px] sm:text-sm font-semibold text-slate-500 uppercase tracking-wider">Score</div>
                        <div className="text-xl sm:text-2xl font-black text-slate-900">{audit.overallScore}/100</div>
                      </div>
                    )}
                    <ChevronRight className="text-slate-400 w-5 h-5" />
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

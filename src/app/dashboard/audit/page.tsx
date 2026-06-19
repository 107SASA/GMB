'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useBusiness } from '@/context/BusinessContext';
import { Zap, Clock, ExternalLink, ChevronRight, CheckCircle2, AlertTriangle, FileText } from 'lucide-react';
import AuditForm from '@/components/audit/AuditForm';

export default function AuditDashboardPage() {
  const { activeBusiness } = useBusiness();
  const [audits, setAudits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewAudit, setShowNewAudit] = useState(false);

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
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">AI Audits</h1>
          <p className="text-slate-500 mt-1">Review AI-generated health reports for your Google Business Profile.</p>
        </div>
        <button
          onClick={() => setShowNewAudit(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow-sm flex items-center gap-2"
        >
          <Zap className="w-5 h-5" />
          Run New Audit
        </button>
      </div>

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
                <div className="p-6 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${
                      audit.status === 'COMPLETED' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' :
                      audit.status === 'FAILED' ? 'bg-red-50 border-red-100 text-red-600' :
                      'bg-blue-50 border-blue-100 text-blue-600'
                    }`}>
                      {audit.status === 'COMPLETED' ? <CheckCircle2 className="w-6 h-6" /> :
                       audit.status === 'FAILED' ? <AlertTriangle className="w-6 h-6" /> :
                       <Clock className="w-6 h-6 animate-pulse" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                        {new Date(audit.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                        {audit.status === 'PENDING' && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Processing...</span>
                        )}
                        {audit.status === 'FAILED' && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Failed</span>
                        )}
                      </h4>
                      <p className="text-sm text-slate-500 mt-0.5">{audit.businessName}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    {audit.status === 'COMPLETED' && audit.overallScore && (
                      <div className="text-right">
                        <div className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Health Score</div>
                        <div className="text-2xl font-black text-slate-900">{audit.overallScore}/100</div>
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

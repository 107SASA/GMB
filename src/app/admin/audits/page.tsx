import { Zap, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import dbConnect from '@/lib/mongodb';
import Audit from '@/models/Audit';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminAuditsPage() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) redirect('/admin-login');

  await dbConnect();

  const totalAudits = await Audit.countDocuments();
  const completedAudits = await Audit.countDocuments({ status: 'COMPLETED' });
  const failedAudits = await Audit.countDocuments({ status: 'FAILED' });
  
  const recentAudits = await Audit.find().sort({ createdAt: -1 }).limit(20);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-11 h-11 bg-violet-600 rounded-xl flex items-center justify-center shadow-sm">
          <Zap className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Monitor</h1>
          <p className="text-sm text-slate-500">System-wide AI audit execution logs.</p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="text-sm font-semibold text-slate-500 mb-1">Total Audits</div>
          <div className="text-3xl font-black text-slate-900">{totalAudits}</div>
        </div>
        <div className="bg-white rounded-2xl border border-emerald-200 p-6 shadow-sm">
          <div className="text-sm font-semibold text-emerald-600 mb-1">Completed Successfully</div>
          <div className="text-3xl font-black text-slate-900">{completedAudits}</div>
        </div>
        <div className="bg-white rounded-2xl border border-red-200 p-6 shadow-sm">
          <div className="text-sm font-semibold text-red-600 mb-1">Failed Runs</div>
          <div className="text-3xl font-black text-slate-900">{failedAudits}</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
          <div className="col-span-3">Business</div>
          <div className="col-span-2">Date</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Score</div>
          <div className="col-span-3">Error (if any)</div>
        </div>

        <div className="divide-y divide-slate-100">
          {recentAudits.map(audit => (
            <div key={audit._id.toString()} className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-slate-50 transition-colors">
              <div className="col-span-3 font-semibold text-sm text-slate-900">
                {audit.businessName}
              </div>
              <div className="col-span-2 text-sm text-slate-500">
                {new Date(audit.createdAt).toLocaleString()}
              </div>
              <div className="col-span-2">
                {audit.status === 'COMPLETED' ? (
                  <span className="inline-flex items-center gap-1 text-xs font-bold bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full border border-emerald-100">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                  </span>
                ) : audit.status === 'FAILED' ? (
                  <span className="inline-flex items-center gap-1 text-xs font-bold bg-red-50 text-red-700 px-2.5 py-1 rounded-full border border-red-100">
                    <AlertTriangle className="w-3.5 h-3.5" /> Failed
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-bold bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full border border-amber-100">
                    <Clock className="w-3.5 h-3.5 animate-pulse" /> Pending
                  </span>
                )}
              </div>
              <div className="col-span-2 text-sm font-bold text-slate-900">
                {audit.overallScore ? `${audit.overallScore}/100` : '-'}
              </div>
              <div className="col-span-3 text-xs text-red-500 font-mono truncate" title={audit.metadata?.error}>
                {audit.metadata?.error || '-'}
              </div>
            </div>
          ))}
          {recentAudits.length === 0 && (
            <div className="p-12 text-center text-slate-500">
              No audits have been executed yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

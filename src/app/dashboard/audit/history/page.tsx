"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Calendar, Star, TrendingUp, Trash2 } from "lucide-react";

export default function AuditHistoryPage() {
  const [audits, setAudits] = useState<any[]>([]);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("gmb_audits") || "[]");
    setAudits(saved);
  }, []);

  const deleteAudit = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    const updated = audits.filter(a => a.id !== id);
    localStorage.setItem("gmb_audits", JSON.stringify(updated));
    setAudits(updated);
  };

  return (
    <div className="space-y-8 pb-10">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Audit History (Local)</h1>
        <p className="text-slate-500">Manage your locally saved Google Business Profile reports.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {audits.length === 0 ? (
          <div className="bg-white p-20 rounded-[40px] border border-slate-200 shadow-sm text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Calendar className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">No Local Audits Found</h3>
            <p className="text-slate-500 mb-8">Start by running your first AI-powered GMB audit.</p>
            <Link href="/dashboard/audit" className="px-8 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition-all shadow-sm">
              Run First Audit
            </Link>
          </div>
        ) : (
          audits.map((audit) => (
            <Link 
              key={audit.id} 
              href={`/dashboard/audit/${audit.id}`}
              className="bg-white p-6 rounded-3xl border border-slate-200 hover:border-primary hover:shadow-md transition-all flex items-center justify-between group shadow-sm"
            >
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center relative">
                  <div className="text-xl font-bold text-slate-900">{audit.overallScore}</div>
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                    <TrendingUp className="w-2.5 h-2.5 text-white" />
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 group-hover:text-primary transition-colors">{audit.business.name}</h3>
                  <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(audit.createdAt).toLocaleDateString()}</span>
                    <span className="flex items-center gap-1"><Star className="w-3 h-3 text-primary fill-primary" /> {audit.business.rating}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button 
                  onClick={(e) => deleteAudit(audit.id, e)}
                  className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-primary transition-colors" />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

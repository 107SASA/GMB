'use client';

import { Clock } from 'lucide-react';

export default function JobsPage() {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-11 h-11 bg-violet-600 rounded-xl flex items-center justify-center shadow-sm">
          <Clock className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Queues & Jobs</h1>
          <p className="text-sm text-slate-500">Monitor background Inngest queues and scheduled tasks.</p>
        </div>
      </div>
      
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
        <Clock className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-slate-900 mb-2">Jobs Module</h3>
        <p className="text-slate-500">This module is currently under construction. Check back later for updates.</p>
      </div>
    </div>
  );
}

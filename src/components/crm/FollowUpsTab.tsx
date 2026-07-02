import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, CheckCircle2, Clock, User, BellRing, Loader2 } from 'lucide-react';

export default function FollowUpsTab() {
  const [followups, setFollowups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/followups')
      .then(res => res.json())
      .then(data => {
        setFollowups(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="w-8 h-8 text-purple-500 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-xl font-bold text-slate-900 mb-1">Follow-Up Automation</h2>
          <p className="text-sm text-slate-500">Track automated CRM reminders and engagement sequences.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {followups.length === 0 ? (
          <div className="col-span-full p-10 bg-white border border-slate-200 shadow-sm rounded-3xl text-center text-slate-500">
            No follow-ups recorded yet.
          </div>
        ) : (
          followups.map((fu: any) => (
            <div key={fu._id} className="bg-white border border-slate-200 shadow-sm rounded-3xl p-6 hover:bg-slate-50 transition-all">
              <div className="flex items-center justify-between mb-6">
                <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${fu.completed ? 'bg-green-500/20 text-green-400' : 'bg-orange-500/20 text-orange-400'}`}>
                  {fu.completed ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  {fu.completed ? 'Completed' : 'Pending'}
                </div>
                <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold">
                  <BellRing className="w-4 h-4" />
                  {fu.reminderType}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900">{fu.leadId?.name || 'Unknown Lead'}</div>
                    <div className="text-sm text-slate-500">{fu.leadId?.phone || 'No phone'}</div>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-xl p-4 flex flex-col gap-2 border border-slate-100">
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Scheduled For</div>
                  <div className="flex items-center gap-3 text-sm font-medium text-slate-700">
                    <CalendarIcon className="w-4 h-4 text-purple-400" />
                    {format(new Date(fu.scheduledAt), 'PPpp')}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

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
    return <div className="flex h-64 items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-xl font-bold text-on-surface mb-1">Follow-Up Automation</h2>
          <p className="text-sm text-on-surface-variant">Track automated CRM reminders and engagement sequences.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {followups.length === 0 ? (
          <div className="col-span-full p-10 bg-surface-container-lowest border border-outline-variant shadow-sm rounded-xl text-center text-on-surface-variant">
            No follow-ups recorded yet.
          </div>
        ) : (
          followups.map((fu: any) => (
            <div key={fu._id} className="bg-surface-container-lowest border border-outline-variant shadow-sm rounded-xl p-6 hover:bg-surface transition-all">
              <div className="flex items-center justify-between mb-6">
                <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${fu.completed ? 'bg-secondary-container text-secondary' : 'bg-error-container text-error'}`}>
                  {fu.completed ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  {fu.completed ? 'Completed' : 'Pending'}
                </div>
                <div className="flex items-center gap-2 text-on-surface-variant text-xs font-semibold">
                  <BellRing className="w-4 h-4" />
                  {fu.reminderType}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-primary">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-on-surface">{fu.leadId?.name || 'Unknown Lead'}</div>
                    <div className="text-sm text-on-surface-variant">{fu.leadId?.phone || 'No phone'}</div>
                  </div>
                </div>

                <div className="bg-surface rounded-xl p-4 flex flex-col gap-2 border border-outline-variant">
                  <div className="text-[10px] text-outline uppercase font-semibold">Scheduled For</div>
                  <div className="flex items-center gap-3 text-sm font-medium text-on-surface">
                    <CalendarIcon className="w-4 h-4 text-primary" />
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

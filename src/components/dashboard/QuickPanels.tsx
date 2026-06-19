import React from 'react';

interface QuickPanelsProps {
  panels: {
    recentLeads: any[];
    followUps: any[];
    activities: any[];
    calendar: any[];
  };
}

export default function QuickPanels({ panels }: QuickPanelsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      {/* Recent Leads */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-slate-900">Recent Leads</h3>
          <a href="/dashboard/crm" className="text-xs font-bold text-indigo-600 hover:text-indigo-700">View All</a>
        </div>
        <div className="space-y-4">
          {panels.recentLeads.length === 0 ? (
            <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-6 text-center mt-2">
              <p className="text-sm font-medium text-slate-500 mb-2">No leads captured yet.</p>
              <a href="/dashboard/crm" className="text-xs font-bold text-indigo-600 hover:text-indigo-700">Setup Lead Generation &rarr;</a>
            </div>
          ) : null}
          {panels.recentLeads.map((lead: any, i: number) => (
            <div key={i} className="flex items-center justify-between border-b border-slate-50 pb-3 last:border-0 last:pb-0">
              <div>
                <p className="font-bold text-sm text-slate-800">{lead.name}</p>
                <p className="text-xs text-slate-500">{lead.source}</p>
              </div>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                lead.pipelineStage === 'Converted' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
              }`}>{lead.pipelineStage}</span>
            </div>
          ))}
        </div>
      </div>

      {/* AI Activity Feed */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="font-bold text-slate-900 mb-6">AI Activity Feed</h3>
        <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
          {panels.activities.length === 0 ? (
            <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-6 text-center relative z-10 mx-4">
              <p className="text-sm font-medium text-slate-500 mb-2">Quiet day for the AI.</p>
              <p className="text-xs text-slate-400">Activity will appear here when the AI interacts.</p>
            </div>
          ) : null}
          {panels.activities.map((act: any, i: number) => (
            <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active z-10 bg-white">
              <div className="flex items-center justify-center w-5 h-5 rounded-full border border-white bg-slate-100 text-slate-500 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm">
                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span>
              </div>
              <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] px-2 py-1 rounded-lg hover:bg-slate-50 transition-colors">
                <p className="font-medium text-xs text-slate-800 line-clamp-1">{act.content}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{new Date(act.createdAt).toLocaleTimeString([], { hour: '2-digit', minute:'2-digit'})}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Content Calendar Mini */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-slate-900">Upcoming Content</h3>
          <a href="/dashboard/scheduler" className="text-xs font-bold text-indigo-600 hover:text-indigo-700">Calendar</a>
        </div>
        <div className="space-y-3">
          {panels.calendar.length === 0 ? (
            <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-6 text-center mt-2">
              <p className="text-sm font-medium text-slate-500 mb-2">Content buffer is empty!</p>
              <a href="/dashboard/scheduler" className="text-xs font-bold text-indigo-600 hover:text-indigo-700">Generate AI Posts &rarr;</a>
            </div>
          ) : null}
          {panels.calendar.slice(0, 5).map((post: any, i: number) => (
            <div key={i} className="flex gap-3 items-start group">
              <div className="flex flex-col items-center bg-slate-50 rounded-lg p-2 min-w-[3rem] text-center border border-slate-100">
                <span className="text-[10px] font-bold text-slate-500 uppercase">{new Date(post.scheduledAt).toLocaleDateString('en-US', { weekday: 'short' })}</span>
                <span className="text-sm font-bold text-slate-800">{new Date(post.scheduledAt).getDate()}</span>
              </div>
              <div className="flex-1 py-1">
                <p className="text-xs font-medium text-slate-700 line-clamp-2 leading-relaxed">{post.content}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

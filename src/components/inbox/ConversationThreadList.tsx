import React from 'react';

interface ThreadListProps {
  threads: any[];
  activeThreadId: string | null;
  onSelectThread: (thread: any) => void;
}

export default function ConversationThreadList({ threads, activeThreadId, onSelectThread }: ThreadListProps) {
  return (
    <div className="w-80 border-r border-slate-200 bg-white h-full flex flex-col flex-shrink-0">
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <h2 className="font-bold text-slate-800">Inbox</h2>
        <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-1 rounded-full">
          {threads.reduce((acc, t) => acc + (t.unreadCount > 0 ? 1 : 0), 0)} Unread
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No conversations found.</div>
        ) : (
          threads.map(thread => {
            const lead = thread.leadId || {};
            const isActive = activeThreadId === thread._id;
            
            return (
              <div 
                key={thread._id} 
                onClick={() => onSelectThread(thread)}
                className={`p-4 border-b border-slate-100 cursor-pointer transition-colors relative ${isActive ? 'bg-indigo-50 border-indigo-100' : 'hover:bg-slate-50'}`}
              >
                {/* Active Indicator */}
                {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500"></div>}
                
                <div className="flex justify-between items-start mb-1">
                  <div className="flex items-center gap-2">
                    <h4 className={`text-sm ${thread.unreadCount > 0 ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>
                      {lead.name || 'Unknown Lead'}
                    </h4>
                    {thread.aiEnabled && (
                      <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">AI</span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {new Date(thread.lastActivityAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                
                <p className={`text-xs truncate pr-6 ${thread.unreadCount > 0 ? 'text-slate-800 font-medium' : 'text-slate-500'}`}>
                  {thread.lastMessage || 'No messages yet'}
                </p>

                {thread.unreadCount > 0 && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 bg-rose-500 text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-full">
                    {thread.unreadCount}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

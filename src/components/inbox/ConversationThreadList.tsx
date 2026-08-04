import React from 'react';

interface ThreadListProps {
  threads: any[];
  activeThreadId: string | null;
  onSelectThread: (thread: any) => void;
}

export default function ConversationThreadList({ threads, activeThreadId, onSelectThread }: ThreadListProps) {
  return (
    <div className="w-full border-r border-outline-variant bg-surface-container-lowest h-full flex flex-col flex-shrink-0">
      <div className="p-4 border-b border-outline-variant flex justify-between items-center bg-surface">
        <h2 className="font-bold text-on-surface">Inbox</h2>
        <span className="bg-primary-fixed text-primary text-xs font-bold px-2 py-1 rounded-full">
          {threads.reduce((acc, t) => acc + (t.unreadCount > 0 ? 1 : 0), 0)} Unread
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="p-8 text-center text-outline text-sm">No conversations found.</div>
        ) : (
          threads.map(thread => {
            const lead = thread.leadId || {};
            const isActive = activeThreadId === thread._id;
            
            return (
              <div 
                key={thread._id} 
                onClick={() => onSelectThread(thread)}
                className={`p-4 border-b border-outline-variant cursor-pointer transition-colors relative ${isActive ? 'bg-primary-fixed border-primary-fixed-dim' : 'hover:bg-surface'}`}
              >
                {/* Active Indicator */}
                {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary"></div>}
                
                <div className="flex justify-between items-start mb-1">
                  <div className="flex items-center gap-2">
                    <h4 className={`text-sm ${thread.unreadCount > 0 ? 'font-bold text-on-surface' : 'font-medium text-on-surface'}`}>
                      {lead.name || 'Unknown Lead'}
                    </h4>
                    {thread.aiEnabled && (
                      <span className="bg-secondary-container text-on-secondary-container text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">AI</span>
                    )}
                  </div>
                  <span className="text-[10px] text-outline">
                    {new Date(thread.lastActivityAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                
                <p className={`text-xs truncate pr-6 ${thread.unreadCount > 0 ? 'text-on-surface font-medium' : 'text-on-surface-variant'}`}>
                  {thread.lastMessage || 'No messages yet'}
                </p>

                {thread.unreadCount > 0 && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 bg-error text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-full">
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

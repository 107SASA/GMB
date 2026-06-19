'use client';

import React, { useState, useEffect } from 'react';
import ConversationThreadList from '@/components/inbox/ConversationThreadList';
import ChatWindow from '@/components/inbox/ChatWindow';
import PromptEditor from '@/components/inbox/PromptEditor';

export default function InboxDashboard() {
  const [threads, setThreads] = useState<any[]>([]);
  const [activeThread, setActiveThread] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'inbox' | 'config'>('inbox');
  
  // Demo identifiers
  const businessId = '60b9b3b3b3b3b3b3b3b3b3b3';
  const tenantId = 'demo-tenant';

  const fetchThreads = async () => {
    try {
      const res = await fetch(`/api/inbox/threads?businessId=${businessId}`);
      const data = await res.json();
      if (data.success) {
        setThreads(data.threads);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchThreads();
    const interval = setInterval(fetchThreads, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleUpdateThread = (threadId: string, updates: any) => {
    setThreads(prev => prev.map(t => t._id === threadId ? { ...t, ...updates } : t));
    if (activeThread && activeThread._id === threadId) {
      setActiveThread({ ...activeThread, ...updates });
    }
  };

  return (
    <div className="h-[calc(100vh-4rem)] bg-white flex flex-col">
      {/* Top Bar */}
      <div className="h-14 border-b border-slate-200 flex items-center px-6 bg-white shrink-0 justify-between">
        <h1 className="text-xl font-bold text-slate-800">Sales Inbox</h1>
        <div className="flex bg-slate-100 p-1 rounded-lg">
          <button 
            onClick={() => setActiveTab('inbox')}
            className={`px-4 py-1 text-sm font-bold rounded-md transition-all ${activeTab === 'inbox' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Conversations
          </button>
          <button 
            onClick={() => setActiveTab('config')}
            className={`px-4 py-1 text-sm font-bold rounded-md transition-all ${activeTab === 'config' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
          >
            AI Settings
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === 'inbox' ? (
          <div className="flex h-full">
            <ConversationThreadList 
              threads={threads} 
              activeThreadId={activeThread?._id || null} 
              onSelectThread={setActiveThread} 
            />
            <ChatWindow 
              thread={activeThread} 
              businessId={businessId} 
              tenantId={tenantId}
              onUpdateThread={handleUpdateThread}
            />
          </div>
        ) : (
          <div className="p-8 h-full overflow-y-auto bg-slate-50">
            <PromptEditor businessId={businessId} />
          </div>
        )}
      </div>
    </div>
  );
}

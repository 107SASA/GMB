'use client';

import React, { useState, useEffect, useCallback } from 'react';
import ConversationThreadList from '@/components/inbox/ConversationThreadList';
import ChatWindow from '@/components/inbox/ChatWindow';
import PromptEditor from '@/components/inbox/PromptEditor';
import BookingSettingsPanel from '@/components/inbox/BookingSettingsPanel';
import AppointmentsPanel from '@/components/inbox/AppointmentsPanel';
import { useBusiness } from '@/context/BusinessContext';

type Tab = 'inbox' | 'config' | 'booking' | 'appointments';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'inbox', label: 'Conversations' },
  { key: 'config', label: 'AI Settings' },
  { key: 'booking', label: 'Booking Settings' },
  { key: 'appointments', label: 'Appointments' },
];

export default function InboxDashboard() {
  const { activeBusiness } = useBusiness();
  const [threads, setThreads] = useState<any[]>([]);
  const [activeThread, setActiveThread] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<Tab>('inbox');

  const businessId = activeBusiness?._id;
  // tenantId is only used by ChatWindow when composing a manual (human) reply;
  // organizationId doubles as tenantId elsewhere in the app's data model.
  const tenantId = (activeBusiness as any)?.organizationId || businessId;

  const fetchThreads = useCallback(async () => {
    if (!businessId) return;
    try {
      const res = await fetch(`/api/inbox/threads?businessId=${businessId}`);
      const data = await res.json();
      if (data.success) {
        setThreads(data.threads);
      }
    } catch (e) {
      console.error(e);
    }
  }, [businessId]);

  useEffect(() => {
    fetchThreads();
    const interval = setInterval(fetchThreads, 15000);
    return () => clearInterval(interval);
  }, [fetchThreads]);

  const handleUpdateThread = (threadId: string, updates: any) => {
    setThreads(prev => prev.map(t => t._id === threadId ? { ...t, ...updates } : t));
    if (activeThread && activeThread._id === threadId) {
      setActiveThread({ ...activeThread, ...updates });
    }
  };

  return (
    <div className="h-[calc(100vh-4rem)] bg-white flex flex-col">
      {/* Top Bar */}
      <div className="h-14 border-b border-slate-200 flex items-center px-6 bg-white shrink-0 justify-between gap-4 overflow-x-auto">
        <h1 className="text-xl font-bold text-slate-800 shrink-0">WhatsApp AI Agent</h1>
        <div className="flex bg-slate-100 p-1 rounded-lg shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-1 text-sm font-bold rounded-md transition-all whitespace-nowrap ${activeTab === tab.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === 'inbox' && (
          <div className="flex h-full">
            <div className={`
              flex flex-col w-full md:w-80 md:flex-none md:border-r md:border-slate-100
              ${activeThread ? 'hidden md:flex' : 'flex'}
            `}>
              <ConversationThreadList
                threads={threads}
                activeThreadId={activeThread?._id || null}
                onSelectThread={setActiveThread}
              />
            </div>
            <div className={`
              flex-1 flex flex-col overflow-hidden
              ${activeThread ? 'flex' : 'hidden md:flex'}
            `}>
              <ChatWindow
                thread={activeThread}
                businessId={businessId || ''}
                tenantId={tenantId || ''}
                onUpdateThread={handleUpdateThread}
                onBack={() => setActiveThread(null)}
              />
            </div>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="p-4 sm:p-8 h-full overflow-y-auto bg-slate-50">
            <PromptEditor />
          </div>
        )}

        {activeTab === 'booking' && (
          <div className="p-4 sm:p-8 h-full overflow-y-auto bg-slate-50">
            <BookingSettingsPanel />
          </div>
        )}

        {activeTab === 'appointments' && (
          <div className="p-4 sm:p-8 h-full overflow-y-auto bg-slate-50">
            <AppointmentsPanel />
          </div>
        )}
      </div>
    </div>
  );
}

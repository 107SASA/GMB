'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ConversationThreadList from '@/components/inbox/ConversationThreadList';
import ChatWindow from '@/components/inbox/ChatWindow';
import PromptEditor from '@/components/inbox/PromptEditor';
import { useBusiness } from '@/context/BusinessContext';

export default function InboxDashboard() {
  const { activeBusiness, loading } = useBusiness();
  const [threads, setThreads] = useState<any[]>([]);
  const [activeThread, setActiveThread] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'inbox' | 'config'>('inbox');
  const [isLive, setIsLive] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const businessId = activeBusiness?._id ?? '';
  const tenantId = activeBusiness?.organizationId ?? '';

  // Merge updated threads from SSE into local state (newest-first)
  const mergeThreads = useCallback((incoming: any[]) => {
    setThreads(prev => {
      const map = new Map(prev.map(t => [t._id, t]));
      for (const t of incoming) map.set(t._id, t);
      return [...map.values()].sort(
        (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
      );
    });
  }, []);

  // Initial full load
  const fetchThreads = useCallback(async () => {
    try {
      const res  = await fetch('/api/inbox/threads');
      const data = await res.json();
      if (data.success) setThreads(data.threads);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // SSE connection — reconnects automatically when businessId changes
  useEffect(() => {
    if (!businessId) return;

    fetchThreads();

    const connect = () => {
      const es = new EventSource('/api/inbox/sse');
      esRef.current = es;

      es.addEventListener('connected', () => setIsLive(true));
      es.addEventListener('ping', () => {/* heartbeat — no-op */});
      es.addEventListener('threads', (e: MessageEvent) => {
        try {
          const updated = JSON.parse(e.data);
          mergeThreads(updated);
        } catch { /* ignore parse errors */ }
      });

      es.onerror = () => {
        setIsLive(false);
        es.close();
        // Reconnect after a short delay
        setTimeout(connect, 4000);
      };
    };

    connect();

    return () => {
      esRef.current?.close();
      esRef.current = null;
      setIsLive(false);
    };
  }, [businessId, fetchThreads, mergeThreads]);

  const handleUpdateThread = (threadId: string, updates: any) => {
    setThreads(prev => prev.map(t => t._id === threadId ? { ...t, ...updates } : t));
    if (activeThread && activeThread._id === threadId) {
      setActiveThread((prev: any) => ({ ...prev, ...updates }));
    }
  };

  if (loading) {
    return (
      <div className="h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading workspace...</div>
      </div>
    );
  }

  if (!activeBusiness) {
    return (
      <div className="h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="text-slate-400 text-sm">No business found. Please complete onboarding.</div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] bg-white flex flex-col">
      {/* Top Bar */}
      <div className="h-14 border-b border-slate-200 flex items-center px-6 bg-white shrink-0 justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-slate-800">Sales Inbox</h1>
          <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${isLive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
            {isLive ? 'Live' : 'Connecting…'}
          </span>
        </div>
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
            {/* Thread list:
                - Mobile: full-width, hidden when a thread is open
                - Desktop: fixed-width panel, always visible */}
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

            {/* Chat window:
                - Mobile: full-screen, hidden when no thread is selected
                - Desktop: fills remaining space, always visible (shows empty state when no thread) */}
            <div className={`
              flex-1 flex flex-col overflow-hidden
              ${activeThread ? 'flex' : 'hidden md:flex'}
            `}>
              <ChatWindow
                thread={activeThread}
                businessId={businessId}
                tenantId={tenantId}
                onUpdateThread={handleUpdateThread}
                onBack={() => setActiveThread(null)}
              />
            </div>
          </div>
        ) : (
          <div className="p-4 sm:p-8 h-full overflow-y-auto bg-slate-50">
            <PromptEditor />
          </div>
        )}
      </div>
    </div>
  );
}

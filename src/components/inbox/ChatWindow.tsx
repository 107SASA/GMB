import React, { useState, useEffect, useRef } from 'react';

interface ChatWindowProps {
  thread: any;
  businessId: string;
  tenantId: string;
  onUpdateThread: (threadId: string, updates: any) => void;
}

export default function ChatWindow({ thread, businessId, tenantId, onUpdateThread }: ChatWindowProps) {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const fetchMessages = async () => {
    if (!thread) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/inbox/messages?leadId=${thread.leadId._id}`);
      const data = await res.json();
      if (data.success) {
        setMessages(data.messages);
        // Clear unread in parent
        if (thread.unreadCount > 0) {
          onUpdateThread(thread._id, { unreadCount: 0 });
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
    // In a real app, you would use WebSockets or SSE for real-time.
    // For this prototype, we just fetch on load.
    const interval = setInterval(fetchMessages, 10000);
    return () => clearInterval(interval);
  }, [thread?._id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleAI = async () => {
    const newState = !thread.aiEnabled;
    try {
      onUpdateThread(thread._id, { aiEnabled: newState }); // Optimistic
      await fetch(`/api/inbox/threads`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: thread._id, aiEnabled: newState })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !thread) return;

    const tempMsg = {
      _id: Date.now().toString(),
      direction: 'outbound',
      messageText: input,
      isAI: false,
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempMsg]);
    setInput('');

    try {
      const res = await fetch(`/api/inbox/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: thread.leadId._id,
          businessId,
          tenantId,
          phone: thread.leadId.phone,
          text: tempMsg.messageText,
          threadId: thread._id
        })
      });
      const data = await res.json();
      if (data.success) {
        fetchMessages(); // Refresh exact state
        // Parent thread updates AI to off
        onUpdateThread(thread._id, { aiEnabled: false, lastMessage: tempMsg.messageText });
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (!thread) {
    return (
      <div className="flex-1 bg-slate-50 flex items-center justify-center">
        <div className="text-center text-slate-400">
          <svg className="w-16 h-16 mx-auto mb-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
          <p>Select a conversation to start chatting</p>
        </div>
      </div>
    );
  }

  const lead = thread.leadId;

  return (
    <div className="flex-1 flex flex-col bg-white h-full relative">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white z-10 shadow-sm">
        <div>
          <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
            {lead.name}
            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full uppercase tracking-wider">{lead.pipelineStage}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">{lead.phone}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">AI Handling</span>
            <button 
              onClick={toggleAI}
              className={`w-12 h-6 rounded-full relative transition-colors ${thread.aiEnabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${thread.aiEnabled ? 'left-7' : 'left-1'}`}></div>
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
        <div className="space-y-6 flex flex-col">
          {loading && messages.length === 0 ? (
            <div className="text-center text-sm text-slate-400 py-10">Loading conversation...</div>
          ) : messages.length === 0 ? (
            <div className="text-center text-sm text-slate-400 py-10">No messages found.</div>
          ) : (
            messages.map((msg, idx) => {
              const isInbound = msg.direction === 'inbound';
              
              return (
                <div key={msg._id || idx} className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[70%] ${isInbound ? 'bg-white border border-slate-200 text-slate-800' : 'bg-indigo-600 text-white'} rounded-2xl px-4 py-3 shadow-sm relative group`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.messageText}</p>
                    <div className={`text-[10px] mt-1.5 flex items-center gap-1 ${isInbound ? 'text-slate-400' : 'text-indigo-200'}`}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {!isInbound && msg.isAI && <span className="font-bold">· AI</span>}
                      {!isInbound && !msg.isAI && <span className="font-bold">· You</span>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="p-4 bg-white border-t border-slate-100">
        {!thread.aiEnabled && (
          <div className="mb-2 flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Human Takeover Active</span>
          </div>
        )}
        <form onSubmit={handleSend} className="relative">
          <input 
            type="text" 
            placeholder="Type a manual response... (This will pause the AI)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
          />
          <button 
            type="submit" 
            disabled={!input.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
          </button>
        </form>
      </div>
    </div>
  );
}

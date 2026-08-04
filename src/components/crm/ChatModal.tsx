import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, User, Bot, Loader2, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { format } from 'date-fns';

export default function ChatModal({ lead, onClose }: any) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConversations();
  }, [lead._id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversations]);

  async function fetchConversations() {
    try {
      const res = await fetch(`/api/conversations/${lead._id}`);
      const data = await res.json();

      // Filter out duplicate IDs to prevent rendering glitches
      const uniqueMessages = Array.from(new Map(data.map((item: any) => [item._id, item])).values());
      setConversations(uniqueMessages as any[]);
    } catch (error) {
      console.error("Failed to fetch conversations", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const newMessage = {
      _id: Date.now().toString(),
      sender: 'user',
      message: input,
      timestamp: new Date().toISOString(),
      messageType: 'text'
    };

    // Optimistic UI update
    setConversations(prev => [...prev, newMessage]);
    setInput('');
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-surface-container-lowest border border-outline-variant w-full max-w-2xl h-[80vh] rounded-xl flex flex-col overflow-hidden card-shadow"
        >
          {/* Header */}
          <div className="p-6 border-b border-outline-variant flex justify-between items-center bg-surface">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/20 to-primary-fixed flex items-center justify-center text-primary font-bold text-lg border border-primary-fixed-dim">
                {lead.name.substring(0, 2).toUpperCase()}
              </div>
              <div>
                <h2 className="font-bold text-lg text-on-surface">{lead.name}</h2>
                <div className="text-sm text-on-surface-variant">{lead.phone} • {lead.status}</div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-surface-container rounded-full transition-colors"
            >
              <X className="w-5 h-5 text-on-surface-variant" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth bg-gradient-to-b from-transparent to-surface-container-low">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex h-full items-center justify-center text-outline text-sm">
                No conversation history yet.
              </div>
            ) : (
              conversations.map((msg) => {
                const isAI = msg.sender === 'ai';
                const isSystem = msg.sender === 'system';
                const isMedia = msg.messageType === 'media' || msg.message === '[Media Message]';

                return (
                  <div key={msg._id} className={`flex ${isAI || isSystem ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[80%] flex gap-3 ${isAI || isSystem ? 'flex-row' : 'flex-row-reverse'}`}>
                      <div className="flex-shrink-0 mt-auto">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${isAI ? 'bg-primary-fixed border-primary-fixed-dim text-primary' : isSystem ? 'bg-error border-error text-error' : 'bg-surface-container border-outline-variant text-on-surface-variant'}`}>
                          {isSystem ? <AlertCircle className="w-4 h-4" /> : isAI ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                        </div>
                      </div>
                      <div>
                        <div className={`p-4 rounded-2xl text-sm ${isAI ? 'bg-surface-container rounded-bl-sm text-on-surface border border-outline-variant' : isSystem ? 'bg-error text-error rounded-bl-sm border border-error' : 'bg-primary rounded-br-sm text-white shadow-sm'}`}>
                          {isMedia ? (
                            <div className="flex items-center gap-2 italic opacity-80">
                              <ImageIcon className="w-4 h-4" />
                              Media Attachment
                            </div>
                          ) : (
                            msg.message
                          )}
                        </div>
                        <div className={`text-[10px] text-outline mt-2 font-medium ${isAI || isSystem ? 'text-left' : 'text-right'}`}>
                          {format(new Date(msg.timestamp), 'h:mm a')}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-outline-variant bg-surface">
            <form onSubmit={handleSend} className="relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Reply directly (simulated)..."
                className="w-full bg-surface-container-lowest border border-outline-variant rounded-full py-4 pl-6 pr-14 text-sm text-on-surface focus:outline-none focus:border-primary transition-colors placeholder:text-outline shadow-sm"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="absolute right-2 top-2 bottom-2 w-10 bg-primary hover:bg-primary-container disabled:opacity-50 disabled:hover:bg-primary-container text-white rounded-full flex items-center justify-center transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

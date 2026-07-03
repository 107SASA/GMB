import Conversation from '@/models/Conversation';

/**
 * Feature 7 — Chat History Storage.
 *
 * We deliberately do NOT introduce a second chat-history collection.
 * `Conversation` already persists every inbound/outbound WhatsApp message
 * to MongoDB (survives restarts, not memory-only) and already distinguishes
 * sender type via `direction` + `isAI`. This wrapper just adds the
 * `threadId` (= session ID) tag going forward and provides read helpers for
 * the WhatsApp Agent's own features (personalization, summaries, dashboard).
 * Existing callers of `Conversation.create(...)` elsewhere are untouched.
 */

export interface ChatHistoryEntry {
  sender: 'user' | 'ai';
  content: string;
  timestamp: Date;
}

export async function getRecentChatHistory(leadId: string, limit = 20): Promise<ChatHistoryEntry[]> {
  const rows = await Conversation.find({ leadId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();

  return rows
    .reverse()
    .map((r: any) => ({
      sender: r.isAI ? 'ai' : 'user',
      content: r.messageText,
      timestamp: r.timestamp,
    }));
}

export function formatHistoryForPrompt(history: ChatHistoryEntry[]): string {
  return history.map((h) => `${h.sender === 'ai' ? 'Assistant' : 'Customer'}: ${h.content}`).join('\n');
}

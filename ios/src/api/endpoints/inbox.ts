import { z } from 'zod';
import { api } from '../client';

/**
 * WhatsApp inbox — backed by ConversationThread (one per lead) and
 * Conversation (individual messages). Threads are polled; there are no
 * websockets in this backend.
 */

const threadLeadSchema = z.object({
  _id: z.string(),
  name: z.string().catch('Unknown'),
  phone: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  pipelineStage: z.string().nullable().optional(),
  aiLeadScore: z.number().nullable().optional(),
});
export type ThreadLead = z.infer<typeof threadLeadSchema>;

const threadSchema = z.object({
  _id: z.string(),
  // Populated Lead document; null when the lead was deleted.
  leadId: threadLeadSchema.nullable().catch(null),
  unreadCount: z.number().catch(0),
  lastMessage: z.string().nullable().catch(null),
  aiEnabled: z.boolean().catch(true),
  lastActivityAt: z.string().nullable().catch(null),
});
export type ConversationThread = z.infer<typeof threadSchema>;

const threadsResponseSchema = z.object({
  success: z.literal(true),
  threads: z.array(threadSchema.nullable().catch(null)),
});

/** GET /api/inbox/threads — all threads for the active business, newest first. */
export async function fetchThreads(): Promise<ConversationThread[]> {
  const { data } = await api.get('/api/inbox/threads');
  return threadsResponseSchema
    .parse(data)
    .threads.filter((t): t is ConversationThread => t !== null);
}

/** PATCH /api/inbox/threads — flips the per-thread AI agent on/off. */
export async function setThreadAiEnabled(threadId: string, aiEnabled: boolean): Promise<void> {
  await api.patch('/api/inbox/threads', { threadId, aiEnabled });
}

const messageSchema = z.object({
  _id: z.string(),
  direction: z.enum(['inbound', 'outbound']).catch('inbound'),
  messageText: z.string().catch(''),
  isAI: z.boolean().catch(false),
  messageStatus: z.string().catch('received'),
  timestamp: z.string().nullable().catch(null),
});
export type ConversationMessage = z.infer<typeof messageSchema>;

const messagesResponseSchema = z.object({
  success: z.literal(true),
  messages: z.array(messageSchema.nullable().catch(null)),
});

/**
 * GET /api/inbox/messages?leadId= — full history, oldest first. Fetching
 * also clears the thread's unreadCount server-side.
 */
export async function fetchMessages(leadId: string): Promise<ConversationMessage[]> {
  const { data } = await api.get('/api/inbox/messages', { params: { leadId } });
  return messagesResponseSchema
    .parse(data)
    .messages.filter((m): m is ConversationMessage => m !== null);
}

/**
 * POST /api/inbox/messages — sends a manual WhatsApp reply through Twilio.
 * The backend flips the thread's aiEnabled off (human takeover).
 */
export async function sendMessage(params: {
  leadId: string;
  threadId: string;
  phone: string;
  text: string;
}): Promise<void> {
  await api.post('/api/inbox/messages', params);
}

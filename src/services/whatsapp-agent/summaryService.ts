import { Groq } from 'groq-sdk';
import WhatsAppConversationSummary from '@/models/WhatsAppConversationSummary';
import { ChatHistoryEntry, formatHistoryForPrompt } from './chatHistoryService';

export interface StructuredSummary {
  customerName?: string;
  interestedServices: string[];
  preferredTimes: string[];
  importantNotes: string[];
}

async function generateStructuredSummary(
  history: ChatHistoryEntry[],
  previous: StructuredSummary | null,
  fallbackName?: string
): Promise<StructuredSummary> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const prompt = `Summarize this WhatsApp conversation between a business and a customer into structured fields for the business owner's CRM.
${previous ? `Previous summary (merge/update, don't just repeat): ${JSON.stringify(previous)}\n` : ''}
Conversation:
${formatHistoryForPrompt(history)}

Respond with ONLY valid JSON in exactly this shape:
{"customerName": "string or null", "interestedServices": ["string", ...], "preferredTimes": ["string", ...], "importantNotes": ["string", ...]}
Keep each array short (max 5 items), concise, and free of duplicates.`;

  try {
    const resp = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      max_tokens: 300,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(resp.choices[0]?.message?.content || '{}');
    return {
      customerName: parsed.customerName || fallbackName || undefined,
      interestedServices: Array.isArray(parsed.interestedServices) ? parsed.interestedServices.slice(0, 5) : [],
      preferredTimes: Array.isArray(parsed.preferredTimes) ? parsed.preferredTimes.slice(0, 5) : [],
      importantNotes: Array.isArray(parsed.importantNotes) ? parsed.importantNotes.slice(0, 5) : [],
    };
  } catch (e) {
    console.error('[whatsapp-agent] summary generation error:', e);
    return {
      customerName: fallbackName,
      interestedServices: previous?.interestedServices || [],
      preferredTimes: previous?.preferredTimes || [],
      importantNotes: previous?.importantNotes || [],
    };
  }
}

/**
 * Regenerates the conversation summary for a lead and stores it as a NEW
 * version (old summary flips isCurrent=false but is never deleted), per
 * Feature 8's "preserve old summaries" / "auditable" requirement.
 */
export async function refreshConversationSummary(params: {
  tenantId: string;
  businessId: string;
  leadId: string;
  threadId?: string;
  history: ChatHistoryEntry[];
  fallbackName?: string;
}) {
  const { tenantId, businessId, leadId, threadId, history, fallbackName } = params;
  if (history.length === 0) return null;

  const previousDoc = await WhatsAppConversationSummary.findOne({ leadId, isCurrent: true }).sort({ version: -1 });
  const previous: StructuredSummary | null = previousDoc
    ? {
        customerName: previousDoc.customerName,
        interestedServices: previousDoc.interestedServices,
        preferredTimes: previousDoc.preferredTimes,
        importantNotes: previousDoc.importantNotes,
      }
    : null;

  const structured = await generateStructuredSummary(history, previous, fallbackName);

  if (previousDoc) {
    previousDoc.isCurrent = false;
    await previousDoc.save();
  }

  const created = await WhatsAppConversationSummary.create({
    tenantId,
    businessId,
    leadId,
    threadId,
    customerName: structured.customerName,
    interestedServices: structured.interestedServices,
    preferredTimes: structured.preferredTimes,
    importantNotes: structured.importantNotes,
    lastInteractionAt: new Date(),
    version: previousDoc ? previousDoc.version + 1 : 1,
    isCurrent: true,
  });

  return created;
}

export async function getCurrentSummary(leadId: string) {
  return WhatsAppConversationSummary.findOne({ leadId, isCurrent: true }).exec();
}

export async function getSummaryHistory(leadId: string) {
  return WhatsAppConversationSummary.find({ leadId }).sort({ version: -1 }).exec();
}

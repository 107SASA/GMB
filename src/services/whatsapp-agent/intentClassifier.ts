import { Groq } from 'groq-sdk';
import { getBusinessNow } from './dateTimeUtils';

export type AppointmentIntentType = 'book' | 'cancel' | 'reschedule' | 'none';

export interface AppointmentIntent {
  intent: AppointmentIntentType;
  date: string | null; // "YYYY-MM-DD", resolved to an absolute calendar date
  time: string | null; // "HH:mm" 24hr
  service: string | null;
}

export interface ConfirmationResult {
  decision: 'yes' | 'no' | 'unclear';
}

const SIMPLE_YES = /^(yes|yep|yup|yeah|confirm|confirmed|sure|ok|okay|please do|go ahead|correct|right)\b/i;
const SIMPLE_NO = /^(no|nope|nah|don't|do not|cancel that|never ?mind|stop)\b/i;

/** Cheap keyword pass before spending an LLM call — most confirmations are a bare "yes"/"no". */
export function quickConfirmationCheck(message: string): ConfirmationResult['decision'] | null {
  const trimmed = message.trim();
  if (SIMPLE_YES.test(trimmed)) return 'yes';
  if (SIMPLE_NO.test(trimmed)) return 'no';
  return null;
}

/**
 * Classifies a free-text WhatsApp message as a booking / cancellation /
 * reschedule request (or none), extracting date/time/service if present.
 * Relative dates ("tomorrow", "next Friday") are resolved against the
 * business's own local "today", which is passed into the prompt.
 */
export async function classifyAppointmentIntent(
  message: string,
  timezone: string,
  conversationContext?: string
): Promise<AppointmentIntent> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const now = getBusinessNow(timezone);
  const todayStr = `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;
  const weekdayFull = new Date(Date.UTC(now.year, now.month - 1, now.day)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
  });

  const prompt = `You are a strict intent classifier for a business's WhatsApp appointment agent.
Today is ${weekdayFull}, ${todayStr} (business local time).
${conversationContext ? `Recent conversation context:\n${conversationContext}\n` : ''}
Customer's latest message: "${message}"

Classify the customer's intent as exactly one of: "book" (wants to schedule a new appointment), "cancel" (wants to cancel an existing appointment), "reschedule" (wants to move/change an existing appointment), or "none" (anything else — general question, greeting, small talk).

If a specific date is mentioned or implied (e.g. "tomorrow", "next Friday", "Monday"), resolve it to an absolute calendar date using today's date above, and return it as "YYYY-MM-DD". If a time is mentioned, return it in 24-hour "HH:mm" format. If a service/treatment is mentioned, extract it briefly. Use null for anything not mentioned.

Respond with ONLY valid JSON, no other text, in exactly this shape:
{"intent": "book" | "cancel" | "reschedule" | "none", "date": "YYYY-MM-DD" | null, "time": "HH:mm" | null, "service": "string" | null}`;

  try {
    const resp = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      max_tokens: 150,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const raw = resp.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
    const intent: AppointmentIntentType = ['book', 'cancel', 'reschedule', 'none'].includes(parsed.intent)
      ? parsed.intent
      : 'none';
    return {
      intent,
      date: typeof parsed.date === 'string' ? parsed.date : null,
      time: typeof parsed.time === 'string' ? parsed.time : null,
      service: typeof parsed.service === 'string' ? parsed.service : null,
    };
  } catch (e) {
    console.error('[whatsapp-agent] intent classification error:', e);
    return { intent: 'none', date: null, time: null, service: null };
  }
}

/** Falls back to an LLM read only when the quick keyword check is inconclusive. */
export async function classifyConfirmation(message: string): Promise<ConfirmationResult> {
  const quick = quickConfirmationCheck(message);
  if (quick) return { decision: quick };

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  try {
    const resp = await groq.chat.completions.create({
      messages: [
        {
          role: 'user',
          content: `A business's WhatsApp assistant just asked the customer to confirm an action (e.g. "Would you like me to confirm your appointment?"). The customer replied: "${message}"\nIs this a "yes", "no", or "unclear" (e.g. they asked a new question, changed the topic, or gave a new date instead of confirming)? Respond with ONLY valid JSON: {"decision": "yes" | "no" | "unclear"}`,
        },
      ],
      model: 'llama-3.3-70b-versatile',
      max_tokens: 30,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(resp.choices[0]?.message?.content || '{}');
    if (parsed.decision === 'yes' || parsed.decision === 'no') return { decision: parsed.decision };
    return { decision: 'unclear' };
  } catch (e) {
    console.error('[whatsapp-agent] confirmation classification error:', e);
    return { decision: 'unclear' };
  }
}

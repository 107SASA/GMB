import Groq from 'groq-sdk';
import dbConnect from '@/lib/mongodb';
import BookingAgentConfig from '@/models/BookingAgentConfig';
import type { IBookingConversation, IBookingDetails } from '@/models/BookingConversation';
import {
  defaultBookingAgentConfig,
  renderTemplate,
  BOOKING_BRAND_NAME,
  type BookingAgentConfigShape,
} from '@/lib/bookingAgentDefaults';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export function firstName(name?: string): string {
  const n = (name || '').trim().split(/\s+/)[0];
  return n || 'there';
}

/** Loads the singleton booking-agent config, creating defaults once. */
export async function getBookingAgentConfig(): Promise<BookingAgentConfigShape> {
  await dbConnect();
  const existing = (await BookingAgentConfig.findOne({ key: 'default' }).lean()) as any;
  if (existing) {
    return { ...defaultBookingAgentConfig(), ...existing };
  }
  const created = defaultBookingAgentConfig();
  await BookingAgentConfig.create({ key: 'default', ...created });
  return created;
}

const EMPTY_DETAILS: IBookingDetails = {
  name: '', businessName: '', businessType: '', location: '',
  email: '', preferredDate: '', preferredTime: '', notes: '',
};

/**
 * Fixed machine contract wrapped around the (editable) persona. Kept in code so
 * a super-admin editing the persona can never break the JSON the parser needs.
 */
const CONTRACT = `You are conducting a WhatsApp conversation to book a demo for ${BOOKING_BRAND_NAME}.

Respond with a SINGLE JSON object and NOTHING else, in this exact shape:
{
  "reply": "the WhatsApp message to send back to the prospect",
  "status": "collecting" | "ready",
  "details": {
    "name": "", "businessName": "", "businessType": "", "location": "",
    "email": "", "preferredDate": "", "preferredTime": "", "notes": ""
  }
}

Rules:
- Carry forward every detail already known; fill "details" with everything gathered so far (leave unknown fields as "").
- Set "status" to "ready" ONLY when you have, at minimum: name, businessName, a specific preferredDate AND preferredTime. Otherwise "collecting".
- When status is "ready", "reply" MUST clearly confirm the booking and restate the day and time.
- "preferredDate" should be human-readable (e.g. "Tomorrow", "Mon 28 Jul"), "preferredTime" like "3:00 PM".
- Never include text outside the JSON object.`;

export interface BookingReply {
  reply: string;
  ready: boolean;
  details: IBookingDetails;
}

function parseModelJson(raw: string): { reply?: string; status?: string; details?: Partial<IBookingDetails> } | null {
  if (!raw) return null;
  // Strip code fences and grab the outermost {...}.
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function mergeDetails(prev: IBookingDetails, next?: Partial<IBookingDetails>): IBookingDetails {
  const out: IBookingDetails = { ...EMPTY_DETAILS, ...prev };
  if (!next) return out;
  for (const k of Object.keys(EMPTY_DETAILS) as (keyof IBookingDetails)[]) {
    const v = next[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

function hasRequired(d: IBookingDetails): boolean {
  return Boolean(d.name && d.businessName && d.preferredDate && d.preferredTime);
}

/**
 * Composes the agent's next reply from the conversation so far. Returns the
 * message to send, whether the booking is now ready to file, and the merged
 * details collected. The AI both converses and extracts structured fields.
 */
export async function composeAgentReply(
  config: BookingAgentConfigShape,
  convo: Pick<IBookingConversation, 'messages' | 'details' | 'leadName'>
): Promise<BookingReply> {
  const priorDetails = mergeDetails(EMPTY_DETAILS, convo.details as Partial<IBookingDetails>);

  const systemPrompt =
    `${CONTRACT}\n\nPersona and tone to use for "reply":\n${config.agentSystemPrompt}\n\n` +
    `Details known so far (JSON): ${JSON.stringify(priorDetails)}`;

  const history = (convo.messages || [])
    .slice(-12)
    .map((m) => `${m.role === 'lead' ? 'Prospect' : 'You'}: ${m.text}`)
    .join('\n');

  let parsed: ReturnType<typeof parseModelJson> = null;
  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Conversation so far:\n${history}\n\nProduce the next JSON response.` },
      ],
      temperature: 0.6,
      max_tokens: 700,
      response_format: { type: 'json_object' },
    });
    parsed = parseModelJson(res.choices?.[0]?.message?.content?.trim() || '');
  } catch (err: any) {
    console.warn('[bookingAgent] AI reply failed:', err?.message);
  }

  const details = mergeDetails(priorDetails, parsed?.details);
  const ready = parsed?.status === 'ready' && hasRequired(details);

  let reply = (parsed?.reply || '').trim();
  if (!reply) {
    // Graceful fallback if the model/JSON failed.
    reply = ready
      ? renderTemplate(config.confirmationMessage, {
          name: firstName(details.name),
          business: details.businessName || 'your business',
          date: details.preferredDate,
          time: details.preferredTime,
        })
      : `Thanks! To book your ${BOOKING_BRAND_NAME} demo, could you share your name, your business, and a day & time that suit you? 🙂`;
  }

  return { reply, ready, details };
}

/** Renders the configured confirmation message for a completed booking. */
export function renderConfirmation(config: BookingAgentConfigShape, details: IBookingDetails): string {
  return renderTemplate(config.confirmationMessage, {
    name: firstName(details.name),
    business: details.businessName || 'your business',
    date: details.preferredDate,
    time: details.preferredTime,
  });
}

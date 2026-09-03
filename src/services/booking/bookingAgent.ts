import Groq from 'groq-sdk';
import dbConnect from '@/lib/mongodb';
import { GROQ_MODEL } from '@/lib/aiModel';
import BookingAgentConfig from '@/models/BookingAgentConfig';
import type { IBookingConversation, IBookingDetails, IOfferedSlot } from '@/models/BookingConversation';
import {
  defaultBookingAgentConfig,
  renderTemplate,
  BOOKING_BRAND_NAME,
  type BookingAgentConfigShape,
} from '@/lib/bookingAgentDefaults';
import { AGENT_SCOPE_GUARDRAIL } from '@/lib/agentGuardrails';
import { getBusinessNow, friendlyDateLabel, friendlyTimeLabel } from '@/services/whatsapp-agent/dateTimeUtils';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// GrowwMatics itself operates on IST — same default every other platform-side
// cron/agent in this codebase uses (see Business.ts's timezone default,
// businessHours.ts). Prospects booking a demo have no business record of
// their own yet, so there's no per-lead timezone to read instead.
const PLATFORM_TIMEZONE = 'Asia/Kolkata';

const WEEKDAY_FULL: Record<string, string> = {
  Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday',
  Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday',
};

/** "Thursday, 21 Aug 2026, 11:42 PM IST" — grounds the model in the actual current moment. */
function currentTimeLine(): string {
  const now = getBusinessNow(PLATFORM_TIMEZONE);
  const weekday = WEEKDAY_FULL[now.weekday];
  const month = new Date(Date.UTC(now.year, now.month - 1, now.day))
    .toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });
  const h24 = now.hour;
  const period = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  const time = `${h12}:${String(now.minute).padStart(2, '0')} ${period}`;
  return `${weekday}, ${now.day} ${month} ${now.year}, ${time} IST.`;
}

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
 * Fixed machine contract wrapped around the (editable) persona. Kept in code
 * so a super-admin editing the persona can never break the JSON the parser
 * needs.
 *
 * Phase 6 change: the LLM no longer collects/confirms a specific date/time
 * at all — that used to be freeform-text "preferredDate"/"preferredTime"
 * fields it extracted from conversation, which is exactly the fabrication
 * risk this task's context flags (no calendar existed before this phase, so
 * there was nothing real to check a proposed time against). Once it has
 * name + businessName, status goes to "ready_for_slots" and the CODE takes
 * over with real getAvailableSlots() options — see composeAgentReply's
 * caller in services/inngest/functions.ts for how that handoff works.
 */
const CONTRACT = `You are conducting a WhatsApp conversation to book a demo for ${BOOKING_BRAND_NAME}.

Respond with a SINGLE JSON object and NOTHING else, in this exact shape:
{
  "reply": "the WhatsApp message to send back to the prospect",
  "status": "collecting" | "ready_for_slots",
  "details": {
    "name": "", "businessName": "", "businessType": "", "location": "",
    "email": "", "notes": ""
  }
}

Rules:
- Carry forward every detail already known; fill "details" with everything gathered so far (leave unknown fields as "").
- Set "status" to "ready_for_slots" ONLY when you have, at minimum: name and businessName. Otherwise "collecting".
- You do NOT ask for or confirm a specific date/time yourself — a separate step will offer real available slots once status is "ready_for_slots". If the prospect brings up timing, acknowledge it warmly but say you'll share real available times in a moment; never state or imply a specific day/time yourself.
- When status is "ready_for_slots", "reply" should be a short transition line (e.g. "Great, let me pull up some times for you!") — the actual slot options are appended separately, not by you.
- Never include text outside the JSON object.`;

export interface BookingReply {
  reply: string;
  readyForSlots: boolean;
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

function hasRequiredForSlots(d: IBookingDetails): boolean {
  return Boolean(d.name && d.businessName);
}

/**
 * Composes the agent's next reply from the conversation so far. Returns the
 * message to send, whether enough details are collected to move to real
 * slot-offering, and the merged details collected. The AI both converses
 * and extracts structured fields — it never picks a date/time itself (see
 * CONTRACT's doc comment).
 */
export async function composeAgentReply(
  config: BookingAgentConfigShape,
  convo: Pick<IBookingConversation, 'messages' | 'details' | 'leadName'>
): Promise<BookingReply> {
  const priorDetails = mergeDetails(EMPTY_DETAILS, convo.details as Partial<IBookingDetails>);

  const systemPrompt =
    `${AGENT_SCOPE_GUARDRAIL}\n(Apply the rules above through the "reply" field's text — never break the JSON-only output format required below.)\n\n` +
    `${CONTRACT}\n\nCurrent date/time: ${currentTimeLine()}\n\n` +
    `Persona and tone to use for "reply":\n${config.agentSystemPrompt}\n\n` +
    `Details known so far (JSON): ${JSON.stringify(priorDetails)}`;

  const history = (convo.messages || [])
    .slice(-12)
    .map((m) => `${m.role === 'lead' ? 'Prospect' : 'You'}: ${m.text}`)
    .join('\n');

  let parsed: ReturnType<typeof parseModelJson> = null;
  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
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
  const readyForSlots = parsed?.status === 'ready_for_slots' && hasRequiredForSlots(details);

  let reply = (parsed?.reply || '').trim();
  if (!reply) {
    // Graceful fallback if the model/JSON failed.
    reply = readyForSlots
      ? `Great, let me pull up some available times for you!`
      : `Thanks! To book your ${BOOKING_BRAND_NAME} demo, could you share your name and your business name? 🙂`;
  }

  return { reply, readyForSlots, details };
}

/** Renders the configured confirmation message for a completed booking, including the real Meet link. */
export function renderConfirmation(
  config: BookingAgentConfigShape,
  details: IBookingDetails,
  slot: { date: string; time: string },
  meetingLink: string
): string {
  return renderTemplate(config.confirmationMessage, {
    name: firstName(details.name),
    business: details.businessName || 'your business',
    date: friendlyDateLabel(slot.date),
    time: friendlyTimeLabel(slot.time),
  }) + `\n\nJoin here: ${meetingLink}`;
}

/** Formats a numbered list of real available slots for a WhatsApp message. */
export function formatOfferedSlots(slots: IOfferedSlot[]): string {
  return slots
    .map((s, i) => `${i + 1}) ${friendlyDateLabel(s.date)} at ${friendlyTimeLabel(s.time)}`)
    .join('\n');
}

/**
 * Deterministic slot-pick parser — NOT an LLM call. Matches the lead's
 * reply against the slots actually offered (snapshotted onto the
 * conversation when they were presented), either by number ("2", "option
 * 2") or a loose text match against the slot's own date/time labels. This
 * is the mechanism that makes "present real options instead of accepting
 * freeform text" actually true: the lead can only ever select a slot that
 * getAvailableSlots() confirmed is real, never one the model invents.
 * Returns null if the reply doesn't clearly match any offered slot.
 */
export function pickSlotFromReply(reply: string, offeredSlots: IOfferedSlot[]): IOfferedSlot | null {
  const text = (reply || '').trim().toLowerCase();
  if (!text || !offeredSlots.length) return null;

  const numberMatch = text.match(/\b(\d+)\b/);
  if (numberMatch) {
    const idx = parseInt(numberMatch[1], 10) - 1;
    if (idx >= 0 && idx < offeredSlots.length) return offeredSlots[idx];
  }

  for (const slot of offeredSlots) {
    const dateLabel = friendlyDateLabel(slot.date).toLowerCase();
    const timeLabel = friendlyTimeLabel(slot.time).toLowerCase();
    const dayNameOnly = dateLabel.split(',')[0]; // e.g. "monday"
    if (text.includes(timeLabel) || (text.includes(dayNameOnly) && text.includes(timeLabel.split(' ')[0]))) {
      return slot;
    }
  }
  return null;
}

// Keyword signals for the reschedule/cancel branches (task item 3) —
// deterministic, same reasoning as BOOKING_HANDOFF_RE in the webhook route:
// instant, free, and never at risk of an LLM inventing a reschedule the
// lead didn't actually ask for.
const RESCHEDULE_RE = /\b(resched|change.*(time|date)|move.*(demo|meeting|call)|different time|another time)\b/i;
const CANCEL_RE = /\b(cancel|can'?t make it|won'?t be able to|no longer (need|want))\b/i;

export type BookedReplyIntent = 'none' | 'reschedule' | 'cancel';

/** Classifies a message from a lead with an already-BOOKED demo — deterministic keyword match, not an LLM call, matching this codebase's established pattern for handoff-triggering keywords. */
export function classifyBookedReplyIntent(text: string): BookedReplyIntent {
  if (CANCEL_RE.test(text)) return 'cancel';
  if (RESCHEDULE_RE.test(text)) return 'reschedule';
  return 'none';
}

import { NextResponse } from 'next/server';
import { validateTwilioSignature } from '@/lib/twilioSignature';
import { twilioAdapter } from '@/services/telephony/normalize';
import { businessForCalledNumber, recordCallEvent } from '@/services/crm/calls';

// Twilio calls this endpoint when someone calls the business's tracking number
// (the call URL fires with CallStatus 'ringing'; the status callback — set it
// to this same URL — fires on answered / completed / no-answer / busy).
// In Twilio Console → Phone Numbers → your number → Voice Configuration →
// set "A call comes in" webhook (and the status callback) to:
// https://your-domain.com/api/twilio/voice
//
// Customer CRM: the call is normalized by the telephony adapter and recorded
// as a CallEvent for the business that owns the called number. A caller who
// is already a lead is linked (timeline entry, no duplicate). An unknown
// caller is NOT auto-created as a lead — the owner is asked to Save as Lead /
// link to an Existing Lead / Dismiss. Nothing is ever sent to the caller.
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twiml = () => new NextResponse(EMPTY_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } });

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const form: Record<string, string> = {};
    formData.forEach((v, k) => { if (typeof v === 'string') form[k] = v; });

    const event = twilioAdapter.normalize(form);
    if (!event) return twiml();

    const business = await businessForCalledNumber(event.businessNumber);
    if (!business) {
      console.error(`[voice-webhook] No business found for called number: ${event.businessNumber}`);
      return twiml();
    }

    const verification = await validateTwilioSignature(req, formData, (business.integrations as any)?.twilioAuthToken);
    if (!verification.ok) return verification.response;

    const { callEvent, matchedLeadId } = await recordCallEvent(business, event);
    console.log(`[voice-webhook] ${event.kind} ${event.callId} | business: ${business._id} | lead: ${matchedLeadId ?? 'not saved'} | state: ${callEvent?.leadState}`);

    // Empty TwiML — Twilio follows its own call-handling rules.
    return twiml();
  } catch (error) {
    console.error('[voice-webhook] Error:', error);
    return twiml();
  }
}

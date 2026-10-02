/**
 * Telephony provider abstraction — pure (runs under `node --test`).
 *
 * Every provider's webhook is converted to ONE normalized call event; the
 * CRM (services/crm/calls.ts) only ever sees this shape, so adding a provider
 * means adding one adapter here — not touching the CRM.
 *
 *   incoming_call | outgoing_call | call_answered | call_missed | call_ended
 *
 * Recording URLs are passed through only when the provider sent one and the
 * business has explicitly enabled recordings (not enabled anywhere today).
 */

export type CallEventKind = 'incoming_call' | 'outgoing_call' | 'call_answered' | 'call_missed' | 'call_ended';

export interface NormalizedCallEvent {
  provider: string;
  kind: CallEventKind;
  callId: string;
  direction: 'inbound' | 'outbound';
  /** The other party's number (caller for inbound, callee for outbound). */
  phone: string;
  /** The business's number that was called / used. */
  businessNumber: string;
  callerName: string | null;
  at: Date;
  durationSec: number | null;
  recordingUrl: string | null;
}

export interface TelephonyAdapter {
  provider: string;
  /** null = not a call event we act on. */
  normalize(form: Record<string, string | null | undefined>, now?: Date): NormalizedCallEvent | null;
}

/**
 * Twilio Voice webhooks — the call URL (CallStatus 'ringing') and the status
 * callback (CallStatus completed / no-answer / busy / failed / canceled /
 * in-progress), both POSTed to /api/twilio/voice.
 */
export const twilioAdapter: TelephonyAdapter = {
  provider: 'twilio',
  normalize(f, now = new Date()) {
    const callId = String(f.CallSid || '').trim();
    if (!callId) return null;
    const outbound = String(f.Direction || '').startsWith('outbound');
    const phone = String((outbound ? f.To : f.From) || '').trim();
    const businessNumber = String((outbound ? f.From : f.To) || '').trim();
    if (!phone) return null;
    const status = String(f.CallStatus || 'ringing').toLowerCase();
    const duration = f.CallDuration != null && f.CallDuration !== '' ? Number(f.CallDuration) : null;
    let kind: CallEventKind;
    if (status === 'ringing' || status === 'queued' || status === 'initiated') kind = outbound ? 'outgoing_call' : 'incoming_call';
    else if (status === 'in-progress' || status === 'answered') kind = 'call_answered';
    else if (status === 'no-answer' || status === 'busy' || status === 'failed' || status === 'canceled') kind = 'call_missed';
    else if (status === 'completed') kind = duration === 0 ? 'call_missed' : 'call_ended';
    else return null;
    return {
      provider: 'twilio',
      kind,
      callId,
      direction: outbound ? 'outbound' : 'inbound',
      phone,
      businessNumber,
      callerName: String(f.CallerName || '').trim() || null,
      at: now,
      durationSec: duration != null && Number.isFinite(duration) ? duration : null,
      recordingUrl: null,
    };
  },
};

export const TELEPHONY_ADAPTERS: Record<string, TelephonyAdapter> = { twilio: twilioAdapter };

/** CallEvent.outcome after applying an event (never downgrades a finished call). */
export function nextOutcome(current: string | null | undefined, kind: CallEventKind): 'ringing' | 'answered' | 'missed' | 'ended' {
  if (kind === 'call_missed') return current === 'answered' || current === 'ended' ? (current as any) : 'missed';
  if (kind === 'call_ended') return current === 'missed' ? 'missed' : 'ended';
  if (kind === 'call_answered') return current === 'ended' || current === 'missed' ? (current as any) : 'answered';
  return (current as any) || 'ringing';
}

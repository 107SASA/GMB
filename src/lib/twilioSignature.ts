import { NextResponse } from 'next/server';
import twilio from 'twilio';

/** Checks Twilio's signature; a rejected one is recorded in the security log. */
export async function validateTwilioSignature(
  req: Request,
  formData: FormData,
  authToken?: string
): ReturnType<typeof checkTwilioSignature> {
  const result = await checkTwilioSignature(req, formData, authToken);
  if (!result.ok) {
    const { logSecurityEvent } = await import('@/services/security/securityLog');
    await logSecurityEvent(req, { type: 'webhook.signature_invalid', outcome: 'blocked', status: result.response.status, detail: 'Twilio', metadata: { provider: 'twilio' } });
  }
  return result;
}

async function checkTwilioSignature(
  req: Request,
  formData: FormData,
  authToken?: string
): Promise<
  // signatureChecked is false only on the development skip below — callers
  // that treat the sender as proven (phone verification) must require true.
  { ok: true; signatureChecked: boolean } | { ok: false; response: NextResponse }
> {
  const token = authToken || process.env.TWILIO_AUTH_TOKEN;

  if (!token) {
    if (process.env.NODE_ENV === 'production') {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Twilio auth token not configured' }, { status: 403 }),
      };
    }
    console.warn('[twilio] TWILIO_AUTH_TOKEN not set — skipping signature validation in development');
    return { ok: true, signatureChecked: false };
  }

  const signature = req.headers.get('x-twilio-signature');
  if (!signature) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Missing Twilio signature' }, { status: 403 }),
    };
  }

  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = value.toString();
  });

  // Twilio signs the PUBLIC URL it called (https://growwmatics.com/...).
  // Behind the nginx reverse proxy, req.url reflects whatever nginx forwards
  // internally (typically plain http:// on localhost/127.0.0.1) — comparing
  // the signature against that reconstructs a different URL than the one
  // Twilio signed, so validateRequest() always fails here even with a
  // correct auth token. Rebuild the original public URL from the
  // X-Forwarded-* headers nginx sets, falling back to https/env if absent.
  const forwardedProto = req.headers.get('x-forwarded-proto');
  const forwardedHost = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const parsed = new URL(req.url);
  const proto = forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : parsed.protocol.replace(':', ''));
  const host = forwardedHost || parsed.host;
  const publicUrl = `${proto}://${host}${parsed.pathname}${parsed.search}`;

  const isValid = twilio.validateRequest(token, signature, publicUrl, params);
  if (!isValid) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid Twilio signature' }, { status: 403 }),
    };
  }

  return { ok: true, signatureChecked: true };
}

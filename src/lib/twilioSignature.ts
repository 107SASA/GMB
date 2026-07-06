import { NextResponse } from 'next/server';
import twilio from 'twilio';

export async function validateTwilioSignature(
  req: Request,
  formData: FormData,
  authToken?: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const token = authToken || process.env.TWILIO_AUTH_TOKEN;

  if (!token) {
    if (process.env.NODE_ENV === 'production') {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Twilio auth token not configured' }, { status: 403 }),
      };
    }
    console.warn('[twilio] TWILIO_AUTH_TOKEN not set — skipping signature validation in development');
    return { ok: true };
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

  const isValid = twilio.validateRequest(token, signature, req.url, params);
  if (!isValid) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid Twilio signature' }, { status: 403 }),
    };
  }

  return { ok: true };
}

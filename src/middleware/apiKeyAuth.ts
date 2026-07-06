import { NextResponse } from 'next/server';
import crypto from 'crypto';

export function validateApiKey(
  req: Request
): { ok: true } | { ok: false; response: NextResponse } {
  const apiKey = req.headers.get('x-api-key');
  const expected = process.env.AUTOMATION_API_KEY;

  if (!expected) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'AUTOMATION_API_KEY is not configured on this server' },
        { status: 500 }
      ),
    };
  }

  const apiKeyBuffer = Buffer.from(apiKey ?? '');
  const expectedBuffer = Buffer.from(expected);
  const isValid =
    apiKeyBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(apiKeyBuffer, expectedBuffer);

  if (!apiKey || !isValid) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Unauthorized: Invalid or missing x-api-key header' },
        { status: 401 }
      ),
    };
  }

  return { ok: true };
}

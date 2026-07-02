import { NextResponse } from 'next/server';

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

  if (!apiKey || apiKey !== expected) {
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

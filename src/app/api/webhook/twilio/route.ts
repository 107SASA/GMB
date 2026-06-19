import { NextResponse } from 'next/server';
import { inngest } from '@/services/inngest/client';

export const maxDuration = 60; // Webhook handler should be fast, but we'll leave it at 60s
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const body = formData.get('Body')?.toString() || '';
    const from = formData.get('From')?.toString() || '';
    const profileName = formData.get('ProfileName')?.toString() || '';
    const messageSid = formData.get('MessageSid')?.toString() || '';
    const numMedia = parseInt(formData.get('NumMedia')?.toString() || '0', 10);

    // 1. Immediately acknowledge Twilio with an empty TwiML response
    // This prevents Twilio's 15s timeout
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`;

    // 2. Dispatch to Inngest for background processing
    await inngest.send({
      name: 'whatsapp/incoming',
      data: {
        messageSid,
        from,
        body,
        profileName,
        numMedia,
      },
    });

    return new NextResponse(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('Webhook error:', error);
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`;
    return new NextResponse(fallbackTwiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}

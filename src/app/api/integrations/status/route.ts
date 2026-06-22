import { NextResponse } from 'next/server';
import { requireClient } from '@/lib/auth';

export async function GET() {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    serpapi: !!process.env.SERPAPI_KEY,
    twilio: !!process.env.TWILIO_ACCOUNT_SID,
    groq: !!process.env.GROQ_API_KEY,
    googlePlaces: !!process.env.GOOGLE_MAPS_API_KEY,
  });
}

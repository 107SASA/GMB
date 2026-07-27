import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import BookingAgentConfig from '@/models/BookingAgentConfig';
import { getBookingAgentConfig } from '@/services/booking/bookingAgent';
import { BOOKING_TEMPLATE_VARS } from '@/lib/bookingAgentDefaults';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const config = await getBookingAgentConfig();
  return NextResponse.json({ success: true, config, variables: BOOKING_TEMPLATE_VARS });
}

const configSchema = z.object({
  enabled: z.boolean(),
  agentSystemPrompt: z.string().default(''),
  confirmationMessage: z.string().default(''),
});

export async function PUT(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = configSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid config', details: parsed.error.issues },
      { status: 400 }
    );
  }

  await dbConnect();
  await BookingAgentConfig.findOneAndUpdate(
    { key: 'default' },
    { $set: { key: 'default', ...parsed.data } },
    { upsert: true, setDefaultsOnInsert: true }
  );

  return NextResponse.json({ success: true });
}

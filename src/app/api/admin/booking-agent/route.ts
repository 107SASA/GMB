import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import BookingAgentConfig from '@/models/BookingAgentConfig';
import { getBookingAgentConfig } from '@/services/booking/bookingAgent';
import { BOOKING_TEMPLATE_VARS } from '@/lib/bookingAgentDefaults';
import { validateDemoSchedule, defaultDemoSchedule } from '@/services/calendar/demoScheduling';

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
  automatedBookingEnabled: z.boolean().optional(),
  demoDurationMinutes: z.number().int().min(15).max(180).optional(),
  timezone: z.string().optional(),
  openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  workingDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  minAdvanceMinutes: z.number().int().min(0).max(7 * 24 * 60).optional(),
  maxDaysAhead: z.number().int().min(1).max(60).optional(),
  bufferMinutes: z.number().int().min(0).max(120).optional(),
  assignmentStrategy: z.enum(['first-available', 'round-robin']).optional(),
  reminderLeadMinutes: z.array(z.number().int().min(5).max(7 * 24 * 60)).max(5).optional(),
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

  const schedule = { ...defaultDemoSchedule(), ...parsed.data };
  const invalid = validateDemoSchedule({
    automatedBookingEnabled: schedule.automatedBookingEnabled,
    demoDurationMinutes: schedule.demoDurationMinutes,
    timezone: schedule.timezone,
    openingTime: schedule.openingTime,
    closingTime: schedule.closingTime,
    workingDays: schedule.workingDays,
    minAdvanceMinutes: schedule.minAdvanceMinutes,
    maxDaysAhead: schedule.maxDaysAhead,
    bufferMinutes: schedule.bufferMinutes,
    assignmentStrategy: schedule.assignmentStrategy,
    reminderLeadMinutes: schedule.reminderLeadMinutes,
  });
  if (invalid) {
    return NextResponse.json({ success: false, error: invalid }, { status: 400 });
  }

  await dbConnect();
  await BookingAgentConfig.findOneAndUpdate(
    { key: 'default' },
    { $set: { key: 'default', ...parsed.data } },
    { upsert: true, setDefaultsOnInsert: true }
  );

  return NextResponse.json({ success: true });
}

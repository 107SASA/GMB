import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { resolveWorkingHoursConfig } from '@/services/whatsapp-agent/businessHours';
import { isValidTimeString } from '@/services/whatsapp-agent/dateTimeUtils';

/**
 * ADDITIVE — new endpoint scoped entirely to the WhatsApp AI Agent booking
 * config. Reads/writes ONLY the new `whatsappBookingSettings` sub-object on
 * Business; no other field is touched.
 */

export async function GET(req: Request) {
  try {
    // WhatsApp AI Agent is a Super Admin–exclusive feature.
    const authCheck = await requireSuperAdmin();
    if (!authCheck.ok) return authCheck.response;

    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();
    const business = await Business.findById(ctx.businessId).select('whatsappBookingSettings').lean();
    const settings = resolveWorkingHoursConfig((business as any)?.whatsappBookingSettings);

    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    console.error('[whatsapp/business-hours][GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load business hours' }, { status: 500 });
  }
}

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

export async function PUT(req: Request) {
  try {
    // WhatsApp AI Agent is a Super Admin–exclusive feature.
    const authCheck = await requireSuperAdmin();
    if (!authCheck.ok) return authCheck.response;

    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const body = await req.json();

    if (body.openingTime !== undefined && !isValidTimeString(body.openingTime)) {
      return NextResponse.json({ success: false, error: 'openingTime must be in "HH:mm" 24-hour format' }, { status: 400 });
    }
    if (body.closingTime !== undefined && !isValidTimeString(body.closingTime)) {
      return NextResponse.json({ success: false, error: 'closingTime must be in "HH:mm" 24-hour format' }, { status: 400 });
    }
    if (
      body.openingTime !== undefined &&
      body.closingTime !== undefined &&
      body.openingTime >= body.closingTime
    ) {
      return NextResponse.json({ success: false, error: 'openingTime must be before closingTime' }, { status: 400 });
    }
    if (body.workingDays !== undefined) {
      if (typeof body.workingDays !== 'object' || Array.isArray(body.workingDays)) {
        return NextResponse.json({ success: false, error: 'workingDays must be an object of day -> boolean' }, { status: 400 });
      }
      for (const key of Object.keys(body.workingDays)) {
        if (!DAY_KEYS.includes(key as any)) {
          return NextResponse.json({ success: false, error: `Unknown working day key: ${key}` }, { status: 400 });
        }
      }
    }
    if (body.slotDurationMinutes !== undefined) {
      const n = Number(body.slotDurationMinutes);
      if (!Number.isFinite(n) || n < 5 || n > 240) {
        return NextResponse.json({ success: false, error: 'slotDurationMinutes must be between 5 and 240' }, { status: 400 });
      }
    }

    await dbConnect();
    const business = await Business.findById(ctx.businessId);
    if (!business) return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });

    const current = resolveWorkingHoursConfig(business.whatsappBookingSettings);
    const updated = {
      bookingEnabled: body.bookingEnabled !== undefined ? !!body.bookingEnabled : current.bookingEnabled,
      timezone: body.timezone || current.timezone,
      workingDays: { ...current.workingDays, ...(body.workingDays || {}) },
      openingTime: body.openingTime || current.openingTime,
      closingTime: body.closingTime || current.closingTime,
      slotDurationMinutes: body.slotDurationMinutes ? Number(body.slotDurationMinutes) : current.slotDurationMinutes,
    };

    business.whatsappBookingSettings = updated as any;
    await business.save();

    return NextResponse.json({ success: true, settings: updated });
  } catch (error: any) {
    console.error('[whatsapp/business-hours][PUT]', error);
    return NextResponse.json({ success: false, error: 'Failed to update business hours' }, { status: 500 });
  }
}

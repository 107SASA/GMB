import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/tenant';
import { fetchLocationProfile, updateLocationProfile, GBPAuthError } from '@/lib/gbpClient';
import { gbpWritesEnabled } from '@/lib/gbpSafety';

export const dynamic = 'force-dynamic';

/**
 * Live Google Business Profile for the active workspace.
 *  GET   -> fetch the live profile (name, description, phone, website, …).
 *  PATCH -> edit it. Edits are always saved to our Business doc; the write to
 *           Google only happens when GBP_LIVE_WRITES_ENABLED is on (until the
 *           app is verified for the business.manage write scope).
 */

export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  if (!ctx.business.googleConnected) {
    return NextResponse.json({ success: false, connected: false, error: 'Google Business Profile is not connected.' });
  }

  try {
    const profile = await fetchLocationProfile(ctx.businessId);
    return NextResponse.json({ success: true, connected: true, liveWritesEnabled: gbpWritesEnabled(), profile });
  } catch (err: any) {
    if (err instanceof GBPAuthError) {
      return NextResponse.json({ success: false, connected: false, error: 'Google connection expired — please reconnect.' });
    }
    return NextResponse.json({ success: false, connected: true, error: err.message || 'Failed to load profile' }, { status: 500 });
  }
}

const patchSchema = z.object({
  title: z.string().trim().min(1, 'Business name cannot be empty.').optional(),
  description: z.string().trim().max(750).optional(),
  primaryPhone: z.string().trim().max(30).optional(),
  website: z.string().trim().max(300).optional(),
});

export async function PATCH(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  if (!ctx.business.googleConnected) {
    return NextResponse.json({ success: false, error: 'Google Business Profile is not connected.' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  try {
    const { liveWriteApplied } = await updateLocationProfile(ctx.businessId, parsed.data);
    return NextResponse.json({ success: true, liveWriteApplied });
  } catch (err: any) {
    if (err instanceof GBPAuthError) {
      return NextResponse.json({ success: false, error: 'Google connection expired — please reconnect.' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: err.message || 'Failed to save profile' }, { status: 500 });
  }
}

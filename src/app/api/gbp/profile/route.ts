import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/tenant';
import { fetchLocationProfile, GBPAuthError } from '@/lib/gbpClient';
import { gbpWritesEnabled } from '@/lib/gbpSafety';
import { createChange, locationIdFor } from '@/services/gbp/changes/store';
import { validateBusinessName, validateDescription, withGbpUtm } from '@/services/gbp/changes/policy';
import dbConnect from '@/lib/mongodb';
import GBPToken from '@/models/GBPToken';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const dynamic = 'force-dynamic';

/**
 * Live Google Business Profile for the active workspace.
 *  GET   -> fetch the live profile (name, description, phone, website, …).
 *  PATCH -> propose edits. Google is not written here. Approve the proposal
 *           on Profile optimization, then execute it.
 */

export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  // "Connected" must mean a real OAuth grant exists (a GBPToken), NOT just
  // that onboarding set Business.googleConnected from a picked Places result
  // — same check /api/gbp/insights already uses. Without this, a business
  // could show "connected" here while insights correctly shows it isn't.
  await dbConnect();
  const tokenDoc = await GBPToken.findOne({ businessId: ctx.businessId }).lean();
  if (!tokenDoc) {
    return NextResponse.json({ success: false, connected: false, error: 'Google Business Profile is not connected.' });
  }

  try {
    const profile = await fetchLocationProfile(ctx.businessId);
    return NextResponse.json({ success: true, connected: true, liveWritesEnabled: gbpWritesEnabled(), profile });
  } catch (err: any) {
    if (err instanceof GBPAuthError) {
      return NextResponse.json({ success: false, connected: false, error: 'Google connection expired — please reconnect.' });
    }
    return NextResponse.json({ success: false, connected: true, error: toFriendlyMessage(err) }, { status: 500 });
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

  await dbConnect();
  const tokenDoc = await GBPToken.findOne({ businessId: ctx.businessId }).lean();
  if (!tokenDoc) {
    return NextResponse.json({ success: false, error: 'Google Business Profile is not connected.' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  try {
    const locationId = await locationIdFor(ctx.businessId);
    if (!locationId) return NextResponse.json({ success: false, error: 'Google Business Profile is not connected.' }, { status: 400 });
    const current = await fetchLocationProfile(ctx.businessId);
    const proposals = [];
    const pairs: Array<{ kind: 'title' | 'description' | 'phone' | 'website'; next: string; prev: string }> = [];
    if (parsed.data.title !== undefined && parsed.data.title !== current.title) pairs.push({ kind: 'title', next: parsed.data.title, prev: current.title });
    if (parsed.data.description !== undefined && parsed.data.description !== current.description) pairs.push({ kind: 'description', next: parsed.data.description, prev: current.description });
    if (parsed.data.primaryPhone !== undefined && parsed.data.primaryPhone !== current.primaryPhone) pairs.push({ kind: 'phone', next: parsed.data.primaryPhone, prev: current.primaryPhone });
    if (parsed.data.website !== undefined && parsed.data.website !== current.website) pairs.push({ kind: 'website', next: parsed.data.website, prev: current.website });
    for (const pair of pairs) {
      let proposed: unknown = pair.next;
      let validation: { valid: boolean; violations: Array<{ code: string; message: string }> } = { valid: true, violations: [] };
      if (pair.kind === 'description') validation = validateDescription(pair.next, { tokens: [current.primaryCategory, ctx.business.city, ctx.business.category].filter(Boolean) });
      if (pair.kind === 'title') validation = validateBusinessName(pair.prev, pair.next, { city: ctx.business.city, category: current.primaryCategory || ctx.business.category });
      if (pair.kind === 'website') {
        const utm = withGbpUtm(pair.next);
        if (!utm.ok || !utm.url) validation = { valid: false, violations: utm.violations };
        else proposed = utm.url;
      }
      proposals.push(await createChange({
        businessId: ctx.businessId,
        organizationId: ctx.organizationId,
        locationId,
        kind: pair.kind,
        fields: [pair.kind],
        source: 'owner',
        before: pair.prev,
        proposed,
        validation,
        requestedBy: ctx.userId,
      }));
    }
    return NextResponse.json({
      success: true,
      liveWriteApplied: false,
      proposals,
      reason: proposals.length
        ? 'Proposed. Review and approve the change before it is sent to Google.'
        : 'Nothing changed.',
    });
  } catch (err: any) {
    if (err instanceof GBPAuthError) {
      return NextResponse.json({ success: false, error: 'Google connection expired — please reconnect.' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: toFriendlyMessage(err) }, { status: 500 });
  }
}

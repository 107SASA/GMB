import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import Business from '@/models/Business';
import GBPToken from '@/models/GBPToken';
import { googleAccessCopy } from '@/services/gbp/access/evaluate';

export const dynamic = 'force-dynamic';

/**
 * Google access state for the active workspace — drives the "Google access
 * problem" popup, banner and header chip (web + Android + iOS).
 *
 *   status: 'not_connected' | 'checking' | 'verified' | 'limited' | 'blocked'
 *
 * A workspace connected before the access check existed (no state yet) is
 * reported as 'verified' only when its last sync wrote a snapshot; otherwise
 * 'checking' until the next sync records the real state.
 * "Check again" = POST /api/gbp/sync (the same sync re-checks access).
 */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  await dbConnect();

  const [biz, token]: any[] = await Promise.all([
    Business.findById(ctx.businessId).select('googleConnected googleAccess').lean(),
    GBPToken.findOne({ businessId: ctx.businessId }).select('googleEmail lastSyncAt').lean(),
  ]);
  if (!biz?.googleConnected || !token) {
    return NextResponse.json({ status: 'not_connected', reconnect: true, copy: null });
  }

  const a = biz.googleAccess || null;
  const status: string = a?.state || (token.lastSyncAt ? 'verified' : 'checking');
  const copy = googleAccessCopy(status as any, a?.reason ?? null);
  return NextResponse.json({
    status,
    reason: a?.reason ?? null,
    // Google's own refusal text, for "show details" / support.
    detail: a?.detail ?? null,
    googleEmail: token.googleEmail || null,
    checkedAt: a?.checkedAt ?? null,
    problemSince: a?.problemSince ?? null,
    canPost: a?.canPost ?? null,
    canEdit: a?.canEdit ?? null,
    reconnect: copy?.reconnect ?? false,
    copy,
  });
}

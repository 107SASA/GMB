import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { listMediaAssets } from '@/lib/gbpMediaService';
import { GBPAuthError } from '@/lib/gbpClient';
import { gbpWritesEnabled } from '@/lib/gbpSafety';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const dynamic = 'force-dynamic';

/**
 * GET -> every media asset (staged + published) for the active workspace,
 * reconciled against the live Google profile when connected. This is the
 * local-DB-backed CRUD source of truth — see gbpMediaService.ts / models/
 * GbpMediaAsset.ts for why it replaced a direct live-only read.
 */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    const { media, liveSyncError } = await listMediaAssets(ctx.businessId, !!ctx.business.googleConnected);
    return NextResponse.json({
      success: true,
      connected: !!ctx.business.googleConnected,
      liveWritesEnabled: gbpWritesEnabled(),
      media,
      // Previously swallowed into a server-only console.warn — a business
      // whose live sync was failing on every request had no way to ever
      // find out why the photo list never changed. See listMediaAssets.
      liveSyncError,
    });
  } catch (err: any) {
    if (err instanceof GBPAuthError) {
      return NextResponse.json({ success: false, connected: false, error: 'Google connection expired — please reconnect.' });
    }
    return NextResponse.json({ success: false, error: toFriendlyMessage(err) }, { status: 500 });
  }
}

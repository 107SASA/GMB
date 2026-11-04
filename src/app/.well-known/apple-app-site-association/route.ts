import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * iOS Universal Links: lets https://growwmatics.com/dashboard/… links
 * (WhatsApp fix reminders) open the GrowwMatics iOS app (ios/app.json
 * associatedDomains). APPLE_APP_IDS = "<Team ID>.com.growwmatics.app"
 * (Apple Developer → Membership), comma-separated. Unset → 404, and links
 * keep opening in the browser. Apple fetches this without redirects, as JSON.
 */
export async function GET() {
  const appIDs = (process.env.APPLE_APP_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^[A-Z0-9]{10}\.com\.growwmatics\.app$/.test(id));
  if (!appIDs.length) return NextResponse.json({}, { status: 404 });
  return NextResponse.json(
    { applinks: { details: [{ appIDs, components: [{ '/': '/dashboard/*', comment: 'Dashboard links open the app' }] }] } },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Android App Links: lets https://growwmatics.com/dashboard/… links (WhatsApp
 * fix reminders) open the GrowwMatics Android app (mobile/app.json
 * intentFilters). ANDROID_APP_SHA256_FINGERPRINTS = the app signing
 * certificate's SHA-256 (Play Console → App integrity, or `eas credentials`),
 * comma-separated. Unset → 404, and links keep opening in the browser.
 */
export async function GET() {
  const fingerprints = (process.env.ANDROID_APP_SHA256_FINGERPRINTS || '')
    .split(',')
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  if (!fingerprints.length) return NextResponse.json([], { status: 404 });
  return NextResponse.json(
    [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.growwmatics.app', sha256_cert_fingerprints: fingerprints },
    }],
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}

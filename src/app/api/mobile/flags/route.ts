import { NextResponse } from 'next/server';

/**
 * Remote feature flags for the mobile app. Intentionally unauthenticated —
 * flags contain nothing sensitive and the app may need them pre-login.
 *
 * androidCallLogCapture gates the READ_CALL_LOG-based capture UI (Plan B).
 * It must stay OFF until (a) a build actually ships the native call-log
 * module + manifest permission and (b) Google Play's Permissions Declaration
 * Form for READ_CALL_LOG has been filed and approved. See mobile/README.md.
 */
export async function GET() {
  return NextResponse.json({
    androidCallLogCapture: process.env.MOBILE_FLAG_ANDROID_CALL_LOG === 'true',
  });
}

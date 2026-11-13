import dbConnect from '@/lib/mongodb';
import PlatformSettings from '@/models/PlatformSettings';

/**
 * Super-admin switches for free accounts (Admin → Settings → Free sign-up).
 * Both default ON. docs/FREE_ACCOUNT_REGISTRATION_PLAN.md
 */
export interface FreeSignupSettings {
  /** New free accounts can be created (app / website). Off → existing accounts still log in. */
  enabled: boolean;
  /** Generate the free Google profile report at sign-up when a listing was picked. */
  autoReport: boolean;
}

export async function getFreeSignupSettings(): Promise<FreeSignupSettings> {
  await dbConnect();
  const s = (await PlatformSettings.findOne().select('freeSignupEnabled freeSignupAutoReport').lean()) as any;
  return { enabled: s?.freeSignupEnabled !== false, autoReport: s?.freeSignupAutoReport !== false };
}

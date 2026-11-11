import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { encrypt } from '@/lib/crypto';
import { generateTotpSecret, otpauthUri } from '@/lib/totp';
import { generateRecoveryCodes, maskEmail, consumeRecoveryCode, consumeTotpCode } from '@/lib/adminTwoStep';
import { logSecurityEvent } from '@/services/security/securityLog';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';

export const dynamic = 'force-dynamic';

/** The signed-in admin's own two-step status. */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  await dbConnect();
  const u = await User.findById(auth.userId).select('email adminTotpEnabledAt +adminRecoveryCodeHashes').lean<any>();
  return NextResponse.json({
    success: true,
    data: {
      email: maskEmail(u?.email || ''),
      totpEnabled: Boolean(u?.adminTotpEnabledAt),
      totpEnabledAt: u?.adminTotpEnabledAt || null,
      recoveryCodesLeft: u?.adminRecoveryCodeHashes?.length ?? 0,
    },
  });
}

/**
 * actions:
 *   start      → new secret + QR (only when the app is not set up yet)
 *   confirm    → {code} from the app; turns it on and returns 10 recovery codes once
 *   regenerate → {code}; replaces the recovery codes
 *   disable    → {code} (app or recovery code); turns the app off
 * Changing an existing setup always needs a current code, so a stolen
 * session alone can't swap in an attacker's authenticator.
 */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const rl = await checkDurableRateLimit(`admin-two-step:${auth.userId}`, 20, 15 * 60 * 1000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Too many attempts. Try again later.' }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  await dbConnect();
  const user = await User.findById(auth.userId).select('email adminTotpEnabledAt').lean<any>();
  if (!user) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  const enabled = Boolean(user.adminTotpEnabledAt);
  const log = (detail: string) =>
    logSecurityEvent(req, { type: 'admin.two_step_change', outcome: 'success', severity: 'warning', userId: auth.userId, role: 'SUPER_ADMIN', subject: user.email, detail });

  if (action === 'start') {
    if (enabled) return NextResponse.json({ success: false, error: 'The authenticator app is already set up. Turn it off first to move it to a new phone.' }, { status: 400 });
    const secret = generateTotpSecret();
    await User.updateOne({ _id: auth.userId }, { $set: { adminTotpPendingSecretEnc: encrypt(secret) } });
    const uri = otpauthUri(secret, user.email);
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
    return NextResponse.json({ success: true, data: { qr, secret: secret.replace(/(.{4})/g, '$1 ').trim() } });
  }

  if (action === 'confirm') {
    if (enabled) return NextResponse.json({ success: false, error: 'Already set up.' }, { status: 400 });
    if (!/^\d{6}$/.test(code)) return NextResponse.json({ success: false, error: 'Enter the 6-digit code from the app.' }, { status: 400 });
    const step = await consumeTotpCode(auth.userId, code, 'adminTotpPendingSecretEnc');
    if (step == null) return NextResponse.json({ success: false, error: 'That code is not right. Check the phone’s time is set automatically and try the newest code.' }, { status: 400 });
    const pending = await User.findById(auth.userId).select('+adminTotpPendingSecretEnc').lean<any>();
    const { codes, hashes } = generateRecoveryCodes();
    await User.updateOne(
      { _id: auth.userId },
      {
        $set: { adminTotpSecretEnc: pending.adminTotpPendingSecretEnc, adminTotpEnabledAt: new Date(), adminRecoveryCodeHashes: hashes },
        $unset: { adminTotpPendingSecretEnc: 1 },
      }
    );
    await log('Turned on the authenticator app');
    return NextResponse.json({ success: true, data: { recoveryCodes: codes } });
  }

  if (action === 'regenerate' || action === 'disable') {
    if (!enabled) return NextResponse.json({ success: false, error: 'The authenticator app is not set up.' }, { status: 400 });
    const ok = /^\d{6}$/.test(code)
      ? (await consumeTotpCode(auth.userId, code)) != null
      : action === 'disable' && code.length >= 10 && (await consumeRecoveryCode(auth.userId, code));
    if (!ok) return NextResponse.json({ success: false, error: action === 'disable' ? 'Enter a current code from the app (or a recovery code).' : 'Enter a current code from the app.' }, { status: 400 });

    if (action === 'regenerate') {
      const { codes, hashes } = generateRecoveryCodes();
      await User.updateOne({ _id: auth.userId }, { $set: { adminRecoveryCodeHashes: hashes } });
      await log('Replaced the recovery codes');
      return NextResponse.json({ success: true, data: { recoveryCodes: codes } });
    }
    await User.updateOne(
      { _id: auth.userId },
      { $unset: { adminTotpSecretEnc: 1, adminTotpPendingSecretEnc: 1, adminTotpEnabledAt: 1, adminTotpLastStep: 1, adminRecoveryCodeHashes: 1 } }
    );
    await log('Turned off the authenticator app');
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
}

import crypto from 'crypto';
import dbConnect from '@/lib/mongodb';
import AdminLoginChallenge from '@/models/AdminLoginChallenge';
import User from '@/models/User';
import { generateOTP, hashOTP } from '@/services/auth/otp';
import { sendEmailOtp } from '@/services/email';
import { decrypt } from '@/lib/crypto';
import { verifyTotp } from '@/lib/totp';

/**
 * Second step of super admin sign-in. Three ways to pass it:
 *   totp     — the authenticator app (main method once set up; needs no email)
 *   email    — a 6-digit code emailed on request (the only method until the app is set up)
 *   recovery — a one-time recovery code, for a lost phone while email is down
 * All three share one challenge and one attempt counter (5 wrong tries in total).
 *
 * Kill switch for a lockout: set ADMIN_EMAIL_2FA=off on the server and
 * restart. It needs server access, which already implies full trust.
 */
export const ADMIN_CODE_TTL_MINUTES = 10;
export const ADMIN_CODE_MAX_ATTEMPTS = 5;
export const ADMIN_CODE_MAX_RESENDS = 5;
export const ADMIN_CODE_RESEND_COOLDOWN_MS = 60 * 1000;

export type TwoStepMethod = 'totp' | 'email' | 'recovery';

export function isAdminTwoStepEnabled(): boolean {
  return process.env.ADMIN_EMAIL_2FA?.trim().toLowerCase() !== 'off';
}

export const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

/** "studysphere654@gmail.com" → "st***4@gmail.com" */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 2);
  const tail = local.length > 4 ? local.slice(-1) : '';
  return `${head}***${tail}@${domain}`;
}

// ── recovery codes ───────────────────────────────────────────────────────────

const RC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const RECOVERY_CODE_COUNT = 10;

/** Upper-case, no separators — how recovery codes are hashed and compared. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Ten fresh "XXXX-XXXX-XX" codes and their hashes (only hashes are stored). */
export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    let raw = '';
    for (let j = 0; j < 10; j++) raw += RC_ALPHABET[crypto.randomInt(RC_ALPHABET.length)];
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`);
  }
  return { codes, hashes: codes.map((c) => sha256(normalizeRecoveryCode(c))) };
}

/** Consumes a recovery code atomically. True if it existed (and is now gone). */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const hash = sha256(normalizeRecoveryCode(code));
  const r = await User.updateOne({ _id: userId, adminRecoveryCodeHashes: hash }, { $pull: { adminRecoveryCodeHashes: hash } });
  return r.modifiedCount === 1;
}

/** Checks an authenticator code and records its step atomically so it can't be replayed. */
export async function consumeTotpCode(userId: string, code: string, secretField: 'adminTotpSecretEnc' | 'adminTotpPendingSecretEnc' = 'adminTotpSecretEnc'): Promise<number | null> {
  const u = await User.findById(userId).select(`+${secretField} adminTotpLastStep`).lean<any>();
  const enc = u?.[secretField];
  if (!enc) return null;
  let secret: string;
  try { secret = decrypt(enc); } catch { return null; }
  const step = verifyTotp(secret, code, u.adminTotpLastStep);
  if (step == null) return null;
  const r = await User.updateOne(
    { _id: userId, $or: [{ adminTotpLastStep: { $exists: false } }, { adminTotpLastStep: { $lt: step } }] },
    { $set: { adminTotpLastStep: step } }
  );
  return r.modifiedCount === 1 ? step : null;
}

// ── challenges ───────────────────────────────────────────────────────────────

/**
 * Creates the sign-in challenge. Emails a code only when `sendEmail` is true
 * (admins without the app). With the app set up, no email goes out unless
 * the admin asks for one, so a Resend outage doesn't matter.
 */
export async function startAdminChallenge(user: { _id: unknown; email: string }, ip: string, opts: { sendEmail: boolean }) {
  await dbConnect();
  const userId = String(user._id);
  // One live challenge per admin: starting a new sign-in cancels older ones.
  await AdminLoginChallenge.deleteMany({ userId, usedAt: { $exists: false } });
  const challenge = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const code = opts.sendEmail ? generateOTP() : null;
  await AdminLoginChallenge.create({
    userId,
    challengeHash: sha256(challenge),
    ...(code ? { codeHash: hashOTP(code), lastSentAt: now } : {}),
    expiresAt: new Date(now.getTime() + ADMIN_CODE_TTL_MINUTES * 60 * 1000),
    ip,
  });
  if (!code) return { challenge, sent: false, error: undefined };
  const sent = await sendEmailOtp(user.email, code, 'admin_login', ADMIN_CODE_TTL_MINUTES);
  return { challenge, sent: Boolean(sent.success), error: (sent as any).error as string | undefined };
}

type VerifyResult =
  | { ok: true; userId: string; method: TwoStepMethod }
  | { ok: false; reason: 'invalid' | 'expired' | 'too_many' | 'wrong_code'; attemptsLeft?: number };

export async function verifyAdminChallenge(challenge: string, code: string, method: TwoStepMethod): Promise<VerifyResult> {
  await dbConnect();
  // Count the attempt first (atomic), so parallel guesses can't exceed the cap.
  const row = await AdminLoginChallenge.findOneAndUpdate(
    { challengeHash: sha256(challenge), usedAt: { $exists: false } },
    { $inc: { attempts: 1 } },
    { new: true }
  );
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.expiresAt.getTime() < Date.now()) {
    await AdminLoginChallenge.deleteOne({ _id: row._id });
    return { ok: false, reason: 'expired' };
  }
  if (row.attempts > ADMIN_CODE_MAX_ATTEMPTS) {
    await AdminLoginChallenge.deleteOne({ _id: row._id });
    return { ok: false, reason: 'too_many' };
  }

  const userId = String(row.userId);
  let match = false;
  if (method === 'email') {
    if (row.codeHash) {
      const given = Buffer.from(hashOTP(code));
      const stored = Buffer.from(row.codeHash);
      match = given.length === stored.length && crypto.timingSafeEqual(given, stored);
    }
  } else if (method === 'totp') {
    match = (await consumeTotpCode(userId, code)) != null;
  } else {
    match = await consumeRecoveryCode(userId, code);
  }

  if (!match) {
    const left = ADMIN_CODE_MAX_ATTEMPTS - row.attempts;
    if (left <= 0) await AdminLoginChallenge.deleteOne({ _id: row._id });
    return { ok: false, reason: left <= 0 ? 'too_many' : 'wrong_code', attemptsLeft: Math.max(0, left) };
  }
  const claimed = await AdminLoginChallenge.findOneAndUpdate(
    { _id: row._id, usedAt: { $exists: false } },
    { $set: { usedAt: new Date() } }
  );
  if (!claimed) return { ok: false, reason: 'invalid' };
  return { ok: true, userId, method };
}

type ResendResult =
  | { ok: true; sent: boolean }
  | { ok: false; reason: 'invalid' | 'cooldown' | 'too_many'; retryAfterSeconds?: number };

/** Emails a (new) code for an existing challenge. The old email code stops working. */
export async function resendAdminChallenge(challenge: string, email: (userId: string) => Promise<string | null>): Promise<ResendResult> {
  await dbConnect();
  const row = await AdminLoginChallenge.findOne({ challengeHash: sha256(challenge), usedAt: { $exists: false } });
  if (!row || row.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'invalid' };
  if (row.resends >= ADMIN_CODE_MAX_RESENDS) return { ok: false, reason: 'too_many' };
  const since = row.lastSentAt ? Date.now() - row.lastSentAt.getTime() : Infinity;
  if (since < ADMIN_CODE_RESEND_COOLDOWN_MS) {
    return { ok: false, reason: 'cooldown', retryAfterSeconds: Math.ceil((ADMIN_CODE_RESEND_COOLDOWN_MS - since) / 1000) };
  }
  const to = await email(String(row.userId));
  if (!to) return { ok: false, reason: 'invalid' };
  const code = generateOTP();
  const now = new Date();
  // Conditional on the previous lastSentAt so two parallel requests can't both send.
  const updated = await AdminLoginChallenge.findOneAndUpdate(
    { _id: row._id, ...(row.lastSentAt ? { lastSentAt: row.lastSentAt } : { lastSentAt: { $exists: false } }) },
    { $set: { codeHash: hashOTP(code), lastSentAt: now }, $inc: { resends: 1 } }
  );
  if (!updated) return { ok: false, reason: 'cooldown', retryAfterSeconds: 60 };
  const sent = await sendEmailOtp(to, code, 'admin_login', ADMIN_CODE_TTL_MINUTES);
  return { ok: true, sent: Boolean(sent.success) };
}

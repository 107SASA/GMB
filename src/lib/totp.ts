import crypto from 'crypto';

/**
 * TOTP (RFC 6238) — the 6-digit, 30-second codes shown by Google
 * Authenticator, Microsoft Authenticator, Authy, 1Password, etc.
 * SHA-1 / 6 digits / 30 s: the defaults every authenticator app supports.
 * Pure (node:crypto only).
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** New random secret (160 bits, as RFC 4226 recommends), base32. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

export function totpCode(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Checks a code against the current step ±1 (allows ~30 s of clock drift).
 * Returns the matched step, or null. Steps at or before `lastUsedStep` are
 * refused so the same code can't be used twice.
 */
export function verifyTotp(secretB32: string, code: string, lastUsedStep?: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (lastUsedStep != null && s <= lastUsedStep) continue;
    const expected = Buffer.from(totpCode(secretB32, s));
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) return s;
  }
  return null;
}

/** otpauth:// URI the authenticator app reads from the QR code. */
export function otpauthUri(secretB32: string, account: string, issuer = 'Growwmatics AI Admin'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

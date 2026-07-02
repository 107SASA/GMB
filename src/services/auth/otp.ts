import crypto from 'crypto';

/**
 * Generates a secure random 6-digit OTP
 */
export const generateOTP = (): string => {
  return crypto.randomInt(100000, 999999).toString();
};

/**
 * Hashes an OTP using SHA-256 for secure DB storage.
 * Since OTPs are high-entropy, short-lived, and auto-generated, 
 * SHA-256 is sufficient and much faster than bcrypt.
 */
export const hashOTP = (otp: string): string => {
  return crypto.createHash('sha256').update(otp).digest('hex');
};

/**
 * Verifies if the provided OTP matches the stored hash
 */
export const verifyOTP = (providedOTP: string, storedHash: string): boolean => {
  const hash = hashOTP(providedOTP);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
};

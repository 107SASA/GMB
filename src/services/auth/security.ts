import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const SALT_ROUNDS = 12;

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

// Rules live in src/lib/passwordPolicy.ts (client-safe, no bcrypt/jwt deps)
// so client components can import the exact same check instead of
// hand-copying the regexes — re-exported here so existing server-side
// callers of `validatePasswordStrength` from this module keep working.
export { validatePasswordStrength } from '@/lib/passwordPolicy';

export const generateToken = (payload: object, expiresIn: string = '7d'): string => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined');
  }
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: expiresIn as any });
};

export const verifyToken = (token: string): any => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined');
  }
  return jwt.verify(token, process.env.JWT_SECRET);
};

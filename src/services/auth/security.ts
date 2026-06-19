import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const SALT_ROUNDS = 12;

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

export const validatePasswordStrength = (password: string): { isValid: boolean; error?: string } => {
  if (password.length < 8) return { isValid: false, error: 'Password must be at least 8 characters long.' };
  if (!/[A-Z]/.test(password)) return { isValid: false, error: 'Password must contain an uppercase letter.' };
  if (!/[a-z]/.test(password)) return { isValid: false, error: 'Password must contain a lowercase letter.' };
  if (!/[0-9]/.test(password)) return { isValid: false, error: 'Password must contain a number.' };
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) return { isValid: false, error: 'Password must contain a special character.' };
  return { isValid: true };
};

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

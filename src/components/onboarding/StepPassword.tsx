import React, { useState } from 'react';
import { OnboardingData } from './types';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface Props {
  data: OnboardingData;
  updateData: (fields: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const inputCls =
  'w-full px-4 py-3 pr-12 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all';

// Mirrors validatePasswordStrength in src/services/auth/security.ts — kept in sync manually
// since that file pulls in bcryptjs/jsonwebtoken and can't be imported into a client bundle.
function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain a number.';
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) return 'Password must contain a special character.';
  return null;
}

export default function StepPassword({ data, updateData, onNext, onBack }: Props) {
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleContinue = () => {
    if (!data.password || !data.confirmPassword) {
      setError('Please fill out both password fields.');
      return;
    }
    const passwordError = validatePasswordStrength(data.password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (data.password !== data.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    onNext();
  };

  return (
    <div className="h-full bg-surface-container-lowest rounded-xl card-shadow p-10 flex flex-col border border-outline-variant">
      <div className="flex-1">
        <div className="w-12 h-12 bg-primary-fixed rounded-lg flex items-center justify-center mb-6">
          <MaterialIcon name="lock" size={24} className="text-primary" />
        </div>
        <h2 className="text-headline-md font-heading text-on-surface mb-2">Secure your account</h2>
        <p className="text-on-surface-variant mb-8">Create a strong password for your new workspace.</p>

        <div className="space-y-5">
          <div>
            <label className="block text-label-md text-on-surface mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={data.password || ''}
                onChange={e => updateData({ password: e.target.value })}
                className={inputCls}
                placeholder="••••••••"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center pr-4 text-outline hover:text-on-surface transition-colors"
              >
                <MaterialIcon name={showPassword ? 'visibility_off' : 'visibility'} size={20} />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-label-md text-on-surface mb-2">Confirm Password</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={data.confirmPassword || ''}
                onChange={e => updateData({ confirmPassword: e.target.value })}
                className={inputCls}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center pr-4 text-outline hover:text-on-surface transition-colors"
              >
                <MaterialIcon name={showConfirm ? 'visibility_off' : 'visibility'} size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Error sits directly above the Continue button so it is visible right
          where the user just clicked, instead of at the top of the form. */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-4 p-4 bg-error-container text-on-error-container rounded-lg text-sm font-medium border border-outline-variant flex items-start gap-3"
        >
          <MaterialIcon name="error" size={20} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-between items-center pt-6 border-t border-outline-variant">
        <button onClick={onBack} className="text-on-surface-variant font-bold hover:text-on-surface transition-colors px-4 py-2">
          Back
        </button>
        <button 
          onClick={handleContinue}
          className="flex items-center gap-2 px-8 py-3 bg-primary hover:bg-primary-container text-on-primary rounded-lg font-bold transition-all"
        >
          Continue <MaterialIcon name="arrow_forward" size={16} />
        </button>
      </div>
    </div>
  );
}

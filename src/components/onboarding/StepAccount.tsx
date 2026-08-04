import React, { useState } from 'react';
import { OnboardingData } from './types';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { COUNTRY_CODES, splitPhone } from '@/lib/countryCodes';

interface Props {
  data: OnboardingData;
  updateData: (fields: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

const inputCls =
  'w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all';

export default function StepAccount({ data, updateData, onNext, onBack }: Props) {
  const [error, setError] = useState('');

  // `personalPhone` stays a single E.164-style string in shared state (same
  // shape everything downstream — validation, DB — already expects). The
  // dial code and local digits are just how we split it for this UI.
  const { dialCode, localNumber } = splitPhone(data.personalPhone);

  const handleDialCodeChange = (newDialCode: string) => {
    updateData({ personalPhone: `${newDialCode}${localNumber}` });
  };

  const handleLocalNumberChange = (raw: string) => {
    const digitsOnly = raw.replace(/[^\d]/g, '');
    updateData({ personalPhone: digitsOnly ? `${dialCode}${digitsOnly}` : '' });
  };

  const handleContinue = () => {
    if (!data.fullName || !data.email || !data.personalPhone) {
      setError('Please fill out all fields.');
      return;
    }
    if (!EMAIL_REGEX.test(data.email)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!PHONE_REGEX.test(data.personalPhone.replace(/[^\d+]/g, ''))) {
      setError('Please enter your phone number in international format, e.g. +14155550100.');
      return;
    }
    setError('');
    onNext();
  };

  return (
    <div className="h-full bg-surface-container-lowest rounded-xl card-shadow p-10 flex flex-col border border-outline-variant">
      <div className="flex-1">
        <h2 className="text-headline-md font-heading text-on-surface mb-2">Create your account</h2>
        <p className="text-on-surface-variant mb-8">Enter your personal details to get started.</p>

        <div className="space-y-5">
          <div>
            <label className="block text-label-md text-on-surface mb-2">Full Name</label>
            <input
              type="text"
              value={data.fullName}
              onChange={e => updateData({ fullName: e.target.value })}
              className={inputCls}
              placeholder="John Doe"
            />
          </div>
          <div>
            <label className="block text-label-md text-on-surface mb-2">Email Address</label>
            <input
              type="email"
              value={data.email}
              onChange={e => updateData({ email: e.target.value })}
              className={inputCls}
              placeholder="john@example.com"
            />
          </div>
          <div>
            <label className="block text-label-md text-on-surface mb-2">Your Phone Number</label>
            <div className="flex gap-2">
              <select
                value={dialCode}
                onChange={e => handleDialCodeChange(e.target.value)}
                aria-label="Country code"
                className="w-27.5 shrink-0 px-2 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm"
              >
                {COUNTRY_CODES.map(c => (
                  <option key={`${c.iso2}-${c.dialCode}`} value={c.dialCode}>
                    {c.flag} {c.dialCode}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                value={localNumber}
                onChange={e => handleLocalNumberChange(e.target.value)}
                className={`flex-1 min-w-0 ${inputCls}`}
                placeholder="4155550100"
              />
            </div>
            <p className="text-xs text-outline mt-1.5">
              Your own contact number — this stays separate from your business&apos;s phone number, which you&apos;ll add next.
            </p>
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

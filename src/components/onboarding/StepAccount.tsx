import React, { useState } from 'react';
import { OnboardingData } from './types';
import { ArrowRight, ArrowLeft, AlertCircle } from 'lucide-react';
import { COUNTRY_CODES, splitPhone } from '@/lib/countryCodes';

interface Props {
  data: OnboardingData;
  updateData: (fields: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

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
    <div className="h-full bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-10 flex flex-col border border-slate-100">
      <div className="flex-1">
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Create your account</h2>
        <p className="text-slate-500 mb-8">Enter your personal details to get started.</p>

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-900 mb-2">Full Name</label>
            <input
              type="text"
              value={data.fullName}
              onChange={e => updateData({ fullName: e.target.value })}
              className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
              placeholder="John Doe"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-900 mb-2">Email Address</label>
            <input
              type="email"
              value={data.email}
              onChange={e => updateData({ email: e.target.value })}
              className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
              placeholder="john@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-900 mb-2">Your Phone Number</label>
            <div className="flex gap-2">
              <select
                value={dialCode}
                onChange={e => handleDialCodeChange(e.target.value)}
                aria-label="Country code"
                className="w-27.5 shrink-0 px-2 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none text-sm"
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
                className="flex-1 min-w-0 px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
                placeholder="4155550100"
              />
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              Your own contact number — this stays separate from your business's phone number, which you'll add next.
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
          className="mt-4 p-4 bg-red-50 text-red-700 rounded-xl text-sm font-medium border border-red-200 flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-between items-center pt-6 border-t border-slate-100">
        <button onClick={onBack} className="text-slate-500 font-bold hover:text-slate-900 transition-colors px-4 py-2">
          Back
        </button>
        <button 
          onClick={handleContinue}
          className="flex items-center gap-2 px-8 py-3.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-md"
        >
          Continue <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

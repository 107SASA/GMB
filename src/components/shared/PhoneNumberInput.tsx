'use client';

import { COUNTRY_CODES, splitPhone } from '@/lib/countryCodes';

/**
 * Dial-code select + local-number input, backed by the same COUNTRY_CODES /
 * splitPhone helpers StepAccount (onboarding) uses. `value` and `onChange`
 * carry the phone as a single E.164-ish string ("+91XXXXXXXXXX") — same shape
 * everything downstream (normalizePhoneE164, the Lead/User schemas) expects.
 */
export function PhoneNumberInput({
  value,
  onChange,
  placeholder = '98765 43210',
  className = '',
}: {
  value: string;
  onChange: (fullPhone: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { dialCode, localNumber } = splitPhone(value);

  return (
    <div
      className={`flex items-stretch rounded-lg border border-outline-variant bg-surface overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:border-transparent ${className}`}
    >
      <select
        value={dialCode}
        onChange={(e) => onChange(`${e.target.value}${localNumber}`)}
        aria-label="Country code"
        className="w-[5.5rem] sm:w-24 shrink-0 pl-2.5 pr-1 py-3.5 bg-transparent text-on-surface outline-none text-sm border-r border-outline-variant"
      >
        {COUNTRY_CODES.map((c) => (
          <option key={`${c.iso2}-${c.dialCode}`} value={c.dialCode}>
            {c.flag} {c.dialCode}
          </option>
        ))}
      </select>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={localNumber}
        onChange={(e) => {
          const digitsOnly = e.target.value.replace(/[^\d]/g, '');
          onChange(digitsOnly ? `${dialCode}${digitsOnly}` : '');
        }}
        className="flex-1 min-w-0 px-3 sm:px-4 py-3.5 bg-transparent text-on-surface placeholder:text-outline outline-none text-base"
        placeholder={placeholder}
      />
    </div>
  );
}

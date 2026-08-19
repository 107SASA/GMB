'use client';

import { COUNTRY_CODES, splitPhone } from '@/lib/countryCodes';

const selectCls =
  'w-24 shrink-0 px-2 py-3.5 bg-surface border border-outline-variant rounded-lg text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm';
const inputCls =
  'flex-1 min-w-0 px-4 py-3.5 bg-surface border border-outline-variant rounded-lg text-on-surface placeholder:text-outline focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all';

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
    <div className={`flex gap-2 ${className}`}>
      <select
        value={dialCode}
        onChange={(e) => onChange(`${e.target.value}${localNumber}`)}
        aria-label="Country code"
        className={selectCls}
      >
        {COUNTRY_CODES.map((c) => (
          <option key={`${c.iso2}-${c.dialCode}`} value={c.dialCode}>
            {c.flag} {c.dialCode}
          </option>
        ))}
      </select>
      <input
        type="tel"
        value={localNumber}
        onChange={(e) => {
          const digitsOnly = e.target.value.replace(/[^\d]/g, '');
          onChange(digitsOnly ? `${dialCode}${digitsOnly}` : '');
        }}
        className={inputCls}
        placeholder={placeholder}
      />
    </div>
  );
}

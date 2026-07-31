export interface CountryCode {
  name: string;
  iso2: string;
  dialCode: string; // e.g. "+91"
  flag: string;
}

// Common countries first (India first — primary market), then the rest
// alphabetically. Not an exhaustive ISO list, but covers the countries a
// customer signing up here is realistically dialing from.
export const COUNTRY_CODES: CountryCode[] = [
  { name: 'India', iso2: 'IN', dialCode: '+91', flag: '🇮🇳' },
  { name: 'United States', iso2: 'US', dialCode: '+1', flag: '🇺🇸' },
  { name: 'United Kingdom', iso2: 'GB', dialCode: '+44', flag: '🇬🇧' },
  { name: 'United Arab Emirates', iso2: 'AE', dialCode: '+971', flag: '🇦🇪' },
  { name: 'Canada', iso2: 'CA', dialCode: '+1', flag: '🇨🇦' },
  { name: 'Australia', iso2: 'AU', dialCode: '+61', flag: '🇦🇺' },
  { name: 'Singapore', iso2: 'SG', dialCode: '+65', flag: '🇸🇬' },
  { name: 'Afghanistan', iso2: 'AF', dialCode: '+93', flag: '🇦🇫' },
  { name: 'Argentina', iso2: 'AR', dialCode: '+54', flag: '🇦🇷' },
  { name: 'Austria', iso2: 'AT', dialCode: '+43', flag: '🇦🇹' },
  { name: 'Bahrain', iso2: 'BH', dialCode: '+973', flag: '🇧🇭' },
  { name: 'Bangladesh', iso2: 'BD', dialCode: '+880', flag: '🇧🇩' },
  { name: 'Belgium', iso2: 'BE', dialCode: '+32', flag: '🇧🇪' },
  { name: 'Brazil', iso2: 'BR', dialCode: '+55', flag: '🇧🇷' },
  { name: 'Bhutan', iso2: 'BT', dialCode: '+975', flag: '🇧🇹' },
  { name: 'China', iso2: 'CN', dialCode: '+86', flag: '🇨🇳' },
  { name: 'Colombia', iso2: 'CO', dialCode: '+57', flag: '🇨🇴' },
  { name: 'Denmark', iso2: 'DK', dialCode: '+45', flag: '🇩🇰' },
  { name: 'Egypt', iso2: 'EG', dialCode: '+20', flag: '🇪🇬' },
  { name: 'Finland', iso2: 'FI', dialCode: '+358', flag: '🇫🇮' },
  { name: 'France', iso2: 'FR', dialCode: '+33', flag: '🇫🇷' },
  { name: 'Germany', iso2: 'DE', dialCode: '+49', flag: '🇩🇪' },
  { name: 'Hong Kong', iso2: 'HK', dialCode: '+852', flag: '🇭🇰' },
  { name: 'Indonesia', iso2: 'ID', dialCode: '+62', flag: '🇮🇩' },
  { name: 'Ireland', iso2: 'IE', dialCode: '+353', flag: '🇮🇪' },
  { name: 'Israel', iso2: 'IL', dialCode: '+972', flag: '🇮🇱' },
  { name: 'Italy', iso2: 'IT', dialCode: '+39', flag: '🇮🇹' },
  { name: 'Japan', iso2: 'JP', dialCode: '+81', flag: '🇯🇵' },
  { name: 'Kenya', iso2: 'KE', dialCode: '+254', flag: '🇰🇪' },
  { name: 'Kuwait', iso2: 'KW', dialCode: '+965', flag: '🇰🇼' },
  { name: 'Malaysia', iso2: 'MY', dialCode: '+60', flag: '🇲🇾' },
  { name: 'Mexico', iso2: 'MX', dialCode: '+52', flag: '🇲🇽' },
  { name: 'Nepal', iso2: 'NP', dialCode: '+977', flag: '🇳🇵' },
  { name: 'Netherlands', iso2: 'NL', dialCode: '+31', flag: '🇳🇱' },
  { name: 'New Zealand', iso2: 'NZ', dialCode: '+64', flag: '🇳🇿' },
  { name: 'Nigeria', iso2: 'NG', dialCode: '+234', flag: '🇳🇬' },
  { name: 'Norway', iso2: 'NO', dialCode: '+47', flag: '🇳🇴' },
  { name: 'Oman', iso2: 'OM', dialCode: '+968', flag: '🇴🇲' },
  { name: 'Pakistan', iso2: 'PK', dialCode: '+92', flag: '🇵🇰' },
  { name: 'Philippines', iso2: 'PH', dialCode: '+63', flag: '🇵🇭' },
  { name: 'Poland', iso2: 'PL', dialCode: '+48', flag: '🇵🇱' },
  { name: 'Portugal', iso2: 'PT', dialCode: '+351', flag: '🇵🇹' },
  { name: 'Qatar', iso2: 'QA', dialCode: '+974', flag: '🇶🇦' },
  { name: 'Russia', iso2: 'RU', dialCode: '+7', flag: '🇷🇺' },
  { name: 'Saudi Arabia', iso2: 'SA', dialCode: '+966', flag: '🇸🇦' },
  { name: 'South Africa', iso2: 'ZA', dialCode: '+27', flag: '🇿🇦' },
  { name: 'South Korea', iso2: 'KR', dialCode: '+82', flag: '🇰🇷' },
  { name: 'Spain', iso2: 'ES', dialCode: '+34', flag: '🇪🇸' },
  { name: 'Sri Lanka', iso2: 'LK', dialCode: '+94', flag: '🇱🇰' },
  { name: 'Sweden', iso2: 'SE', dialCode: '+46', flag: '🇸🇪' },
  { name: 'Switzerland', iso2: 'CH', dialCode: '+41', flag: '🇨🇭' },
  { name: 'Thailand', iso2: 'TH', dialCode: '+66', flag: '🇹🇭' },
  { name: 'Turkey', iso2: 'TR', dialCode: '+90', flag: '🇹🇷' },
  { name: 'Vietnam', iso2: 'VN', dialCode: '+84', flag: '🇻🇳' },
];

export const DEFAULT_COUNTRY = COUNTRY_CODES[0]; // India

/**
 * Splits a stored E.164-style phone string (e.g. "+14155550100") into the
 * dial code and the local number, matching the longest known dial code
 * prefix first (so "+1" doesn't shadow "+971", etc).
 */
export function splitPhone(fullPhone: string): { dialCode: string; localNumber: string } {
  if (!fullPhone) return { dialCode: DEFAULT_COUNTRY.dialCode, localNumber: '' };
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.dialCode.length - a.dialCode.length);
  const match = sorted.find((c) => fullPhone.startsWith(c.dialCode));
  if (match) return { dialCode: match.dialCode, localNumber: fullPhone.slice(match.dialCode.length) };
  return { dialCode: DEFAULT_COUNTRY.dialCode, localNumber: fullPhone.replace(/^\+/, '') };
}

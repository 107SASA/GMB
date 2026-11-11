/**
 * Growth Partner KYC — pure rules, so tests load them directly.
 *
 * A partner registers either as a company (agency / firm) or as an
 * individual. Both give a PAN and bank details for commission payouts.
 *  - company:    legal name, business type, registered address, optional
 *                GSTIN / registration number, company PAN, documents:
 *                PAN card, registration certificate, GST certificate (when a
 *                GSTIN is given), cancelled cheque.
 *  - individual: address, PAN, Aadhaar, documents: PAN card, Aadhaar front +
 *                back, cancelled cheque.
 *
 * Aadhaar: the full number is only checked (format + Verhoeff checksum) and
 * then discarded — only the last 4 digits are kept, as UIDAI rules expect.
 */

export const ENTITY_TYPES = ['company', 'individual'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const COMPANY_TYPES = [
  'proprietorship',
  'partnership',
  'llp',
  'private_limited',
  'public_limited',
  'other',
] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export const COMPANY_TYPE_LABELS: Record<CompanyType, string> = {
  proprietorship: 'Sole proprietorship',
  partnership: 'Partnership firm',
  llp: 'LLP',
  private_limited: 'Private limited company',
  public_limited: 'Public limited company',
  other: 'Other',
};

export const KYC_DOC_KINDS = [
  'pan_card',
  'registration_certificate',
  'gst_certificate',
  'aadhaar_front',
  'aadhaar_back',
  'cancelled_cheque',
] as const;
export type KycDocKind = (typeof KYC_DOC_KINDS)[number];

export const KYC_DOC_LABELS: Record<KycDocKind, string> = {
  pan_card: 'PAN card',
  registration_certificate: 'Business registration certificate',
  gst_certificate: 'GST registration certificate',
  aadhaar_front: 'Aadhaar card (front)',
  aadhaar_back: 'Aadhaar card (back)',
  cancelled_cheque: 'Cancelled cheque or bank statement',
};

export const KYC_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const KYC_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** The documents a submission must include. */
export function requiredDocKinds(entityType: EntityType, hasGstin: boolean): KycDocKind[] {
  if (entityType === 'company') {
    return ['pan_card', 'registration_certificate', ...(hasGstin ? (['gst_certificate'] as const) : []), 'cancelled_cheque'];
  }
  return ['pan_card', 'aadhaar_front', 'aadhaar_back', 'cancelled_cheque'];
}

/** Detects the real file type from its first bytes — the browser-sent type is not trusted. */
export function sniffKycFileType(bytes: Uint8Array): (typeof KYC_FILE_TYPES)[number] | null {
  const b = bytes;
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'; // %PDF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) return 'image/webp';
  return null;
}

// ── Identifiers ──────────────────────────────────────────────────────────

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PINCODE_RE = /^[1-9][0-9]{5}$/;

function upperNoSpace(v: unknown): string {
  return typeof v === 'string' ? v.toUpperCase().replace(/[\s-]/g, '') : '';
}

export function normalizePan(v: unknown): string | null {
  const s = upperNoSpace(v);
  return PAN_RE.test(s) ? s : null;
}

export function normalizeGstin(v: unknown): string | null {
  const s = upperNoSpace(v);
  return GSTIN_RE.test(s) ? s : null;
}

export function normalizeIfsc(v: unknown): string | null {
  const s = upperNoSpace(v);
  return IFSC_RE.test(s) ? s : null;
}

// Verhoeff tables — the checksum UIDAI uses for Aadhaar numbers.
const V_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const V_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function isValidAadhaar(v: unknown): boolean {
  const s = typeof v === 'string' ? v.replace(/\s/g, '') : '';
  if (!/^[2-9][0-9]{11}$/.test(s)) return false;
  let c = 0;
  const digits = s.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = V_D[c][V_P[i % 8][digits[i]]];
  return c === 0;
}

/** "XXXXXX1234"-style display; never more than the last 4 characters. */
export function maskLast4(last4: string | null | undefined, total = 10): string {
  if (!last4) return '';
  return `${'X'.repeat(Math.max(0, total - last4.length))}${last4}`;
}

// ── Submission ───────────────────────────────────────────────────────────

export interface KycSubmission {
  entityType: EntityType;
  /** Company legal name, or the individual's name as on PAN. */
  legalName: string;
  companyType: CompanyType | null;
  gstin: string | null;
  registrationNumber: string | null;
  address: string;
  pincode: string;
  pan: string;
  /** Last 4 digits only — the full Aadhaar number never leaves this function. */
  aadhaarLast4: string | null;
  bank: {
    accountHolderName: string;
    accountNumber: string;
    ifsc: string;
    bankName: string;
    accountType: 'savings' | 'current';
  };
}

export type KycValidation = { ok: true; value: KycSubmission } | { ok: false; error: string };

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

export function validateKycSubmission(body: Record<string, unknown>): KycValidation {
  const entityType = text(body.entityType, 20) as EntityType;
  if (!ENTITY_TYPES.includes(entityType)) return { ok: false, error: 'Choose whether you are registering as a company or an individual.' };
  const isCompany = entityType === 'company';

  const legalName = text(body.legalName, 160);
  if (legalName.length < 2) {
    return { ok: false, error: isCompany ? 'Enter the company’s legal name.' : 'Enter your full name as on your PAN card.' };
  }

  let companyType: CompanyType | null = null;
  if (isCompany) {
    companyType = text(body.companyType, 30) as CompanyType;
    if (!COMPANY_TYPES.includes(companyType)) return { ok: false, error: 'Choose your business type.' };
  }

  const address = text(body.address, 400);
  if (address.length < 10) return { ok: false, error: isCompany ? 'Enter the registered business address.' : 'Enter your full address.' };
  const pincode = text(body.pincode, 6);
  if (!PINCODE_RE.test(pincode)) return { ok: false, error: 'Enter a valid 6-digit PIN code.' };

  const pan = normalizePan(body.pan);
  if (!pan) return { ok: false, error: 'Enter a valid PAN, e.g. ABCDE1234F.' };
  // 4th character of a PAN is the holder type: P = person. A proprietorship
  // uses the owner's personal PAN; other companies have a business PAN.
  if (!isCompany && pan[3] !== 'P') return { ok: false, error: 'Enter your personal PAN (its 4th letter is P).' };
  if (isCompany && companyType !== 'proprietorship' && pan[3] === 'P') {
    return { ok: false, error: 'Enter the company’s PAN, not a personal PAN.' };
  }

  let gstin: string | null = null;
  let registrationNumber: string | null = null;
  if (isCompany) {
    const gstRaw = text(body.gstin, 20);
    if (gstRaw) {
      gstin = normalizeGstin(gstRaw);
      if (!gstin) return { ok: false, error: 'Enter a valid 15-character GSTIN, or leave it empty.' };
      if (gstin.slice(2, 12) !== pan) return { ok: false, error: 'The GSTIN does not match the PAN you entered.' };
    }
    registrationNumber = text(body.registrationNumber, 40) || null;
  }

  let aadhaarLast4: string | null = null;
  if (!isCompany) {
    const aadhaar = typeof body.aadhaar === 'string' ? body.aadhaar.replace(/\s/g, '') : '';
    if (!isValidAadhaar(aadhaar)) return { ok: false, error: 'Enter a valid 12-digit Aadhaar number.' };
    aadhaarLast4 = aadhaar.slice(-4);
  }

  const b = (typeof body.bank === 'object' && body.bank ? body.bank : {}) as Record<string, unknown>;
  const accountHolderName = text(b.accountHolderName, 120);
  if (accountHolderName.length < 2) return { ok: false, error: 'Enter the bank account holder’s name.' };
  const accountNumber = typeof b.accountNumber === 'string' ? b.accountNumber.replace(/\s/g, '') : '';
  if (!/^[0-9]{9,18}$/.test(accountNumber)) return { ok: false, error: 'Enter a valid bank account number (9–18 digits).' };
  const confirm = typeof b.confirmAccountNumber === 'string' ? b.confirmAccountNumber.replace(/\s/g, '') : '';
  if (confirm !== accountNumber) return { ok: false, error: 'The two account numbers do not match.' };
  const ifsc = normalizeIfsc(b.ifsc);
  if (!ifsc) return { ok: false, error: 'Enter a valid IFSC code, e.g. HDFC0001234.' };
  const bankName = text(b.bankName, 120);
  if (bankName.length < 2) return { ok: false, error: 'Enter the bank name.' };
  const accountType = b.accountType === 'current' ? 'current' : b.accountType === 'savings' ? 'savings' : null;
  if (!accountType) return { ok: false, error: 'Choose savings or current account.' };

  return {
    ok: true,
    value: {
      entityType,
      legalName,
      companyType,
      gstin,
      registrationNumber,
      address,
      pincode,
      pan,
      aadhaarLast4,
      bank: { accountHolderName, accountNumber, ifsc, bankName, accountType },
    },
  };
}

/** Which required documents are still missing from what was uploaded. */
export function missingDocs(entityType: EntityType, hasGstin: boolean, uploaded: string[]): KycDocKind[] {
  const have = new Set(uploaded);
  return requiredDocKinds(entityType, hasGstin).filter((k) => !have.has(k));
}

/**
 * Pure merge helpers for Lead.buyingSignals and businessProfile interests.
 * Kept dependency-free so integration tests can run without mongoose/DB.
 */

export const VALID_BUYING_SIGNAL_TYPES = [
  'PRICING_QUESTION',
  'IMPLEMENTATION_QUESTION',
  'DEMO_REQUESTED',
  'DEMO_BOOKED',
  'PURCHASE_INTENT',
] as const;

export type BuyingSignalType = (typeof VALID_BUYING_SIGNAL_TYPES)[number];

export interface BuyingSignalRow {
  type: BuyingSignalType;
  note?: string;
  detectedAt: Date;
}

export function mergeBuyingSignalRows(
  existing: BuyingSignalRow[] | undefined | null,
  incoming: Array<string | { type?: string; note?: string } | null | undefined>,
  scoreSignal?: string | null
): BuyingSignalRow[] {
  const out: BuyingSignalRow[] = [...(existing || [])].map((s) => ({ ...s }));
  const candidates = [...incoming];
  if (
    scoreSignal &&
    (VALID_BUYING_SIGNAL_TYPES as readonly string[]).includes(scoreSignal) &&
    !candidates.length
  ) {
    candidates.push({ type: scoreSignal });
  }

  for (const raw of candidates) {
    if (!raw) continue;
    let type: string | undefined;
    let note: string | undefined;
    if (typeof raw === 'string') {
      type = raw.trim().toUpperCase();
    } else {
      type = (raw.type || '').trim().toUpperCase();
      note = raw.note ? String(raw.note).trim() : undefined;
    }
    if (!type || !(VALID_BUYING_SIGNAL_TYPES as readonly string[]).includes(type)) {
      continue; // unknown types dropped — never invent
    }
    const existingRow = out.find((s) => s.type === type);
    if (existingRow) {
      existingRow.detectedAt = new Date();
      if (note) existingRow.note = note;
    } else {
      out.push({ type: type as BuyingSignalType, note, detectedAt: new Date() });
    }
  }
  return out;
}

export function mergeStringList(existing: string[] | undefined, incoming: string[] | undefined): string[] {
  const out = [...(existing || [])];
  const seen = new Set(out.map((s) => s.toLowerCase().trim()));
  for (const item of incoming || []) {
    const clean = (item || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    out.push(clean);
    seen.add(key);
  }
  return out;
}

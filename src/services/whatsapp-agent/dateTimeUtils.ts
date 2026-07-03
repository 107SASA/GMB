/**
 * Timezone-safe date/time helpers for the WhatsApp AI Agent.
 *
 * Built entirely on the native Intl API so we don't need to add a new
 * runtime dependency (date-fns is already used elsewhere in the codebase
 * but has no built-in IANA timezone conversion helper).
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  weekday: 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat';
}

export type DayKey =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

export const WEEKDAY_TO_DAY_KEY: Record<ZonedParts['weekday'], DayKey> = {
  Sun: 'sunday',
  Mon: 'monday',
  Tue: 'tuesday',
  Wed: 'wednesday',
  Thu: 'thursday',
  Fri: 'friday',
  Sat: 'saturday',
};

const DAY_KEY_LABEL: Record<DayKey, string> = {
  sunday: 'Sunday',
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
};

export function dayKeyLabel(day: DayKey): string {
  return DAY_KEY_LABEL[day];
}

/** Break an absolute instant down into its calendar/clock parts within a given IANA timezone. */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // Some ICU implementations render midnight as "24" with hour12:false.
    hour: map.hour === '24' ? 0 : Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: map.weekday as ZonedParts['weekday'],
  };
}

/** Current date/time as seen from the business's configured timezone. */
export function getBusinessNow(timeZone: string): ZonedParts {
  return getZonedParts(new Date(), timeZone);
}

/**
 * Convert a business-local "YYYY-MM-DD" + "HH:mm" pair into the absolute
 * UTC instant it represents in the given IANA timezone. Uses a small
 * fixed-point iteration so it's correct across DST boundaries too.
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const targetLocalUtcMs = Date.UTC(y, m - 1, d, hh, mm, 0);

  let guessMs = targetLocalUtcMs;
  for (let i = 0; i < 3; i++) {
    const parts = getZonedParts(new Date(guessMs), timeZone);
    const partsAsUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const diff = partsAsUtcMs - targetLocalUtcMs;
    if (diff === 0) break;
    guessMs -= diff;
  }
  return new Date(guessMs);
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function formatHHmm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Weekday of a plain "YYYY-MM-DD" calendar date — timezone independent by design. */
export function dayKeyOfDateString(dateStr: string): DayKey {
  const [y, m, d] = dateStr.split('-').map(Number);
  const idx = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const order: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return order[idx];
}

export function isValidDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTimeString(timeStr: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeStr);
}

/** Friendly "Monday, 10 July" style label for messages, rendered from the plain date string (no tz math needed). */
export function friendlyDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' });
  const month = dt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long' });
  return `${weekday}, ${d} ${month}`;
}

/** Friendly "4:00 PM" style label from "HH:mm". */
export function friendlyTimeLabel(timeStr: string): string {
  const mins = toMinutes(timeStr);
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

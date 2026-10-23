/**
 * Asia/Kolkata clock rules for automated WhatsApp timing. Pure (no imports),
 * so the rules run under plain `node --test`.
 *
 * India has used a fixed UTC+05:30 offset with no daylight saving since 1945,
 * so the conversion is exact without a timezone database — and it does not
 * depend on the server's own timezone (the droplet runs in UTC).
 */

export const IST_TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Owner notifications that can wait are not delivered from 21:00 to 09:00 IST. */
export const OWNER_QUIET_START_HOUR = 21;
export const OWNER_QUIET_END_HOUR = 9;

/** Minutes since 00:00 IST for `at`. */
export function istMinuteOfDay(at: Date): number {
  const local = new Date(at.getTime() + IST_OFFSET_MS);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** The instant of hour:00 IST on the IST calendar day of `at`, shifted by `addDays`. */
function istHourOn(at: Date, hour: number, addDays = 0): Date {
  const local = new Date(at.getTime() + IST_OFFSET_MS);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnightLocal + addDays * DAY_MS + hour * 3_600_000 - IST_OFFSET_MS);
}

/**
 * The next moment inside the business-hours window [startHour, endHour) IST,
 * or null when `now` is already inside it. Hours are whole IST hours (0–24).
 */
export function nextIstBusinessHourStart(now: Date, startHour: number, endHour: number): Date | null {
  const minute = istMinuteOfDay(now);
  if (minute >= startHour * 60 && minute < endHour * 60) return null;
  return istHourOn(now, startHour, minute >= endHour * 60 ? 1 : 0);
}

/**
 * When an owner notice that can wait should go out: null to send now, or
 * 09:00 IST when `now` falls in the 21:00–09:00 IST quiet period.
 */
export function ownerQuietHoursDeferUntil(now: Date): Date | null {
  const minute = istMinuteOfDay(now);
  if (minute >= OWNER_QUIET_END_HOUR * 60 && minute < OWNER_QUIET_START_HOUR * 60) return null;
  return istHourOn(now, OWNER_QUIET_END_HOUR, minute >= OWNER_QUIET_START_HOUR * 60 ? 1 : 0);
}

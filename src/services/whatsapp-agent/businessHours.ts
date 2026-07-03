import {
  DayKey,
  dayKeyLabel,
  dayKeyOfDateString,
  formatHHmm,
  friendlyDateLabel,
  friendlyTimeLabel,
  getBusinessNow,
  isValidDateString,
  isValidTimeString,
  toMinutes,
} from './dateTimeUtils';

export interface WorkingHoursConfig {
  bookingEnabled: boolean;
  timezone: string;
  workingDays: Record<DayKey, boolean>;
  openingTime: string; // "HH:mm"
  closingTime: string; // "HH:mm"
  slotDurationMinutes: number;
}

export const DEFAULT_WORKING_HOURS: WorkingHoursConfig = {
  bookingEnabled: false,
  timezone: 'Asia/Kolkata',
  workingDays: {
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: true,
    sunday: false,
  },
  openingTime: '09:00',
  closingTime: '18:00',
  slotDurationMinutes: 30,
};

/** Normalizes a (possibly partially populated / legacy-missing) business doc field into a full config, defaulting bookingEnabled to false. */
export function resolveWorkingHoursConfig(raw: any | undefined | null): WorkingHoursConfig {
  if (!raw) return { ...DEFAULT_WORKING_HOURS, bookingEnabled: false };
  return {
    bookingEnabled: !!raw.bookingEnabled,
    timezone: raw.timezone || DEFAULT_WORKING_HOURS.timezone,
    workingDays: { ...DEFAULT_WORKING_HOURS.workingDays, ...(raw.workingDays || {}) },
    openingTime: raw.openingTime || DEFAULT_WORKING_HOURS.openingTime,
    closingTime: raw.closingTime || DEFAULT_WORKING_HOURS.closingTime,
    slotDurationMinutes: raw.slotDurationMinutes || DEFAULT_WORKING_HOURS.slotDurationMinutes,
  };
}

export interface SlotValidationResult {
  valid: boolean;
  reason?: string;
  friendlyMessage?: string;
}

/**
 * Validates a proposed business-local date/time against working days,
 * business hours, and "not in the past" rules. Pure function, no DB access,
 * so it's trivially unit-testable.
 */
export function validateSlot(
  config: WorkingHoursConfig,
  dateStr: string,
  timeStr: string
): SlotValidationResult {
  if (!config.bookingEnabled) {
    return {
      valid: false,
      reason: 'booking_disabled',
      friendlyMessage: `Online booking isn't set up for this business yet — please call us directly to schedule.`,
    };
  }

  if (!isValidDateString(dateStr) || !isValidTimeString(timeStr)) {
    return {
      valid: false,
      reason: 'invalid_format',
      friendlyMessage: `Sorry, I couldn't understand that date/time. Could you tell me the day and time again?`,
    };
  }

  const dayKey = dayKeyOfDateString(dateStr);
  if (!config.workingDays[dayKey]) {
    return {
      valid: false,
      reason: 'closed_day',
      friendlyMessage: `We're closed on ${dayKeyLabel(dayKey)}s. Could you pick another day?`,
    };
  }

  const requestedMinutes = toMinutes(timeStr);
  const openMinutes = toMinutes(config.openingTime);
  const closeMinutes = toMinutes(config.closingTime);
  if (requestedMinutes < openMinutes || requestedMinutes >= closeMinutes) {
    return {
      valid: false,
      reason: 'outside_hours',
      friendlyMessage: `That's outside our business hours (${friendlyTimeLabel(config.openingTime)}–${friendlyTimeLabel(
        config.closingTime
      )}). Could you pick a time in that window?`,
    };
  }

  const now = getBusinessNow(config.timezone);
  const nowDateStr = `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;
  const nowMinutes = now.hour * 60 + now.minute;

  if (dateStr < nowDateStr) {
    return {
      valid: false,
      reason: 'past_date',
      friendlyMessage: `That date has already passed. Could you pick an upcoming date?`,
    };
  }
  if (dateStr === nowDateStr && requestedMinutes <= nowMinutes) {
    return {
      valid: false,
      reason: 'past_time',
      friendlyMessage: `That time has already passed today. Could you pick a later time today, or another day?`,
    };
  }

  return { valid: true };
}

/**
 * Generates up to `count` alternative open slots on `dateStr`, at the
 * configured slot duration, skipping any time in `excludeTimes` and
 * anything in the past. Falls forward to the following working day(s) if
 * the given day has no more room, so the customer always gets useful
 * options (bounded search of `maxDaysAhead` days).
 */
export function suggestAlternativeSlots(
  config: WorkingHoursConfig,
  dateStr: string,
  excludeTimes: string[],
  count = 3,
  maxDaysAhead = 14
): Array<{ date: string; time: string }> {
  const suggestions: Array<{ date: string; time: string }> = [];
  const excluded = new Set(excludeTimes);

  let cursorDate = dateStr;
  for (let dayOffset = 0; dayOffset <= maxDaysAhead && suggestions.length < count; dayOffset++) {
    if (dayOffset > 0) cursorDate = addDays(dateStr, dayOffset);

    const dayKey = dayKeyOfDateString(cursorDate);
    if (!config.workingDays[dayKey]) continue;

    const openMinutes = toMinutes(config.openingTime);
    const closeMinutes = toMinutes(config.closingTime);
    const now = getBusinessNow(config.timezone);
    const nowDateStr = `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;
    const nowMinutes = now.hour * 60 + now.minute;

    for (let m = openMinutes; m < closeMinutes; m += config.slotDurationMinutes) {
      const slotTime = formatHHmm(m);
      // excludeTimes only applies to the originally-requested date; later
      // fallback days are assumed open unless they're also in the past.
      if (cursorDate === dateStr && excluded.has(slotTime)) continue;
      if (cursorDate === nowDateStr && m <= nowMinutes) continue;

      suggestions.push({ date: cursorDate, time: slotTime });
      if (suggestions.length >= count) break;
    }
  }

  return suggestions;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function formatSlotsForMessage(slots: Array<{ date: string; time: string }>, anchorDate: string): string {
  return slots
    .map((s) => {
      const label = s.date === anchorDate ? friendlyTimeLabel(s.time) : `${friendlyDateLabel(s.date)} at ${friendlyTimeLabel(s.time)}`;
      return `• ${label}`;
    })
    .join('\n');
}

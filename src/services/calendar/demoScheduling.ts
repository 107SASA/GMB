/**
 * Pure demo-scheduling rules. No Google calls and no database.
 * Calendar availability and event creation stay in salespersonCalendar.ts.
 * Whether a booking may be confirmed still depends on a real Meet URL.
 */

export const DEMO_TIMEZONE_DEFAULT = 'Asia/Kolkata';
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

export type AssignmentStrategy = 'first-available' | 'round-robin';

export interface DemoScheduleConfig {
  automatedBookingEnabled: boolean;
  demoDurationMinutes: number;
  timezone: string;
  openingTime: string;
  closingTime: string;
  /** 0 = Sunday … 6 = Saturday. */
  workingDays: number[];
  minAdvanceMinutes: number;
  maxDaysAhead: number;
  bufferMinutes: number;
  assignmentStrategy: AssignmentStrategy;
  reminderLeadMinutes: number[];
}

export interface RequestedSlot {
  date: string;
  time: string;
  startUtc: Date;
}

export interface BusyRange {
  start: Date;
  end: Date;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function defaultDemoSchedule(): DemoScheduleConfig {
  return {
    automatedBookingEnabled: false,
    demoDurationMinutes: 30,
    timezone: DEMO_TIMEZONE_DEFAULT,
    openingTime: '10:00',
    closingTime: '18:00',
    workingDays: [1, 2, 3, 4, 5],
    minAdvanceMinutes: 60,
    maxDaysAhead: 14,
    bufferMinutes: 15,
    assignmentStrategy: 'first-available',
    reminderLeadMinutes: [24 * 60, 60, 15],
  };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function validateDemoSchedule(input: DemoScheduleConfig): string | null {
  if (typeof input.automatedBookingEnabled !== 'boolean') return 'Automated booking must be true or false.';
  if (!Number.isInteger(input.demoDurationMinutes) || input.demoDurationMinutes < 15 || input.demoDurationMinutes > 180) {
    return 'Demo duration must be between 15 and 180 minutes.';
  }
  if (!isValidTimeZone(input.timezone)) return 'Timezone is not a valid IANA timezone.';
  if (!HHMM.test(input.openingTime) || !HHMM.test(input.closingTime)) return 'Working hours must be HH:mm.';
  if (minutesOfDay(input.openingTime) >= minutesOfDay(input.closingTime)) {
    return 'Opening time must be earlier than closing time.';
  }
  if (!Array.isArray(input.workingDays) || input.workingDays.length === 0) return 'Choose at least one working day.';
  if (input.workingDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return 'Working days must be 0–6.';
  if (new Set(input.workingDays).size !== input.workingDays.length) return 'Working days must be unique.';
  if (!Number.isInteger(input.minAdvanceMinutes) || input.minAdvanceMinutes < 0 || input.minAdvanceMinutes > 7 * 24 * 60) {
    return 'Minimum notice must be between 0 minutes and 7 days.';
  }
  if (!Number.isInteger(input.maxDaysAhead) || input.maxDaysAhead < 1 || input.maxDaysAhead > 60) {
    return 'Maximum days ahead must be between 1 and 60.';
  }
  if (!Number.isInteger(input.bufferMinutes) || input.bufferMinutes < 0 || input.bufferMinutes > 120) {
    return 'Buffer must be between 0 and 120 minutes.';
  }
  if (input.assignmentStrategy !== 'first-available' && input.assignmentStrategy !== 'round-robin') {
    return 'Assignment strategy must be first-available or round-robin.';
  }
  if (!Array.isArray(input.reminderLeadMinutes) || input.reminderLeadMinutes.length === 0 || input.reminderLeadMinutes.length > 5) {
    return 'Choose between 1 and 5 reminders.';
  }
  if (input.reminderLeadMinutes.some((mins) => !Number.isInteger(mins) || mins < 5 || mins > 7 * 24 * 60)) {
    return 'Each reminder must be between 5 minutes and 7 days before the demo.';
  }
  if (new Set(input.reminderLeadMinutes).size !== input.reminderLeadMinutes.length) return 'Reminder times must be unique.';
  return null;
}

export function zonedParts(date: Date, timeZone: string): {
  year: number; month: number; day: number; hour: number; minute: number; weekday: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(pick('weekday'));
  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    hour: Number(pick('hour')) % 24,
    minute: Number(pick('minute')),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

export function zonedLocalToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const got = zonedParts(guess, timeZone);
  const delta = Date.UTC(year, month - 1, day, hour, minute) - Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute);
  return new Date(guess.getTime() + delta);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dateString(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function addDays(date: string, days: number, timeZone: string): string {
  const utc = zonedLocalToUtc(date, '12:00', timeZone);
  return dateString(zonedParts(new Date(utc.getTime() + days * 24 * 60 * 60 * 1000), timeZone));
}

function minutesOfDay(hhmm: string): number {
  const [hour, minute] = hhmm.split(':').map(Number);
  return hour * 60 + minute;
}

/**
 * Parses a customer time request such as "10:30 today" or "10.30 today".
 * A bare clock time is today only when that instant is still ahead.
 */
export function parseRequestedDateTime(text: string, now: Date, timeZone: string): RequestedSlot | null {
  const cleaned = (text || '').toLowerCase().replace(/(\d{1,2})\.(\d{2})\b/g, '$1:$2');
  const match = cleaned.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3];
  if (minute > 59 || hour > 23) return null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (!meridiem && hour > 23) return null;
  if (hour > 23) return null;

  const today = zonedParts(now, timeZone);
  let date = dateString(today);
  if (/\btomorrow\b/.test(cleaned)) date = addDays(date, 1, timeZone);
  else if (!/\btoday\b/.test(cleaned)) {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const named = weekdays.findIndex((day) => cleaned.includes(day));
    if (named >= 0) {
      const delta = (named - today.weekday + 7) % 7;
      date = addDays(date, delta === 0 ? 0 : delta, timeZone);
    }
  }

  const time = `${pad(hour)}:${pad(minute)}`;
  const startUtc = zonedLocalToUtc(date, time, timeZone);
  if (!/\btoday\b|\btomorrow\b|sunday|monday|tuesday|wednesday|thursday|friday|saturday/.test(cleaned) && startUtc.getTime() <= now.getTime()) {
    return null;
  }
  return { date, time, startUtc };
}

/**
 * Like parseRequestedDateTime, and also accepts "Friday afternoon",
 * "tomorrow morning", and "evening" by mapping them onto a working-hours clock time.
 */
export function parseDemoTimeRequest(text: string, now: Date, timeZone: string): RequestedSlot | null {
  const direct = parseRequestedDateTime(text, now, timeZone);
  if (direct) return direct;
  const cleaned = (text || '').toLowerCase();
  let clock: string | null = null;
  if (/\bmorning\b/.test(cleaned)) clock = '10:00';
  else if (/\bafternoon\b/.test(cleaned)) clock = '14:00';
  else if (/\bevening\b/.test(cleaned)) clock = '17:00';
  if (!clock) return null;
  const day = cleaned.match(/\b(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  return parseRequestedDateTime(day ? `${clock} ${day[1]}` : clock, now, timeZone);
}

export function slotFitsSchedule(slot: RequestedSlot, now: Date, config: DemoScheduleConfig): string | null {
  const start = zonedParts(slot.startUtc, config.timezone);
  if (!config.workingDays.includes(start.weekday)) return 'outside-working-days';
  const minute = start.hour * 60 + start.minute;
  const open = minutesOfDay(config.openingTime);
  const close = minutesOfDay(config.closingTime);
  const endMinute = minute + config.demoDurationMinutes;
  if (minute < open || endMinute > close) return 'outside-working-hours';
  if (slot.startUtc.getTime() < now.getTime() + config.minAdvanceMinutes * 60 * 1000) return 'too-soon';
  if (slot.startUtc.getTime() > now.getTime() + config.maxDaysAhead * 24 * 60 * 60 * 1000) return 'too-far';
  return null;
}

export function rangesOverlap(start: Date, end: Date, busy: BusyRange[], bufferMinutes: number): boolean {
  const buffer = bufferMinutes * 60 * 1000;
  const from = start.getTime() - buffer;
  const to = end.getTime() + buffer;
  return busy.some((range) => from < range.end.getTime() && to > range.start.getTime());
}

export interface SalespersonCandidate {
  userId: string;
  email: string;
  calendarId: string;
  busy: boolean;
}

export function assignSalesperson(
  candidates: SalespersonCandidate[],
  strategy: AssignmentStrategy,
  cursor: number
): { person: SalespersonCandidate | null; nextCursor: number } {
  const available = candidates.filter((person) => !person.busy);
  if (!available.length) return { person: null, nextCursor: cursor };
  if (strategy === 'first-available') return { person: available[0], nextCursor: cursor };
  const index = ((cursor % available.length) + available.length) % available.length;
  return { person: available[index], nextCursor: cursor + 1 };
}

export function alternativeSlots(input: {
  now: Date;
  config: DemoScheduleConfig;
  around: Date;
  busyByUser: Array<{ userId: string; busy: BusyRange[] }>;
  limit?: number;
}): RequestedSlot[] {
  const limit = input.limit ?? 2;
  const open: RequestedSlot[] = [];
  const startDay = dateString(zonedParts(input.around, input.config.timezone));
  for (let dayOffset = 0; dayOffset < input.config.maxDaysAhead && open.length < limit; dayOffset++) {
    const date = addDays(startDay, dayOffset, input.config.timezone);
    const openMinute = minutesOfDay(input.config.openingTime);
    const closeMinute = minutesOfDay(input.config.closingTime);
    for (let minute = openMinute; minute + input.config.demoDurationMinutes <= closeMinute; minute += input.config.demoDurationMinutes) {
      const time = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
      const slot = { date, time, startUtc: zonedLocalToUtc(date, time, input.config.timezone) };
      if (slot.startUtc.getTime() <= input.around.getTime()) continue;
      if (slotFitsSchedule(slot, input.now, input.config)) continue;
      const end = new Date(slot.startUtc.getTime() + input.config.demoDurationMinutes * 60 * 1000);
      const someoneFree = input.busyByUser.some((person) => !rangesOverlap(slot.startUtc, end, person.busy, input.config.bufferMinutes));
      if (!someoneFree) continue;
      open.push(slot);
      if (open.length >= limit) break;
    }
  }
  return open;
}

export function reminderInstants(startUtc: Date, leadMinutes: number[], now: Date): Array<{ leadMinutes: number; dueAt: Date }> {
  return leadMinutes
    .map((mins) => ({ leadMinutes: mins, dueAt: new Date(startUtc.getTime() - mins * 60 * 1000) }))
    .filter((row) => row.dueAt.getTime() > now.getTime());
}

export function bookingIdempotencyKey(leadId: string, startUtc: Date): string {
  return `demo:${leadId}:${startUtc.toISOString()}`;
}

export function confirmationCopy(input: { whenLabel: string; meetingLink: string }): string | null {
  if (!input.meetingLink.startsWith('https://')) return null;
  return `Your GrowwMatics demo is confirmed for ${input.whenLabel}.\n\nYou'll meet with our team via Google Meet.\n\nJoin here: ${input.meetingLink}\n\nWe'll remind you before the demo.`;
}

export function reminderShouldSend(input: {
  bookingStatus: string;
  humanOwned: boolean;
  optedOut: boolean;
  currentBookingStart?: string | null;
  reminderStart?: string | null;
}): boolean {
  if (input.humanOwned || input.optedOut) return false;
  if (input.bookingStatus !== 'Confirmed') return false;
  if (input.currentBookingStart && input.reminderStart && input.currentBookingStart !== input.reminderStart) return false;
  return true;
}

export function classifyTokenRefreshFailure(status: number, errorCode: string): 'revoked' | 'transient' {
  if (status === 400 || status === 401 || errorCode === 'invalid_grant') return 'revoked';
  return 'transient';
}

export function publicCalendarConnection(row: {
  userId: string;
  googleEmail?: string | null;
  calendarId?: string | null;
  status: string;
  lastCheckedAt?: Date | string | null;
  refreshTokenEnc?: string;
  accessTokenEnc?: string;
}): {
  userId: string;
  googleEmail: string | null;
  calendarId: string;
  status: string;
  connected: boolean;
  lastCheckedAt: string | null;
} {
  return {
    userId: row.userId,
    googleEmail: row.googleEmail || null,
    calendarId: row.calendarId || 'primary',
    status: row.status,
    connected: row.status === 'active',
    lastCheckedAt: row.lastCheckedAt ? new Date(row.lastCheckedAt).toISOString() : null,
  };
}

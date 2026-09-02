import { google, calendar_v3 } from 'googleapis';
import { randomUUID } from 'crypto';
import {
  resolveWorkingHoursConfig,
  suggestAlternativeSlots,
  type WorkingHoursConfig,
} from '@/services/whatsapp-agent/businessHours';
import { zonedTimeToUtc, getBusinessNow } from '@/services/whatsapp-agent/dateTimeUtils';

/**
 * First-ever calendar integration in this codebase (confirmed by the Aug
 * 2026 architecture audit — zero prior Calendar/Meet code existed). Uses a
 * Google Cloud service account (not the per-user OAuth pattern the rest of
 * this codebase uses for GBP — a demo calendar belongs to GrowwMatics
 * itself, not to any one signed-in user) with domain-wide delegation NOT
 * required: the calendar just needs to be shared with the service
 * account's email (see setup note below) with "Make changes to events"
 * permission.
 *
 * Env vars (documented in .env.production.example):
 *   GOOGLE_CALENDAR_CREDENTIALS_JSON — the full service-account JSON key,
 *     as a single-line string (same shape Google Cloud Console downloads).
 *   GOOGLE_CALENDAR_ID — the calendar to book demos on (a dedicated
 *     GrowwMatics calendar's ID, NOT a personal calendar's "primary").
 *
 * Setup (one-time, not code): create a GCP service account, enable the
 * Calendar API, download its JSON key, then share the target calendar with
 * that service account's client_email (Calendar UI → Settings → Share with
 * specific people → paste the service account email → "Make changes to
 * events").
 */

const REQUIRED_SCOPES = ['https://www.googleapis.com/auth/calendar'];

/** Reuses the same generic business-hours engine as the tenant-facing WhatsApp appointment agent (services/whatsapp-agent/businessHours.ts) — it has no tenant-specific coupling, so it's directly reusable for GrowwMatics' own demo calendar rather than duplicating slot-generation logic. */
const PLATFORM_TIMEZONE = 'Asia/Kolkata';
const DEMO_WORKING_HOURS: WorkingHoursConfig = resolveWorkingHoursConfig({
  bookingEnabled: true,
  timezone: PLATFORM_TIMEZONE,
  workingDays: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false },
  openingTime: '10:00',
  closingTime: '18:00',
  slotDurationMinutes: 30,
});

/**
 * Typed error every exported function in this module throws on any
 * failure — auth misconfiguration, a Google API error, a network failure,
 * whatever. Callers (bookingAgent.ts) catch THIS type specifically rather
 * than letting a raw googleapis error (which can carry verbose internal
 * detail) surface anywhere near a user-facing message.
 */
export class CalendarError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'CalendarError';
  }
}

let cachedClient: calendar_v3.Calendar | null = null;

function getCalendarId(): string {
  const id = process.env.GOOGLE_CALENDAR_ID;
  if (!id) throw new CalendarError('GOOGLE_CALENDAR_ID is not configured');
  return id;
}

/** Lazily builds (and caches) the authenticated Calendar API client from the service-account credentials. Throws CalendarError if unconfigured or the credentials JSON is malformed — never a raw parse/googleapis error. */
function getCalendarClient(): calendar_v3.Calendar {
  if (cachedClient) return cachedClient;

  const raw = process.env.GOOGLE_CALENDAR_CREDENTIALS_JSON;
  if (!raw) {
    throw new CalendarError('GOOGLE_CALENDAR_CREDENTIALS_JSON is not configured');
  }

  let credentials: { client_email: string; private_key: string };
  try {
    credentials = JSON.parse(raw);
  } catch (err) {
    throw new CalendarError('GOOGLE_CALENDAR_CREDENTIALS_JSON is not valid JSON', err);
  }
  if (!credentials.client_email || !credentials.private_key) {
    throw new CalendarError('GOOGLE_CALENDAR_CREDENTIALS_JSON is missing client_email/private_key');
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: REQUIRED_SCOPES,
  });

  cachedClient = google.calendar({ version: 'v3', auth });
  return cachedClient;
}

export interface AvailableSlot {
  /** "YYYY-MM-DD", business-local. */
  date: string;
  /** "HH:mm", business-local (24h). */
  time: string;
  /** The exact UTC instant this slot starts — what actually gets booked. */
  startUtc: Date;
}

/**
 * Queries the configured calendar's free/busy for the given range, then
 * intersects the busy blocks with the working-hours slot grid
 * (businessHours.ts's suggestAlternativeSlots) to return genuinely open
 * slots — not just "the business is open," but "the business is open AND
 * nothing is already on the calendar then."
 *
 * `durationMinutes` currently only affects which slots are excluded (a slot
 * is dropped if ANY part of it overlaps a busy block) — slot width itself
 * still comes from DEMO_WORKING_HOURS.slotDurationMinutes; a future phase
 * could let callers request a custom grid width if durations ever vary.
 */
export async function getAvailableSlots(
  dateRangeStart: Date,
  dateRangeEnd: Date,
  durationMinutes: number,
  maxResults = 6
): Promise<AvailableSlot[]> {
  try {
    const client = getCalendarClient();
    const calendarId = getCalendarId();

    const freebusy = await client.freebusy.query({
      requestBody: {
        timeMin: dateRangeStart.toISOString(),
        timeMax: dateRangeEnd.toISOString(),
        items: [{ id: calendarId }],
      },
    });
    const busy = freebusy.data.calendars?.[calendarId]?.busy || [];
    const busyRanges = busy
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: new Date(b.start as string), end: new Date(b.end as string) }));

    const startParts = getBusinessNow(PLATFORM_TIMEZONE);
    const anchorDate = `${startParts.year}-${String(startParts.month).padStart(2, '0')}-${String(startParts.day).padStart(2, '0')}`;

    // Generate the full candidate grid across the range (businessHours.ts's
    // own generator is date-anchored + count-bounded, so ask for generously
    // more than maxResults and filter down — cheap since these are all pure
    // in-memory computations, no extra API calls).
    const candidates = suggestAlternativeSlots(DEMO_WORKING_HOURS, anchorDate, [], maxResults * 6, 21);

    const open: AvailableSlot[] = [];
    for (const c of candidates) {
      const startUtc = zonedTimeToUtc(c.date, c.time, PLATFORM_TIMEZONE);
      if (startUtc < dateRangeStart || startUtc > dateRangeEnd) continue;
      const endUtc = new Date(startUtc.getTime() + durationMinutes * 60 * 1000);

      const overlapsBusy = busyRanges.some((b) => startUtc < b.end && endUtc > b.start);
      if (overlapsBusy) continue;

      open.push({ date: c.date, time: c.time, startUtc });
      if (open.length >= maxResults) break;
    }

    return open;
  } catch (err) {
    if (err instanceof CalendarError) throw err;
    throw new CalendarError('Failed to fetch available calendar slots', err);
  }
}

export interface CreateDemoEventInput {
  title: string;
  startTime: Date;
  durationMinutes: number;
  attendeeEmail?: string;
}

export interface CreateDemoEventResult {
  eventId: string;
  meetingLink: string;
}

/**
 * Creates a Calendar event with Google Meet conferencing auto-generated
 * (conferenceData.createRequest — the standard way to get a real Meet link
 * without a separate Meet API call). attendeeEmail is optional since the
 * booking agent doesn't always collect an email — an event with no
 * attendee is still valid and still gets a Meet link.
 */
export async function createDemoEvent(input: CreateDemoEventInput): Promise<CreateDemoEventResult> {
  try {
    const client = getCalendarClient();
    const calendarId = getCalendarId();

    const endTime = new Date(input.startTime.getTime() + input.durationMinutes * 60 * 1000);
    const requestId = randomUUID();

    const res = await client.events.insert({
      calendarId,
      conferenceDataVersion: 1, // required for Google to actually create the Meet link
      requestBody: {
        summary: input.title,
        start: { dateTime: input.startTime.toISOString() },
        end: { dateTime: endTime.toISOString() },
        attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      },
    });

    const eventId = res.data.id;
    const meetingLink =
      res.data.hangoutLink ||
      res.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;

    if (!eventId || !meetingLink) {
      // Google can accept the event but not attach a Meet link yet (rare,
      // usually a conferenceData propagation delay) — treat as a failure
      // rather than hand back a booking with no way to actually join.
      throw new CalendarError('Calendar event created but no Meet link was returned');
    }

    return { eventId, meetingLink };
  } catch (err) {
    if (err instanceof CalendarError) throw err;
    throw new CalendarError('Failed to create the calendar event', err);
  }
}

/** Deletes (cancels) a calendar event. Treats "already gone" (404) as success — cancelling twice must not be an error. */
export async function cancelDemoEvent(eventId: string): Promise<void> {
  try {
    const client = getCalendarClient();
    const calendarId = getCalendarId();
    await client.events.delete({ calendarId, eventId });
  } catch (err: any) {
    if (err?.code === 404 || err?.response?.status === 404) return; // already cancelled/deleted — not an error
    if (err instanceof CalendarError) throw err;
    throw new CalendarError('Failed to cancel the calendar event', err);
  }
}

/** True once both required env vars are present — lets callers check "is calendar integration even set up" before attempting a call, same pattern as getMetaConfig() elsewhere in this codebase. */
export function isCalendarConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CALENDAR_CREDENTIALS_JSON && process.env.GOOGLE_CALENDAR_ID);
}

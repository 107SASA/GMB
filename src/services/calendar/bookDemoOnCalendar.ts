import { randomUUID } from 'crypto';
import dbConnect from '@/lib/mongodb';
import SalespersonCalendarConnection from '@/models/SalespersonCalendarConnection';
import BookingAgentConfig from '@/models/BookingAgentConfig';
import DemoBooking from '@/models/DemoBooking';
import {
  alternativeSlots,
  assignSalesperson,
  bookingIdempotencyKey,
  defaultDemoSchedule,
  rangesOverlap,
  slotFitsSchedule,
  type DemoScheduleConfig,
  type RequestedSlot,
} from '@/services/calendar/demoScheduling';
import {
  accessTokenFor,
  CalendarAuthError,
  deleteCalendarEvent,
  insertMeetEvent,
  queryFreeBusy,
} from '@/services/calendar/salespersonCalendar';
import { CalendarError, SlotUnavailableError, createDemoEvent, isCalendarConfigured } from '@/services/calendar/googleCalendar';

export interface BookedMeeting {
  eventId: string;
  meetingLink: string;
  salespersonUserId?: string;
  googleEmail?: string;
  calendarId: string;
  idempotencyKey: string;
}

export interface BookingRefusal {
  ok: false;
  reason: string;
  alternatives: RequestedSlot[];
}

function scheduleFromStored(raw: any): DemoScheduleConfig {
  const base = defaultDemoSchedule();
  if (!raw) return base;
  return {
    ...base,
    automatedBookingEnabled: raw.automatedBookingEnabled === true,
    demoDurationMinutes: raw.demoDurationMinutes || base.demoDurationMinutes,
    timezone: raw.timezone || base.timezone,
    openingTime: raw.openingTime || base.openingTime,
    closingTime: raw.closingTime || base.closingTime,
    workingDays: Array.isArray(raw.workingDays) && raw.workingDays.length ? raw.workingDays : base.workingDays,
    minAdvanceMinutes: typeof raw.minAdvanceMinutes === 'number' ? raw.minAdvanceMinutes : base.minAdvanceMinutes,
    maxDaysAhead: raw.maxDaysAhead || base.maxDaysAhead,
    bufferMinutes: typeof raw.bufferMinutes === 'number' ? raw.bufferMinutes : base.bufferMinutes,
    assignmentStrategy: raw.assignmentStrategy === 'round-robin' ? 'round-robin' : 'first-available',
    reminderLeadMinutes: Array.isArray(raw.reminderLeadMinutes) && raw.reminderLeadMinutes.length
      ? raw.reminderLeadMinutes
      : base.reminderLeadMinutes,
  };
}

async function loadSchedule(): Promise<{ config: DemoScheduleConfig; cursor: number }> {
  await dbConnect();
  const raw = await BookingAgentConfig.findOne({ key: 'default' }).lean() as any;
  return { config: scheduleFromStored(raw), cursor: typeof raw?.roundRobinCursor === 'number' ? raw.roundRobinCursor : 0 };
}

/**
 * Books a confirmed slot on a salesperson calendar when one is connected.
 * Falls back to the existing service-account calendar only when no
 * salesperson has connected. Never invents a Meet URL.
 */
export async function bookDemoOnCalendar(input: {
  leadId: string;
  name: string;
  phone: string;
  dateLabel: string;
  timeLabel: string;
  title: string;
  description: string;
  start: Date;
  durationMinutes: number;
  attendeeEmail?: string;
  preferredUserId?: string;
}): Promise<BookedMeeting> {
  await dbConnect();
  const key = bookingIdempotencyKey(input.leadId, input.start);
  const existing = await DemoBooking.findOne({ idempotencyKey: key }).lean() as any;
  if (existing?.status === 'Confirmed' && existing.calendarEventId && existing.meetingLink) {
    return {
      eventId: existing.calendarEventId,
      meetingLink: existing.meetingLink,
      salespersonUserId: existing.salespersonUserId ? String(existing.salespersonUserId) : undefined,
      googleEmail: existing.googleEmail,
      calendarId: existing.calendarId || 'primary',
      idempotencyKey: key,
    };
  }

  const placeholder = await claimBookingSlot(input, key);

  const connections = await SalespersonCalendarConnection.find({ status: 'active' });
  if (!connections.length) {
    if (!isCalendarConfigured()) {
      await releaseClaim(placeholder._id);
      throw new SlotUnavailableError('No salesperson calendar is connected');
    }
    try {
      const created = await createDemoEvent({
        title: input.title,
        startTime: input.start,
        durationMinutes: input.durationMinutes,
        attendeeEmail: input.attendeeEmail,
      });
      await markConfirmed(placeholder, { ...created, calendarId: process.env.GOOGLE_CALENDAR_ID || '' });
      return { ...created, calendarId: process.env.GOOGLE_CALENDAR_ID || '', idempotencyKey: key };
    } catch (err) {
      await releaseClaim(placeholder._id);
      throw err;
    }
  }

  const { config, cursor } = await loadSchedule();
  const unfit = slotFitsSchedule(
    { date: '1970-01-01', time: '00:00', startUtc: input.start },
    new Date(),
    { ...config, demoDurationMinutes: input.durationMinutes }
  );
  if (unfit) {
    await releaseClaim(placeholder._id);
    throw new SlotUnavailableError(`Requested time is not bookable (${unfit})`);
  }

  const end = new Date(input.start.getTime() + input.durationMinutes * 60 * 1000);
  const windowStart = new Date(input.start.getTime() - config.bufferMinutes * 60 * 1000);
  const windowEnd = new Date(end.getTime() + config.bufferMinutes * 60 * 1000);
  const candidates = [];
  for (const connection of connections) {
    try {
      const token = await accessTokenFor(connection);
      const busy = await queryFreeBusy(token, connection.calendarId || 'primary', windowStart, windowEnd);
      candidates.push({
        userId: String(connection.userId),
        email: connection.googleEmail || '',
        calendarId: connection.calendarId || 'primary',
        busy: rangesOverlap(input.start, end, busy, config.bufferMinutes),
        connection,
      });
    } catch (err) {
      if (err instanceof CalendarAuthError) continue;
      throw err;
    }
  }

  const ordered = input.preferredUserId
    ? [...candidates.filter((row) => row.userId === input.preferredUserId), ...candidates.filter((row) => row.userId !== input.preferredUserId)]
    : candidates;
  const assigned = assignSalesperson(ordered, input.preferredUserId ? 'first-available' : config.assignmentStrategy, cursor);
  if (!assigned.person) {
    await releaseClaim(placeholder._id);
    throw new SlotUnavailableError('No salesperson is free at that time');
  }

  const chosen = ordered.find((row) => row.userId === assigned.person!.userId)!;
  const token = await accessTokenFor(chosen.connection);
  const again = await queryFreeBusy(token, chosen.calendarId, windowStart, windowEnd);
  if (rangesOverlap(input.start, end, again, config.bufferMinutes)) {
    await releaseClaim(placeholder._id);
    throw new SlotUnavailableError('That time was just taken');
  }

  let created;
  try {
    created = await insertMeetEvent({
      accessToken: token,
      calendarId: chosen.calendarId,
      title: input.title,
      description: input.description,
      start: input.start,
      end,
      attendeeEmail: input.attendeeEmail,
      requestId: randomUUID(),
    });
  } catch (err) {
    await releaseClaim(placeholder._id);
    throw err instanceof CalendarAuthError ? new CalendarError(err.message, err) : err;
  }

  if (config.assignmentStrategy === 'round-robin' && !input.preferredUserId) {
    await BookingAgentConfig.updateOne({ key: 'default' }, { $set: { roundRobinCursor: assigned.nextCursor } });
  }

  const booked = {
    eventId: created.eventId,
    meetingLink: created.meetingLink,
    salespersonUserId: chosen.userId,
    googleEmail: chosen.email,
    calendarId: chosen.calendarId,
  };
  await markConfirmed(placeholder, booked);
  return { ...booked, idempotencyKey: key };
}

async function claimBookingSlot(input: {
  leadId: string; name: string; phone: string; dateLabel: string; timeLabel: string; start: Date; durationMinutes: number;
}, key: string) {
  try {
    return await DemoBooking.create({
      leadId: input.leadId,
      name: input.name,
      phone: input.phone,
      date: input.dateLabel,
      timeSlot: input.timeLabel,
      status: 'Pending',
      channel: 'whatsapp',
      idempotencyKey: key,
      startUtc: input.start,
      endUtc: new Date(input.start.getTime() + input.durationMinutes * 60 * 1000),
    });
  } catch (err: any) {
    if (err?.code !== 11000) throw err;
    const row: any = await DemoBooking.findOne({ idempotencyKey: key });
    if (row?.status === 'Confirmed' && row.meetingLink) return row;
    if (row?.status === 'Pending' && !row.calendarEventId) {
      const age = Date.now() - new Date(row.updatedAt || 0).getTime();
      if (age > 2 * 60 * 1000) return row;
    }
    throw new SlotUnavailableError('This booking request is already being processed');
  }
}

async function markConfirmed(booking: any, created: {
  eventId: string; meetingLink: string; salespersonUserId?: string; googleEmail?: string; calendarId: string;
}) {
  booking.status = 'Confirmed';
  booking.calendarEventId = created.eventId;
  booking.meetingLink = created.meetingLink;
  booking.calendarId = created.calendarId;
  if (created.salespersonUserId) booking.salespersonUserId = created.salespersonUserId;
  if (created.googleEmail) booking.googleEmail = created.googleEmail;
  await booking.save();
}

async function releaseClaim(id: unknown) {
  await DemoBooking.deleteOne({ _id: id, status: 'Pending', meetingLink: { $in: [null, ''] } });
}

export async function cancelBookedEvent(booking: {
  calendarEventId?: string;
  calendarId?: string;
  salespersonUserId?: { toString(): string } | string;
}): Promise<void> {
  if (!booking.calendarEventId) return;
  if (booking.salespersonUserId) {
    await dbConnect();
    const connection = await SalespersonCalendarConnection.findOne({
      userId: booking.salespersonUserId,
      status: 'active',
    });
    if (!connection) return;
    const token = await accessTokenFor(connection);
    await deleteCalendarEvent(token, booking.calendarId || connection.calendarId || 'primary', booking.calendarEventId);
    return;
  }
  const { cancelDemoEvent } = await import('@/services/calendar/googleCalendar');
  await cancelDemoEvent(booking.calendarEventId);
}

export async function suggestWhenBusy(start: Date): Promise<RequestedSlot[]> {
  const { config } = await loadSchedule();
  const connections = await SalespersonCalendarConnection.find({ status: 'active' });
  const horizon = new Date(start.getTime() + config.maxDaysAhead * 24 * 60 * 60 * 1000);
  const busyByUser = [];
  for (const connection of connections) {
    try {
      const token = await accessTokenFor(connection);
      const busy = await queryFreeBusy(token, connection.calendarId || 'primary', start, horizon);
      busyByUser.push({ userId: String(connection.userId), busy });
    } catch {
      busyByUser.push({ userId: String(connection.userId), busy: [{ start, end: horizon }] });
    }
  }
  if (!busyByUser.length) return [];
  return alternativeSlots({ now: new Date(), config, around: start, busyByUser, limit: 2 });
}

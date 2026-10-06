import dbConnect from '@/lib/mongodb';
import DemoBooking from '@/models/DemoBooking';
import SalespersonCalendarConnection from '@/models/SalespersonCalendarConnection';
import { loadSchedule } from '@/services/calendar/bookDemoOnCalendar';
import {
  rangesOverlap,
  slotFitsSchedule,
  zonedLocalToUtc,
  zonedParts,
  type BusyRange,
} from '@/services/calendar/demoScheduling';
import { accessTokenFor, queryFreeBusy } from '@/services/calendar/salespersonCalendar';

export interface OpenSlot {
  /** "HH:mm" in the demo timezone. */
  time: string;
  /** "4:00 PM" */
  label: string;
  startUtc: string;
}

export interface OpenSlotsResult {
  date: string;
  timezone: string;
  durationMinutes: number;
  slots: OpenSlot[];
  /** Earliest/latest bookable dates, for the date picker. */
  minDate: string;
  maxDate: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
function label(time: string): string {
  const mins = toMinutes(time);
  const h24 = Math.floor(mins / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad(mins % 60)} ${h24 >= 12 ? 'PM' : 'AM'}`;
}
function dateInZone(d: Date, timeZone: string): string {
  const p = zonedParts(d, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Open demo slots on one calendar day, for the public /book-demo slot picker.
 *
 * A slot is open when it fits the working-hours schedule (same rules the
 * WhatsApp booking agent enforces), is not already taken by a Pending/Confirmed
 * DemoBooking, and — when salesperson calendars are connected — at least one
 * connected calendar is free. If every connected calendar fails to answer we
 * return NO slots rather than guess (a wrong "open" slot would double-book).
 */
export async function listOpenSlots(date: string, now = new Date()): Promise<OpenSlotsResult> {
  await dbConnect();
  const { config } = await loadSchedule();
  const tz = config.timezone;
  const step = config.demoDurationMinutes;
  const durationMs = step * 60 * 1000;

  const result: OpenSlotsResult = {
    date,
    timezone: tz,
    durationMinutes: step,
    slots: [],
    minDate: dateInZone(new Date(now.getTime() + config.minAdvanceMinutes * 60 * 1000), tz),
    maxDate: dateInZone(new Date(now.getTime() + config.maxDaysAhead * 24 * 60 * 60 * 1000), tz),
  };

  const open = toMinutes(config.openingTime);
  const close = toMinutes(config.closingTime);
  const candidates: Array<{ time: string; startUtc: Date }> = [];
  for (let minute = open; minute + step <= close; minute += step) {
    const time = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
    const startUtc = zonedLocalToUtc(date, time, tz);
    if (slotFitsSchedule({ date, time, startUtc }, now, config)) continue;
    candidates.push({ time, startUtc });
  }
  if (!candidates.length) return result;

  const dayStart = candidates[0].startUtc;
  const dayEnd = new Date(candidates[candidates.length - 1].startUtc.getTime() + durationMs);
  const buffer = config.bufferMinutes * 60 * 1000;

  // Slots already promised to someone else (booked or awaiting confirmation).
  const taken = (await DemoBooking.find({
    status: { $in: ['Pending', 'Confirmed'] },
    startUtc: { $gte: new Date(dayStart.getTime() - durationMs), $lte: dayEnd },
  })
    .select('startUtc endUtc')
    .lean()) as any[];
  const takenRanges: BusyRange[] = taken.map((b) => ({
    start: new Date(b.startUtc),
    end: b.endUtc ? new Date(b.endUtc) : new Date(new Date(b.startUtc).getTime() + durationMs),
  }));

  const connections = await SalespersonCalendarConnection.find({ status: 'active' });
  const calendars: BusyRange[][] = [];
  for (const connection of connections) {
    try {
      const token = await accessTokenFor(connection);
      calendars.push(
        await queryFreeBusy(
          token,
          connection.calendarId || 'primary',
          new Date(dayStart.getTime() - buffer),
          new Date(dayEnd.getTime() + buffer)
        )
      );
    } catch (err: any) {
      console.warn('[publicSlots] free/busy failed for a salesperson calendar:', err?.message);
    }
  }
  // Calendars are connected but none could be read → don't offer guesses.
  if (connections.length && !calendars.length) return result;

  for (const c of candidates) {
    const end = new Date(c.startUtc.getTime() + durationMs);
    if (rangesOverlap(c.startUtc, end, takenRanges, 0)) continue;
    if (calendars.length && !calendars.some((busy) => !rangesOverlap(c.startUtc, end, busy, config.bufferMinutes))) continue;
    result.slots.push({ time: c.time, label: label(c.time), startUtc: c.startUtc.toISOString() });
  }
  return result;
}

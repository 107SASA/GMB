/**
 * Dated festival calendar (India). Dates are STORED — never computed or
 * guessed by AI. Source: officeholidays.com India 2026/2027 lists (fetched
 * 2026-09-29), except where noted. Moon-dependent dates (Eid) can shift by a
 * day with the sighting; Navratri start is derived as 9 days before the
 * listed Dussehra date. Refresh this file every year.
 *
 * Pure (no imports) — runs under `node --test`.
 */

export interface Festival {
  key: string;
  name: string;
  /** ISO date (local, India). */
  date: string;
  /** Date may move by a day (moon sighting / regional observance). */
  approximate?: boolean;
  note?: string;
}

export const FESTIVALS: Festival[] = [
  // 2026
  { key: 'republic-day-2026', name: 'Republic Day', date: '2026-01-26' },
  { key: 'holi-2026', name: 'Holi', date: '2026-03-04' },
  { key: 'eid-al-fitr-2026', name: 'Eid al-Fitr', date: '2026-03-20', approximate: true, note: 'Listed as 20–21 March; moon-dependent' },
  { key: 'eid-al-adha-2026', name: 'Eid al-Adha', date: '2026-05-26', approximate: true, note: 'Listed as 26–28 May; moon-dependent' },
  { key: 'independence-day-2026', name: 'Independence Day', date: '2026-08-15' },
  { key: 'ganesh-chaturthi-2026', name: 'Ganesh Chaturthi', date: '2026-09-14' },
  { key: 'navratri-2026', name: 'Navratri', date: '2026-10-11', approximate: true, note: 'Derived: 9 days before Dussehra (20 Oct)' },
  { key: 'dussehra-2026', name: 'Dussehra', date: '2026-10-20', note: 'Listed as 20–21 October (regional)' },
  { key: 'diwali-2026', name: 'Diwali', date: '2026-11-08' },
  { key: 'christmas-2026', name: 'Christmas', date: '2026-12-25' },
  // 2027
  { key: 'new-year-2027', name: 'New Year', date: '2027-01-01' },
  { key: 'republic-day-2027', name: 'Republic Day', date: '2027-01-26' },
  { key: 'eid-al-fitr-2027', name: 'Eid al-Fitr', date: '2027-03-09', approximate: true, note: 'Moon-dependent' },
  { key: 'holi-2027', name: 'Holi', date: '2027-03-22' },
  { key: 'eid-al-adha-2027', name: 'Eid al-Adha', date: '2027-05-17', approximate: true, note: 'Moon-dependent' },
  { key: 'independence-day-2027', name: 'Independence Day', date: '2027-08-15' },
  { key: 'ganesh-chaturthi-2027', name: 'Ganesh Chaturthi', date: '2027-09-04' },
  { key: 'navratri-2027', name: 'Navratri', date: '2027-09-30', approximate: true, note: 'Derived: 9 days before Dussehra (9 Oct)' },
  { key: 'dussehra-2027', name: 'Dussehra', date: '2027-10-09' },
  { key: 'diwali-2027', name: 'Diwali', date: '2027-10-29' },
  { key: 'christmas-2027', name: 'Christmas', date: '2027-12-25' },
  { key: 'new-year-2028', name: 'New Year', date: '2028-01-01' },
];

const DAY = 86_400_000;
const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Festivals whose date falls in [from, from + days) (IST calendar days). */
export function festivalsBetween(from: Date, days: number): Festival[] {
  const start = istDay(from);
  const end = istDay(new Date(from.getTime() + days * DAY));
  return FESTIVALS.filter((f) => f.date >= start && f.date < end);
}

/** Last stored date — callers can warn when the calendar needs extending. */
export function calendarCoversUntil(): string {
  return FESTIVALS.map((f) => f.date).sort().slice(-1)[0];
}

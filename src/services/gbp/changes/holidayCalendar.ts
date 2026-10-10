/**
 * Public holidays for reminder display only.
 * Copied from Google's published Holidays in India calendar on 2026-10-10.
 * Source: https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics
 * Entries that calendar marks as tentative are omitted. Dates are not calculated here.
 * A country without an entry stays unconfigured.
 */
export interface HolidayEntry { date: string; name: string }

const INDIA: HolidayEntry[] = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-01-03", name: "Hazarat Ali's Birthday" },
  { date: "2026-01-14", name: "Makar Sankranti" },
  { date: "2026-01-14", name: "Pongal" },
  { date: "2026-01-23", name: "Vasant Panchami" },
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-02-01", name: "Guru Ravidas Jayanti" },
  { date: "2026-02-12", name: "Maharishi Dayanand Saraswati Jayanti" },
  { date: "2026-02-15", name: "Maha Shivaratri" },
  { date: "2026-02-19", name: "Ramadan Start" },
  { date: "2026-02-19", name: "Shivaji Jayanti" },
  { date: "2026-03-03", name: "Holika Dahana" },
  { date: "2026-03-04", name: "Holi" },
  { date: "2026-03-19", name: "Cheti Chand" },
  { date: "2026-03-19", name: "Gudi Padwa" },
  { date: "2026-03-19", name: "Ugadi" },
  { date: "2026-03-20", name: "Jamat Ul-Vida" },
  { date: "2026-03-21", name: "Ramzan Id" },
  { date: "2026-03-26", name: "Rama Navami" },
  { date: "2026-03-31", name: "Mahavir Jayanti" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-14", name: "Ambedkar Jayanti" },
  { date: "2026-04-14", name: "Mesadi" },
  { date: "2026-04-14", name: "Vaisakhi" },
  { date: "2026-04-14", name: "Vishu" },
  { date: "2026-04-15", name: "Bahag Bihu (Assam)" },
  { date: "2026-04-15", name: "Vaisakhadi (Bengal)" },
  { date: "2026-05-01", name: "Buddha Purnima" },
  { date: "2026-05-09", name: "Birthday of Rabindranath" },
  { date: "2026-05-28", name: "Bakrid" },
  { date: "2026-06-26", name: "Muharram/Ashura" },
  { date: "2026-07-16", name: "Rath Yatra" },
  { date: "2026-08-15", name: "Independence Day" },
  { date: "2026-08-15", name: "Parsi New Year" },
  { date: "2026-08-26", name: "Milad un-Nabi" },
  { date: "2026-08-26", name: "Onam" },
  { date: "2026-08-28", name: "Raksha Bandhan" },
  { date: "2026-09-04", name: "Janmashtami" },
  { date: "2026-09-04", name: "Janmashtami (Smarta)" },
  { date: "2026-09-14", name: "Ganesh Chaturthi" },
  { date: "2026-10-02", name: "Mahatma Gandhi Jayanti" },
  { date: "2026-10-11", name: "First Day of Sharad Navratri" },
  { date: "2026-10-17", name: "First Day of Durga Puja Festivities" },
  { date: "2026-10-18", name: "Maha Saptami" },
  { date: "2026-10-19", name: "Maha Ashtami" },
  { date: "2026-10-20", name: "Dussehra" },
  { date: "2026-10-26", name: "Maharishi Valmiki Jayanti" },
  { date: "2026-10-29", name: "Karaka Chaturthi" },
  { date: "2026-11-08", name: "Diwali/Deepavali" },
  { date: "2026-11-08", name: "Naraka Chaturdasi" },
  { date: "2026-11-09", name: "Govardhan Puja" },
  { date: "2026-11-11", name: "Bhai Duj" },
  { date: "2026-11-15", name: "Chhat Puja (Pratihar Sashthi/Surya Sashthi)" },
  { date: "2026-11-24", name: "Guru Nanak Jayanti" },
  { date: "2026-11-24", name: "Guru Tegh Bahadur's Martyrdom Day" },
  { date: "2026-12-23", name: "Hazarat Ali's Birthday" },
  { date: "2026-12-24", name: "Christmas Eve" },
  { date: "2026-12-25", name: "Christmas" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-01-14", name: "Makar Sankranti" },
  { date: "2027-01-15", name: "Guru Govind Singh Jayanti" },
  { date: "2027-01-15", name: "Pongal" },
  { date: "2027-01-26", name: "Republic Day" },
  { date: "2027-02-11", name: "Vasant Panchami" },
  { date: "2027-02-19", name: "Shivaji Jayanti" },
  { date: "2027-02-20", name: "Guru Ravidas Jayanti" },
  { date: "2027-03-02", name: "Maharishi Dayanand Saraswati Jayanti" },
  { date: "2027-03-05", name: "Jamat Ul-Vida" },
  { date: "2027-03-06", name: "Maha Shivaratri" },
  { date: "2027-03-22", name: "Dolyatra" },
  { date: "2027-03-22", name: "Holi" },
  { date: "2027-03-22", name: "Holika Dahana" },
  { date: "2027-03-26", name: "Good Friday" },
  { date: "2027-04-07", name: "Chaitra Sukhladi" },
  { date: "2027-04-07", name: "Cheti Chand" },
  { date: "2027-04-07", name: "Gudi Padwa" },
  { date: "2027-04-07", name: "Ugadi" },
  { date: "2027-04-14", name: "Ambedkar Jayanti" },
  { date: "2027-04-14", name: "Mesadi" },
  { date: "2027-04-14", name: "Vaisakhi" },
  { date: "2027-04-14", name: "Vishu" },
  { date: "2027-04-15", name: "Bahag Bihu (Assam)" },
  { date: "2027-04-15", name: "Rama Navami" },
  { date: "2027-04-15", name: "Vaisakhadi (Bengal)" },
  { date: "2027-04-19", name: "Mahavir Jayanti" },
  { date: "2027-05-09", name: "Birthday of Rabindranath" },
  { date: "2027-05-20", name: "Buddha Purnima" },
  { date: "2027-07-05", name: "Rath Yatra" },
  { date: "2027-08-15", name: "Independence Day" },
  { date: "2027-08-15", name: "Parsi New Year" },
  { date: "2027-08-17", name: "Raksha Bandhan" },
  { date: "2027-08-25", name: "Janmashtami" },
  { date: "2027-08-25", name: "Janmashtami (Smarta)" },
  { date: "2027-09-04", name: "Ganesh Chaturthi" },
  { date: "2027-09-12", name: "Onam" },
  { date: "2027-09-30", name: "First Day of Sharad Navratri" },
  { date: "2027-10-02", name: "Mahatma Gandhi Jayanti" },
  { date: "2027-10-05", name: "First Day of Durga Puja Festivities" },
  { date: "2027-10-06", name: "Maha Saptami" },
  { date: "2027-10-07", name: "Maha Ashtami" },
  { date: "2027-10-08", name: "Maha Navami" },
  { date: "2027-10-09", name: "Dussehra" },
  { date: "2027-10-15", name: "Maharishi Valmiki Jayanti" },
  { date: "2027-10-18", name: "Karaka Chaturthi" },
  { date: "2027-10-28", name: "Naraka Chaturdasi" },
  { date: "2027-10-29", name: "Diwali/Deepavali" },
  { date: "2027-10-30", name: "Govardhan Puja" },
  { date: "2027-10-31", name: "Bhai Duj" },
  { date: "2027-11-04", name: "Chhat Puja (Pratihar Sashthi/Surya Sashthi)" },
  { date: "2027-11-14", name: "Guru Nanak Jayanti" },
  { date: "2027-11-24", name: "Guru Tegh Bahadur's Martyrdom Day" },
  { date: "2027-12-12", name: "Hazarat Ali's Birthday" },
  { date: "2027-12-24", name: "Christmas Eve" },
  { date: "2027-12-25", name: "Christmas" },
];

const CALENDARS: Record<string, HolidayEntry[]> = { IN: INDIA };

export function holidayCalendarFor(regionCode: string | null | undefined): HolidayEntry[] | null {
  const raw = String(regionCode || '').trim().toUpperCase();
  const key = raw === 'INDIA' ? 'IN' : raw;
  return CALENDARS[key] || null;
}

/** Calendar date in the business timezone. An invalid timezone returns null. */
export function calendarDate(timeZone: string | null | undefined, now: Date): string | null {
  const zone = String(timeZone || '').trim();
  if (!zone) return null;
  try {
    const formatted = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : null;
  } catch {
    return null;
  }
}

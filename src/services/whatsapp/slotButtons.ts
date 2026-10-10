/**
 * WhatsApp buttons and lists for demo booking. Pure: no sending, no database.
 * Flow: pick a day (Today / Tomorrow / Other date), then pick a time from that day's list.
 */

export interface SlotChoice {
  date: string;
  time: string;
}

export interface SlotButton {
  id: string;
  title: string;
}

export interface SlotListItem {
  id: string;
  item: string;
  description?: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const OTHER_DATE_ID = 'other-date';
/** A WhatsApp list holds 10 rows. One is kept for "Another day". */
export const MAX_LISTED_SLOTS = 9;

export const DAY_CHOICE_BUTTONS: SlotButton[] = [
  { id: 'today', title: 'Today' },
  { id: 'tomorrow', title: 'Tomorrow' },
  { id: OTHER_DATE_ID, title: 'Other date' },
];

export const ASK_DAY = 'When would you like your demo?';
export const ASK_CUSTOM_DATE = 'Which date works for you? You can type it like 12 Oct, 12/10, or just 12.';

/** "4:00 PM" from "16:00". */
export function timeLabel(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute || 0).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

/** "Mon 12 Oct" from "2026-10-12". */
export function dateLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const when = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  return `${DAYS[when.getUTCDay()]} ${day} ${MONTHS[(month || 1) - 1]}`;
}

/** WhatsApp quick-reply titles are limited to 20 characters. */
export function slotButtonTitle(date: string, time: string): string {
  return `${dateLabel(date)} ${timeLabel(time)}`.slice(0, 20);
}

/** Buttons for other open days, plus "Other date". Ids are the ISO date, which parseDemoDate reads back. */
export function dateButtons(dates: string[]): SlotButton[] {
  return [
    ...dates.slice(0, 2).map((date) => ({ id: date, title: dateLabel(date) })),
    { id: OTHER_DATE_ID, title: 'Other date' },
  ];
}

/** List rows for the offered times. Ids are 1..n so a tap or a typed number picks the same slot. */
export function slotListItems(slots: SlotChoice[]): SlotListItem[] {
  return [
    ...slots.slice(0, MAX_LISTED_SLOTS).map((slot, index) => ({
      id: String(index + 1),
      item: timeLabel(slot.time),
      description: dateLabel(slot.date),
    })),
    { id: OTHER_DATE_ID, item: 'Another day' },
  ];
}

/** Text version of the day choice, for when buttons cannot be sent. No numbers, so a reply is never mistaken for a date. */
export function dayChoiceText(intro: string): string {
  return `${intro}\n\nReply *today*, *tomorrow*, or type a date like 12 Oct.`;
}

/** Text version of the time list, for when the list cannot be sent. */
export function slotOfferText(intro: string, slots: SlotChoice[]): string {
  const lines = slots.slice(0, MAX_LISTED_SLOTS).map((slot, index) => `${index + 1}) ${dateLabel(slot.date)}, ${timeLabel(slot.time)}`);
  return `${intro}\n\n${lines.join('\n')}\n\nReply with the number, or type another date.`;
}

/** The "Other date" button, or the customer saying they want a different day. */
export function isOtherDateChoice(reply: string): boolean {
  const text = (reply || '').trim().toLowerCase().replace(/[.!?]+$/, '');
  if (text === OTHER_DATE_ID) return true;
  return /^(?:(?:an)?other|custom|different|change|some ?other|pick another|choose another)(?:\s+(?:day|date))?$/.test(text)
    || /^(?:other|another|different) (?:day|date)\b/.test(text);
}

function clockFromText(text: string): string | null {
  const cleaned = text.toLowerCase().replace(/(\d{1,2})[.:](\d{2})/g, '$1:$2');
  const clocks = [...cleaned.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/g)];
  if (!clocks.length) return null;
  const last = clocks[clocks.length - 1];
  let hour = Number(last[1]);
  const minute = last[2] ? Number(last[2]) : 0;
  if (last[3] === 'pm' && hour < 12) hour += 12;
  if (last[3] === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Which offered slot a tap or a typed reply means.
 * A leading number wins ("1", "option 2"). Otherwise the clock time in the message
 * ("10 am", "12 october 10am") is matched to a slot that was actually offered.
 */
export function pickOfferedSlotIndex(reply: string, slots: SlotChoice[]): number | null {
  const text = (reply || '').trim().toLowerCase();
  if (!text || !slots.length) return null;

  // "2 pm" or "2:30" is a clock time, not button 2.
  const choice = text.match(/^(?:option\s*)?(\d{1,2})(?![\d:.]|\s*(?:am|pm)\b)/);
  if (choice) {
    const index = parseInt(choice[1], 10) - 1;
    if (index >= 0 && index < slots.length) return index;
  }

  const clock = clockFromText(text);
  if (clock) {
    const matches = slots
      .map((slot, index) => ({ slot, index }))
      .filter((item) => item.slot.time === clock);
    if (matches.length === 1) return matches[0].index;
    const day = text.match(/\b(\d{1,2})\b/);
    if (matches.length > 1 && day) {
      const named = matches.find((item) => Number(item.slot.date.slice(-2)) === Number(day[1]));
      if (named) return named.index;
    }
  }

  for (let index = 0; index < slots.length; index++) {
    const title = slotButtonTitle(slots[index].date, slots[index].time).toLowerCase();
    if (text.includes(title)) return index;
  }
  return null;
}

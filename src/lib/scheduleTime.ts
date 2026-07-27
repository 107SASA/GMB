/**
 * Helpers for `<input type="datetime-local">` scheduling fields.
 *
 * A datetime-local input value is ALWAYS interpreted in the browser's local
 * timezone. Formatting it with `Date.prototype.toISOString()` (which is UTC)
 * therefore shifts both the displayed value and the `min` bound by the user's
 * UTC offset — for users behind UTC this made most of "today" unselectable, so
 * posts could effectively only be scheduled from tomorrow. These helpers format
 * using LOCAL calendar fields so "later today" is always selectable and the
 * displayed default time is correct in every timezone.
 */

/** Format a Date as a `datetime-local` value (`YYYY-MM-DDTHH:mm`) in LOCAL time. */
export function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** The earliest selectable moment (now, local) — for a `min` attribute. */
export function nowDateTimeLocal(): string {
  return toDateTimeLocal(new Date());
}

/**
 * Suggested default schedule time: tomorrow at 09:00 local. The user can move it
 * anywhere from `nowDateTimeLocal()` onward, including later the same day.
 */
export function defaultScheduleDateTimeLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toDateTimeLocal(d);
}

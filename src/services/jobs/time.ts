/**
 * Pure helpers (no DB, no `@/` aliases — unit-testable with node --test):
 * duration parsing, exponential backoff, and a 5-field cron evaluator.
 */

const UNIT_MS: Record<string, number> = {
  ms: 1, s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  d: 86_400_000, day: 86_400_000, days: 86_400_000,
  w: 604_800_000, week: 604_800_000, weeks: 604_800_000,
};

/** "15s", "5m", "2 hours", "1d", or a number of ms → milliseconds. Throws on garbage. */
export function parseDurationMs(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) throw new Error(`Invalid duration: ${input}`);
    return Math.floor(input);
  }
  const m = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s*$/.exec(input);
  const unit = m ? UNIT_MS[m[2].toLowerCase()] : undefined;
  if (!m || unit === undefined) throw new Error(`Invalid duration: ${JSON.stringify(input)}`);
  return Math.floor(parseFloat(m[1]) * unit);
}

/**
 * Retry delay after the Nth consecutive failure (1-based): base·2^(n-1),
 * capped, with ±`jitter` fraction of random spread so a burst of failures
 * does not retry in lockstep. `rand` is injectable for tests.
 */
export function backoffMs(
  failedAttempts: number,
  opts: { baseMs?: number; capMs?: number; jitter?: number; rand?: () => number } = {}
): number {
  const { baseMs = 30_000, capMs = 60 * 60_000, jitter = 0.2, rand = Math.random } = opts;
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, failedAttempts - 1));
  const spread = 1 - jitter + rand() * jitter * 2; // [1-jitter, 1+jitter)
  return Math.min(capMs, Math.floor(exp * spread));
}

// ---------------------------------------------------------------- cron ----

export interface CronSpec {
  minutes: Set<number>;
  hours: Set<number>;
  dom: Set<number>;
  months: Set<number>;
  dow: Set<number>;
  domStar: boolean;
  dowStar: boolean;
}

function parseField(field: string, min: number, max: number, name: string): { set: Set<number>; star: boolean } {
  const set = new Set<number>();
  let star = false;
  for (const part of field.split(',')) {
    const [range, stepStr] = part.split('/');
    const step = stepStr === undefined ? 1 : Number(stepStr);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad cron step in ${name}: ${part}`);
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
      if (stepStr === undefined) star = true;
    } else if (/^\d+$/.test(range)) {
      lo = Number(range);
      hi = stepStr === undefined ? lo : max;
    } else if (/^\d+-\d+$/.test(range)) {
      [lo, hi] = range.split('-').map(Number);
    } else {
      throw new Error(`Unsupported cron token in ${name}: ${part}`);
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`Cron ${name} out of range: ${part}`);
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return { set, star };
}

/** Parse a 5-field cron (UTC). Throws on anything unsupported (names, TZ=, 6-field, L/W/#). */
export function parseCron(expr: string): CronSpec {
  if (/^\s*TZ=/i.test(expr)) throw new Error(`Cron timezones are not supported: ${expr}`);
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`Cron must have 5 fields: ${expr}`);
  const minutes = parseField(f[0], 0, 59, 'minute');
  const hours = parseField(f[1], 0, 23, 'hour');
  const dom = parseField(f[2], 1, 31, 'day-of-month');
  const months = parseField(f[3], 1, 12, 'month');
  const dowRaw = parseField(f[4], 0, 7, 'day-of-week');
  const dow = new Set([...dowRaw.set].map((d) => (d === 7 ? 0 : d)));
  return {
    minutes: minutes.set,
    hours: hours.set,
    dom: dom.set,
    months: months.set,
    dow,
    domStar: dom.star,
    dowStar: dowRaw.star,
  };
}

export function cronMatches(spec: CronSpec, d: Date): boolean {
  if (!spec.minutes.has(d.getUTCMinutes()) || !spec.hours.has(d.getUTCHours()) || !spec.months.has(d.getUTCMonth() + 1)) {
    return false;
  }
  const domOk = spec.dom.has(d.getUTCDate());
  const dowOk = spec.dow.has(d.getUTCDay());
  // Standard cron: when both day fields are restricted, either may match.
  if (!spec.domStar && !spec.dowStar) return domOk || dowOk;
  return domOk && dowOk;
}

const MINUTE = 60_000;

/**
 * Every scheduled slot in (afterMs, untilMs], oldest first, capped at `limit`
 * (a long outage must not allocate unbounded arrays). Slots are minute-aligned UTC.
 */
export function slotsBetween(spec: CronSpec, afterMs: number, untilMs: number, limit = 10_000): number[] {
  const out: number[] = [];
  let t = Math.floor(afterMs / MINUTE) * MINUTE + MINUTE;
  for (; t <= untilMs && out.length < limit; t += MINUTE) {
    if (cronMatches(spec, new Date(t))) out.push(t);
  }
  return out;
}

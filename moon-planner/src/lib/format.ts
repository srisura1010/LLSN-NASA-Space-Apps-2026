// The one home for number, angle, date and time formatting. All times are UTC.
// Every view formats through these so the same value reads the same everywhere.

// ---------- Time constants ----------

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
/** Short aliases, used where the unit is obvious. */
export const HOUR = HOUR_MS;
export const DAY = DAY_MS;

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** A true minus sign, for negative numbers. */
export const MINUS = "−";

const two = (n: number) => String(n).padStart(2, "0");
const toMinute = (ms: number) => Math.round(ms / MINUTE_MS) * MINUTE_MS;
const trim = (v: number, digits: number) => String(Number(v.toFixed(digits)));

// ---------- Dates and times ----------

/** "2 Jun", or "2 Jun 2027" with the year. */
export function fmtDay(ms: number, withYear = false): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ""}`;
}

/** "13:24", rounded to the minute. */
export function fmtTime(ms: number): string {
  const d = new Date(toMinute(ms));
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** "2 Jun 06h" (hour only). */
export function fmtDayHour(ms: number): string {
  const t = toMinute(ms);
  return `${fmtDay(t)} ${two(new Date(t).getUTCHours())}h`;
}

/** "2 Jun 13:24". */
export function fmtDayTime(ms: number): string {
  const t = toMinute(ms);
  return `${fmtDay(t)} ${fmtTime(t)}`;
}

/** "2 Jun 2027, 13:24", or "2 Jun, 13:24" without the year (the caller adds UTC where it is not clear). */
export function fmtWhen(ms: number, withYear = true): string {
  const t = toMinute(ms);
  return `${fmtDay(t, withYear)}, ${fmtTime(t)}`;
}

/** "2 Jun 2027, 13:24 UTC". */
export function fmtFull(ms: number): string {
  return `${fmtWhen(ms)} UTC`;
}

/** "1 Jun 2027, 00:00 to 7 Jun, 12:00 UTC" (the year is repeated only when it changes). */
export function fmtSpan(startMs: number, endMs: number): string {
  const sameYear = new Date(startMs).getUTCFullYear() === new Date(endMs).getUTCFullYear();
  return `${fmtWhen(startMs)} to ${fmtWhen(endMs, !sameYear)} UTC`;
}

/** "14–20 Nov 2027", "28 Nov – 4 Dec 2027": a compact window for chips and headings. */
export function fmtDateRange(startMs: number, endMs: number): string {
  const a = new Date(startMs);
  const b = new Date(endMs);
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${fmtDay(startMs, true)} – ${fmtDay(endMs, true)}`;
  if (a.getUTCMonth() !== b.getUTCMonth()) return `${fmtDay(startMs)} – ${fmtDay(endMs, true)}`;
  if (a.getUTCDate() === b.getUTCDate()) return fmtDay(startMs, true);
  return `${a.getUTCDate()}–${fmtDay(endMs, true)}`;
}

/** "November 2027". */
export function fmtMonth(month: number, year = 2027): string {
  return `${MONTHS_LONG[month]} ${year}`;
}

/** Elapsed time since mission start: "T+2 d 14 h". */
export function fmtElapsed(ms: number): string {
  const h = Math.round(ms / HOUR_MS);
  const sign = h < 0 ? MINUS : "+";
  const a = Math.abs(h);
  const d = Math.floor(a / 24);
  const r = a % 24;
  return d ? `T${sign}${d} d ${r} h` : `T${sign}${r} h`;
}

// ---------- Durations ----------

/** Duration in hours as "35 min", "21 h" or "3 d 4 h", rounded to the hour before splitting into days. */
export function fmtDuration(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  const total = Math.round(hours);
  if (total < 48) return `${total} h`;
  const d = Math.floor(total / 24);
  const r = total % 24;
  return r ? `${d} d ${r} h` : `${d} d`;
}

/** A dark or no-comms spell, or "None". */
export function fmtSpell(hours: number): string {
  return hours > 0 ? fmtDuration(hours) : "None";
}

/** Minutes as "12 h 27 min", "39 min". */
export function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Mission length: "6.5 days", "36 hours", "1 day". */
export function fmtLength(hours: number): string {
  const d = hours / 24;
  if (hours >= 24 && Math.abs(d * 2 - Math.round(d * 2)) < 1e-9) return `${trim(d, 1)} ${d === 1 ? "day" : "days"}`;
  if (hours < 48) return `${trim(hours, 1)} ${hours === 1 ? "hour" : "hours"}`;
  return fmtDuration(hours);
}

/** Mission length, short: "6.5 d", "36 h". */
export function fmtLengthShort(hours: number): string {
  const d = hours / 24;
  if (hours >= 24 && Math.abs(d * 2 - Math.round(d * 2)) < 1e-9) return `${trim(d, 1)} d`;
  return `${trim(hours, 1)} h`;
}

/** Signed shift of a window: "+1 day", "+1 week", "+2 weeks", "−3 d", "+1 d 6 h", "+6 h". */
export function fmtShift(ms: number): string {
  const h = Math.round(ms / HOUR_MS);
  const sign = h < 0 ? MINUS : "+";
  const a = Math.abs(h);
  if (a > 0 && a % (7 * 24) === 0) {
    const w = a / (7 * 24);
    return `${sign}${w} ${w === 1 ? "week" : "weeks"}`;
  }
  if (a === 24) return `${sign}1 day`;
  const d = Math.floor(a / 24);
  const r = a % 24;
  if (!d) return `${sign}${r} h`;
  return r ? `${sign}${d} d ${r} h` : `${sign}${d} d`;
}

// ---------- Shares ----------

/** Share (0..1) as a whole percentage that never rounds a partial value to 0 or 100: "<1%", ">99%". */
export function pct(v: number): string {
  if (!Number.isFinite(v)) return "n/a";
  if (v <= 0) return "0%";
  if (v >= 1) return "100%";
  const r = Math.round(v * 100);
  if (r === 0) return "<1%";
  if (r === 100) return ">99%";
  return `${r}%`;
}

/** Share (0..1) as a percentage with one decimal. */
export function pct1(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** Signed percentage points with one decimal: "+1.2", "−0.3", "0.0". */
export function pts(v: number): string {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return "0.0";
  return `${r > 0 ? "+" : MINUS}${Math.abs(r).toFixed(1)}`;
}

// ---------- Numbers and angles ----------

/** Whole number with thousands separators: "379,327". */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Angle with a true minus sign: "4.1°", "−0.3°". */
export function fmtDeg(v: number, digits = 1): string {
  const s = Math.abs(v).toFixed(digits);
  return `${v < 0 && Number(s) !== 0 ? MINUS : ""}${s}°`;
}

/** Angle always signed: "+7.1°", "−3.4°", "0.0°". */
export function fmtSigned(v: number, digits = 1): string {
  const s = Math.abs(v).toFixed(digits);
  if (Number(s) === 0) return `${s}°`;
  return `${v < 0 ? MINUS : "+"}${s}°`;
}

/** Azimuth in 0..360: "212.4°". */
export function fmtAz(v: number, digits = 1): string {
  const a = ((v % 360) + 360) % 360;
  return `${a.toFixed(digits)}°`;
}

// ---------- Positions ----------

/** "85.43° S". */
export function fmtLat(v: number, digits = 2): string {
  return `${Math.abs(v).toFixed(digits)}° ${v < 0 ? "S" : "N"}`;
}

/** "31.74° E" (east-positive input). */
export function fmtLon(v: number, digits = 2): string {
  return `${Math.abs(v).toFixed(digits)}° ${v < 0 ? "W" : "E"}`;
}

/** "85.43° S, 31.74° E". */
export function fmtLatLon(lat: number, lon: number, digits = 2): string {
  return `${fmtLat(lat, digits)}, ${fmtLon(lon, digits)}`;
}

/** Graticule label, whole degrees: "86° S", "90° E", "0°", "180°". */
export function fmtLatTick(v: number): string {
  return v === 0 ? "0°" : `${Math.abs(v)}° ${v < 0 ? "S" : "N"}`;
}

export function fmtLonTick(v: number): string {
  const w = ((v + 540) % 360) - 180;
  return w === 0 ? "0°" : Math.abs(w) === 180 ? "180°" : `${Math.abs(w)}° ${w < 0 ? "W" : "E"}`;
}

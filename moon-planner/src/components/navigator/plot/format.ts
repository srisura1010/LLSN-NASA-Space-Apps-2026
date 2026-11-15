// UTC time and angle formatting shared by the horizon plot and the timeline.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MINUS = "−";
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

const pad = (n: number) => String(n).padStart(2, "0");
const toMinute = (ms: number) => Math.round(ms / 60_000) * 60_000;

/** "2 Jun" */
export function fmtDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "2 Jun 06h" (bulletin style, hour only) */
export function fmtDayHour(ms: number): string {
  const d = new Date(toMinute(ms));
  return `${fmtDay(d.getTime())} ${pad(d.getUTCHours())}h`;
}

/** "13:24" */
export function fmtTime(ms: number): string {
  const d = new Date(toMinute(ms));
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "2 Jun 13:24" */
export function fmtDayTime(ms: number): string {
  const t = toMinute(ms);
  return `${fmtDay(t)} ${fmtTime(t)}`;
}

/** "2 Jun 2027, 13:24 UTC" */
export function fmtFull(ms: number): string {
  const t = toMinute(ms);
  return `${fmtDay(t)} ${new Date(t).getUTCFullYear()}, ${fmtTime(t)} UTC`;
}

/** Signed angle with a true minus sign: "+7.1°", "−3.4°". */
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

/** Elapsed time since mission start: "T+2 d 14 h". */
export function fmtElapsed(ms: number): string {
  const h = Math.round(ms / HOUR_MS);
  const sign = h < 0 ? MINUS : "+";
  const a = Math.abs(h);
  const d = Math.floor(a / 24);
  const r = a % 24;
  return d ? `T${sign}${d} d ${r} h` : `T${sign}${r} h`;
}

/** Signed shift of a window: "+1 week", "+2 weeks", "−3 d", "+1 d 6 h", "+6 h". */
export function fmtShift(ms: number): string {
  const h = Math.round(ms / HOUR_MS);
  const sign = h < 0 ? MINUS : "+";
  const a = Math.abs(h);
  if (a > 0 && a % (7 * 24) === 0) {
    const w = a / (7 * 24);
    return `${sign}${w} ${w === 1 ? "week" : "weeks"}`;
  }
  const d = Math.floor(a / 24);
  const r = a % 24;
  if (!d) return `${sign}${r} h`;
  return r ? `${sign}${d} d ${r} h` : `${sign}${d} d`;
}

/** "1 Jun 2027, 00:00 to 7 Jun, 12:00 UTC" (year repeated only when it changes). */
export function fmtSpan(startMs: number, endMs: number): string {
  const a = new Date(toMinute(startMs));
  const b = new Date(toMinute(endMs));
  const yearB = a.getUTCFullYear() === b.getUTCFullYear() ? "" : ` ${b.getUTCFullYear()}`;
  return `${fmtDay(a.getTime())} ${a.getUTCFullYear()}, ${fmtTime(a.getTime())} to ${fmtDay(b.getTime())}${yearB}, ${fmtTime(b.getTime())} UTC`;
}

/** Duration in hours as "35 min", "21 h" or "3 d 4 h", rounded to the hour before splitting into days. */
export function fmtDuration(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  const total = Math.round(hours);
  if (total < 48) return `${total} h`;
  const d = Math.floor(total / 24);
  const r = total % 24;
  return r ? `${d} d ${r} h` : `${d} d`;
}

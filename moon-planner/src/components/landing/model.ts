// Constants and pure helpers shared by the landing page components.

import { sites } from "@/lib/sites";
import { sampleAt, type SiteData } from "@/lib/sky";
import { contactEvents } from "@/components/navigator/plot/contacts";

export const HOUR_MS = 3_600_000;
/** Surface stay shown on the landing page: 6.5 days. */
export const STAY_HOURS = 156;
export const SLIP_DAYS = 14;
/** Start dates the 2027 tracks can cover for a full stay (the data ends 1 Jan 2028 00:00 UTC). */
export const FIRST_DATE = "2027-01-01";
export const LAST_DATE = "2027-12-25";
export const DEFAULT_SITE_ID = "nobile-2";
export const DEFAULT_DATE = "2027-07-15";

export function siteById(id: string) {
  return sites.find((s) => s.id === id) ?? null;
}

/** Midnight UTC for a YYYY-MM-DD value, or null if it is not a real date inside the 2027 range. */
export function parseDate(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const t = new Date(ms);
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  if (value < FIRST_DATE || value > LAST_DATE) return null;
  return ms;
}

/** ISO 8601 to the hour, the form the Navigator writes and reads: 2027-07-15T00:00Z. */
export function isoHour(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 13)}:00Z`;
}

/** The Navigator reads `site`, `start` and `hours` from its search params. */
export function navigatorHref(siteId: string, startMs: number): string {
  return `/tool?site=${encodeURIComponent(siteId)}&start=${isoHour(startMs)}&hours=${STAY_HOURS}`;
}

/** Start used for the slip comparison: two weeks later, or two weeks earlier near the end of the data. */
export function slipStart(startMs: number): { ms: number; later: boolean } {
  const later = startMs + SLIP_DAYS * 24 * HOUR_MS;
  const last = parseDate(LAST_DATE) as number;
  return later <= last ? { ms: later, later: true } : { ms: startMs - SLIP_DAYS * 24 * HOUR_MS, later: false };
}

/** The one year the tracks cover. */
export const DATA_YEAR = Number(FIRST_DATE.slice(0, 4));

/** Days in a month (0 = Jan) of the data year. */
export function daysInMonth(month: number): number {
  return new Date(Date.UTC(DATA_YEAR, month + 1, 0)).getUTCDate();
}

/** Day and month (0 = Jan) of a YYYY-MM-DD value, or null if it is not in that form. */
export function dayMonthOf(value: string): { day: number; month: number } | null {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(value);
  return m ? { day: Number(m[2]), month: Number(m[1]) - 1 } : null;
}

/** YYYY-MM-DD in the data year for a day and month (0 = Jan). */
export function dateValue(day: number, month: number): string {
  return `${DATA_YEAR}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------- Formatting (UTC) ----------

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function fmtDayTime(ms: number): string {
  return `${fmtDay(ms)} ${fmtTime(ms)}`;
}

export function fmtDate(ms: number): string {
  return `${fmtDay(ms)} ${new Date(ms).getUTCFullYear()}`;
}

export function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Durations as the bulletin prints them: "22 h", "2 d 4 h", "none". */
export function fmtSpell(hours: number): string {
  if (hours <= 0) return "none";
  if (hours < 48) return `${Math.round(hours)} h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return h ? `${d} d ${h} h` : `${d} d`;
}

export function fmtLatLon(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? "W" : "E"}`;
}

// ---------- Window facts ----------

export type Contact = { body: "sun" | "earth"; kind: "rise" | "set"; atMs: number };

export const CONTACT_NAME: Record<Contact["body"], Record<Contact["kind"], string>> = {
  sun: { rise: "Sunrise", set: "Sunset" },
  earth: { rise: "Earthrise", set: "Earthset" },
};

/**
 * Rise and set times inside the window, in time order, interpolated between
 * the hourly steps to the minute with the Navigator's solver, so the two
 * pages give the same times.
 */
export function contactsIn(site: SiteData, startMs: number, endMs: number): Contact[] {
  return contactEvents(site, startMs, endMs).map((e) => ({
    body: e.kind === "sunrise" || e.kind === "sunset" ? "sun" : "earth",
    kind: e.kind === "sunrise" || e.kind === "earthrise" ? "rise" : "set",
    atMs: Math.min(endMs, Math.round(e.ms / 60_000) * 60_000),
  }));
}

/** Hour-by-hour visibility for a stay: one flag per hour from the start. */
export function hourlyFlags(site: SiteData, startMs: number, hours: number) {
  const sun: boolean[] = [];
  const earth: boolean[] = [];
  for (let h = 0; h < hours; h++) {
    const s = sampleAt(site, startMs + h * HOUR_MS);
    sun.push(s.sunFraction > 0);
    earth.push(s.earthUp);
  }
  return { sun, earth };
}

export type Run = { on: boolean; from: number; to: number };

export function toRuns(flags: boolean[]): Run[] {
  const runs: Run[] = [];
  flags.forEach((on, i) => {
    const last = runs[runs.length - 1];
    if (last && last.on === on) last.to = i + 1;
    else runs.push({ on, from: i, to: i + 1 });
  });
  return runs;
}

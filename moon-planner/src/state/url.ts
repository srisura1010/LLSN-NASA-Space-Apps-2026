// The /tool URL: what it can carry and how it is read and written. The page
// mirrors its plan into the URL so a link reproduces the view.
//
//   site, start, hours, view, cmp, custom, pt, at, gap   (the landing window and views)
//   launch, liftoff, arrive, transit                      (the launch plan)

import { GAP_LIMITS, DEFAULT_GAP, DATA_END_MS, DATA_START_MS, DEFAULT_HOURS, DEFAULT_START_MS, MAX_HOURS, MIN_HOURS } from "@/lib/mission";
import { POINT_SITE_ID } from "@/lib/anySite";
import { HOUR } from "@/lib/format";
import { DEFAULT_TRANSIT_DAYS, TRANSIT_DAY_OPTIONS } from "@/lib/launchWindow";
import { launchSites } from "@/lib/launchSites";
import { sites } from "@/lib/sites";

/**
 * What the workspace shows: the Plan mode at one of its three zoom levels
 * (navigator = the site level, moon, system), or the Launch or Compare mode.
 * "about" in a link opens the About & data drawer over the Plan mode.
 */
export type View = "navigator" | "moon" | "system" | "launch" | "compare";
const URL_VIEWS = ["navigator", "moon", "system", "launch", "compare", "about"];

export const CUSTOM_ID = "custom";
/** The id a point picked at the Moon level takes in Compare. */
export const POINT_ID = POINT_SITE_ID;
/** Custom sites north of this latitude take their terrain from NASA Moon Trek (src/lib/localTerrain.ts). */
export const POLAR_CUSTOM_LAT = -80;

const SITE_IDS = new Set(sites.map((s) => s.id));
const LAUNCH_IDS = new Set(launchSites.map((s) => s.id));

export type LatLon = { lat: number; lon: number };
export type LaunchPick = { launchSiteId: string; launchMs: number; arrivalMs: number };

export type UrlState = {
  site: string | null;
  startMs: number;
  hours: number;
  view: View;
  cmp: string[] | null;
  custom: LatLon | null;
  /** A point picked at the Moon level, anywhere on the globe. */
  pt: LatLon | null;
  atHours: number;
  gap: number;
  launchSiteId: string | null;
  launchPick: LaunchPick | null;
  transitDays: number;
  /** The About & data drawer is open (about=1, or the older view=about). */
  about: boolean;
};

/** The parameters that name a plan; a link with none of them keeps the current one. */
export const PLAN_KEYS = ["site", "start", "hours", "custom", "cmp", "pt", "launch", "liftoff"];

/**
 * A UTC time from the URL, floored to the minute. Accepts a date (2027-07-15),
 * the form this page writes (2027-07-15T06:00Z) and a full ISO time
 * (2027-07-15T06:00:00.000Z). Impossible dates are rejected.
 */
export function parseTimeParam(v: string | null): number | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::?(\d{2})(?::?(\d{2})(?:\.\d+)?)?)?)?Z?$/i.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = m[4] ? Number(m[4]) : 0;
  const mi = m[5] ? Number(m[5]) : 0;
  if (h > 23 || mi > 59 || Number(m[6] ?? 0) > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const t = new Date(ms);
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return ms;
}

/** "2027-07-15T06:00Z", to the minute. */
export function isoMinute(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}T${two(d.getUTCHours())}:${two(d.getUTCMinutes())}Z`;
}

function parsePoint(v: string | null): LatLon | null {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(v ?? "");
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 360) return null;
  return { lat, lon: lon > 180 ? lon - 360 : lon };
}

export function readUrl(p: URLSearchParams): UrlState {
  let hours = Number(p.get("hours"));
  if (!Number.isFinite(hours) || hours < MIN_HOURS || hours > MAX_HOURS) hours = DEFAULT_HOURS;
  const startParam = parseTimeParam(p.get("start"));
  let startMs = startParam === null ? DEFAULT_START_MS : Math.floor(startParam / HOUR) * HOUR;
  if (startMs < DATA_START_MS || startMs >= DATA_END_MS) startMs = DEFAULT_START_MS;
  if (startMs + hours * HOUR > DATA_END_MS) startMs = Math.floor((DATA_END_MS - hours * HOUR) / HOUR) * HOUR;

  const custom = parsePoint(p.get("custom"));
  const pt = parsePoint(p.get("pt"));
  const valid = (id: string) => SITE_IDS.has(id) || (id === CUSTOM_ID && !!custom) || (id === POINT_ID && !!pt);
  const siteParam = p.get("site");
  const viewParam = p.get("view");
  const cmp = (p.get("cmp") ?? "").split(",").filter(valid).slice(0, 3);
  const at = Number(p.get("at"));
  const gap = Number(p.get("gap"));

  const launchParam = p.get("launch");
  const launchSiteId = launchParam && LAUNCH_IDS.has(launchParam) ? launchParam : null;
  const liftoff = parseTimeParam(p.get("liftoff"));
  const arrive = parseTimeParam(p.get("arrive"));
  const launchPick = launchSiteId && liftoff !== null && arrive !== null ? { launchSiteId, launchMs: liftoff, arrivalMs: arrive } : null;
  const transit = Number(p.get("transit"));

  return {
    site: siteParam && valid(siteParam) ? siteParam : null,
    startMs,
    hours,
    view: URL_VIEWS.includes(viewParam ?? "") && viewParam !== "about" ? (viewParam as View) : "navigator",
    cmp: cmp.length ? cmp : null,
    custom,
    pt,
    atHours: Number.isFinite(at) && at > 0 && at <= hours ? at : 0,
    gap: GAP_LIMITS.includes(gap) ? gap : DEFAULT_GAP,
    launchSiteId,
    launchPick,
    transitDays: TRANSIT_DAY_OPTIONS.includes(transit) ? transit : DEFAULT_TRANSIT_DAYS,
    about: viewParam === "about" || p.get("about") === "1",
  };
}

export function writeUrl(s: {
  site: string;
  startMs: number;
  hours: number;
  view: View;
  cmp: string[] | null;
  custom: LatLon | null;
  pt: LatLon | null;
  atHours: number;
  gap: number;
  launchSiteId: string | null;
  launchPick: LaunchPick | null;
  transitDays: number;
  about: boolean;
}): string {
  const parts = [`site=${encodeURIComponent(s.site)}`, `start=${isoMinute(s.startMs)}`, `hours=${Number(s.hours.toFixed(3))}`];
  if (s.view !== "navigator") parts.push(`view=${s.view}`);
  if (s.cmp?.length) parts.push(`cmp=${s.cmp.map(encodeURIComponent).join(",")}`);
  if (s.custom) parts.push(`custom=${s.custom.lat.toFixed(4)},${s.custom.lon.toFixed(4)}`);
  if (s.pt) parts.push(`pt=${Number(s.pt.lat.toFixed(4))},${Number(s.pt.lon.toFixed(4))}`);
  if (s.atHours > 0.05) parts.push(`at=${Number(s.atHours.toFixed(1))}`);
  if (s.gap !== DEFAULT_GAP) parts.push(`gap=${s.gap}`);
  if (s.launchSiteId) parts.push(`launch=${encodeURIComponent(s.launchSiteId)}`);
  if (s.launchPick && s.launchPick.launchSiteId === s.launchSiteId) {
    parts.push(`liftoff=${isoMinute(s.launchPick.launchMs)}`, `arrive=${isoMinute(s.launchPick.arrivalMs)}`);
  }
  if (s.transitDays !== DEFAULT_TRANSIT_DAYS) parts.push(`transit=${s.transitDays}`);
  if (s.about) parts.push("about=1");
  return parts.join("&");
}

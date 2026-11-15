// Custom landing sites anywhere from 80° S to the pole, computed live: Sun
// and Earth tracks from JPL Horizons through the app's /api/horizons route,
// measured against a terrain horizon computed in the browser
// (src/lib/horizonFromGrid.ts): 80 m LOLA heights from NASA Moon Trek within
// 5 km of the point, the 640 m heightmap beyond, as process-dem does for the
// named regions. If Moon Trek is unreachable the 640 m grid is used alone and
// the profile says so (nearFieldResolutionM null). The result is a SiteData,
// so every function in src/lib/sky.ts works on it unchanged.
//
// Client-safe: parses Horizons times itself instead of importing
// src/lib/horizons.ts, which uses Node modules.

import type { SiteData, SkyData } from "./sky";
import {
  computeHorizon,
  loadHeightGrid,
  loadNearField,
  type GridHorizonProfile,
} from "./horizonFromGrid";
import { latLonToXY, type HeightGrid, type HorizonProfile } from "./terrain";
import { DAY, HOUR } from "./format";

export const CUSTOM_SITE_ID = "custom";

/** Southernmost supported latitude: local north (and so azimuth) is undefined at the pole. */
export const CUSTOM_MIN_LAT = -89.9;
/** Northernmost supported latitude: the edge of the LOLA south pole grid. */
export const CUSTOM_MAX_LAT = -80;

const API_PATH = "/api/horizons";
const STEP = "1 h";
const TIMEOUT_MS = 60_000;
const NEAR_FIELD_TIMEOUT_MS = 10_000;
const MAX_SPAN_DAYS = 400;

// Range of the stored 2027 tracks. Requests that fit inside stay inside, so
// the margins never reach into another year by accident.
const CACHE_START_MS = Date.UTC(2027, 0, 1);
const CACHE_END_MS = Date.UTC(2028, 0, 1);

// public/data/terrain/heightmap.json covers ±304 km in 640 m pixels. Keep
// sites 2 px inside the edge so every azimuth has at least one terrain sample.
const GRID_LIMIT_M = 304_000 - 2 * 640;

// ---------- Errors ----------

export type CustomSiteErrorKind =
  | "unsupported" // coordinates outside the supported area
  | "range" // mission window empty, reversed or too long
  | "network" // the API route could not be reached
  | "timeout" // Horizons took too long
  | "horizons" // the route or JPL Horizons reported an error
  | "data" // the tracks came back malformed
  | "terrain"; // the heightmap could not be loaded

/** Error from loadCustomSite. `message` names the problem and what to try; `kind` lets the UI branch. */
export class CustomSiteError extends Error {
  readonly kind: CustomSiteErrorKind;
  constructor(kind: CustomSiteErrorKind, message: string) {
    super(message);
    this.name = "CustomSiteError";
    this.kind = kind;
  }
}

// ---------- Coordinates ----------

/** Longitude in degrees east, wrapped to [-180, 180). */
export function normalizeLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0; // `|| 0` drops -0

/**
 * Whether a custom site can be computed at (lat, lon): latitude from -80 to
 * -89.9 (80° S to 89.9° S), longitude from -180 to 360 degrees east. If not,
 * `reason` is a sentence for the user.
 */
export function isCustomSiteSupported(lat: number, lon: number): { ok: boolean; reason?: string } {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, reason: "Enter latitude and longitude in decimal degrees, for example −85.2 and 31.5." };
  }
  if (lat > 90 || lat < -90) {
    return { ok: false, reason: "Latitude must be between −90 and 90 degrees." };
  }
  if (lat > CUSTOM_MAX_LAT) {
    return {
      ok: false,
      reason: "The LOLA terrain grid covers 80° S to the pole. Enter a latitude from −80 to −89.9.",
    };
  }
  if (lat < CUSTOM_MIN_LAT) {
    return {
      ok: false,
      reason: "Too close to the pole: local north, and so azimuth, is undefined there. Enter a latitude from −80 to −89.9.",
    };
  }
  if (lon < -180 || lon > 360) {
    return { ok: false, reason: "Longitude must be between −180 and 360 degrees east." };
  }
  const { x, y } = latLonToXY(lat, normalizeLongitude(lon));
  if (Math.abs(x) > GRID_LIMIT_M || Math.abs(y) > GRID_LIMIT_M) {
    return {
      ok: false,
      reason: "This point is on the edge of the LOLA terrain grid. Move it slightly toward the pole.",
    };
  }
  return { ok: true };
}

/** Closest a site may be to either pole: local north, and so azimuth, is undefined at a pole. */
export const POLE_MARGIN_DEG = 0.1;

export type SitePointCheck =
  | { ok: true; lat: number; lon: number; source: "polar" | "moontrek" }
  | { ok: false; field: "lat" | "lon"; reason: string };

/**
 * The one rule for where a site can be opened at the site level, used by the
 * custom-site form, the Moon level's "Open site level" and zooming in on the
 * globe. Any point on the Moon up to 0.1° from either pole. South of 80° S
 * the terrain comes from the polar LOLA grids (and the point must sit inside
 * them); anywhere else from the NASA Moon Trek mosaics. Longitude is
 * returned wrapped to −180..180.
 */
export function validateSitePoint(lat: number, lon: number): SitePointCheck {
  if (!Number.isFinite(lat)) return { ok: false, field: "lat", reason: "Enter a latitude in degrees, for example −85.5 or 85.5 S." };
  if (!Number.isFinite(lon)) return { ok: false, field: "lon", reason: "Enter a longitude in degrees, for example 31.2 or 45 W." };
  if (lat < -90 || lat > 90) return { ok: false, field: "lat", reason: "Latitude runs from −90 (the south pole) to 90 (the north pole)." };
  if (lon < -180 || lon > 360) return { ok: false, field: "lon", reason: "Longitude runs from −180 to 180 degrees east (or 0 to 360)." };
  if (Math.abs(lat) > 90 - POLE_MARGIN_DEG) {
    return {
      ok: false,
      field: "lat",
      reason: `Too close to the pole: local north, and so azimuth, is undefined there. Keep the latitude between −${90 - POLE_MARGIN_DEG} and ${90 - POLE_MARGIN_DEG}.`,
    };
  }
  const lonNorm = normalizeLongitude(lon);
  if (lat <= CUSTOM_MAX_LAT) {
    const polar = isCustomSiteSupported(lat, lonNorm);
    if (!polar.ok) return { ok: false, field: "lat", reason: polar.reason ?? "That point is outside the polar terrain grid." };
    return { ok: true, lat, lon: lonNorm, source: "polar" };
  }
  return { ok: true, lat, lon: lonNorm, source: "moontrek" };
}

// ---------- Time ----------

/**
 * The span of Horizons data loadCustomSite requests for a mission window:
 * one day of margin each side, rounded out to whole UTC days, and kept inside
 * 2027 when the window itself is inside 2027.
 */
export function customSkyRange(startMs: number, endMs: number): { startMs: number; endMs: number } {
  let lo = Math.floor((startMs - DAY) / DAY) * DAY;
  let hi = Math.ceil((endMs + DAY) / DAY) * DAY;
  if (startMs >= CACHE_START_MS) lo = Math.max(lo, CACHE_START_MS);
  if (endMs <= CACHE_END_MS) hi = Math.min(hi, CACHE_END_MS);
  return { startMs: lo, endMs: hi };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Parse a Horizons UT time such as "2027-Jan-01 00:00" (or "2027-01-01 00:00") to ms. NaN if malformed. */
export function parseHorizonsTime(s: string): number {
  const m = /^\s*(\d{4})-([A-Za-z]{3}|\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*$/.exec(s);
  if (!m) return NaN;
  const month = /^\d/.test(m[2]) ? Number(m[2]) - 1 : MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0 || month > 11) return NaN;
  const frac = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
  return Date.UTC(Number(m[1]), month, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), frac);
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ---------- Horizons tracks ----------

type Target = "sun" | "earth";
type Track = { times: number[]; az: number[]; el: number[] };

const round3 = (v: number) => Math.round(v * 1000) / 1000; // precision of public/data/sky

/** Collapse a route error (which can quote a whole Horizons response or an HTML page) to one short line. */
function shortDetail(text: string): string {
  const line = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > 220 ? `${line.slice(0, 217)}...` : line;
}

async function fetchTrack(target: Target, lat: number, lon: number, startMs: number, endMs: number): Promise<Track> {
  const name = target === "sun" ? "Sun" : "Earth";
  const query = new URLSearchParams({
    target,
    lat: lat.toFixed(4),
    lon: lon.toFixed(4),
    start: isoDay(startMs),
    stop: isoDay(endMs),
    step: STEP,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const timedOut = () =>
    new CustomSiteError(
      "timeout",
      `JPL Horizons did not send the ${name} track within ${TIMEOUT_MS / 1000} s. Try again, or shorten the mission window.`,
    );
  let status = 0;
  let body: unknown;
  try {
    const res = await fetch(`${API_PATH}?${query}`, { signal: controller.signal });
    status = res.status;
    body = await res.json().catch(() => undefined);
  } catch {
    if (controller.signal.aborted) throw timedOut();
    throw new CustomSiteError(
      "network",
      `Could not reach the Horizons service for the ${name} track. Check your connection, then try again.`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (body === undefined && controller.signal.aborted) throw timedOut();

  if (status !== 200 || !Array.isArray(body)) {
    const error = body && typeof body === "object" && "error" in body ? String(body.error) : "";
    const problem = error
      ? `JPL Horizons could not compute the ${name} track for this point (${shortDetail(error)}).`
      : `The app's Horizons service answered HTTP ${status} without the ${name} track.`;
    throw new CustomSiteError(
      "horizons",
      `${problem} Try again in a minute, or pick one of the nine named regions, which use stored 2027 tracks.`,
    );
  }

  const n = body.length;
  const track: Track = { times: new Array(n), az: new Array(n), el: new Array(n) };
  for (let i = 0; i < n; i++) {
    const p = body[i] as { time?: unknown; az?: unknown; el?: unknown } | null;
    const t = typeof p?.time === "string" ? parseHorizonsTime(p.time) : NaN;
    const az = Number(p?.az);
    const el = Number(p?.el);
    if (!Number.isFinite(t) || !Number.isFinite(az) || !Number.isFinite(el)) {
      throw new CustomSiteError(
        "data",
        `Horizons returned an unreadable ${name} position (row ${i + 1}). Try again; if it repeats, pick one of the nine named regions.`,
      );
    }
    track.times[i] = t;
    track.az[i] = round3(az);
    track.el[i] = round3(el);
  }
  return track;
}

/**
 * Pack the Sun and Earth tracks into the SkyData shape of
 * public/data/sky/<id>.json, checking both cover [startMs, endMs] hour by hour.
 */
function buildSky(sun: Track, earth: Track, startMs: number, endMs: number): SkyData {
  const count = Math.round((endMs - startMs) / HOUR) + 1;
  const onGrid = (track: Track) =>
    track.times.length === count && track.times.every((t, i) => t === startMs + i * HOUR);
  if (!onGrid(sun) || !onGrid(earth)) {
    throw new CustomSiteError(
      "data",
      `Horizons returned ${sun.times.length} Sun and ${earth.times.length} Earth positions where ${count} hourly ones were expected. Try again; if it repeats, pick one of the nine named regions.`,
    );
  }
  return {
    siteId: CUSTOM_SITE_ID,
    startMs: sun.times[0],
    stepMs: HOUR,
    count,
    sunAz: sun.az,
    sunEl: sun.el,
    earthAz: earth.az,
    earthEl: earth.el,
  };
}

// ---------- Terrain horizon ----------

// After a Moon Trek failure, skip it for a while so an outage does not add
// the full timeout to every call.
const NEAR_FIELD_RETRY_MS = 120_000;
let nearFieldRetryAt = 0;

/** Near field from Moon Trek, or null if it fails or takes too long (the 640 m grid then stands alone). */
async function nearFieldOrNull(lat: number, lon: number): Promise<HeightGrid | null> {
  if (Date.now() < nearFieldRetryAt) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NEAR_FIELD_TIMEOUT_MS);
  try {
    return await loadNearField(lat, lon, controller.signal);
  } catch {
    nearFieldRetryAt = Date.now() + NEAR_FIELD_RETRY_MS;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function computeCustomHorizon(lat: number, lon: number, useNearField: boolean): Promise<GridHorizonProfile> {
  const near = useNearField ? nearFieldOrNull(lat, lon) : Promise.resolve(null);
  let grid: HeightGrid;
  try {
    grid = await loadHeightGrid();
  } catch (err) {
    throw new CustomSiteError(
      "terrain",
      err instanceof Error ? err.message : "Could not load the LOLA terrain grid. Reload the page to try again.",
    );
  }
  const nearField = (await near) ?? undefined;
  try {
    return computeHorizon(grid, lat, lon, { siteId: CUSTOM_SITE_ID, nearField });
  } catch (err) {
    throw new CustomSiteError("unsupported", err instanceof Error ? err.message : "This point is not on the terrain grid.");
  }
}

/**
 * One sentence on how a custom site's terrain horizon was made, for the
 * method note next to its numbers. Accuracy figures are from
 * scripts/check-custom-site.ts at the nine region centres.
 */
export function customHorizonMethod(horizon: HorizonProfile): string {
  const near = (horizon as Partial<GridHorizonProfile>).nearFieldResolutionM;
  if (near) {
    return (
      `Terrain horizon from LOLA heights: ${near} m pixels within 5 km of the point (LRO LOLA 30 m south pole DEM, via NASA Moon Trek), ` +
      `${horizon.gridResolutionM} m beyond, out to 80° S. Tested at the nine region centres, it is within 0.2° of the named regions' horizons on average.`
    );
  }
  return (
    `Terrain horizon from the ${horizon.gridResolutionM} m LOLA grid alone: the 80 m near-field terrain could not be loaded. ` +
    "Relief within about 5 km is smoothed, so on slopes and summits the horizon can read 1 to 3° low and sunlight too high."
  );
}

// ---------- Caches ----------

// Terrain horizons depend only on the point; sky tracks on point and span.
// They are cached apart so a near-field fallback is retried on the next call
// without fetching the tracks again.
const horizons = new Map<string, Promise<GridHorizonProfile>>();
type LoadedSky = { key: string; startMs: number; endMs: number; sky: Promise<SkyData> };
const skies: LoadedSky[] = []; // newest last
const MAX_SKIES = 16;

function horizonFor(lat: number, lon: number, useNearField: boolean): Promise<GridHorizonProfile> {
  const key = `${lat},${lon},${useNearField}`;
  let p = horizons.get(key);
  if (!p) {
    p = computeCustomHorizon(lat, lon, useNearField);
    horizons.set(key, p);
    // Keep failures and near-field fallbacks out of the cache so the next call retries.
    p.then(
      (h) => {
        if (useNearField && h.nearFieldResolutionM === null) horizons.delete(key);
      },
      () => horizons.delete(key),
    );
  }
  return p;
}

function skyFor(lat: number, lon: number, startMs: number, endMs: number): Promise<SkyData> {
  const key = `${lat},${lon}`;
  const hit = skies.find((e) => e.key === key && e.startMs <= startMs && e.endMs >= endMs);
  if (hit) return hit.sky.then((sky) => sliceSky(sky, startMs, endMs));

  const sky = Promise.all([
    fetchTrack("sun", lat, lon, startMs, endMs),
    fetchTrack("earth", lat, lon, startMs, endMs),
  ]).then(([sun, earth]) => buildSky(sun, earth, startMs, endMs));
  const entry: LoadedSky = { key, startMs, endMs, sky };
  skies.push(entry);
  if (skies.length > MAX_SKIES) skies.shift();
  sky.catch(() => {
    const i = skies.indexOf(entry);
    if (i >= 0) skies.splice(i, 1);
  });
  return sky;
}

/** The part of `sky` between two hourly instants it covers. */
function sliceSky(sky: SkyData, startMs: number, endMs: number): SkyData {
  const i0 = Math.max(0, Math.round((startMs - sky.startMs) / HOUR));
  const i1 = Math.min(sky.count, Math.round((endMs - sky.startMs) / HOUR) + 1);
  if (i0 === 0 && i1 === sky.count) return sky;
  return {
    ...sky,
    startMs: sky.startMs + i0 * HOUR,
    count: i1 - i0,
    sunAz: sky.sunAz.slice(i0, i1),
    sunEl: sky.sunEl.slice(i0, i1),
    earthAz: sky.earthAz.slice(i0, i1),
    earthEl: sky.earthEl.slice(i0, i1),
  };
}

// ---------- Public entry point ----------

export type CustomSiteOptions = {
  /**
   * Resolve the first 5 km with 80 m heights from NASA Moon Trek (default
   * true). false uses the 640 m heightmap alone: no third-party request, but
   * horizons 1-3° low on slopes and summits.
   */
  nearField?: boolean;
};

/**
 * Sun and Earth visibility data for any point from 80° S to 89.9° S, in the
 * same shape as the named regions (loadSite in src/lib/sky.ts).
 *
 * - sky: hourly Sun and Earth az/el from JPL Horizons (live through
 *   /api/horizons, about a second) covering customSkyRange(startMs, endMs):
 *   the window plus a day each side. siteId "custom".
 * - horizon: a GridHorizonProfile (siteId "custom", lat/lon as used,
 *   gridResolutionM 640, nearFieldResolutionM 80 or null, reachKm per
 *   azimuth). customHorizonMethod(horizon) describes it in one sentence.
 *
 * Results are cached per point and span; a request inside a span already
 * loaded for the same point resolves from memory. Rejects with a
 * CustomSiteError whose message says what went wrong and what to try.
 */
export async function loadCustomSite(
  lat: number,
  lon: number,
  startMs: number,
  endMs: number,
  options: CustomSiteOptions = {},
): Promise<SiteData> {
  const useNearField = options.nearField ?? true;
  const latR = round4(lat);
  const lonR = round4(normalizeLongitude(lon));
  const support = isCustomSiteSupported(latR, lon);
  if (!support.ok) throw new CustomSiteError("unsupported", support.reason ?? "This point is not supported.");
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new CustomSiteError("range", "The mission window must end after it starts. Check the start date and length.");
  }
  if (endMs - startMs > MAX_SPAN_DAYS * DAY) {
    throw new CustomSiteError(
      "range",
      `Custom sites call JPL Horizons live, so the window is limited to ${MAX_SPAN_DAYS} days. Choose a shorter window.`,
    );
  }

  const range = customSkyRange(startMs, endMs);
  const [sky, horizon] = await Promise.all([
    skyFor(latR, lonR, range.startMs, range.endMs),
    horizonFor(latR, lonR, useNearField),
  ]);
  return { sky, horizon };
}

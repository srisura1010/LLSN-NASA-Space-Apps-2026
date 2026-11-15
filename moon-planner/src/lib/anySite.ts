// Sun and Earth visibility at any point on the Moon, computed in the browser
// from the packed 2027 ephemeris (src/lib/system.ts) and the IAU rotation
// model (src/lib/moonFrame.ts). There is no terrain: the horizon is that of a
// smooth sphere. The result is a SiteData, so every function in
// src/lib/sky.ts works on it unchanged.

import { eclipticToBody, moonAxes } from "./moonFrame";
import type { SiteData, SkyData } from "./sky";
import { C_KM_S, MOON_RADIUS_KM, type SystemData } from "./system";
import type { HorizonProfile } from "./terrain";
import { HOUR } from "./format";

export const POINT_SITE_ID = "point";

const RAD = Math.PI / 180;
/** Eye height above the sphere, the same 2 m mast the terrain horizons of the nine regions use. */
export const SMOOTH_MAST_M = 2;
/** Dip of a smooth sphere's horizon below the local horizontal from the mast, degrees (about -0.087). */
export const SMOOTH_DIP_DEG = -Math.acos(MOON_RADIUS_KM / (MOON_RADIUS_KM + SMOOTH_MAST_M / 1000)) / RAD;
const AZ_STEP_DEG = 0.5;

export const SMOOTH_LABEL = "Smooth horizon, no terrain: hills and crater rims are not included.";

export const SMOOTH_METHOD =
  "Sun and Earth directions come from the JPL Horizons 2027 vectors and the IAU rotation model for the Moon, " +
  "measured from the surface point so Earth's parallax is included. The horizon is that of a smooth sphere of " +
  "radius 1,737.4 km seen from a 2 m mast, 0.087° below level, the same mast as the nine regions. " +
  "No terrain is used, so hills and crater rims that would block the Sun or Earth are not included.";

export type SmoothSiteData = SiteData & {
  /** No terrain horizon went into this site. */
  terrain: "none";
  lat: number;
  lon: number;
  method: string;
};

export const isSmoothSite = (s: SiteData | null | undefined): s is SmoothSiteData => (s as Partial<SmoothSiteData> | null | undefined)?.terrain === "none";

// ---------- Body-fixed tracks, shared by every point ----------

type Tracks = { startMs: number; count: number; sun: Float64Array; earth: Float64Array };
const trackCache = new WeakMap<SystemData, Tracks>();

/**
 * Moon centre to Sun and to Earth in the body-fixed frame, km, on whole UTC
 * hours. The Sun's direction carries the annual aberration (the Moon's
 * velocity over c, 0.006 degrees), as the Horizons observer tracks do.
 */
function tracksFor(d: SystemData): Tracks {
  const hit = trackCache.get(d);
  if (hit) return hit;
  const startMs = Math.ceil(d.startMs / HOUR) * HOUR;
  // The packed vectors sit 69 s before the hour (TDB), so the last hour is a 69 s extrapolation.
  const count = Math.floor((d.startMs + (d.count - 1) * d.stepMs + d.stepMs / 2 - startMs) / HOUR) + 1;
  const sun = new Float64Array(count * 3);
  const earth = new Float64Array(count * 3);
  const stepS = d.stepMs / 1000;
  for (let i = 0; i < count; i++) {
    const ms = startMs + i * HOUR;
    const pos = (ms - d.startMs) / d.stepMs;
    const j = Math.min(Math.max(Math.floor(pos), 0), d.count - 2);
    const f = pos - j;
    const k = j * 3;
    const mx = d.moon[k] + (d.moon[k + 3] - d.moon[k]) * f;
    const my = d.moon[k + 1] + (d.moon[k + 4] - d.moon[k + 1]) * f;
    const mz = d.moon[k + 2] + (d.moon[k + 5] - d.moon[k + 2]) * f;
    const ex = d.earth[k] + (d.earth[k + 3] - d.earth[k]) * f;
    const ey = d.earth[k + 1] + (d.earth[k + 4] - d.earth[k + 1]) * f;
    const ez = d.earth[k + 2] + (d.earth[k + 5] - d.earth[k + 2]) * f;
    const r = Math.hypot(mx, my, mz);
    const ab = r / C_KM_S / stepS;
    const axes = moonAxes(ms);
    const s = eclipticToBody(
      [-mx + (d.moon[k + 3] - d.moon[k]) * ab, -my + (d.moon[k + 4] - d.moon[k + 1]) * ab, -mz + (d.moon[k + 5] - d.moon[k + 2]) * ab],
      axes,
    );
    const e = eclipticToBody([ex - mx, ey - my, ez - mz], axes);
    sun.set(s, i * 3);
    earth.set(e, i * 3);
  }
  const t = { startMs, count, sun, earth };
  trackCache.set(d, t);
  return t;
}

// ---------- The site ----------

/**
 * Hourly Sun and Earth azimuth (degrees clockwise from local north) and
 * elevation (degrees above the local horizontal plane) for the whole year at
 * a selenographic point, with a flat horizon at the smooth-sphere dip.
 * Latitude within ±90, east-positive longitude. At the poles azimuth is
 * measured from the 180° meridian direction, which is where "north" tends to.
 */
export function buildSmoothSite(lat: number, lon: number, data: SystemData): SmoothSiteData {
  const t = tracksFor(data);
  const n = t.count;
  const la = Math.min(90, Math.max(-90, lat)) * RAD;
  const lo = lon * RAD;
  const cl = Math.cos(la);
  const sl = Math.sin(la);
  const co = Math.cos(lo);
  const so = Math.sin(lo);
  // Up, east and north at the point, in the body-fixed frame.
  const ux = cl * co;
  const uy = cl * so;
  const uz = sl;
  const ex = -so;
  const ey = co;
  const nx = -sl * co;
  const ny = -sl * so;
  const nz = cl;
  const R = MOON_RADIUS_KM;
  const sunAz = new Array<number>(n);
  const sunEl = new Array<number>(n);
  const earthAz = new Array<number>(n);
  const earthEl = new Array<number>(n);
  for (const [src, az, el] of [
    [t.sun, sunAz, sunEl],
    [t.earth, earthAz, earthEl],
  ] as const) {
    for (let i = 0, k = 0; i < n; i++, k += 3) {
      const x = src[k] - ux * R;
      const y = src[k + 1] - uy * R;
      const z = src[k + 2] - uz * R;
      const a = Math.atan2(x * ex + y * ey, x * nx + y * ny + z * nz) / RAD;
      az[i] = a < 0 ? a + 360 : a;
      el[i] = Math.asin((x * ux + y * uy + z * uz) / Math.hypot(x, y, z)) / RAD;
    }
  }
  const sky: SkyData = { siteId: POINT_SITE_ID, startMs: t.startMs, stepMs: HOUR, count: n, sunAz, sunEl, earthAz, earthEl };
  const horizon: HorizonProfile = {
    siteId: POINT_SITE_ID,
    lat,
    lon,
    siteHeight: 0,
    stepDeg: AZ_STEP_DEG,
    gridResolutionM: 0,
    elevations: new Array<number>(Math.round(360 / AZ_STEP_DEG)).fill(SMOOTH_DIP_DEG),
  };
  return { sky, horizon, terrain: "none", lat, lon, method: SMOOTH_METHOD };
}

// ---------- Coordinates typed by hand ----------

export type CoordResult = { ok: true; value: number } | { ok: false; message: string };

/**
 * A latitude or longitude as typed: a signed number (26.13, -41.6) or a
 * number with a letter (26.13 N, 153.99 W). Degree signs, a typographic minus
 * and a decimal comma are accepted. Longitude may run to 360 E and is wrapped
 * to -180..180 (180 E stays 180 E). A failure names the problem and what to type instead.
 */
export function parseCoordinate(text: string, axis: "lat" | "lon"): CoordResult {
  const name = axis === "lat" ? "Latitude" : "Longitude";
  const example = axis === "lat" ? "0.67 N or −41.64" : "23.47 E or −153.99";
  const raw = text.trim();
  if (!raw) return { ok: false, message: `${name} is empty. Type degrees, for example ${example}.` };
  const m = /^([+\-−])?\s*(\d+(?:[.,]\d+)?|[.,]\d+)\s*°?\s*([NSEWnsew])?$/.exec(raw);
  if (!m) return { ok: false, message: `${name} "${raw}" is not a number of degrees. Type it as ${example}.` };
  const letter = m[3]?.toUpperCase();
  const allowed = axis === "lat" ? "NS" : "EW";
  if (letter && !allowed.includes(letter)) {
    return {
      ok: false,
      message:
        axis === "lat"
          ? `Latitude takes N or S, not ${letter}. Put the ${letter === "E" ? "east" : "west"} value in the longitude box.`
          : `Longitude takes E or W, not ${letter}. Put the ${letter === "N" ? "north" : "south"} value in the latitude box.`,
    };
  }
  if (letter && m[1]) return { ok: false, message: `${name} has both a sign and a letter. Use one: ${example}.` };
  let v = Number(m[2].replace(",", "."));
  if (m[1] === "-" || m[1] === "−" || letter === "S" || letter === "W") v = -v;
  if (axis === "lat") {
    if (Math.abs(v) > 90) return { ok: false, message: `Latitude runs from 90 S to 90 N; ${raw} is outside it. Type a value between −90 and 90.` };
    return { ok: true, value: v || 0 };
  }
  if (v < -180 || v > 360) return { ok: false, message: `Longitude runs from 180 W to 180 E (or 0 to 360 E); ${raw} is outside it. Type a value between −180 and 360.` };
  return { ok: true, value: (v > 180 ? v - 360 : v) || 0 };
}

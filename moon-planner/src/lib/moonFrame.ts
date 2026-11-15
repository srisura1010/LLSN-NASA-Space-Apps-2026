// The Moon's orientation and the directions to the Sun and Earth in its
// body-fixed frame, from the packed JPL Horizons vectors (src/lib/system.ts)
// and the IAU/WGCCRE rotation model (Archinal et al. 2018, "Report of the IAU
// Working Group on Cartographic Coordinates and Rotational Elements: 2015",
// Celest. Mech. Dyn. Astron. 130:22). That model gives the pole and prime
// meridian to about 0.04 degrees of the mean-Earth/polar-axis frame the maps
// use, which is below what this view can show.

import { MOON_RADIUS_KM, positionsAt, type SystemData, type Vec3 } from "./system";
import { DAY_MS } from "./format";

const RAD = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
/** TDB minus UTC: 32.184 s plus 37 leap seconds (unchanged since 2017). */
const TDB_MINUS_UTC_MS = 69_184;
/** Mean obliquity of the ecliptic at J2000. */
const OBLIQUITY = 23.4392911 * RAD;
const COS_E = Math.cos(OBLIQUITY);
const SIN_E = Math.sin(OBLIQUITY);

/** E1..E13: value at J2000 and rate per day, in degrees. */
const E: [number, number][] = [
  [125.045, -0.0529921],
  [250.089, -0.1059842],
  [260.008, 13.0120009],
  [176.625, 13.3407154],
  [357.529, 0.9856003],
  [311.589, 26.4057084],
  [134.963, 13.064993],
  [276.617, 0.3287146],
  [34.226, 1.7484877],
  [15.134, -0.1589763],
  [119.743, 0.0036096],
  [239.961, 0.1643573],
  [25.053, 12.9590088],
];
/** Coefficients of sin E1..E13 in the pole's right ascension, degrees. */
const RA_SIN = [-3.8787, -0.1204, 0.07, -0.0172, 0, 0.0072, 0, 0, 0, -0.0052, 0, 0, 0.0043];
/** Coefficients of cos E1..E13 in the pole's declination, degrees. */
const DEC_COS = [1.5419, 0.0239, -0.0278, 0.0068, 0, -0.0029, 0.0009, 0, 0, 0.0008, 0, 0, -0.0009];
/** Coefficients of sin E1..E13 in the prime meridian angle W, degrees. */
const W_SIN = [3.561, 0.1208, -0.0642, 0.0158, 0.0252, -0.0066, -0.0047, -0.0046, 0.0028, 0.0052, 0.004, 0.0019, -0.0044];

export type LatLon = { lat: number; lon: number };

/** The body-fixed axes (x through 0° N 0° E, z through the north pole) as unit vectors in equatorial J2000. */
export type MoonAxes = { x: Vec3; y: Vec3; z: Vec3; raDeg: number; decDeg: number; wDeg: number };

export function moonAxes(ms: number): MoonAxes {
  const d = (ms + TDB_MINUS_UTC_MS - J2000_MS) / DAY_MS;
  const T = d / 36525;
  let ra = 269.9949 + 0.0031 * T;
  let dec = 66.5392 + 0.013 * T;
  let w = 38.3213 + 13.17635815 * d - 1.4e-12 * d * d;
  for (let i = 0; i < 13; i++) {
    const e = (E[i][0] + E[i][1] * d) * RAD;
    const s = Math.sin(e);
    ra += RA_SIN[i] * s;
    dec += DEC_COS[i] * Math.cos(e);
    w += W_SIN[i] * s;
  }
  const a = ra * RAD;
  const dl = dec * RAD;
  const wr = w * RAD;
  const z: Vec3 = [Math.cos(dl) * Math.cos(a), Math.cos(dl) * Math.sin(a), Math.sin(dl)];
  // Ascending node of the Moon's equator on the J2000 equator, and the vector 90 degrees on along the equator.
  const q: Vec3 = [-Math.sin(a), Math.cos(a), 0];
  const m = cross(z, q);
  const cw = Math.cos(wr);
  const sw = Math.sin(wr);
  const x: Vec3 = [q[0] * cw + m[0] * sw, q[1] * cw + m[1] * sw, q[2] * cw + m[2] * sw];
  return { x, y: cross(z, x), z, raDeg: ra, decDeg: dec, wDeg: ((w % 360) + 360) % 360 };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Ecliptic J2000 to equatorial J2000. */
export function eclipticToEquatorial(v: Vec3): Vec3 {
  return [v[0], v[1] * COS_E - v[2] * SIN_E, v[1] * SIN_E + v[2] * COS_E];
}

/** Equatorial J2000 to ecliptic J2000. */
export function equatorialToEcliptic(v: Vec3): Vec3 {
  return [v[0], v[1] * COS_E + v[2] * SIN_E, -v[1] * SIN_E + v[2] * COS_E];
}

/** An ecliptic J2000 vector expressed in the Moon's body-fixed frame. */
export function eclipticToBody(v: Vec3, axes: MoonAxes): Vec3 {
  const q = eclipticToEquatorial(v);
  return [dot(q, axes.x), dot(q, axes.y), dot(q, axes.z)];
}

/** Body-fixed unit vector of a selenographic point (degrees, east-positive longitude). */
export function latLonToBody(lat: number, lon: number): Vec3 {
  const cl = Math.cos(lat * RAD);
  return [cl * Math.cos(lon * RAD), cl * Math.sin(lon * RAD), Math.sin(lat * RAD)];
}

export function bodyToLatLon(v: Vec3): LatLon {
  const u = norm(v);
  return { lat: Math.asin(Math.min(1, Math.max(-1, u[2]))) / RAD, lon: Math.atan2(u[1], u[0]) / RAD };
}

export type MoonFrame = {
  ms: number;
  /** Moon centre to Sun and to Earth in the body-fixed frame, km. */
  sunKm: Vec3;
  earthKm: Vec3;
  /** The same as unit vectors. */
  sunDir: Vec3;
  earthDir: Vec3;
  /** Where the Sun and Earth are overhead. The sub-Earth point is the libration in latitude and longitude. */
  subSolar: LatLon;
  subEarth: LatLon;
};

/** Geometric directions (no light time or aberration, both under 0.01 degrees here). */
export function moonFrameAt(data: SystemData, ms: number): MoonFrame {
  const { earth, moon } = positionsAt(data, ms);
  const axes = moonAxes(ms);
  const sunKm = eclipticToBody([-moon[0], -moon[1], -moon[2]], axes);
  const earthKm = eclipticToBody([earth[0] - moon[0], earth[1] - moon[1], earth[2] - moon[2]], axes);
  return { ms, sunKm, earthKm, sunDir: norm(sunKm), earthDir: norm(earthKm), subSolar: bodyToLatLon(sunKm), subEarth: bodyToLatLon(earthKm) };
}

/**
 * Elevation in degrees of a body's centre above the horizon of a smooth sphere
 * at a selenographic point. The target is a body-fixed vector from the Moon's
 * centre in km, so Earth's parallax (up to 0.26 degrees) is included.
 */
export function elevationDeg(lat: number, lon: number, targetKm: Vec3, radiusKm = MOON_RADIUS_KM): number {
  const n = latLonToBody(lat, lon);
  const t: Vec3 = [targetKm[0] - n[0] * radiusKm, targetKm[1] - n[1] * radiusKm, targetKm[2] - n[2] * radiusKm];
  return Math.asin(dot(n, t) / Math.hypot(t[0], t[1], t[2])) / RAD;
}

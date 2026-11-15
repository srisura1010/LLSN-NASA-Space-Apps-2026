// Earth's orientation and the points where the Sun and Moon are overhead, from
// the packed JPL Horizons vectors (src/lib/system.ts). The rotation angle is the
// Earth Rotation Angle (IAU 2000, Capitaine et al. 2000) taken with UT1 = UTC
// (they differ by under 0.9 s, 0.004° of turn), about the mean pole of date
// from the IAU 1976 precession angles. Nutation (up to 0.005°) and polar motion
// are left out, so a longitude here is good to about 0.01°, one kilometre on
// the ground.

import { eclipticToEquatorial, type LatLon } from "./moonFrame";
import { positionsAt, type SystemData, type Vec3 } from "./system";

const RAD = Math.PI / 180;
const ARCSEC = RAD / 3600;
const TAU = 2 * Math.PI;
const DAY_MS = 86_400_000;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

/** Earth Rotation Angle in radians, 0 to 2π: the turn of the Greenwich meridian from the celestial intermediate origin. */
export function eraRad(ms: number): number {
  const d = (ms - J2000_MS) / DAY_MS;
  return wrap(TAU * ((d % 1) + 0.779057273264 + 0.00273781191135448 * d));
}

/** Greenwich mean sidereal time in radians, 0 to 2π: the same turn measured from the mean equinox of date (IAU 2006). */
export function gmstRad(ms: number): number {
  const T = (ms - J2000_MS) / DAY_MS / 36525;
  return wrap(eraRad(ms) + (0.014506 + 4612.156534 * T + 1.3915817 * T * T) * ARCSEC);
}

/** The Earth-fixed axes (x through 0° N 0° E, z through the north pole) as unit vectors in equatorial J2000. */
export type EarthAxes = { x: Vec3; y: Vec3; z: Vec3; eraDeg: number };

export function earthAxes(ms: number): EarthAxes {
  const T = (ms - J2000_MS) / DAY_MS / 36525;
  // Mean pole of date in J2000 axes: it has moved about 0.15° towards the equinox by 2027.
  const zeta = 2306.2181 * T * ARCSEC;
  const theta = 2004.3109 * T * ARCSEC;
  const z: Vec3 = [Math.sin(theta) * Math.cos(zeta), -Math.sin(theta) * Math.sin(zeta), Math.cos(theta)];
  // The origin of the rotation angle on the equator of date stays within 0.1 arcsecond of the J2000 x axis dropped onto that equator.
  const k = z[0];
  const x0 = norm([1 - k * z[0], -k * z[1], -k * z[2]]);
  const y0 = cross(z, x0);
  const era = eraRad(ms);
  const c = Math.cos(era);
  const s = Math.sin(era);
  const x: Vec3 = [x0[0] * c + y0[0] * s, x0[1] * c + y0[1] * s, x0[2] * c + y0[2] * s];
  return { x, y: cross(z, x), z, eraDeg: era / RAD };
}

/** Earth-fixed unit vector of a geographic point (degrees, east-positive longitude, spherical Earth). */
export function latLonToEarthFixed(lat: number, lon: number): Vec3 {
  const cl = Math.cos(lat * RAD);
  return [cl * Math.cos(lon * RAD), cl * Math.sin(lon * RAD), Math.sin(lat * RAD)];
}

export function earthFixedToLatLon(v: Vec3): LatLon {
  const u = norm(v);
  return { lat: Math.asin(Math.min(1, Math.max(-1, u[2]))) / RAD, lon: Math.atan2(u[1], u[0]) / RAD };
}

/** An ecliptic J2000 vector expressed in the Earth-fixed frame. */
export function eclipticToEarthFixed(v: Vec3, axes: EarthAxes): Vec3 {
  const q = eclipticToEquatorial(v);
  return [dot(q, axes.x), dot(q, axes.y), dot(q, axes.z)];
}

/** An Earth-fixed vector in equatorial J2000. */
export function earthFixedToEquatorial(v: Vec3, axes: EarthAxes): Vec3 {
  return [
    axes.x[0] * v[0] + axes.y[0] * v[1] + axes.z[0] * v[2],
    axes.x[1] * v[0] + axes.y[1] * v[1] + axes.z[1] * v[2],
    axes.x[2] * v[0] + axes.y[2] * v[1] + axes.z[2] * v[2],
  ];
}

export type EarthFrame = {
  ms: number;
  axes: EarthAxes;
  /** Earth's centre to the Sun and to the Moon in the Earth-fixed frame, km. */
  sunKm: Vec3;
  moonKm: Vec3;
  sunDir: Vec3;
  moonDir: Vec3;
  /** Where the Sun and the Moon are overhead (geocentric latitude, east-positive longitude). */
  subSolar: LatLon;
  subLunar: LatLon;
};

/** Geometric directions from Earth's centre (no light time or aberration: the Sun's 0.006° and the Moon's 0.0002° are below this model). */
export function earthFrameAt(data: SystemData, ms: number): EarthFrame {
  const { earth, moon } = positionsAt(data, ms);
  const axes = earthAxes(ms);
  const sunKm = eclipticToEarthFixed([-earth[0], -earth[1], -earth[2]], axes);
  const moonKm = eclipticToEarthFixed([moon[0] - earth[0], moon[1] - earth[1], moon[2] - earth[2]], axes);
  return { ms, axes, sunKm, moonKm, sunDir: norm(sunKm), moonDir: norm(moonKm), subSolar: earthFixedToLatLon(sunKm), subLunar: earthFixedToLatLon(moonKm) };
}

export const subSolarPoint = (data: SystemData, ms: number): LatLon => earthFrameAt(data, ms).subSolar;
export const subLunarPoint = (data: SystemData, ms: number): LatLon => earthFrameAt(data, ms).subLunar;

/**
 * Unit vector, Earth-fixed, of the point reached from a place by going a given angle (radians) along a great circle
 * that leaves it at a given azimuth (degrees clockwise from north).
 */
export function alongAzimuth(lat: number, lon: number, azimuthDeg: number, angle: number): Vec3 {
  const p = latLonToEarthFixed(lat, lon);
  const la = lat * RAD;
  const lo = lon * RAD;
  const north: Vec3 = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const east: Vec3 = [-Math.sin(lo), Math.cos(lo), 0];
  const a = azimuthDeg * RAD;
  const ca = Math.cos(a) * Math.sin(angle);
  const sa = Math.sin(a) * Math.sin(angle);
  const c = Math.cos(angle);
  return [p[0] * c + north[0] * ca + east[0] * sa, p[1] * c + north[1] * ca + east[1] * sa, p[2] * c + north[2] * ca + east[2] * sa];
}

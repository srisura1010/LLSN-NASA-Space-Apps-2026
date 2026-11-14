// Frame: Moon-fixed, Y = north pole, +X = 0° longitude (the point facing Earth),
// -Z = 90° E. This matches how three.js wraps an equirectangular texture
// (like the NASA CGI Moon Kit map) onto a SphereGeometry.

import { Vector3 } from "three";

const DEG = Math.PI / 180;

/** Unit vector from the Moon's centre through a lat/lon (degrees). */
export function latLonToVector(latDeg: number, lonDeg: number): Vector3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return new Vector3(
    Math.cos(lat) * Math.cos(lon),
    Math.sin(lat),
    -Math.cos(lat) * Math.sin(lon),
  );
}

/**
 * How high a body appears above a flat local horizon at the site, in degrees.
 * Uses a smooth sphere, so it ignores hills and crater walls (terrain comes later).
 */
export function elevationDeg(site: Vector3, bodyDirection: Vector3): number {
  return Math.asin(site.dot(bodyDirection)) / DEG;
}

// Approximate Sun/Earth directions until JPL Horizons data is wired in.

const SYNODIC_MONTH_DAYS = 29.530589;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // 6 Jan 2000, 18:14 UTC

/**
 * Direction to the Sun. At new moon the Sun is over the far side (180°);
 * it then sweeps west once per lunar day. Real data also tilts it by up to
 * about 1.5° north/south, which matters a lot at the pole; not modelled here.
 */
export function sunDirection(date: Date): Vector3 {
  const days = (date.getTime() - KNOWN_NEW_MOON) / 86_400_000;
  const phase = (days / SYNODIC_MONTH_DAYS) % 1;
  return latLonToVector(0, 180 - 360 * phase);
}

/** Direction to Earth. Fixed over 0°, 0° (real data wobbles ~7° from libration). */
export function earthDirection(): Vector3 {
  return latLonToVector(0, 0);
}

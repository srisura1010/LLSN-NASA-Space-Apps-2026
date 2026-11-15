// Scales for the horizon panorama.
//
// Azimuth runs left to right (clockwise, as seen standing at the site). The
// seam sits at 180° (S, toward the pole) so that north, where Earth hangs for
// every candidate region, is in the middle and the Earth track never splits.

import { EARTH_RADIUS_DEG, SUN_RADIUS_DEG, type SiteData } from "@/lib/sky";

export const SEAM_AZ = 180;

/** Azimuth (deg) to panorama position u in [-180, 180), with north at 0. */
export function azToU(az: number): number {
  return ((((az - SEAM_AZ) % 360) + 360) % 360) - 180;
}

/** Panorama position u back to azimuth in 0..360. */
export function uToAz(u: number): number {
  return (((u + 180 + SEAM_AZ) % 360) + 360) % 360;
}

/** Signed shortest turn from azimuth a to b, in (-180, 180]. */
export function azDelta(a: number, b: number): number {
  let d = (((b - a) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

export type Frame = {
  left: number;
  top: number;
  width: number;
  height: number;
  elMin: number;
  elMax: number;
};

export const pxPerDegX = (f: Frame) => f.width / 360;
export const pxPerDegY = (f: Frame) => f.height / (f.elMax - f.elMin);
export const xOfU = (f: Frame, u: number) => f.left + ((u + 180) / 360) * f.width;
export const xOfAz = (f: Frame, az: number) => xOfU(f, azToU(az));
export const yOfEl = (f: Frame, el: number) => f.top + ((f.elMax - el) / (f.elMax - f.elMin)) * f.height;
/** Inverse of xOfAz, in 0..360. */
export const azOfX = (f: Frame, x: number) => uToAz(((x - f.left) / f.width) * 360 - 180);

/**
 * Elevation domain (deg) for a plot: the whole terrain horizon, both tracks
 * over the window (with their discs) and the level line, snapped outward to
 * whole degrees with a minimum span of 8°, keeping room under the lowest and
 * over the highest track for time labels. Pass the same range to several
 * plots to compare them on one scale.
 */
export function plotElevationRange(site: SiteData, startMs: number, endMs: number): [number, number] {
  const { sky, horizon } = site;
  let lo = 0;
  let hi = 0;
  for (const e of horizon.elevations) {
    if (e < lo) lo = e;
    if (e > hi) hi = e;
  }
  let trackLo = Infinity;
  let trackHi = -Infinity;
  const i0 = Math.max(0, Math.floor((startMs - sky.startMs) / sky.stepMs));
  const i1 = Math.min(sky.count - 1, Math.ceil((endMs - sky.startMs) / sky.stepMs));
  for (let i = i0; i <= i1; i++) {
    lo = Math.min(lo, sky.sunEl[i] - SUN_RADIUS_DEG, sky.earthEl[i] - EARTH_RADIUS_DEG);
    hi = Math.max(hi, sky.sunEl[i] + SUN_RADIUS_DEG, sky.earthEl[i] + EARTH_RADIUS_DEG);
    trackLo = Math.min(trackLo, sky.sunEl[i], sky.earthEl[i]);
    trackHi = Math.max(trackHi, sky.sunEl[i], sky.earthEl[i]);
  }
  lo = Math.floor(Math.min(lo - 0.4, trackLo - 1.8));
  hi = Math.ceil(Math.max(hi + 0.4, trackHi + 1.2));
  while (hi - lo < 8) {
    hi += 1;
    if (hi - lo < 8) lo -= 1;
  }
  return [lo, hi];
}

/** Labelled and minor elevation ticks for a domain. */
export function elevationTicks(lo: number, hi: number): { major: number[]; minor: number[] } {
  const span = hi - lo;
  const step = span > 24 ? 5 : span > 12 ? 2 : 1;
  const major: number[] = [];
  const minor: number[] = [];
  for (let v = Math.ceil(lo); v <= hi; v++) {
    if (v % step === 0) major.push(v);
    else minor.push(v);
  }
  return { major, minor };
}

const CARDINAL: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W" };

/** Azimuth ticks every 30°, left to right, with compass letters on the cardinals. */
export function azimuthTicks(): { u: number; az: number; label: string; cardinal: boolean }[] {
  const out = [];
  for (let u = -180; u <= 180; u += 30) {
    const az = uToAz(u);
    const cardinal = az in CARDINAL;
    out.push({ u, az, label: cardinal ? CARDINAL[az] : `${az}°`, cardinal });
  }
  return out;
}

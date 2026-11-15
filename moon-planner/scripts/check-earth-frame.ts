// Checks src/lib/earthFrame.ts: the sub-solar point from the packed JPL vectors and the Earth rotation model against
// an independent low-precision solar position (Astronomical Almanac formulas, good to about 0.01°) turned by GMST,
// and the two round numbers anyone can check by hand. Run: npx tsx scripts/check-earth-frame.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { earthAxes, earthFixedToLatLon, earthFrameAt, eraRad, gmstRad, latLonToEarthFixed, subLunarPoint, subSolarPoint } from "../src/lib/earthFrame";
import type { SystemData } from "../src/lib/system";

const data = JSON.parse(readFileSync(join(process.cwd(), "public/data/system/2027.json"), "utf8")) as SystemData;
const RAD = Math.PI / 180;
const J2000 = Date.UTC(2000, 0, 1, 12);
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Sub-solar point from the Almanac's low-precision Sun (equinox of date) and GMST. */
function almanac(ms: number) {
  const n = (ms - J2000) / 86_400_000;
  const L = 280.46 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * RAD;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  return { lat: dec / RAD, lon: wrap180((ra - gmstRad(ms)) / RAD) };
}

let fail = 0;
const check = (name: string, ok: boolean, text: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${text}`);
};
const f = (n: number) => n.toFixed(3);

const cases: [string, number, { lat: number; lon: number; tol: number } | null][] = [
  ["2027-03-20 12:00 UTC (equinox day, noon)", Date.UTC(2027, 2, 20, 12), { lat: 0, lon: 0, tol: 2.5 }],
  ["2027-06-21 00:00 UTC (solstice day, midnight)", Date.UTC(2027, 5, 21, 0), { lat: 23.44, lon: 180, tol: 1 }],
  ["2027-09-23 12:00 UTC (equinox day, noon)", Date.UTC(2027, 8, 23, 12), { lat: 0, lon: 0, tol: 2.5 }],
  ["2027-12-22 06:00 UTC", Date.UTC(2027, 11, 22, 6), { lat: -23.44, lon: 90, tol: 1 }],
  ["2027-01-15 17:30 UTC", Date.UTC(2027, 0, 15, 17, 30), null],
  ["2027-08-02 03:10 UTC", Date.UTC(2027, 7, 2, 3, 10), null],
];
for (const [name, ms, want] of cases) {
  const s = subSolarPoint(data, ms);
  const a = almanac(ms);
  const dLat = s.lat - a.lat;
  const dLon = wrap180(s.lon - a.lon);
  check(name, Math.abs(dLat) < 0.03 && Math.abs(dLon) < 0.03, `sub-solar ${f(s.lat)}° N ${f(s.lon)}° E; almanac ${f(a.lat)}, ${f(a.lon)}; difference ${f(dLat)}, ${f(dLon)}`);
  if (want) check("  expected", Math.abs(s.lat - want.lat) < want.tol && Math.abs(wrap180(s.lon - want.lon)) < want.tol, `near ${want.lat}° N ${want.lon}° E within ${want.tol}°`);
}

// The sub-lunar point: the Moon's declination stays within 28.7°, and it is overhead about 50 minutes later each day.
const m0 = subLunarPoint(data, Date.UTC(2027, 5, 21, 0));
const m1 = subLunarPoint(data, Date.UTC(2027, 5, 22, 0));
const drift = wrap180(m1.lon - m0.lon);
check("sub-lunar 2027-06-21 00:00 UTC", Math.abs(m0.lat) < 28.8, `${f(m0.lat)}° N ${f(m0.lon)}° E; a day later ${f(m1.lat)}° N ${f(m1.lon)}° E (moved ${f(drift)}° east: the Moon's daily motion, 11 to 15°)`);
check("  daily drift", drift > 10.5 && drift < 15.5, `${f(drift)}°`);

// Geometry of the frame itself.
const ms = Date.UTC(2027, 5, 21, 0);
const ax = earthAxes(ms);
const d = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
check("axes orthonormal", Math.abs(d(ax.x, ax.y)) < 1e-12 && Math.abs(d(ax.x, ax.z)) < 1e-12 && Math.abs(d(ax.z, ax.z) - 1) < 1e-12, `pole tilt from J2000 ${f(Math.acos(ax.z[2]) / RAD)}°`);
check("ERA and GMST", Math.abs(wrap180((gmstRad(ms) - eraRad(ms)) / RAD) - 0.352) < 0.01, `ERA ${f(eraRad(ms) / RAD)}°, GMST ${f(gmstRad(ms) / RAD)}° (GMST leads by the precession in right ascension since 2000)`);
const k = earthFixedToLatLon(latLonToEarthFixed(28.573, -80.649));
check("lat/lon round trip", Math.abs(k.lat - 28.573) < 1e-9 && Math.abs(k.lon + 80.649) < 1e-9, `${f(k.lat)}, ${f(k.lon)}`);
const fr = earthFrameAt(data, ms);
// Local solar time at Kennedy at this instant from the Sun's hour angle: 00:00 UTC is early evening of the 20th there.
const ha = wrap180(-80.649 - fr.subSolar.lon);
check("Kennedy local solar time", Math.abs(12 + ha / 15 - 18.6) < 0.2, `${f(12 + ha / 15)} h (expected about 18.6 h: UTC minus 5.38 h)`);

console.log(fail ? `${fail} check(s) failed` : "all checks passed");
process.exit(fail ? 1 : 0);

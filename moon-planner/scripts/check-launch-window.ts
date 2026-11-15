// Check src/lib/launchWindow.ts: Earth rotation against known values, the
// Moon's right ascension and declination against JPL Horizons, the Apollo 11
// launch as a sanity check, and the model's own properties over 2027.
//
// Usage: npx tsx scripts/check-launch-window.ts   (two small Horizons calls; falls back offline)

import { readFile } from "node:fs/promises";
import path from "node:path";
import { type LaunchSite, launchSites } from "../src/lib/launchSites";
import {
  bestOpportunity,
  earthRotationAngleDeg,
  formatAzimuthRanges,
  formatLaunchUtc,
  formatOpportunity,
  formatWindow,
  gmstDeg,
  launchOpportunities,
  launchWindowsForAll,
  moonGeocentric,
  requiredAzimuth,
  transferSweepDeg,
} from "../src/lib/launchWindow";
import { moonFrameAt } from "../src/lib/moonFrame";
import type { SystemData, Vec3 } from "../src/lib/system";

const RAD = Math.PI / 180;
const DAY = 86_400_000;
let failures = 0;
const check = (ok: boolean, text: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${text}`);
};
const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

type Horizons = { raDeg: number; decDeg: number; distanceKm: number };

/** Geocentric astrometric RA/Dec (ICRF) and distance of the Moon at a UTC time, from JPL Horizons. */
async function horizonsMoon(ms: number): Promise<Horizons | null> {
  const q = new URLSearchParams({
    format: "text",
    COMMAND: "'301'",
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'500@399'",
    TLIST: `'${(ms / DAY + 2440587.5).toFixed(6)}'`,
    QUANTITIES: "'1,20'",
    ANG_FORMAT: "'DEG'",
    CSV_FORMAT: "'YES'",
  });
  try {
    const r = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${q}`, { signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    const row = text.split("$$SOE")[1]?.split("$$EOE")[0]?.trim();
    if (!row) return null;
    const n = row.split(",").slice(1).map((s) => s.trim()).filter((s) => s !== "" && !Number.isNaN(Number(s))).map(Number);
    return n.length >= 3 ? { raDeg: n[0], decDeg: n[1], distanceKm: n[2] * 149_597_870.7 } : null;
  } catch {
    return null;
  }
}

const toKm = (h: Horizons): Vec3 => {
  const [a, d] = [h.raDeg * RAD, h.decDeg * RAD];
  return [h.distanceKm * Math.cos(d) * Math.cos(a), h.distanceKm * Math.cos(d) * Math.sin(a), h.distanceKm * Math.sin(d)];
};

async function main() {
  const data = JSON.parse(await readFile(path.join(__dirname, "..", "public", "data", "system", "2027.json"), "utf8")) as SystemData;

  // ---- (a) Earth rotation
  console.log("(a) Earth rotation");
  const j2000 = Date.UTC(2000, 0, 1, 12);
  console.log(`  GMST (IAU 1982) 2000-01-01 12:00 UT1: ${gmstDeg(j2000).toFixed(5)}  (reference 280.46062)`);
  check(Math.abs(gmstDeg(j2000) - 280.46062) < 1e-4, "GMST at J2000 matches 280.46062 degrees");
  console.log(`  ERA  (IAU 2000) 2000-01-01 12:00 UT1: ${earthRotationAngleDeg(j2000).toFixed(5)}  (reference 280.46062)`);
  const t27 = Date.UTC(2027, 10, 14);
  // Independent route: IAU 2006 GMST = ERA + accumulated precession in right ascension (arcseconds).
  const du = (t27 - j2000) / DAY;
  const tc = du / 36525;
  const era = (((0.779057273264 + 1.00273781191135448 * du) % 1) * 360 + 360) % 360;
  const gmst06 = (era + (0.014506 + 4612.156534 * tc + 1.3915817 * tc * tc - 0.00000044 * tc ** 3) / 3600) % 360;
  console.log(`  2027-11-14 00:00: GMST 1982 ${gmstDeg(t27).toFixed(5)}, GMST 2006 by ERA + precession ${gmst06.toFixed(5)}, ERA ${earthRotationAngleDeg(t27).toFixed(5)}`);
  check(angDiff(gmstDeg(t27), gmst06) < 1e-3, `the two GMST formulas agree to ${angDiff(gmstDeg(t27), gmst06).toExponential(1)} degrees`);
  check(angDiff(earthRotationAngleDeg(t27), era) < 1e-6, "library ERA matches the direct formula");
  console.log(`  GMST - ERA in 2027 = ${angDiff(gmstDeg(t27), era).toFixed(4)} degrees: precession since 2000, left out on purpose because the ephemeris is in the J2000 frame.`);

  // ---- (b) Moon RA/Dec
  console.log("\n(b) Moon from Earth's centre, system.ts against JPL Horizons (observer table, ICRF astrometric)");
  const mine = moonGeocentric(data, t27);
  const hz = await horizonsMoon(t27);
  console.log(`  system.ts 2027-11-14 00:00 UTC: RA ${mine.raDeg.toFixed(4)}  Dec ${mine.decDeg.toFixed(4)}  distance ${mine.distanceKm.toFixed(0)} km`);
  if (hz) {
    console.log(`  Horizons                      : RA ${hz.raDeg.toFixed(4)}  Dec ${hz.decDeg.toFixed(4)}  distance ${hz.distanceKm.toFixed(0)} km`);
    check(angDiff(mine.raDeg, hz.raDeg) < 0.02 && Math.abs(mine.decDeg - hz.decDeg) < 0.02, `difference RA ${angDiff(mine.raDeg, hz.raDeg).toFixed(4)}  Dec ${Math.abs(mine.decDeg - hz.decDeg).toFixed(4)} degrees, ${Math.abs(mine.distanceKm - hz.distanceKm).toFixed(0)} km`);
  } else {
    // Offline: the sub-Earth point from moonFrame.ts must be opposite the Moon's direction within the libration.
    const fr = moonFrameAt(data, t27);
    console.log(`  Horizons not reachable. Fallback: moonFrame.ts sub-Earth point ${fr.subEarth.lat.toFixed(2)}, ${fr.subEarth.lon.toFixed(2)} (must be within libration limits).`);
    check(Math.abs(fr.subEarth.lat) < 7 && Math.abs(fr.subEarth.lon) < 8.5, "sub-Earth point within libration limits (weaker check than Horizons)");
  }

  // ---- 2027 declination range
  let [dMin, dMax] = [90, -90];
  for (let i = 0; i < data.count; i++) {
    const d = moonGeocentric(data, data.startMs + i * data.stepMs).decDeg;
    dMin = Math.min(dMin, d);
    dMax = Math.max(dMax, d);
  }
  console.log(`\nMoon declination over the 2027 table: ${dMin.toFixed(2)} to +${dMax.toFixed(2)} degrees`);

  // ---- (c) Apollo 11
  console.log("\n(c) Apollo 11 (launch 1969-07-16 13:32:00 UTC, azimuth 72.058, window 72-108 degrees until 17:54; injection 16:16; lunar orbit insertion 1969-07-19 17:22)");
  const loi = Date.UTC(1969, 6, 19, 17, 22);
  const actual = Date.UTC(1969, 6, 16, 13, 32);
  const fetched = await horizonsMoon(loi);
  // Fallback: Horizons geocentric Moon at 1969-07-19 17:22 UTC, fetched 2026-11-15.
  const moon69 = fetched ?? APOLLO_MOON;
  console.log(`  Moon at insertion (${fetched ? "Horizons, fetched now" : "hard-coded from Horizons"}): RA ${moon69.raDeg.toFixed(4)}  Dec ${moon69.decDeg.toFixed(4)}  distance ${moon69.distanceKm.toFixed(0)} km`);
  const pad39a: LaunchSite = { ...launchSites[0], id: "lc39a", name: "KSC LC-39A (Apollo limits)", lat: 28.6083, lon: -80.6041, azimuths: [{ min: 72, max: 108 }] };
  const km69 = toKm(moon69);
  const opts = { moonKmAt: () => km69, transitDays: 3.046 };
  const at = requiredAzimuth(pad39a, actual, opts);
  console.log(`  Model azimuth at the real lift-off time: ${at.azimuthDeg.toFixed(2)} (flown 72.058), inclination ${at.inclinationDeg.toFixed(2)} (flown 32.52)`);
  const list = launchOpportunities(pad39a, loi, opts);
  for (const o of list) console.log(`  ${formatOpportunity(o)}; coast ${o.coastMin.toFixed(0)} min, injection over ${o.tliLat.toFixed(0)}, ${o.tliLon.toFixed(0)}, arrival ${o.arrivalOffsetHours >= 0 ? "+" : ""}${o.arrivalOffsetHours.toFixed(1)} h`);
  const near = list.filter((o) => o.windowOpenMs !== null).sort((a, b) => Math.abs(a.windowOpenMs! - actual) - Math.abs(b.windowOpenMs! - actual))[0];
  if (near) {
    const dOpen = (near.windowOpenMs! - actual) / 60_000;
    const dClose = (near.windowCloseMs! - Date.UTC(1969, 6, 16, 17, 54)) / 60_000;
    console.log(`  Nearest window: opens ${formatLaunchUtc(near.windowOpenMs!)} (${dOpen >= 0 ? "+" : ""}${dOpen.toFixed(0)} min from the real 13:32), closes ${formatLaunchUtc(near.windowCloseMs!)} (${dClose >= 0 ? "+" : ""}${dClose.toFixed(0)} min from the real 17:54)`);
    check(Math.abs(dOpen) <= 90, "window opening within 1.5 hours of the real launch");
    check(actual >= near.windowOpenMs! - 30 * 60_000 && actual <= near.windowCloseMs!, "real launch time inside the model window (30 min tolerance at the opening)");
    console.log(`  Coast to injection: model ${near.coastMin.toFixed(0)} min at its best lift-off; flown 164 min (injection 2 h 44 min after lift-off)`);
  } else check(false, "no window found near the Apollo 11 launch");
  check(Math.abs(at.azimuthDeg - 72.058) < 10, `azimuth at the real lift-off within 10 degrees of 72.058 (difference ${(at.azimuthDeg - 72.058).toFixed(2)})`);
  console.log(`  Transfer sweep for 3.046 days to that distance: ${transferSweepDeg(6563, moon69.distanceKm, 3.046 * 86400).toFixed(1)} degrees from injection to arrival`);

  // ---- (d) properties
  console.log("\n(d) Properties over 2027 (an arrival every 5 days, 3-day transfer, lift-off within 1 day of nominal)");
  const o27 = { system: data };
  const high = ["kodiak", "andoya", "esrange", "saxavord"];
  const equatorial = ["kourou", "alcantara"];
  const full: LaunchSite = { ...launchSites[0], id: "lat40", name: "Test site at 40 N, any eastward azimuth", lat: 40, lon: 0, azimuths: [{ min: 0, max: 180 }] };
  let [n, incBelowDec, incBelowLat, eqMissing, highNotFlagged, fullMissing, fullBelow] = [0, 0, 0, 0, 0, 0, 0];
  const counts = new Map<string, Record<string, number>>();
  for (let t = Date.UTC(2027, 0, 8); t < Date.UTC(2027, 11, 28); t += 5 * DAY) {
    for (const s of [...launchSites, full]) {
      const list = launchOpportunities(s, t, o27);
      const c = counts.get(s.id) ?? { good: 0, costly: 0, blocked: 0, arrivals: 0 };
      c.arrivals++;
      counts.set(s.id, c);
      for (const o of list) {
        n++;
        c[o.rating]++;
        if (o.inclinationDeg < Math.abs(o.moonDecDeg) - 0.01) incBelowDec++;
        if (o.inclinationDeg < Math.abs(s.lat) - 0.01) incBelowLat++;
        if (high.includes(s.id) && o.rating === "good") highNotFlagged++;
        if (s.id === "lat40" && o.inclinationDeg < 40 - 0.01) fullBelow++;
      }
      if (equatorial.includes(s.id)) {
        // Over a four-day span, usable lift-offs must never be more than 30 hours apart.
        const good = launchOpportunities(s, t, { ...o27, spanDays: 2 }).filter((o) => o.rating === "good");
        if (good.length < 3 || good.some((o, i) => i > 0 && o.launchMs - good[i - 1].launchMs > 30 * 3_600_000)) eqMissing++;
      }
      if (s.id === "lat40" && list.filter((o) => o.azimuthAllowed).length < 3) fullMissing++;
    }
  }
  console.log(`  ${n} opportunities examined`);
  check(incBelowDec === 0, "inclination is never below the Moon's declination at arrival");
  check(incBelowLat === 0, "inclination is never below the site latitude");
  check(fullMissing === 0 && fullBelow === 0, `a site at 40 N (above the Moon's largest declination, ${Math.max(dMax, -dMin).toFixed(1)}) always has opportunities, all at inclination 40 or more`);
  check(eqMissing === 0, "Kourou and Alcantara have a usable opportunity every day (never more than 30 hours between usable lift-offs)");
  check(highNotFlagged === 0, "Kodiak, Andoya, Esrange and SaxaVord are never rated good (costly or blocked, with a reason)");
  console.log("  Opportunities per site over those arrivals (good / costly / blocked):");
  for (const s of launchSites) {
    const c = counts.get(s.id)!;
    console.log(`    ${s.name.padEnd(44)} ${String(c.good).padStart(3)} / ${String(c.costly).padStart(3)} / ${String(c.blocked).padStart(3)}   lat ${s.lat.toFixed(1).padStart(6)}  azimuths ${formatAzimuthRanges(s)} (${s.azimuthSource})`);
  }

  // ---- example
  const arrival = Date.UTC(2027, 10, 14);
  console.log(`\nExample: arrival ${formatLaunchUtc(arrival)}, 3-day transfer. First rows of launchWindowsForAll:`);
  const all = launchWindowsForAll(arrival, o27);
  for (const o of all.slice(0, 6)) {
    console.log(`  ${o.siteName} | lift-off ${formatLaunchUtc(o.launchMs)} | az ${o.azimuthDeg.toFixed(1)} | inc ${o.inclinationDeg.toFixed(1)} | ${o.rating} | window ${formatWindow(o)} | arrival ${o.arrivalOffsetHours >= 0 ? "+" : ""}${o.arrivalOffsetHours.toFixed(1)} h | boost ${o.rotationBoostMs.toFixed(0)} m/s`);
  }
  console.log("Best per site for that arrival:");
  for (const s of launchSites) {
    const b = bestOpportunity(all.filter((o) => o.siteId === s.id));
    console.log(`  ${b ? formatOpportunity(b) : `${s.name}: none`}`);
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
  if (failures) process.exitCode = 1;
}

/** JPL Horizons, geocentric astrometric Moon at 1969-07-19 17:22 UTC (see main). */
const APOLLO_MOON: Horizons = { raDeg: 174.6354, decDeg: 2.1931, distanceKm: 394_506 };

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Check src/lib/moonFrame.ts: libration and sub-solar ranges over 2027, and
// Sun and Earth elevation over a smooth sphere at the nine region centres
// against the JPL Horizons observer tracks in public/data/sky.
//
// Usage: npx tsx scripts/check-moon-frame.ts

import { readFile } from "node:fs/promises";
import path from "node:path";
import { elevationDeg, moonAxes, moonFrameAt } from "../src/lib/moonFrame";
import { sites } from "../src/lib/sites";
import type { SystemData } from "../src/lib/system";

type Sky = { startMs: number; stepMs: number; count: number; sunEl: number[]; earthEl: number[] };

const root = path.join(__dirname, "..", "public", "data");
const f = (n: number, d = 3) => (n >= 0 ? "+" : "") + n.toFixed(d);

async function main() {
  const data = JSON.parse(await readFile(path.join(root, "system", "2027.json"), "utf8")) as SystemData;

  const a = moonAxes(Date.UTC(2027, 0, 1));
  console.log(`2027-01-01 00:00 UTC  pole RA ${a.raDeg.toFixed(4)}  Dec ${a.decDeg.toFixed(4)}  W ${a.wDeg.toFixed(4)}`);

  const r = { seLat: [90, -90], seLon: [180, -180], ssLat: [90, -90] };
  const span = (s: number[], v: number) => {
    s[0] = Math.min(s[0], v);
    s[1] = Math.max(s[1], v);
  };
  for (let i = 0; i < data.count; i++) {
    const fr = moonFrameAt(data, data.startMs + i * data.stepMs);
    span(r.seLat, fr.subEarth.lat);
    span(r.seLon, fr.subEarth.lon);
    span(r.ssLat, fr.subSolar.lat);
  }
  console.log(`Sub-Earth latitude   ${f(r.seLat[0])} to ${f(r.seLat[1])}  (expect within about +-6.9)`);
  console.log(`Sub-Earth longitude  ${f(r.seLon[0])} to ${f(r.seLon[1])}  (expect within about +-8.2)`);
  console.log(`Sub-solar latitude   ${f(r.ssLat[0])} to ${f(r.ssLat[1])}  (expect within about +-1.6)`);

  console.log("\nElevation over a smooth sphere, moonFrame minus Horizons (degrees), all hourly samples of 2027:");
  let worst = 0;
  for (const s of sites) {
    const sky = JSON.parse(await readFile(path.join(root, "sky", `${s.id}.json`), "utf8")) as Sky;
    let sunMax = 0;
    let earthMax = 0;
    let sunSum = 0;
    let earthSum = 0;
    for (let i = 0; i < sky.count; i++) {
      const fr = moonFrameAt(data, sky.startMs + i * sky.stepMs);
      const ds = elevationDeg(s.lat, s.lon, fr.sunKm) - sky.sunEl[i];
      const de = elevationDeg(s.lat, s.lon, fr.earthKm) - sky.earthEl[i];
      sunMax = Math.max(sunMax, Math.abs(ds));
      earthMax = Math.max(earthMax, Math.abs(de));
      sunSum += ds;
      earthSum += de;
    }
    worst = Math.max(worst, sunMax, earthMax);
    console.log(
      `  ${s.id.padEnd(15)} Sun max |d| ${sunMax.toFixed(3)} mean ${f(sunSum / sky.count)}   Earth max |d| ${earthMax.toFixed(3)} mean ${f(earthSum / sky.count)}`,
    );
  }

  console.log("\nSpot values at Haworth (moonFrame / Horizons):");
  const s = sites.find((x) => x.id === "haworth")!;
  const sky = JSON.parse(await readFile(path.join(root, "sky", "haworth.json"), "utf8")) as Sky;
  for (const iso of ["2027-01-15T00:00Z", "2027-04-10T12:00Z", "2027-07-20T06:00Z", "2027-11-14T00:00Z"]) {
    const ms = Date.parse(iso);
    const i = Math.round((ms - sky.startMs) / sky.stepMs);
    const fr = moonFrameAt(data, ms);
    console.log(
      `  ${iso}  Sun ${f(elevationDeg(s.lat, s.lon, fr.sunKm))} / ${f(sky.sunEl[i])}   Earth ${f(elevationDeg(s.lat, s.lon, fr.earthKm))} / ${f(sky.earthEl[i])}   sub-solar ${f(fr.subSolar.lat, 2)}, ${f(fr.subSolar.lon, 2)}   sub-Earth ${f(fr.subEarth.lat, 2)}, ${f(fr.subEarth.lon, 2)}`,
    );
  }
  console.log(`\nWorst elevation difference: ${worst.toFixed(3)} degrees`);
  if (worst > 0.3) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

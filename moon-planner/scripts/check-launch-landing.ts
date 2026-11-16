// Check src/lib/launchLanding.ts against the shared sky model: stay statistics
// equal missionScore, Sun/Earth state at landing equals isUp, quality and
// reason follow the booleans, a landing in a dark spell reports the sunrise
// the contact solver finds, and out-of-range input gives null.
//
// Usage: npx tsx scripts/check-launch-landing.ts

import { readFile } from "node:fs/promises";
import path from "node:path";
import { contactEvents, isUp } from "../src/lib/contacts";
import { landingConditions, orbitLine } from "../src/lib/launchLanding";
import { HOUR, pct } from "../src/lib/format";
import { missionScore, rangeOf, sampleAt, type SiteData, type SkyData } from "../src/lib/sky";
import type { HorizonProfile } from "../src/lib/terrain";

const root = path.join(process.cwd(), "public", "data");
let failures = 0;
const check = (ok: boolean, text: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${text}`);
};

async function load(id: string): Promise<SiteData> {
  const sky = JSON.parse(await readFile(path.join(root, "sky", `${id}.json`), "utf8")) as SkyData;
  const horizon = JSON.parse(await readFile(path.join(root, "horizon", `${id}.json`), "utf8")) as HorizonProfile;
  return { sky, horizon };
}

const LANDING = Date.UTC(2027, 10, 14);
const STAY = 156;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

function verify(id: string, site: SiteData, ms: number) {
  const c = landingConditions(site, ms, STAY);
  check(c !== null, `${id} ${iso(ms)}: conditions returned`);
  if (!c) return null;
  const m = missionScore(site, ms, ms + STAY * HOUR);
  const same =
    c.stay.score === m.score &&
    c.stay.sunlit === m.sunlit &&
    c.stay.earthVisible === m.earthVisible &&
    c.stay.longestDarkHours === m.longestDarkHours &&
    c.stay.longestNoCommsHours === m.longestNoCommsHours;
  check(same, `stay stats equal missionScore (score ${m.score.toFixed(4)}, Sun up ${pct(m.sunlit)}, Earth ${pct(m.earthVisible)}, longest dark ${m.longestDarkHours} h, longest without Earth ${m.longestNoCommsHours} h)`);
  const s = sampleAt(site, ms);
  check(c.sunUp === isUp(site, "sun", ms) && c.earthUp === isUp(site, "earth", ms), `Sun up ${c.sunUp}, Earth up ${c.earthUp} agree with isUp`);
  check(Math.abs(c.sunFraction - s.sunFraction) < 1e-12, `Sun disc ${pct(c.sunFraction)} matches sampleAt; Sun edge ${c.sunClearanceDeg.toFixed(2)}°, Earth edge ${c.earthClearanceDeg.toFixed(2)}°`);
  const want = c.sunUp && c.earthUp ? "good" : c.sunUp || c.earthUp ? "partial" : "poor";
  check(c.quality === want, `quality ${c.quality}`);
  const reasonOk =
    (c.sunUp ? !c.reason.includes("in the dark") : c.reason.includes("in the dark")) &&
    (c.earthUp ? !c.reason.includes("without Earth") : c.reason.includes("without Earth"));
  check(reasonOk, `reason: "${c.reason}"`);
  console.log(`       next Sun: ${c.nextSun ? `${c.nextSun.kind} ${iso(c.nextSun.ms)}` : "none"}; next Earth: ${c.nextEarth ? `${c.nextEarth.kind} ${iso(c.nextEarth.ms)}` : "none"}`);
  return c;
}

async function main() {
  for (const id of ["de-gerlache-2", "slater"]) {
    console.log(`\n${id}`);
    const site = await load(id);
    verify(id, site, LANDING);

    // Out of range: before the data, and a stay running past its end.
    const r = rangeOf(site.sky);
    check(landingConditions(site, r.startMs - HOUR, STAY) === null, "landing before the data gives null");
    check(landingConditions(site, r.endMs - 24 * HOUR, STAY) === null, "stay past the end of the data gives null");
    check(landingConditions(site, NaN, STAY) === null, "NaN landing gives null");
  }

  // A landing inside a known dark spell at Slater: the first sunset at or after the landing date, plus 1 h.
  console.log("\nslater, landing in a dark spell");
  const slater = await load("slater");
  const r = rangeOf(slater.sky);
  const sunsets = contactEvents(slater, LANDING - 60 * 24 * HOUR, r.endMs - 200 * HOUR).filter((e) => e.kind === "sunset");
  let dark: number | null = null;
  for (const e of sunsets) {
    const t = e.ms + HOUR;
    if (!isUp(slater, "sun", t)) {
      dark = t;
      break;
    }
  }
  check(dark !== null, "found a dark spell");
  if (dark !== null) {
    const c = verify("slater", slater, dark);
    if (c) {
      check(c.quality !== "good", `quality in the dark is ${c.quality}`);
      const solver = contactEvents(slater, dark, r.endMs).find((e) => e.kind === "sunrise") ?? null;
      check(
        c.nextSun !== null && c.nextSun.kind === "sunrise" && solver !== null && Math.abs(c.nextSun.ms - solver.ms) < 60_000,
        `sunrise ${c.nextSun ? iso(c.nextSun.ms) : "none"} matches the contact solver ${solver ? iso(solver.ms) : "none"} (${solver ? ((solver.ms - dark) / HOUR).toFixed(1) : "?"} h after landing)`,
      );
    }
  }

  console.log("\norbit lines");
  for (const [n, lat] of [["de Gerlache Rim 2", -88.23], ["Peak near Cabeus B", -83.6375], ["Equator test", 12.3]] as const) {
    const o = orbitLine(n, lat);
    console.log(`  ${o.text}${o.pass ? ` ${o.pass}` : ""}`);
  }
  check(orbitLine("x", -88.23).kind === "polar" && orbitLine("x", -83.6).kind === "near-polar" && orbitLine("x", 12).kind === null, "orbit wording by latitude");

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main();

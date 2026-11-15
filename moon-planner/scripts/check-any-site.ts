// Check src/lib/anySite.ts: Sun and Earth azimuth and elevation from
// buildSmoothSite at the nine region centres against the JPL Horizons observer
// tracks in public/data/sky, and the build time of one site. Exits non-zero
// when a difference is over the limits below.
//
// Usage: npx tsx scripts/check-any-site.ts

import { readFile } from "node:fs/promises";
import path from "node:path";
import { SMOOTH_DIP_DEG, buildSmoothSite, parseCoordinate } from "../src/lib/anySite";
import { sites } from "../src/lib/sites";
import { nextEvent, sampleAt, scoreWindow, windowStats, type SkyData } from "../src/lib/sky";
import type { SystemData } from "../src/lib/system";

const EL_LIMIT = 0.01;
const AZ_LIMIT = 0.05;
/** Every 7th hour: 1,252 samples spread over the year and over all hours of the day. */
const STRIDE = 7;
const HOUR = 3_600_000;

const root = path.join(__dirname, "..", "public", "data");
const azDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

async function main() {
  const data = JSON.parse(await readFile(path.join(root, "system", "2027.json"), "utf8")) as SystemData;
  let failed = false;
  const fail = (msg: string) => {
    failed = true;
    console.log(`  FAIL ${msg}`);
  };

  const t0 = performance.now();
  buildSmoothSite(0.6742, 23.4731, data);
  const first = performance.now() - t0;
  let later = 0;
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    buildSmoothSite(-80 + i, i * 17, data);
    later += performance.now() - t;
  }
  console.log(`Build time for one site, all of 2027 hourly: first ${first.toFixed(1)} ms, then ${(later / 20).toFixed(2)} ms each`);
  if (first > 150) fail("the first build took over 150 ms");

  console.log(`\nbuildSmoothSite minus Horizons (degrees), every ${STRIDE}th hour of 2027:`);
  const worst = { sunEl: 0, sunAz: 0, earthEl: 0, earthAz: 0 };
  for (const s of sites) {
    const ref = JSON.parse(await readFile(path.join(root, "sky", `${s.id}.json`), "utf8")) as SkyData;
    const { sky } = buildSmoothSite(s.lat, s.lon, data);
    if (sky.startMs !== ref.startMs || sky.stepMs !== ref.stepMs || sky.count !== ref.count) {
      fail(`${s.id}: time grid differs (start ${sky.startMs} vs ${ref.startMs}, count ${sky.count} vs ${ref.count})`);
      continue;
    }
    const m = { sunEl: 0, sunAz: 0, earthEl: 0, earthAz: 0 };
    let n = 0;
    for (let i = 0; i < ref.count; i += STRIDE, n++) {
      m.sunEl = Math.max(m.sunEl, Math.abs(sky.sunEl[i] - ref.sunEl[i]));
      m.earthEl = Math.max(m.earthEl, Math.abs(sky.earthEl[i] - ref.earthEl[i]));
      m.sunAz = Math.max(m.sunAz, azDiff(sky.sunAz[i], ref.sunAz[i]));
      m.earthAz = Math.max(m.earthAz, azDiff(sky.earthAz[i], ref.earthAz[i]));
    }
    for (const k of Object.keys(m) as (keyof typeof m)[]) worst[k] = Math.max(worst[k], m[k]);
    console.log(
      `  ${s.id.padEnd(15)} ${n} samples  Sun el ${m.sunEl.toFixed(4)} az ${m.sunAz.toFixed(4)}   Earth el ${m.earthEl.toFixed(4)} az ${m.earthAz.toFixed(4)}`,
    );
  }
  console.log(
    `\nMax |difference|: Sun elevation ${worst.sunEl.toFixed(4)}, Sun azimuth ${worst.sunAz.toFixed(4)}, Earth elevation ${worst.earthEl.toFixed(4)}, Earth azimuth ${worst.earthAz.toFixed(4)}`,
  );
  console.log(`Limits: elevation ${EL_LIMIT}, azimuth ${AZ_LIMIT}`);
  if (Math.max(worst.sunEl, worst.earthEl) > EL_LIMIT) fail("elevation over the limit");
  if (Math.max(worst.sunAz, worst.earthAz) > AZ_LIMIT) fail("azimuth over the limit");

  // The sky.ts functions on a smooth site, at places with a known answer.
  console.log(`\nFlat horizon at ${SMOOTH_DIP_DEG.toFixed(4)} degrees. Window 14 Nov 2027, 6.5 days:`);
  const w0 = Date.UTC(2027, 10, 14);
  const w1 = w0 + 156 * HOUR;
  for (const [name, lat, lon] of [
    ["Apollo 11", 0.6742, 23.4731],
    ["Far side 0 N 180 E", 0, 180],
    ["Near side 0 N 0 E", 0, 0],
  ] as const) {
    const site = buildSmoothSite(lat, lon, data);
    const st = windowStats(site, w0, w1);
    const sc = scoreWindow(site.sky.siteId, st);
    const year = windowStats(site, site.sky.startMs, site.sky.startMs + (site.sky.count - 1) * HOUR);
    const now = sampleAt(site, w0);
    const ev = nextEvent(site, w0, "sun");
    console.log(
      `  ${name.padEnd(19)} Sun up ${(st.sunlit * 100).toFixed(0)}%  Earth ${(st.earthVisible * 100).toFixed(0)}%  score ${sc.score.toFixed(2)}  Sun el now ${now.sunEl.toFixed(2)}  next Sun ${ev ? `${ev.kind} ${new Date(ev.atMs).toISOString().slice(0, 16)}` : "none"}  year: Sun ${(year.sunlit * 100).toFixed(1)}% Earth ${(year.earthVisible * 100).toFixed(0)}% longest dark ${(year.longestDarkHours / 24).toFixed(1)} d`,
    );
    if (lon === 180 && year.earthVisible !== 0) fail("Earth should never be in view from 0 N 180 E");
    if (lon === 0 && year.earthVisible !== 1) fail("Earth should always be in view from 0 N 0 E");
    if (Math.abs(year.sunlit - 0.5) > 0.02) fail(`${name}: the Sun should be up about half the year`);
    if (year.longestDarkHours < 13 * 24 || year.longestDarkHours > 16 * 24) fail(`${name}: the night should last about two weeks`);
  }

  const parse = (t: string, a: "lat" | "lon") => {
    const r = parseCoordinate(t, a);
    return r.ok ? r.value : NaN;
  };
  const cases: [string, "lat" | "lon", number][] = [
    ["0.67 N", "lat", 0.67],
    ["41.64° S", "lat", -41.64],
    ["−41.64", "lat", -41.64],
    ["153.99W", "lon", -153.99],
    ["206", "lon", -154],
    ["91", "lat", NaN],
    ["12 E", "lat", NaN],
    ["abc", "lon", NaN],
    ["", "lat", NaN],
  ];
  for (const [t, a, want] of cases) {
    const got = parse(t, a);
    if (!(Number.isNaN(want) ? Number.isNaN(got) : Math.abs(got - want) < 1e-9)) fail(`parseCoordinate("${t}", ${a}) gave ${got}, expected ${want}`);
  }
  console.log(`\nparseCoordinate: ${cases.length} cases checked`);

  if (failed) {
    console.log("\nFAILED");
    process.exit(1);
  }
  console.log("\nOK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

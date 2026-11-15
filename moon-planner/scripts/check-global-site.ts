// Check src/lib/localTerrain.ts against live NASA Moon Trek data:
//   1. the local projection round-trips;
//   2. raster orientation: the Moon's highest point is found where it should
//      be on plates centred east and south of it;
//   3. the polar and global mosaics agree where they meet (55° N and S);
//   4. the horizon from the Moon Trek grids at four of the nine regions
//      against public/data/horizon/<id>.json (80 m near field + 640 m grid);
//   5. Tycho: the horizon from the floor rises toward the rim, and the
//      terrain-aware site differs from the smooth one.
//
// Usage: npx tsx scripts/check-global-site.ts   (needs the network; about 20 requests)

import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildSmoothSite } from "../src/lib/anySite";
import { buildGlobalSite, computeLocalHorizon, loadLocalTerrain, localProjection } from "../src/lib/localTerrain";
import { windowStats } from "../src/lib/sky";
import type { SystemData } from "../src/lib/system";
import { sampleHeight, type HorizonProfile } from "../src/lib/terrain";

const root = path.join(__dirname, "..", "public", "data");
const HOUR = 3_600_000;
let failed = false;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failed = true;
};

async function main() {
  console.log("1. Projection round trip");
  let worst = 0;
  for (const [lat0, lon0] of [[-43.31, -11.36], [0.67, 23.47], [84, 179.5], [-60, -179.9], [89.5, 10]]) {
    const p = localProjection(lat0, lon0);
    for (let i = 0; i < 200; i++) {
      const x = ((i * 7919) % 300000) - 150000;
      const y = ((i * 104729) % 300000) - 150000;
      const q = p.unproject(x, y);
      const b = p.project(q.lat, q.lon);
      worst = Math.max(worst, Math.hypot(b.x - x, b.y - y));
    }
  }
  check(worst < 0.01, `worst round-trip error ${worst.toExponential(2)} m`);

  console.log("\n2. Orientation: highest point on the Moon (5.4125 N, 158.6335 W, about +10.7 km)");
  const peak = { lat: 5.4125, lon: -158.6335 };
  for (const [name, lat, lon] of [["plate centred 1° east of it", 5.4125, -157.6335], ["plate centred 1° north of it", 6.4125, -158.6335]] as const) {
    const t = await loadLocalTerrain(lat, lon);
    const p = t.projection.project(peak.lat, peak.lon);
    const h = sampleHeight(t.grid, p.x, p.y);
    const mirror = sampleHeight(t.grid, -p.x, -p.y);
    check(h > 9500 && h > mirror + 1000, `${name}: ${h.toFixed(0)} m at the peak (x ${(p.x / 1000).toFixed(1)} km, y ${(p.y / 1000).toFixed(1)} km), ${mirror.toFixed(0)} m at the mirrored point`);
  }

  console.log("\n3. Polar and global mosaics where they meet");
  for (const [name, a, b, lon] of [["55° N", 54.9, 55.1, 30], ["55° S", -54.9, -55.1, -100]] as const) {
    const g = await loadLocalTerrain(a, lon);
    const s = await loadLocalTerrain(b, lon);
    let sum = 0;
    let max = 0;
    let n = 0;
    let rough = 0;
    for (let i = -10; i <= 10; i++) {
      for (let j = -10; j <= 10; j++) {
        const x = i * 12000;
        const y = j * 12000;
        const q = g.projection.unproject(x, y);
        const p = s.projection.project(q.lat, q.lon);
        const d = Math.abs(sampleHeight(g.grid, x, y) - sampleHeight(s.grid, p.x, p.y));
        if (Number.isNaN(d)) continue;
        rough += Math.abs(sampleHeight(g.grid, x, y) - sampleHeight(g.grid, -x, y));
        sum += d;
        max = Math.max(max, d);
        n++;
      }
    }
    check(sum / n < 60, `${name}: mean |Δh| ${(sum / n).toFixed(1)} m, max ${max.toFixed(0)} m over ${n} points (mirrored-x mean |Δh| ${(rough / n).toFixed(0)} m for scale)`);
  }

  console.log("\n4. Horizon from the Moon Trek grids vs the precomputed region horizons (degrees)");
  for (const id of ["malapert", "haworth", "nobile-1", "mouton-plateau"]) {
    const ref = JSON.parse(await readFile(path.join(root, "horizon", `${id}.json`), "utf8")) as HorizonProfile;
    const t = await loadLocalTerrain(ref.lat, ref.lon);
    const hz = computeLocalHorizon(t);
    let sum = 0;
    let max = 0;
    let bias = 0;
    for (let i = 0; i < 720; i++) {
      const d = hz.elevations[i] - ref.elevations[i];
      sum += Math.abs(d);
      bias += d;
      max = Math.max(max, Math.abs(d));
    }
    check(sum / 720 < 1.5, `${id.padEnd(15)} mean |Δ| ${(sum / 720).toFixed(2)}, mean Δ ${(bias / 720).toFixed(2)}, max |Δ| ${max.toFixed(2)}; site height ${hz.siteHeight} vs ${ref.siteHeight} m`);
  }

  console.log("\n5. Tycho (43.31 S, 11.36 W is the central peak; floor point 43.0 S, 10.6 W)");
  const system = JSON.parse(await readFile(path.join(root, "system", "2027.json"), "utf8")) as SystemData;
  const floor = await loadLocalTerrain(-43.0, -10.6);
  const site = buildGlobalSite(floor, system);
  const e = site.horizon.elevations;
  const min = Math.min(...e);
  const max = Math.max(...e);
  check(min > 1 && max < 25, `floor horizon ${min.toFixed(1)}° to ${max.toFixed(1)}° (site height ${site.horizon.siteHeight} m); N ${e[0]}°, E ${e[180]}°, S ${e[360]}°, W ${e[540]}°`);
  const start = Date.UTC(2027, 6, 1);
  const a = windowStats(site, start, start + 720 * HOUR);
  const b = windowStats(buildSmoothSite(-43.0, -10.6, system), start, start + 720 * HOUR);
  check(a.sunlit < b.sunlit, `July 2027 sunlit share: terrain ${(a.sunlit * 100).toFixed(1)}%, smooth ${(b.sunlit * 100).toFixed(1)}%`);
  const peakT = await loadLocalTerrain(-43.31, -11.36);
  console.log(`  Tycho plate: heights ${peakT.minHeight.toFixed(0)} to ${peakT.maxHeight.toFixed(0)} m; centre ${sampleHeight(peakT.near, 0, 0).toFixed(0)} m; 30 km east ${sampleHeight(peakT.grid, 30000, 0).toFixed(0)} m; 50 km east ${sampleHeight(peakT.grid, 50000, 0).toFixed(0)} m`);
  const ap = await loadLocalTerrain(0.6742, 23.4731);
  const apH = computeLocalHorizon(ap);
  console.log(`  Apollo 11: site height ${apH.siteHeight} m, horizon ${Math.min(...apH.elevations).toFixed(2)}° to ${Math.max(...apH.elevations).toFixed(2)}°`);

  console.log(failed ? "\nFAILED" : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

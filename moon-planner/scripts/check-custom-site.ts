// Checks for custom sites (src/lib/horizonFromGrid.ts, src/lib/customSite.ts).
//
// 1. Method: the fast march in computeHorizon() against a direct port of the
//    loop in scripts/process-dem.ts (destination + latLonToXY + 3D vectors),
//    both on the 640 m heightmap. Should agree to rounding (0.001°).
// 2. Accuracy at the nine region centres against the published profiles in
//    public/data/horizon/ (80 m near field + 320 m grid):
//      - 640 m heightmap alone
//      - 640 m heightmap + the same 80 m PGDA windows process-dem used
//        (data/raw/, written by npm run process-dem; skipped if absent)
//    and what each does to 2027 sunlight, Earth visibility and the ranking.
// 3. --live[=URL]: network checks.
//      - 640 m + 80 m near field from NASA Moon Trek (loadNearField), the
//        source custom sites use, against the published profiles.
//      - loadCustomSite() end to end against a running dev server (default
//        http://localhost:3100) at a region centre, where the API route
//        answers from its 2027 cache; the tracks must match public/data/sky/.
//    --live-custom also loads a new point from JPL; note the route saves every
//    new request to data/horizons-cache/.
// 4. loadCustomSite() with a simulated network: Moon Trek down (falls back to
//    the 640 m grid), and the route failing, unreachable or returning bad rows
//    (each must reject with the right CustomSiteError kind).
//
// Usage: npx tsx scripts/check-custom-site.ts [--live[=URL]] [--live-custom]

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { sites } from "../src/lib/sites";
import {
  MOON_RADIUS_M,
  destination,
  latLonToXY,
  sampleHeight,
  type HeightGrid,
  type HorizonProfile,
} from "../src/lib/terrain";
import {
  MAST_M,
  NEAR_FIELD_SERVICE,
  computeHorizon,
  heightGridFromBuffer,
  loadNearField,
  type HeightmapMeta,
} from "../src/lib/horizonFromGrid";
import { rankSites, windowStats, type SiteData, type SkyData } from "../src/lib/sky";
import {
  CustomSiteError,
  customHorizonMethod,
  customSkyRange,
  isCustomSiteSupported,
  loadCustomSite,
} from "../src/lib/customSite";

const ROOT = process.cwd();
const DEG = Math.PI / 180;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const YEAR_START = Date.UTC(2027, 0, 1);
const YEAR_END = Date.UTC(2028, 0, 1);

const args = process.argv.slice(2);
const liveArg = args.find((a) => a === "--live" || a.startsWith("--live="));
const liveBase = liveArg?.includes("=") ? liveArg.slice("--live=".length) : "http://localhost:3100";
const liveCustom = args.includes("--live-custom");

const readJson = async <T>(...parts: string[]): Promise<T> =>
  JSON.parse(await readFile(path.join(ROOT, ...parts), "utf8")) as T;
const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

const pad = (s: string | number, n: number) => String(s).padStart(n);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const deg = (v: number, d = 2) => `${v.toFixed(d)}°`;
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}°`;

// ---------- Direct port of process-dem's computeHorizon, one grid ----------

type Vec3 = [number, number, number];

function unitVector(lat: number, lon: number): Vec3 {
  const p = lat * DEG;
  const l = lon * DEG;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}

function inBounds(grid: HeightGrid, x: number, y: number): boolean {
  const col = (x - grid.originX) / grid.pixelSize - 0.5;
  const row = (grid.originY - y) / grid.pixelSize - 0.5;
  return col >= 0 && row >= 0 && col <= grid.width - 1 && row <= grid.height - 1;
}

function referenceHorizon(lat: number, lon: number, observerHeight: number, grid: HeightGrid): number[] {
  const up = unitVector(lat, lon);
  const rObs = MOON_RADIUS_M + observerHeight;
  const P: Vec3 = [up[0] * rObs, up[1] * rObs, up[2] * rObs];
  const elevations: number[] = [];
  for (let i = 0; i < 720; i++) {
    const az = i * 0.5;
    let maxEl = -90;
    let s = grid.pixelSize; // one pixel out
    for (;;) {
      const q = destination(lat, lon, az, s);
      const { x, y } = latLonToXY(q.lat, q.lon);
      if (!inBounds(grid, x, y)) break;
      s += grid.pixelSize / 2;
      const h = sampleHeight(grid, x, y);
      if (Number.isNaN(h)) continue;
      const u = unitVector(q.lat, q.lon);
      const r = MOON_RADIUS_M + h;
      const dx = u[0] * r - P[0];
      const dy = u[1] * r - P[1];
      const dz = u[2] * r - P[2];
      const el = Math.asin((dx * up[0] + dy * up[1] + dz * up[2]) / Math.hypot(dx, dy, dz)) / DEG;
      if (el > maxEl) maxEl = el;
    }
    elevations.push(Number(maxEl.toFixed(3)));
  }
  return elevations;
}

// ---------- Helpers ----------

type Diff = { meanAbs: number; bias: number; max: number; maxAt: number };

function diffStats(a: number[], b: number[]): Diff {
  let sumAbs = 0;
  let sum = 0;
  let max = 0;
  let maxAt = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d;
    sumAbs += Math.abs(d);
    if (Math.abs(d) > max) {
      max = Math.abs(d);
      maxAt = i;
    }
  }
  return { meanAbs: sumAbs / a.length, bias: sum / a.length, max, maxAt };
}

const median = (values: number[]) => {
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;

function summary(label: string, diffs: Diff[]) {
  console.log(
    `  ${label}: mean|d| ${deg(mean(diffs.map((d) => d.meanAbs)))} (median site ${deg(median(diffs.map((d) => d.meanAbs)))}), ` +
      `worst max|d| ${deg(Math.max(...diffs.map((d) => d.max)))}, mean bias ${signed(mean(diffs.map((d) => d.bias)))}`,
  );
}

/** The 128 x 128 PGDA 80 m window process-dem cached for a site, if present. */
async function pgdaWindow(lat: number, lon: number): Promise<HeightGrid | null> {
  const { x, y } = latLonToXY(lat, lon);
  const col = Math.floor((x + 304_000) / 80) - 64;
  const row = Math.floor((304_000 - y) / 80) - 64;
  const base = path.join(ROOT, "data", "raw", `ldem80s_80m_c${col}_r${row}_128x128`);
  if (!(await exists(`${base}.bin`))) return null;
  const meta = JSON.parse(await readFile(`${base}.json`, "utf8")) as Omit<HeightGrid, "data">;
  const buf = await readFile(`${base}.bin`);
  return { ...meta, data: new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) };
}

type Variant = { name: string; horizon: HorizonProfile };
type Row = { id: string; published: HorizonProfile; sky: SkyData; variants: Variant[]; pgda: HeightGrid | null };

function statsTable(rows: Row[], names: string[]) {
  const heads = ["published", ...names];
  console.log(`  ${"site".padEnd(15)}${heads.map((h) => pad(h, 13)).join("")}   (Sun up | Earth in view | longest dark)`);
  for (const r of rows) {
    const all = [r.published, ...names.map((n) => r.variants.find((v) => v.name === n)!.horizon)];
    const s = all.map((h) => windowStats({ sky: r.sky, horizon: h }, YEAR_START, YEAR_END));
    console.log(`  ${r.id.padEnd(15)}${s.map((x) => pad(pct(x.sunlit), 13)).join("")}`);
    console.log(`  ${"".padEnd(15)}${s.map((x) => pad(pct(x.earthVisible), 13)).join("")}`);
    console.log(`  ${"".padEnd(15)}${s.map((x) => pad(`${x.longestDarkHours} h`, 13)).join("")}`);
  }
}

function rankingAgreement(rows: Row[], name: string) {
  const pub = new Map(rows.map((r): [string, SiteData] => [r.id, { sky: r.sky, horizon: r.published }]));
  const mine = new Map(
    rows.map((r): [string, SiteData] => [r.id, { sky: r.sky, horizon: r.variants.find((v) => v.name === name)!.horizon }]),
  );
  let sameTop = 0;
  let windows = 0;
  let shift = 0;
  for (let m = 0; m < 12; m++) {
    for (const day of [1, 15]) {
      const t = Date.UTC(2027, m, day);
      const a = rankSites(pub, t, 14 * 24);
      const b = rankSites(mine, t, 14 * 24);
      windows++;
      if (a[0].siteId === b[0].siteId) sameTop++;
      for (const [i, s] of a.entries()) shift += Math.abs(b.findIndex((x) => x.siteId === s.siteId) - i);
    }
  }
  console.log(
    `  ${name}: same top site in ${sameTop}/${windows} 14-day windows (1st and 15th of each month), ` +
      `mean rank shift ${(shift / (windows * rows.length)).toFixed(2)} places`,
  );
}

// ---------- Main ----------

async function main() {
  const meta = await readJson<HeightmapMeta>("public", "data", "terrain", "heightmap.json");
  const bin = await readFile(path.join(ROOT, "public", "data", "terrain", "heightmap.bin"));
  const grid = heightGridFromBuffer(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  console.log(`Heightmap ${grid.width} x ${grid.height} @ ${grid.pixelSize} m, origin ${grid.originX}, ${grid.originY} m`);

  computeHorizon(grid, -85, 0); // warm up the JIT so timings reflect repeat use

  // 1. Method check and timing.
  console.log("\n1. Fast march vs direct port of process-dem, both on the 640 m grid");
  const rows: Row[] = [];
  const times: number[] = [];
  const refTimes: number[] = [];
  let refWorst = 0;
  for (const site of sites) {
    const published = await readJson<HorizonProfile>("public", "data", "horizon", `${site.id}.json`);
    const sky = await readJson<SkyData>("public", "data", "sky", `${site.id}.json`);
    const t0 = performance.now();
    const fast = computeHorizon(grid, site.lat, site.lon, { siteId: site.id });
    times.push(performance.now() - t0);
    const { x, y } = latLonToXY(site.lat, site.lon);
    const t1 = performance.now();
    const ref = referenceHorizon(site.lat, site.lon, sampleHeight(grid, x, y) + MAST_M, grid);
    refTimes.push(performance.now() - t1);
    refWorst = Math.max(refWorst, diffStats(fast.elevations, ref).max);

    const variants: Variant[] = [{ name: "640 m", horizon: fast }];
    const pgda = await pgdaWindow(site.lat, site.lon);
    if (pgda) {
      const t2 = performance.now();
      variants.push({ name: "640+80 PGDA", horizon: computeHorizon(grid, site.lat, site.lon, { siteId: site.id, nearField: pgda }) });
      times.push(performance.now() - t2);
    }
    rows.push({ id: site.id, published, sky, variants, pgda });
  }
  console.log(
    `  max |d| ${deg(refWorst, 3)} over 9 sites x 720 azimuths: ${refWorst <= 0.0011 ? "OK (rounding only)" : "MISMATCH"}`,
  );
  console.log(
    `  time per profile: ${median(times).toFixed(0)} ms median, ${Math.max(...times).toFixed(0)} ms worst ` +
      `(direct port: ${median(refTimes).toFixed(0)} ms median)`,
  );
  if (refWorst > 0.0011) process.exitCode = 1;

  // 2. Accuracy against the published profiles.
  const names = rows[0].variants.map((v) => v.name);
  console.log("\n2. Against public/data/horizon (80 m near field + 320 m grid), 720 azimuths per site");
  console.log(
    `  ${"site".padEnd(15)}${pad("h 80m", 8)}${pad("h 640m", 8)}` +
      names.map((n) => `${pad(`${n} mean|d|`, 20)}${pad("max|d|", 8)}${pad("at az", 7)}${pad("bias", 8)}`).join(""),
  );
  for (const r of rows) {
    const cells = r.variants.map((v) => {
      const d = diffStats(v.horizon.elevations, r.published.elevations);
      return `${pad(deg(d.meanAbs), 20)}${pad(deg(d.max), 8)}${pad(d.maxAt * 0.5, 7)}${pad(signed(d.bias), 8)}`;
    });
    console.log(
      `  ${r.id.padEnd(15)}${pad(r.published.siteHeight.toFixed(0), 8)}${pad(r.variants[0].horizon.siteHeight.toFixed(0), 8)}${cells.join("")}`,
    );
  }
  for (const n of names) {
    summary(n, rows.map((r) => diffStats(r.variants.find((v) => v.name === n)!.horizon.elevations, r.published.elevations)));
  }
  if (names.length === 1) console.log("  (no data/raw/ 80 m windows found; run npm run process-dem to add the near-field comparison)");

  console.log("\n  2027, same Horizons tracks, per horizon:");
  statsTable(rows, names);
  console.log("\n  Ranking against the published horizons:");
  for (const n of names) rankingAgreement(rows, n);

  // Supported area and request range.
  console.log("\n   Supported-area checks");
  const cases: [number, number][] = [
    [-80, 45],
    [-80, 0],
    [-80.05, 0],
    [-79.9, 10],
    [-89.9, 0],
    [-89.95, 0],
    [-85, 300],
    [-85, -190],
    [Number.NaN, 0],
  ];
  for (const [lat, lon] of cases) {
    const s = isCustomSiteSupported(lat, lon);
    console.log(`  ${`${lat}, ${lon}`.padEnd(14)} ${s.ok ? "ok" : `no: ${s.reason}`}`);
  }
  // Every supported point near the edge must have terrain under it and at
  // least one terrain sample on every azimuth (-90 = none). The 80° S circle
  // only reaches the square grid's edge within 6° of the four axes.
  let edgeFailures = 0;
  let edgeChecked = 0;
  for (const axis of [-90, 0, 90, 180]) {
    for (let lon = axis - 6; lon <= axis + 6; lon += 0.5) {
      for (const lat of [-80, -80.02, -80.04, -80.06]) {
        if (!isCustomSiteSupported(lat, lon).ok) continue;
        edgeChecked++;
        try {
          if (computeHorizon(grid, lat, lon).elevations.includes(-90)) edgeFailures++;
        } catch {
          edgeFailures++;
        }
      }
    }
  }
  console.log(
    `  edge sweep (80.00-80.06° S within 6° of the grid axes): ${edgeChecked} supported points, ${edgeFailures} without terrain on every azimuth`,
  );
  if (edgeFailures) process.exitCode = 1;
  const edge = computeHorizon(grid, -80.1, 30);
  const minReach = Math.min(...edge.reachKm);
  console.log(
    `  terrain reach at 80.1° S 30° E: ${minReach} km minimum (az ${edge.reachKm.indexOf(minReach) * 0.5}°), ${Math.max(...edge.reachKm)} km maximum`,
  );
  for (const [a, b] of [
    [Date.UTC(2027, 0, 1, 6), Date.UTC(2027, 0, 15, 6)],
    [Date.UTC(2027, 11, 20), Date.UTC(2028, 0, 3)],
  ]) {
    const r = customSkyRange(a, b);
    console.log(
      `  request range for ${new Date(a).toISOString().slice(0, 16)} .. ${new Date(b).toISOString().slice(0, 16)}: ` +
        `${new Date(r.startMs).toISOString().slice(0, 16)} .. ${new Date(r.endMs).toISOString().slice(0, 16)}`,
    );
  }

  if (liveArg) await live(grid, rows);
  await simulated(grid, rows); // last: its Moon Trek outage pauses near-field requests for 2 minutes
}

// ---------- loadCustomSite with a simulated network ----------

async function simulated(grid: HeightGrid, rows: Row[]) {
  console.log("\n4. loadCustomSite() with a simulated network (Moon Trek down; route answers from public/data/sky)");
  const realFetch = globalThis.fetch;
  const hmJson = await readFile(path.join(ROOT, "public", "data", "terrain", "heightmap.json"));
  const hmBin = await readFile(path.join(ROOT, "public", "data", "terrain", "heightmap.bin"));
  const sky = rows.find((r) => r.id === "malapert")!.sky;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const two = (n: number) => String(n).padStart(2, "0");
  const fmt = (ms: number) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${MON[d.getUTCMonth()]}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  };
  type RouteMode = "ok" | "error" | "offline" | "garbled" | "misaligned";
  let route = "ok" as RouteMode;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "/data/terrain/heightmap.json") return new Response(hmJson);
    if (url === "/data/terrain/heightmap.bin") return new Response(hmBin);
    if (url.startsWith(NEAR_FIELD_SERVICE)) throw new TypeError("fetch failed");
    if (url.startsWith("/api/horizons")) {
      if (route === "offline") throw new TypeError("fetch failed");
      if (route === "error") {
        return Response.json({ error: "Horizons HTTP 503: <html>\n  Service Unavailable\n</html>" }, { status: 500 });
      }
      const q = new URL(url, "http://localhost").searchParams;
      const sun = q.get("target") === "sun";
      const start = Date.parse(`${q.get("start")}T00:00:00Z`) + (route === "misaligned" && !sun ? HOUR : 0);
      const stop = Date.parse(`${q.get("stop")}T00:00:00Z`);
      const points: { time: string; az: number; el: number | string }[] = [];
      for (let t = start; t <= stop; t += HOUR) {
        const i = (t - sky.startMs) / HOUR;
        points.push({ time: fmt(t), az: sun ? sky.sunAz[i] : sky.earthAz[i], el: sun ? sky.sunEl[i] : sky.earthEl[i] });
      }
      if (route === "garbled") points[3].el = "n.a.";
      return Response.json(points);
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const check = (label: string, ok: boolean, detail: string) => {
    console.log(`  ${ok ? "OK  " : "FAIL"} ${label}: ${detail}`);
    if (!ok) process.exitCode = 1;
  };
  const start = Date.UTC(2027, 4, 3, 7);
  const end = start + 10 * DAY;
  try {
    const lat = -86.1;
    const lon = 12.5;
    const got = await loadCustomSite(lat, lon, start, end);
    const range = customSkyRange(start, end);
    const i0 = (range.startMs - sky.startMs) / HOUR;
    const same = (["sunAz", "sunEl", "earthAz", "earthEl"] as const).every((k) =>
      got.sky[k].every((v, i) => v === sky[k][i0 + i]),
    );
    const ref = computeHorizon(grid, lat, lon).elevations;
    check(
      "Moon Trek down",
      got.horizon.siteId === "custom" &&
        (got.horizon as { nearFieldResolutionM?: number | null }).nearFieldResolutionM === null &&
        got.horizon.elevations.every((v, i) => v === ref[i]) &&
        same &&
        got.sky.startMs === range.startMs &&
        got.sky.count === (range.endMs - range.startMs) / HOUR + 1,
      `resolved with the 640 m grid alone (${got.sky.count} hourly points, tracks intact); note "${customHorizonMethod(got.horizon).slice(0, 60)}..."`,
    );

    const cases: [RouteMode, string, string][] = [
      ["error", "horizons", "route answers HTTP 500"],
      ["offline", "network", "route unreachable"],
      ["garbled", "data", "a row without a number"],
      ["misaligned", "data", "Earth track an hour late"],
    ];
    for (const [i, [mode, kind, label]] of cases.entries()) {
      route = mode;
      try {
        await loadCustomSite(-85 - i * 0.1, 40, start, end);
        check(label, false, "resolved (expected a rejection)");
      } catch (err) {
        const e = err as CustomSiteError;
        check(label, e instanceof CustomSiteError && e.kind === kind, `[${e.kind}] ${e.message}`);
      }
    }
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------- Network checks ----------

async function live(grid: HeightGrid, rows: Row[]) {
  console.log("\n3a. 640 m + 80 m near field from NASA Moon Trek (what custom sites use)");
  const diffs: Diff[] = [];
  const trekRows: Row[] = [];
  for (const r of rows) {
    const site = sites.find((s) => s.id === r.id)!;
    const t0 = performance.now();
    const near = await loadNearField(site.lat, site.lon);
    const ms = performance.now() - t0;
    const h = computeHorizon(grid, site.lat, site.lon, { siteId: site.id, nearField: near });
    const d = diffStats(h.elevations, r.published.elevations);
    diffs.push(d);
    trekRows.push({ ...r, variants: [{ name: "640+80 Trek", horizon: h }] });
    // Height agreement with the PGDA window, sampled at its pixel centres.
    let dh = "";
    if (r.pgda) {
      let sum = 0;
      let n = 0;
      for (let row = 4; row < 124; row++) {
        for (let col = 4; col < 124; col++) {
          const x = r.pgda.originX + (col + 0.5) * 80;
          const y = r.pgda.originY - (row + 0.5) * 80;
          sum += Math.abs(sampleHeight(near, x, y) - r.pgda.data[row * 128 + col]);
          n++;
        }
      }
      dh = `, heights vs PGDA window mean |dh| ${(sum / n).toFixed(1)} m`;
    }
    console.log(
      `  ${r.id.padEnd(15)} window ${ms.toFixed(0)} ms${dh}; horizon mean|d| ${deg(d.meanAbs)}, max ${deg(d.max)} at az ${d.maxAt * 0.5}, bias ${signed(d.bias)}`,
    );
  }
  summary("640+80 Trek", diffs);
  statsTable(trekRows, ["640+80 Trek"]);
  rankingAgreement(trekRows, "640+80 Trek");

  console.log(`\n3b. loadCustomSite() against ${liveBase}`);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    realFetch(typeof input === "string" && input.startsWith("/") ? liveBase + input : input, init);

  const site = sites.find((s) => s.id === "malapert")!;
  const r = rows.find((x) => x.id === site.id)!;
  const start = Date.UTC(2027, 0, 10, 5);
  const end = start + 14 * DAY;
  const t0 = performance.now();
  const got = await loadCustomSite(site.lat, site.lon, start, end);
  const ms = performance.now() - t0;
  const i0 = (got.sky.startMs - r.sky.startMs) / HOUR;
  let maxDiff = 0;
  for (const key of ["sunAz", "sunEl", "earthAz", "earthEl"] as const) {
    for (let i = 0; i < got.sky.count; i++) maxDiff = Math.max(maxDiff, Math.abs(got.sky[key][i] - r.sky[key][i0 + i]));
  }
  console.log(
    `  ${site.id} centre, 14 days from 10 Jan 05:00: ${got.sky.count} hourly points from ${new Date(got.sky.startMs).toISOString()} ` +
      `in ${ms.toFixed(0)} ms; tracks vs public/data/sky max |d| ${maxDiff}° ${maxDiff === 0 ? "OK" : "MISMATCH"}`,
  );
  if (maxDiff !== 0) process.exitCode = 1;
  const d = diffStats(got.horizon.elevations, r.published.elevations);
  const a = windowStats({ sky: r.sky, horizon: r.published }, start, end);
  const b = windowStats(got, start, end);
  console.log(
    `  horizon vs published: mean|d| ${deg(d.meanAbs)}; window Sun up ${pct(a.sunlit)} (published) vs ${pct(b.sunlit)} (custom), ` +
      `Earth ${pct(a.earthVisible)} vs ${pct(b.earthVisible)}`,
  );
  console.log(`  method note: ${customHorizonMethod(got.horizon)}`);

  const t1 = performance.now();
  await loadCustomSite(site.lat, site.lon, start + DAY, end - DAY);
  console.log(`  repeat inside the loaded span: ${(performance.now() - t1).toFixed(1)} ms (from memory)`);

  const coarse = await loadCustomSite(site.lat, site.lon, start, end, { nearField: false });
  console.log(`  nearField: false -> ${coarse.horizon.gridResolutionM} m only; note: ${customHorizonMethod(coarse.horizon)}`);

  for (const [label, lat, lon, s, e] of [
    ["79° S", -79, 0, start, end],
    ["end before start", -85, 0, end, start],
    ["500-day window", -85, 0, start, start + 500 * DAY],
  ] as const) {
    try {
      await loadCustomSite(lat, lon, s, e);
      console.log(`  ${label}: resolved (unexpected)`);
      process.exitCode = 1;
    } catch (err) {
      const e2 = err as CustomSiteError;
      console.log(`  ${label}: rejected [${e2.kind}] ${e2.message}`);
    }
  }

  if (liveCustom) {
    const t2 = performance.now();
    const c = await loadCustomSite(-85.5, 12.25, Date.UTC(2027, 2, 1, 12), Date.UTC(2027, 2, 2, 12));
    const s = windowStats(c, Date.UTC(2027, 2, 1, 12), Date.UTC(2027, 2, 2, 12));
    console.log(
      `  custom point 85.5° S 12.25° E: ${c.sky.count} points, site height ${c.horizon.siteHeight} m, ` +
        `Sun up ${pct(s.sunlit)}, Earth ${pct(s.earthVisible)}, ${(performance.now() - t2).toFixed(0)} ms`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});

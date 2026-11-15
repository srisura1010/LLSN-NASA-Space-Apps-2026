// Turn the LOLA south pole DEM into small files the app can use:
//   public/data/terrain/heightmap.bin + .json   (3D view)
//   public/data/horizon/<siteId>.json           (terrain horizon per site)
//
// The 189 MB source is a cloud-optimized GeoTIFF, so it's read remotely with
// HTTP range requests; only the overview levels and small windows we need
// are fetched. They're cached in data/raw/ (gitignored), so reruns make no
// network requests except for the metadata.
//
// Usage: npm run process-dem

import { fromUrl, type GeoTIFFImage } from "geotiff";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sites } from "../src/lib/sites";
import {
  MOON_RADIUS_M,
  destination,
  latLonToXY,
  localNorthEast,
  sampleHeight,
  xyToLatLon,
  type HeightGrid,
  type HorizonProfile,
} from "../src/lib/terrain";

// From https://pgda.gsfc.nasa.gov/products/90
const DEM_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF";

const RAW_DIR = path.join(process.cwd(), "data", "raw");
const TERRAIN_DIR = path.join(process.cwd(), "public", "data", "terrain");
const HORIZON_DIR = path.join(process.cwd(), "public", "data", "horizon");

const HEIGHTMAP_MAX_SIZE = 1024; // px per side
const WORKING_RES_M = [160, 320]; // horizon grid: coarsest overview in this range
const FINE_RADIUS_PX = 64; // full-res window around each site (~5 km at 80 m)
const MAST_M = 2; // lander antenna / solar panel height above ground
const AZ_STEP_DEG = 0.5;
const FLAG_ELEVATION_DEG = 10;
const REMOTE_TIMEOUT_MS = 10 * 60_000;

const DEG = Math.PI / 180;

// ---------- Polite fetch + transfer accounting ----------
//
// The PGDA server intermittently answers 403 to bursts of parallel range
// requests, so all requests go one at a time with a short gap, and
// 403/429/5xx are retried with backoff.

const MIN_GAP_MS = 150;
const RETRIES = 5;

let bytesTransferred = 0;
let requestCount = 0;
let retryCount = 0;
const realFetch = globalThis.fetch;
let queue: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function politeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await sleep(MIN_GAP_MS);
    const res = await realFetch(input, init);
    requestCount++;
    const retryable = res.status === 403 || res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= RETRIES) {
      bytesTransferred += Number(res.headers.get("content-length") ?? 0);
      return res;
    }
    await res.arrayBuffer().catch(() => {});
    retryCount++;
    const wait = 1000 * 2 ** attempt;
    console.log(`  (server answered ${res.status}, retrying in ${wait / 1000}s)`);
    await sleep(wait);
  }
}

globalThis.fetch = (input, init) => {
  const run = queue.then(() => politeFetch(input, init));
  queue = run.catch(() => {});
  return run;
};
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;

// ---------- Remote access ----------

async function checkRangeSupport() {
  const res = await fetch(DEM_URL, { headers: { Range: "bytes=0-0" } });
  await res.arrayBuffer();
  const total = res.headers.get("content-range")?.split("/")[1];
  if (res.status !== 206) {
    throw new Error(
      `Server answered ${res.status} to a range request; refusing to download the whole file.`,
    );
  }
  console.log(`Range requests OK (206). Remote file size: ${mb(Number(total))}`);
}

type Level = { index: number; image: GeoTIFFImage; pixelSize: number; width: number; height: number };

type GridMeta = Omit<HeightGrid, "data">;

/** Read a window (or a whole level) from the remote file, cached in data/raw/. */
async function readGrid(
  level: Level,
  originX0: number,
  originY0: number,
  window: [number, number, number, number], // [col0, row0, col1, row1), in this level's pixels
): Promise<HeightGrid> {
  const [c0, r0, c1, r1] = window;
  const meta: GridMeta = {
    width: c1 - c0,
    height: r1 - r0,
    originX: originX0 + c0 * level.pixelSize,
    originY: originY0 - r0 * level.pixelSize,
    pixelSize: level.pixelSize,
  };
  const whole = c0 === 0 && r0 === 0 && c1 === level.width && r1 === level.height;
  const name = whole
    ? `ldem80s_${level.pixelSize}m`
    : `ldem80s_${level.pixelSize}m_c${c0}_r${r0}_${meta.width}x${meta.height}`;
  const binPath = path.join(RAW_DIR, `${name}.bin`);

  try {
    const buf = await readFile(binPath);
    const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    console.log(`  ${name}: from data/raw cache`);
    return { ...meta, data: data.slice() };
  } catch {
    // not cached yet
  }

  const before = bytesTransferred;
  const t0 = Date.now();
  const raster = await level.image.readRasters({
    window,
    samples: [0],
    interleave: true,
    signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
  });
  const data = Float32Array.from(raster as ArrayLike<number>);
  console.log(
    `  ${name}: fetched ${mb(bytesTransferred - before)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(binPath, Buffer.from(data.buffer));
  await writeFile(path.join(RAW_DIR, `${name}.json`), JSON.stringify(meta, null, 2));
  return { ...meta, data };
}

// ---------- Geometry helpers ----------

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

function stats(values: ArrayLike<number>) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  let nan = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) {
      nan++;
      continue;
    }
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n++;
  }
  return { min, max, mean: sum / n, nan };
}

// Replace NaNs with the mean of their valid neighbors, repeating until none are left.
function fillNoData(grid: HeightGrid): number {
  const { width: w, height: h, data } = grid;
  let filledTotal = 0;
  for (;;) {
    const fills: [number, number][] = [];
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const i = r * w + c;
        if (!Number.isNaN(data[i])) continue;
        let sum = 0;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
            const v = data[rr * w + cc];
            if (!Number.isNaN(v)) {
              sum += v;
              n++;
            }
          }
        }
        if (n) fills.push([i, sum / n]);
      }
    }
    if (!fills.length) return filledTotal;
    for (const [i, v] of fills) data[i] = v;
    filledTotal += fills.length;
  }
}

// ---------- Checks ----------

// Orientation check: known craters should be deep pits relative to their
// surroundings. Compare our projection against mirrored alternatives.
function checkOrientation(grid: HeightGrid) {
  const craters = [
    { name: "Shackleton", lat: -89.67, lon: 129.78, diamKm: 21 },
    { name: "de Gerlache", lat: -88.5, lon: -87.1, diamKm: 32.6 },
    { name: "Faustini", lat: -87.3, lon: 77.0, diamKm: 39 },
  ];
  const variants = [
    { label: "x=r·sin, y=r·cos (ours)", sx: 1, sy: 1 },
    { label: "y flipped", sx: 1, sy: -1 },
    { label: "x flipped", sx: -1, sy: 1 },
    { label: "both flipped", sx: -1, sy: -1 },
  ];
  console.log("\nOrientation check: crater center height minus mean rim height (m), more negative = pit");
  console.log(`  ${"".padEnd(26)}${craters.map((c) => c.name.padStart(13)).join("")}`);
  let oursOk = true;
  for (const v of variants) {
    const depths = craters.map((c) => {
      const p = latLonToXY(c.lat, c.lon);
      const center = sampleHeight(grid, v.sx * p.x, v.sy * p.y);
      const ring: number[] = [];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * 2 * Math.PI;
        const rM = c.diamKm * 500; // one radius from center = the rim
        ring.push(sampleHeight(grid, v.sx * p.x + rM * Math.cos(a), v.sy * p.y + rM * Math.sin(a)));
      }
      return center - stats(ring).mean;
    });
    if (v.sx === 1 && v.sy === 1) oursOk = depths.every((d) => d < -1000);
    console.log(`  ${v.label.padEnd(26)}${depths.map((d) => d.toFixed(0).padStart(13)).join("")}`);
  }
  if (!oursOk) {
    throw new Error("Projection orientation check failed: known craters are not pits.");
  }
  console.log("  OK: all three craters are deep pits with our orientation.");
}

// Azimuth check: a short great-circle step at azimuth A must point along
// cos(A)·north + sin(A)·east in projected x/y at the site's longitude.
function checkAzimuthDirections(lat: number, lon: number): number {
  const { north, east } = localNorthEast(lon);
  const p0 = latLonToXY(lat, lon);
  let maxErr = 0;
  for (let az = 0; az < 360; az += 45) {
    const q = destination(lat, lon, az, 50);
    const p1 = latLonToXY(q.lat, q.lon);
    const got = Math.atan2(p1.x - p0.x, p1.y - p0.y);
    const a = az * DEG;
    const want = Math.atan2(
      Math.cos(a) * north.x + Math.sin(a) * east.x,
      Math.cos(a) * north.y + Math.sin(a) * east.y,
    );
    const err = Math.abs(((got - want + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) / DEG;
    maxErr = Math.max(maxErr, err);
  }
  return maxErr;
}

// ---------- Horizon ----------

function computeHorizon(
  lat: number,
  lon: number,
  observerHeight: number,
  fine: HeightGrid,
  coarse: HeightGrid,
): number[] {
  const up = unitVector(lat, lon);
  const rObs = MOON_RADIUS_M + observerHeight;
  const P: Vec3 = [up[0] * rObs, up[1] * rObs, up[2] * rObs];
  const fineReach = (FINE_RADIUS_PX - 2) * fine.pixelSize;
  const elevations: number[] = [];

  for (let i = 0; i < 360 / AZ_STEP_DEG; i++) {
    const az = i * AZ_STEP_DEG;
    let maxEl = -90;
    // Start one full-res pixel out: closer than that, bilinear interpolation
    // just measures the local slope of the site's own pixel, which the DEM
    // can't resolve (it produced spurious 13°+ horizons on sloped sites).
    let s = fine.pixelSize;
    for (;;) {
      const q = destination(lat, lon, az, s);
      const { x, y } = latLonToXY(q.lat, q.lon);
      const useFine = s < fineReach && inBounds(fine, x, y);
      const grid = useFine ? fine : coarse;
      if (!useFine && !inBounds(coarse, x, y)) break; // reached the edge of the data
      s += grid.pixelSize / 2;

      const h = sampleHeight(grid, x, y);
      if (Number.isNaN(h)) continue;

      // Exact elevation angle with 3D vectors (includes lunar curvature).
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

// ---------- Main ----------

async function main() {
  await checkRangeSupport();

  const tiff = await fromUrl(DEM_URL);
  const img0 = await tiff.getImage(0);
  const count = await tiff.getImageCount();
  const levels: Level[] = [];
  for (let i = 0; i < count; i++) {
    const image = await tiff.getImage(i);
    const [rx, ry] = image.getResolution(img0);
    if (Math.abs(rx) !== Math.abs(ry)) throw new Error(`Non-square pixels at level ${i}`);
    levels.push({ index: i, image, pixelSize: Math.abs(rx), width: image.getWidth(), height: image.getHeight() });
  }

  // Geo metadata (read, not hardcoded).
  const [originX, originY] = img0.getOrigin();
  const [resX, resY] = img0.getResolution();
  const geo = img0.getGeoKeys() ?? {};
  console.log("\nGeo metadata:");
  console.log(`  origin (top-left corner): ${originX}, ${originY} m`);
  console.log(`  pixel size: ${resX}, ${resY} m`);
  console.log(`  bbox: ${img0.getBoundingBox().join(", ")}`);
  console.log(`  citation: ${geo.GTCitationGeoKey}`);
  console.log(
    `  projection: CoordTrans=${geo.ProjCoordTransGeoKey} (15 = polar stereographic), ` +
      `origin lat=${geo.ProjNatOriginLatGeoKey}, straight-vertical-pole lon=${geo.ProjStraightVertPoleLongGeoKey}, ` +
      `scale=${geo.ProjScaleAtNatOriginGeoKey}`,
  );
  console.log(`  sphere radius: ${geo.GeogSemiMajorAxisGeoKey} / ${geo.GeogSemiMinorAxisGeoKey} m`);
  console.log(`  nodata: ${img0.getGDALNoData()}, sample format ${img0.getSampleFormat()} (3 = float), ${img0.getBitsPerSample()} bit`);
  console.log("\nLevels:");
  for (const l of levels) {
    console.log(`  #${l.index}: ${l.width}x${l.height} @ ${l.pixelSize} m${l.index === 0 ? " (full res)" : " (overview)"}`);
  }

  // Sanity: our projection constants must match the file.
  if (
    geo.ProjCoordTransGeoKey !== 15 ||
    geo.ProjNatOriginLatGeoKey !== -90 ||
    (geo.ProjStraightVertPoleLongGeoKey ?? 0) !== 0 ||
    geo.GeogSemiMajorAxisGeoKey !== MOON_RADIUS_M ||
    geo.ProjScaleAtNatOriginGeoKey !== 1
  ) {
    throw new Error("DEM projection differs from what src/lib/terrain.ts assumes.");
  }
  const poleCol = (0 - originX) / resX;
  const poleRow = (0 - originY) / resY;
  console.log(`\nPole (lat -90) -> x,y = 0,0 -> pixel ${poleCol}, ${poleRow} of ${img0.getWidth()}x${img0.getHeight()} (center)`);
  const edge = latLonToXY(-80, 90);
  const back = xyToLatLon(edge.x, edge.y);
  console.log(`80°S, 90°E -> x=${edge.x.toFixed(0)} y=${edge.y.toFixed(0)} m (grid half-width ${originY}) -> back ${back.lat.toFixed(6)}, ${back.lon.toFixed(6)}`);

  // 1. Heightmap for the 3D view: largest overview that fits.
  console.log("\nHeightmap:");
  const hmLevel = levels.filter((l) => l.width <= HEIGHTMAP_MAX_SIZE && l.height <= HEIGHTMAP_MAX_SIZE)[0];
  const hm = await readGrid(hmLevel, originX, originY, [0, 0, hmLevel.width, hmLevel.height]);
  const hmNaN = fillNoData(hm);
  const hmStats = stats(hm.data);
  await mkdir(TERRAIN_DIR, { recursive: true });
  await writeFile(path.join(TERRAIN_DIR, "heightmap.bin"), Buffer.from(hm.data.buffer));
  await writeFile(
    path.join(TERRAIN_DIR, "heightmap.json"),
    JSON.stringify(
      {
        source: DEM_URL,
        format: "float32 little-endian, row-major; row 0 = +y edge (lon 0 side), col 0 = -x edge",
        width: hm.width,
        height: hm.height,
        pixelSize: hm.pixelSize,
        extent: {
          minX: hm.originX,
          maxX: hm.originX + hm.width * hm.pixelSize,
          minY: hm.originY - hm.height * hm.pixelSize,
          maxY: hm.originY,
        },
        minHeight: Number(hmStats.min.toFixed(1)),
        maxHeight: Number(hmStats.max.toFixed(1)),
        heightUnits: "meters above 1737.4 km sphere",
        projection: "south polar stereographic, sphere R=1737400 m, scale true at pole",
      },
      null,
      2,
    ),
  );
  console.log(
    `  wrote heightmap.bin ${hm.width}x${hm.height} @ ${hm.pixelSize} m (${mb(hm.data.byteLength)}), ` +
      `heights ${hmStats.min.toFixed(0)}..${hmStats.max.toFixed(0)} m, filled ${hmNaN} nodata px`,
  );

  // 2. Working grid for horizons.
  console.log("\nHorizon working grid:");
  const inRange = levels.filter((l) => l.pixelSize >= WORKING_RES_M[0] && l.pixelSize <= WORKING_RES_M[1]);
  const mid = (WORKING_RES_M[0] + WORKING_RES_M[1]) / 2;
  const workLevel =
    inRange.length > 0
      ? inRange[inRange.length - 1] // coarsest in range = least data
      : [...levels].sort((a, b) => Math.abs(a.pixelSize - mid) - Math.abs(b.pixelSize - mid))[0];
  const coarse = await readGrid(workLevel, originX, originY, [0, 0, workLevel.width, workLevel.height]);
  const coarseStats = stats(coarse.data);
  console.log(`  ${coarse.width}x${coarse.height} @ ${coarse.pixelSize} m, ${coarseStats.nan} nodata px`);

  checkOrientation(coarse);

  // 3. Horizon profile per site.
  console.log("\nSites:");
  await mkdir(HORIZON_DIR, { recursive: true });
  const full = levels[0];
  for (const site of sites) {
    const { x, y } = latLonToXY(site.lat, site.lon);
    const col = Math.floor((x - originX) / full.pixelSize);
    const row = Math.floor((originY - y) / full.pixelSize);
    const window: [number, number, number, number] = [
      Math.max(0, col - FINE_RADIUS_PX),
      Math.max(0, row - FINE_RADIUS_PX),
      Math.min(full.width, col + FINE_RADIUS_PX),
      Math.min(full.height, row + FINE_RADIUS_PX),
    ];
    console.log(`- ${site.id} (${site.lat}, ${site.lon}) -> x=${x.toFixed(0)} y=${y.toFixed(0)} m`);
    const fine = await readGrid(full, originX, originY, window);
    const siteHeight = sampleHeight(fine, x, y);
    if (Number.isNaN(siteHeight)) throw new Error(`No DEM height at site ${site.id}`);

    const azErr = checkAzimuthDirections(site.lat, site.lon);
    if (azErr > 0.1) throw new Error(`Azimuth direction mismatch at ${site.id}: ${azErr}°`);

    const t0 = Date.now();
    const elevations = computeHorizon(site.lat, site.lon, siteHeight + MAST_M, fine, coarse);
    const profile: HorizonProfile = {
      siteId: site.id,
      lat: site.lat,
      lon: site.lon,
      siteHeight: Number(siteHeight.toFixed(1)),
      stepDeg: AZ_STEP_DEG,
      gridResolutionM: coarse.pixelSize,
      elevations,
    };
    await writeFile(path.join(HORIZON_DIR, `${site.id}.json`), JSON.stringify(profile));

    const s = stats(elevations);
    const maxAz = elevations.indexOf(s.max) * AZ_STEP_DEG;
    const p = fine.pixelSize;
    const slope =
      Math.atan(
        Math.hypot(
          (sampleHeight(fine, x + p, y) - sampleHeight(fine, x - p, y)) / (2 * p),
          (sampleHeight(fine, x, y + p) - sampleHeight(fine, x, y - p)) / (2 * p),
        ),
      ) / DEG;
    console.log(
      `  site height ${siteHeight.toFixed(1)} m (80 m data, +${MAST_M} m mast), local slope ${slope.toFixed(1)}°, ` +
        `azimuth check err ${azErr.toExponential(1)}°`,
    );
    console.log(
      `  horizon min ${s.min.toFixed(2)}°, max ${s.max.toFixed(2)}° (az ${maxAz}°), mean ${s.mean.toFixed(2)}°  [${Date.now() - t0} ms]`,
    );
    if (s.max > FLAG_ELEVATION_DEG) {
      console.log(`  ⚠ FLAG: horizon above ${FLAG_ELEVATION_DEG}° at az ${maxAz}°, check this (massif or bug?)`);
    }
  }

  console.log(
    `\nTotal transferred from remote file: ${mb(bytesTransferred)} in ${requestCount} requests (${retryCount} retried)`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  console.log(`Transferred before failure: ${mb(bytesTransferred)} in ${requestCount} requests`);
  process.exit(1);
});

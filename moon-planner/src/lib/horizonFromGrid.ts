// Terrain horizon for any point on the LOLA south pole heightmap, computed in
// the browser from public/data/terrain/heightmap.bin (640 m pixels).
//
// Same method as scripts/process-dem.ts: march outward along each azimuth,
// take the exact elevation angle of every sample on the 1737.4 km sphere
// (3D vectors, so lunar curvature is included), observer at site height plus
// a 2 m mast, start one pixel out, stop at the grid edge.
//
// process-dem resolves the first 5 km around each site with 80 m pixels; on
// the 640 m grid alone that relief is smoothed away and horizons at slopes
// and summits come out 1-3° low (scripts/check-custom-site.ts measures it).
// computeHorizon therefore takes an optional 80 m near-field window, used
// exactly as process-dem uses its fine grid; loadNearField fetches one for any
// point from NASA Moon Trek (LRO LOLA 30 m south pole DEM, served with CORS).
//
// The march is written without per-sample trigonometry: a point s metres
// along the great circle at azimuth A is cos(s/R)·up + sin(s/R)·dir(A), its
// stereographic x/y follow from that unit vector directly, and the elevation
// angle comes from the law of cosines. Mathematically identical to
// destination() + latLonToXY() + 3D vectors; the check script compares the two.
//
// Client-safe: no Node-only imports.

import { MOON_RADIUS_M, latLonToXY, sampleHeight, type HeightGrid, type HorizonProfile } from "./terrain";

export const HEIGHTMAP_BIN_URL = "/data/terrain/heightmap.bin";
export const HEIGHTMAP_META_URL = "/data/terrain/heightmap.json";

/** Lander antenna / solar panel height above the ground (as in process-dem). */
export const MAST_M = 2;
/** Azimuth step of the profile, matching public/data/horizon/*.json. */
export const AZ_STEP_DEG = 0.5;

const DEG = Math.PI / 180;
const R = MOON_RADIUS_M;
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function float32LE(buffer: ArrayBuffer, count: number): Float32Array {
  if (LITTLE_ENDIAN) return new Float32Array(buffer, 0, count);
  const view = new DataView(buffer);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

// ---------- The 640 m heightmap ----------

/** Fields of public/data/terrain/heightmap.json used here. */
export type HeightmapMeta = {
  width: number;
  height: number;
  pixelSize: number;
  extent: { minX: number; maxX: number; minY: number; maxY: number };
};

/** Wrap heightmap.bin (float32 little-endian, row 0 = +y edge) as a HeightGrid. */
export function heightGridFromBuffer(meta: HeightmapMeta, buffer: ArrayBuffer): HeightGrid {
  const { width, height, pixelSize, extent } = meta;
  const expected = width * height * 4;
  if (buffer.byteLength !== expected) {
    throw new Error(`heightmap.bin is ${buffer.byteLength} bytes; heightmap.json describes ${expected}.`);
  }
  if (Math.abs((extent.maxX - extent.minX) / width - pixelSize) > 1e-6) {
    throw new Error("heightmap.json extent and pixel size disagree.");
  }
  const data = float32LE(buffer, width * height);
  return { width, height, originX: extent.minX, originY: extent.maxY, pixelSize, data };
}

let gridPromise: Promise<HeightGrid> | null = null;

/**
 * The 950 x 950 LOLA heightmap, fetched once and shared (3.6 MB). Treat the
 * returned grid as read-only. A failed load is not cached, so callers can retry.
 */
export function loadHeightGrid(): Promise<HeightGrid> {
  if (!gridPromise) {
    gridPromise = (async () => {
      let metaRes: Response;
      let binRes: Response;
      try {
        [metaRes, binRes] = await Promise.all([fetch(HEIGHTMAP_META_URL), fetch(HEIGHTMAP_BIN_URL)]);
      } catch {
        throw new Error("Could not download the LOLA terrain grid. Check your connection, then try again.");
      }
      if (!metaRes.ok || !binRes.ok) {
        const [url, res] = !metaRes.ok ? [HEIGHTMAP_META_URL, metaRes] : [HEIGHTMAP_BIN_URL, binRes];
        throw new Error(
          `Could not load the LOLA terrain grid (${url} answered HTTP ${res.status}). Reload the page to try again.`,
        );
      }
      const meta = (await metaRes.json()) as HeightmapMeta;
      return heightGridFromBuffer(meta, await binRes.arrayBuffer());
    })();
    gridPromise.catch(() => {
      gridPromise = null;
    });
  }
  return gridPromise;
}

// ---------- 80 m near field from Moon Trek ----------

/** NASA Moon Trek image service for LRO_LOLA_DEM_SPole75_30mp_v04 (float32, metres above 1737.4 km, CORS *). */
export const NEAR_FIELD_SERVICE =
  "https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_SPole75_30mp_v04/ImageServer/exportImage";
/** Near-field pixel size and half-width, as process-dem (LDEM_80S_80MPP, 64 px = 5.1 km). */
export const NEAR_FIELD_PX_M = 80;
export const NEAR_FIELD_RADIUS_PX = 64;
// The 80 m lattice of LDEM_80S_80MPP: pixel edges at -304000 + 80k metres.
const LATTICE_ORIGIN_M = 304_000;
// Moon Trek exports sit about 15 m (half a 30 m source pixel) toward -x and
// +y of the PGDA LDEM_80S_80MPP heights the named regions use: the best-fit
// offset was 12-20 m on both axes at all nine region centres. Shifting the
// window origin by it keeps custom and named sites on one registration
// (mean height difference 1-4 m; scripts/check-custom-site.ts --live).
const MOON_TREK_SHIFT_M = 15;

/**
 * A 128 x 128 window of 80 m LOLA heights centred on (lat, lon), fetched
 * from NASA Moon Trek (about 66 KB). Pass it to computeHorizon as nearField.
 */
export async function loadNearField(lat: number, lon: number, signal?: AbortSignal): Promise<HeightGrid> {
  const { x, y } = latLonToXY(lat, lon);
  const px = NEAR_FIELD_PX_M;
  const size = 2 * NEAR_FIELD_RADIUS_PX;
  const col = Math.floor((x + LATTICE_ORIGIN_M) / px);
  const row = Math.floor((LATTICE_ORIGIN_M - y) / px);
  const left = -LATTICE_ORIGIN_M + (col - NEAR_FIELD_RADIUS_PX) * px;
  const top = LATTICE_ORIGIN_M - (row - NEAR_FIELD_RADIUS_PX) * px;
  const query = [
    `bbox=${left},${top - size * px},${left + size * px},${top}`,
    `size=${size},${size}`,
    "format=bsq",
    "pixelType=F32",
    "interpolation=RSP_BilinearInterpolation",
    "f=image",
  ].join("&");

  const res = await fetch(`${NEAR_FIELD_SERVICE}?${query}`, { signal });
  if (!res.ok) throw new Error(`Moon Trek answered HTTP ${res.status} for the near-field terrain.`);
  const buffer = await res.arrayBuffer();
  // The service pads the raster with a few rows of NaN; the image is the first size x size values.
  if (buffer.byteLength < size * size * 4) throw new Error("Moon Trek returned a short near-field raster.");
  const data = float32LE(buffer, size * size);
  let valid = 0;
  for (let i = 0; i < data.length; i++) if (data[i] > -20_000 && data[i] < 20_000) valid++;
  if (valid < data.length * 0.99) throw new Error("Moon Trek returned near-field terrain with gaps.");
  return {
    width: size,
    height: size,
    originX: left - MOON_TREK_SHIFT_M,
    originY: top + MOON_TREK_SHIFT_M,
    pixelSize: px,
    data,
  };
}

// ---------- Horizon ----------

/** A HorizonProfile plus what the terrain data covered. */
export type GridHorizonProfile = HorizonProfile & {
  /** Pixel size (m) of the near-field window used within ~5 km of the site, or null if none. */
  nearFieldResolutionM: number | null;
  /**
   * Distance (km) from the site to the last terrain sample along each
   * azimuth, i.e. to the grid edge. Terrain beyond it (north of about 80° S)
   * is not in the horizon. Same indexing as `elevations`.
   */
  reachKm: number[];
};

export type HorizonOptions = {
  /** Default "custom". */
  siteId?: string;
  /** Observer height above the ground, metres. Default MAST_M (2 m). */
  mastM?: number;
  /** Azimuth step, degrees. Default AZ_STEP_DEG (0.5). */
  stepDeg?: number;
  /**
   * Finer heights around the site (e.g. from loadNearField), used out to two
   * pixels inside the window edge, then the main grid takes over; the site
   * height also comes from it. Ignored if the site is not inside it.
   */
  nearField?: HeightGrid;
};

// Precomputed distances along the path and the trigonometry of each.
type StepTable = { dist: Float64Array; cos: Float64Array; sin: Float64Array; versin: Float64Array };
const stepTables = new Map<string, StepTable>();

function stepTable(first: number, step: number, count: number): StepTable {
  const key = `${first}|${step}|${count}`;
  let t = stepTables.get(key);
  if (!t) {
    t = {
      dist: new Float64Array(count),
      cos: new Float64Array(count),
      sin: new Float64Array(count),
      versin: new Float64Array(count),
    };
    for (let k = 0; k < count; k++) {
      const s = first + k * step;
      const theta = s / R;
      const half = Math.sin(theta / 2);
      t.dist[k] = s;
      t.cos[k] = Math.cos(theta);
      t.sin[k] = Math.sin(theta);
      t.versin[k] = 2 * half * half; // 1 - cos(theta), without cancellation
    }
    stepTables.set(key, t);
  }
  return t;
}

type MarchState = { best: number; reach: number };

/**
 * March one azimuth over one grid along the distances in `table`, raising
 * state.best (max sine of elevation). Returns false where the path leaves
 * the grid. Direction: unit tangent (dirX, dirY, dirZ) at the site.
 */
function marchSegment(
  grid: HeightGrid,
  table: StepTable,
  upX: number,
  upY: number,
  upZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  hObs: number,
  rObs: number,
  state: MarchState,
): boolean {
  const { dist, cos, sin, versin } = table;
  const { width: w, height: h, data, originX, originY, pixelSize } = grid;
  const colMax = w - 1;
  const rowMax = h - 1;
  const twoR = 2 * R;
  for (let k = 0; k < dist.length; k++) {
    // Unit vector of the sample point, then its stereographic x/y:
    // x = 2R·uy / (1 - uz), y = 2R·ux / (1 - uz) (same as latLonToXY).
    const c = cos[k];
    const s = sin[k];
    const ux = c * upX + s * dirX;
    const uy = c * upY + s * dirY;
    const uz = c * upZ + s * dirZ;
    const f = twoR / (1 - uz);
    const col = (uy * f - originX) / pixelSize - 0.5;
    const row = (originY - ux * f) / pixelSize - 0.5;
    if (col < 0 || row < 0 || col > colMax || row > rowMax) return false;

    // Bilinear sample at pixel centres (same arithmetic as sampleHeight).
    const c0 = Math.min(Math.floor(col), w - 2);
    const r0 = Math.min(Math.floor(row), h - 2);
    const fc = col - c0;
    const fr = row - r0;
    const j = r0 * w + c0;
    const height =
      data[j] * (1 - fc) * (1 - fr) +
      data[j + 1] * fc * (1 - fr) +
      data[j + w] * (1 - fc) * fr +
      data[j + w + 1] * fc * fr;
    state.reach = dist[k];
    if (Number.isNaN(height)) continue;

    // Exact elevation angle: for target radius A = R + height at central
    // angle theta, with dh = height - hObs,
    //   (target - observer) · up = dh - A(1 - cos theta)
    //   |target - observer|^2   = dh^2 + 2·A·rObs(1 - cos theta)
    const a = R + height;
    const dh = height - hObs;
    const v = versin[k];
    const sinEl = (dh - a * v) / Math.sqrt(dh * dh + 2 * a * rObs * v);
    if (sinEl > state.best) state.best = sinEl;
  }
  return true;
}

/**
 * Terrain horizon at (lat, lon), in the shape of public/data/horizon/<id>.json
 * (elevations in degrees above the local horizontal plane, azimuth clockwise
 * from local north). Synchronous, about 10-20 ms for 720 azimuths.
 *
 * Throws if the point is not on the grid.
 */
export function computeHorizon(
  grid: HeightGrid,
  lat: number,
  lon: number,
  options: HorizonOptions = {},
): GridHorizonProfile {
  const stepDeg = options.stepDeg ?? AZ_STEP_DEG;
  const mast = options.mastM ?? MAST_M;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Latitude and longitude must be numbers.");

  const site = latLonToXY(lat, lon);
  const coarseHeight = sampleHeight(grid, site.x, site.y);
  if (Number.isNaN(coarseHeight)) {
    throw new Error(`${lat.toFixed(3)}, ${lon.toFixed(3)} is outside the LOLA terrain grid (80° S to the pole).`);
  }
  const nearHeight = options.nearField ? sampleHeight(options.nearField, site.x, site.y) : NaN;
  const near = Number.isNaN(nearHeight) ? null : options.nearField!;
  const siteHeight = near ? nearHeight : coarseHeight;
  const hObs = siteHeight + mast;
  const rObs = R + hObs;

  // Distances, as process-dem: one pixel out, half-pixel steps; with a near
  // field, its pixels until two pixels short of its nearest edge, then the
  // main grid's from there on.
  let nearTable: StepTable | null = null;
  let farStart = grid.pixelSize;
  if (near) {
    const reach = (Math.min(near.width, near.height) / 2 - 2) * near.pixelSize;
    const step = near.pixelSize / 2;
    const count = Math.ceil((reach - near.pixelSize) / step);
    nearTable = stepTable(near.pixelSize, step, count);
    farStart = near.pixelSize + count * step;
  }
  // The grid diagonal bounds every path that stays on it (stereographic scale
  // is >= 1, so projected lengths overestimate surface lengths).
  const farStep = grid.pixelSize / 2;
  const maxDist = Math.hypot(grid.width, grid.height) * grid.pixelSize;
  const farTable = stepTable(farStart, farStep, Math.ceil((maxDist - farStart) / farStep) + 1);

  // Site frame in Moon-centred coordinates (z toward the north pole).
  const p = lat * DEG;
  const l = lon * DEG;
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  const cl = Math.cos(l);
  const sl = Math.sin(l);
  const upX = cp * cl;
  const upY = cp * sl;
  const upZ = sp;
  const northX = -sp * cl;
  const northY = -sp * sl;
  const northZ = cp;
  const eastX = -sl;
  const eastY = cl;

  const count = Math.round(360 / stepDeg);
  const elevations = new Array<number>(count);
  const reachKm = new Array<number>(count);
  const state: MarchState = { best: -2, reach: 0 }; // best = max sin(elevation); -2 = no sample

  for (let i = 0; i < count; i++) {
    const az = i * stepDeg * DEG;
    const ca = Math.cos(az);
    const sa = Math.sin(az);
    const dirX = ca * northX + sa * eastX;
    const dirY = ca * northY + sa * eastY;
    const dirZ = ca * northZ;
    state.best = -2;
    state.reach = 0;
    if (near) marchSegment(near, nearTable!, upX, upY, upZ, dirX, dirY, dirZ, hObs, rObs, state);
    marchSegment(grid, farTable, upX, upY, upZ, dirX, dirY, dirZ, hObs, rObs, state);
    elevations[i] = state.best > -2 ? Math.round((Math.asin(state.best) / DEG) * 1000) / 1000 : -90;
    reachKm[i] = Math.round(state.reach / 100) / 10;
  }

  return {
    siteId: options.siteId ?? "custom",
    lat,
    lon,
    siteHeight: Number(siteHeight.toFixed(1)),
    stepDeg,
    gridResolutionM: grid.pixelSize,
    elevations,
    nearFieldResolutionM: near ? near.pixelSize : null,
    reachKm,
  };
}

/** Load the shared 640 m heightmap (first call only) and compute the horizon at (lat, lon). */
export async function horizonFromGrid(
  lat: number,
  lon: number,
  options?: HorizonOptions,
): Promise<GridHorizonProfile> {
  const grid = await loadHeightGrid();
  return computeHorizon(grid, lat, lon, options);
}

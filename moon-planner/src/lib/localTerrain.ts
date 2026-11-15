// Terrain around any point on the Moon, fetched at run time from NASA Moon
// Trek, and the terrain horizon and SiteData built from it.
//
// Source rasters (LRO LOLA, metres above the 1737.4 km sphere, float32, CORS *):
//   |lat| < 55°   LRO_LOLA_DEM_Global_128ppd_v04   equirectangular, 128 px/deg (237 m at the equator)
//   lat >= 55° N  LRO_LOLA_DEM_NPole45_100mp_v04   north polar stereographic, 100 m
//   lat <= 55° S  LRO_LOLA_DEM_SPole45_100mp_v04   south polar stereographic, 100 m
//
// Two windows are fetched per point and resampled onto square grids in an
// azimuthal equidistant projection centred on the point (x east, y north,
// true distance and bearing from the centre):
//   plate  512 x 512 px of 600 m  (±153.6 km)   the 3D plate and the far horizon
//   near   256 x 256 px of 240 m (global) or 120 m (polar)   the first 15-30 km of the horizon
//
// The horizon uses the method of scripts/process-dem.ts and horizonFromGrid.ts:
// 720 azimuths, exact elevation angle of every sample on the sphere (lunar
// curvature included), observer 2 m above the ground, start one pixel out.
// In this projection a path at azimuth A from the centre is the straight
// line (s sin A, s cos A), so the march needs no per-sample trigonometry.
//
// These grids are much coarser than the 80 m near field of the nine regions:
// rims and ridges are smoothed, so numbers near a grazing Sun are approximate.
//
// Client-safe: no Node-only imports. Uses fetch, so it also runs under tsx.

import { buildSmoothSite } from "./anySite";
import type { SiteData } from "./sky";
import type { SystemData } from "./system";
import { MOON_RADIUS_M, sampleHeight, type HeightGrid, type HorizonProfile } from "./terrain";

const DEG = Math.PI / 180;
const R = MOON_RADIUS_M;
const M_PER_DEG = R * DEG;
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

const TREK = "https://trek.nasa.gov/moon/trekarcgis/rest/services";
export const GLOBAL_DEM = {
  global: { name: "LRO_LOLA_DEM_Global_128ppd_v04", nativeM: 237, text: "LOLA global 128 px/deg (237 m)" },
  north: { name: "LRO_LOLA_DEM_NPole45_100mp_v04", nativeM: 100, text: "LOLA north polar 100 m" },
  south: { name: "LRO_LOLA_DEM_SPole45_100mp_v04", nativeM: 100, text: "LOLA south polar 100 m" },
} as const;
export type GlobalDemKind = keyof typeof GLOBAL_DEM;

/** Beyond this latitude the polar stereographic mosaics are used (they reach 45°). */
export const POLAR_SOURCE_LAT = 55;
export const PLATE_PX_M = 600;
export const PLATE_N = 512;
export const NEAR_N = 256;
export const LOCAL_MAST_M = 2;
const AZ_STEP_DEG = 0.5;

// ---------- Local projection ----------

export type LocalProjection = {
  lat0: number;
  lon0: number;
  /** Selenographic degrees to metres east (x) and north (y) of the centre. */
  project(lat: number, lon: number): { x: number; y: number };
  unproject(x: number, y: number): { lat: number; lon: number };
};

/** Azimuthal equidistant projection of the 1737.4 km sphere centred on (lat0, lon0). */
export function localProjection(lat0: number, lon0: number): LocalProjection {
  const s0 = Math.sin(lat0 * DEG);
  const c0 = Math.cos(lat0 * DEG);
  return {
    lat0,
    lon0,
    project(lat, lon) {
      const sp = Math.sin(lat * DEG);
      const cp = Math.cos(lat * DEG);
      const dl = (lon - lon0) * DEG;
      const cosC = Math.min(1, Math.max(-1, s0 * sp + c0 * cp * Math.cos(dl)));
      const c = Math.acos(cosC);
      const k = c < 1e-9 ? 1 : c / Math.sin(c);
      return { x: R * k * cp * Math.sin(dl), y: R * k * (c0 * sp - s0 * cp * Math.cos(dl)) };
    },
    unproject(x, y) {
      const rho = Math.hypot(x, y);
      if (rho < 1e-6) return { lat: lat0, lon: lon0 };
      const c = rho / R;
      const sc = Math.sin(c);
      const cc = Math.cos(c);
      const lat = Math.asin(Math.min(1, Math.max(-1, cc * s0 + (y * sc * c0) / rho))) / DEG;
      let lon = lon0 + Math.atan2(x * sc, rho * c0 * cc - y * s0 * sc) / DEG;
      if (lon > 180) lon -= 360;
      else if (lon < -180) lon += 360;
      return { lat, lon };
    },
  };
}

// ---------- Source rasters ----------

type EqPiece = { lonMin: number; latMax: number; d: number; w: number; h: number; data: Float32Array };
type Source =
  | { kind: "eq"; pieces: EqPiece[] }
  | { kind: "stereo"; north: boolean; x0: number; y1: number; px: number; w: number; h: number; data: Float32Array };

function bilinear(data: Float32Array, w: number, h: number, col: number, row: number): number {
  const c = Math.min(Math.max(col, 0), w - 1);
  const r = Math.min(Math.max(row, 0), h - 1);
  const c0 = Math.min(Math.floor(c), w - 2);
  const r0 = Math.min(Math.floor(r), h - 2);
  const fc = c - c0;
  const fr = r - r0;
  const i = r0 * w + c0;
  return (
    data[i] * (1 - fc) * (1 - fr) + data[i + 1] * fc * (1 - fr) + data[i + w] * (1 - fc) * fr + data[i + w + 1] * fc * fr
  );
}

/** Polar stereographic metres of the Moon Trek polar mosaics (true scale at the pole, longitude 0 toward +y south, -y north). */
function stereoXY(north: boolean, lat: number, lon: number): { x: number; y: number } {
  const r = 2 * R * Math.tan(((90 - Math.abs(lat)) / 2) * DEG);
  const l = lon * DEG;
  return { x: r * Math.sin(l), y: north ? -r * Math.cos(l) : r * Math.cos(l) };
}

function sampleSource(s: Source, lat: number, lon: number): number {
  if (s.kind === "stereo") {
    const p = stereoXY(s.north, lat, lon);
    return bilinear(s.data, s.w, s.h, (p.x - s.x0) / s.px - 0.5, (s.y1 - p.y) / s.px - 0.5);
  }
  for (const p of s.pieces) {
    const span = p.w * p.d;
    let l = lon;
    if (l < p.lonMin) l += 360;
    else if (l > p.lonMin + span) l -= 360;
    if (l < p.lonMin - 1e-9 || l > p.lonMin + span + 1e-9) continue;
    return bilinear(p.data, p.w, p.h, (l - p.lonMin) / p.d - 0.5, (p.latMax - lat) / p.d - 0.5);
  }
  return NaN;
}

async function fetchRaster(
  service: string,
  bbox: [number, number, number, number],
  w: number,
  h: number,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const query = [
    `bbox=${bbox.map((v) => Number(v.toFixed(7))).join(",")}`,
    `size=${w},${h}`,
    "format=bsq",
    "pixelType=F32",
    "interpolation=RSP_BilinearInterpolation",
    "f=image",
  ].join("&");
  let res: Response;
  try {
    res = await fetch(`${TREK}/${service}/ImageServer/exportImage?${query}`, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error("NASA Moon Trek could not be reached for the terrain. Check your connection, then try again.");
  }
  if (!res.ok) throw new Error(`NASA Moon Trek answered HTTP ${res.status} for the terrain. Try again in a minute.`);
  const buffer = await res.arrayBuffer();
  // The service pads the raster with extra rows; the image is the first w x h values.
  if (buffer.byteLength < w * h * 4) throw new Error("NASA Moon Trek returned a short terrain raster. Try again in a minute.");
  let data: Float32Array;
  if (LITTLE_ENDIAN) data = new Float32Array(buffer, 0, w * h);
  else {
    const view = new DataView(buffer);
    data = new Float32Array(w * h);
    for (let i = 0; i < data.length; i++) data[i] = view.getFloat32(i * 4, true);
  }
  let bad = 0;
  for (let i = 0; i < data.length; i++) {
    if (!(data[i] > -20_000 && data[i] < 20_000)) {
      data[i] = NaN;
      bad++;
    }
  }
  if (bad > data.length * 0.02) throw new Error("NASA Moon Trek returned terrain with gaps for this point.");
  return data;
}

export function demKindFor(lat: number): GlobalDemKind {
  return lat >= POLAR_SOURCE_LAT ? "north" : lat <= -POLAR_SOURCE_LAT ? "south" : "global";
}

/**
 * Fetch the source raster that covers the square |x|, |y| <= half around the
 * projection centre, at about `pxM` metres per pixel. The service keeps
 * pixels square in its own units and grows the extent to fit, so every
 * request is made with a matching bbox and size.
 */
async function fetchSource(proj: LocalProjection, half: number, pxM: number, signal?: AbortSignal): Promise<Source> {
  const kind = demKindFor(proj.lat0);
  const edge: { lat: number; lon: number }[] = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const t = -half + (2 * half * i) / N;
    edge.push(proj.unproject(t, half), proj.unproject(t, -half), proj.unproject(half, t), proj.unproject(-half, t));
  }

  if (kind !== "global") {
    const north = kind === "north";
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const e of edge) {
      const p = stereoXY(north, e.lat, e.lon);
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    const px = Math.max(pxM, GLOBAL_DEM[kind].nativeM);
    // Snap to the pixel lattice, with a two-pixel margin.
    x0 = Math.floor(x0 / px - 2) * px;
    y1 = Math.ceil(y1 / px + 2) * px;
    const w = Math.ceil((x1 - x0) / px + 2);
    const h = Math.ceil((y1 - y0) / px + 2);
    const data = await fetchRaster(GLOBAL_DEM[kind].name, [x0, y1 - h * px, x0 + w * px, y1], w, h, signal);
    return { kind: "stereo", north, x0, y1, px, w, h, data };
  }

  // Equirectangular degrees. Longitudes are taken relative to the centre so the window may cross ±180.
  let latMin = 90;
  let latMax = -90;
  let dMin = 0;
  let dMax = 0;
  for (const e of edge) {
    latMin = Math.min(latMin, e.lat);
    latMax = Math.max(latMax, e.lat);
    const dl = ((e.lon - proj.lon0 + 540) % 360) - 180;
    dMin = Math.min(dMin, dl);
    dMax = Math.max(dMax, dl);
  }
  const d = Math.max(pxM / M_PER_DEG, 1 / 128);
  latMax = Math.min(90, Math.ceil(latMax / d + 2) * d);
  const h = Math.ceil((latMax - latMin) / d + 2);
  const lonMin = Math.floor((proj.lon0 + dMin) / d - 2) * d;
  const w = Math.ceil((proj.lon0 + dMax - lonMin) / d + 2);
  // Split at the ±180 meridian, where the mosaic ends.
  const spans: { lonMin: number; w: number }[] = [];
  const lonMax = lonMin + w * d;
  if (lonMin < -180) {
    const wa = Math.ceil((-180 - lonMin) / d);
    spans.push({ lonMin: 180 - wa * d, w: wa }, { lonMin: -180, w: Math.ceil((lonMax + 180) / d) });
  } else if (lonMax > 180) {
    const wb = Math.ceil((lonMax - 180) / d);
    spans.push({ lonMin: 180 - Math.ceil((180 - lonMin) / d) * d, w: Math.ceil((180 - lonMin) / d) }, { lonMin: -180, w: wb });
  } else spans.push({ lonMin, w });
  const pieces = await Promise.all(
    spans.map(async (s): Promise<EqPiece> => {
      const pw = Math.max(2, s.w);
      const data = await fetchRaster(GLOBAL_DEM.global.name, [s.lonMin, latMax - h * d, s.lonMin + pw * d, latMax], pw, h, signal);
      return { lonMin: s.lonMin, latMax, d, w: pw, h, data };
    }),
  );
  return { kind: "eq", pieces };
}

function resample(proj: LocalProjection, src: Source, n: number, px: number): HeightGrid {
  const half = (n * px) / 2;
  const data = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    const y = half - (r + 0.5) * px;
    for (let c = 0; c < n; c++) {
      const q = proj.unproject(-half + (c + 0.5) * px, y);
      data[r * n + c] = sampleSource(src, q.lat, q.lon);
    }
  }
  return { width: n, height: n, originX: -half, originY: half, pixelSize: px, data };
}

// ---------- Local terrain ----------

export type LocalTerrain = {
  lat: number;
  lon: number;
  projection: LocalProjection;
  /** 512 x 512 heights (m), 600 m pixels, row 0 at the north edge, column 0 at the west edge. */
  grid: HeightGrid;
  /** Finer heights around the centre for the near horizon. */
  near: HeightGrid;
  /** Half the plate's side, m. */
  half: number;
  minHeight: number;
  maxHeight: number;
  source: GlobalDemKind;
  /** Short label of the source and grid, for captions. */
  label: string;
};

const terrainCache = new Map<string, Promise<LocalTerrain>>();
const keyOf = (lat: number, lon: number) => `${lat.toFixed(4)},${lon.toFixed(4)}`;

/**
 * The terrain around (lat, lon): two requests to NASA Moon Trek (about
 * 1.5-3 MB together), cached per point. A failed load is not cached.
 */
export function loadLocalTerrain(lat: number, lon: number): Promise<LocalTerrain> {
  const key = keyOf(lat, lon);
  let p = terrainCache.get(key);
  if (!p) {
    p = (async () => {
      const projection = localProjection(lat, lon);
      const source = demKindFor(lat);
      const nearPx = source === "global" ? 240 : 120;
      const half = (PLATE_N * PLATE_PX_M) / 2;
      const [plateSrc, nearSrc] = await Promise.all([
        fetchSource(projection, half, PLATE_PX_M),
        fetchSource(projection, (NEAR_N * nearPx) / 2, nearPx),
      ]);
      const grid = resample(projection, plateSrc, PLATE_N, PLATE_PX_M);
      const near = resample(projection, nearSrc, NEAR_N, nearPx);
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < grid.data.length; i++) {
        const v = grid.data[i];
        if (Number.isNaN(v)) grid.data[i] = 0;
        else {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (!Number.isFinite(min)) throw new Error("NASA Moon Trek returned no terrain for this point.");
      return {
        lat,
        lon,
        projection,
        grid,
        near,
        half,
        minHeight: min,
        maxHeight: max,
        source,
        label: `${GLOBAL_DEM[source].text}, ${PLATE_PX_M} m grid`,
      };
    })();
    terrainCache.set(key, p);
    p.catch(() => {
      if (terrainCache.get(key) === p) terrainCache.delete(key);
    });
  }
  return p;
}

// ---------- Horizon ----------

function marchRadial(
  g: HeightGrid,
  sinA: number,
  cosA: number,
  from: number,
  to: number,
  step: number,
  hObs: number,
  rObs: number,
  best: number,
): number {
  for (let s = from; s < to; s += step) {
    const h = sampleHeight(g, s * sinA, s * cosA);
    if (Number.isNaN(h)) {
      // Off the grid (or a gap): the square's corners reach further than its sides.
      if (Math.max(Math.abs(s * sinA), Math.abs(s * cosA)) > -g.originX - g.pixelSize) break;
      continue;
    }
    const half = Math.sin(s / (2 * R));
    const v = 2 * half * half; // 1 - cos(theta)
    const a = R + h;
    const dh = h - hObs;
    const sinEl = (dh - a * v) / Math.sqrt(dh * dh + 2 * a * rObs * v);
    if (sinEl > best) best = sinEl;
  }
  return best;
}

/** Terrain horizon at the centre of a local terrain, in the shape of public/data/horizon/<id>.json. */
export function computeLocalHorizon(t: LocalTerrain, siteId = "custom", mastM = LOCAL_MAST_M): HorizonProfile {
  const { grid, near } = t;
  const ground = sampleHeight(near, 0, 0);
  const siteHeight = Number.isNaN(ground) ? sampleHeight(grid, 0, 0) : ground;
  const hObs = siteHeight + mastM;
  const rObs = R + hObs;
  const nearReach = (near.width / 2 - 2) * near.pixelSize;
  const nearStep = near.pixelSize / 2;
  const nearCount = Math.ceil((nearReach - near.pixelSize) / nearStep);
  const farStart = near.pixelSize + nearCount * nearStep;
  const farEnd = Math.SQRT2 * t.half;
  const count = Math.round(360 / AZ_STEP_DEG);
  const elevations = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const az = i * AZ_STEP_DEG * DEG;
    const sa = Math.sin(az);
    const ca = Math.cos(az);
    let best = marchRadial(near, sa, ca, near.pixelSize, farStart - 1e-6, nearStep, hObs, rObs, -2);
    best = marchRadial(grid, sa, ca, farStart, farEnd, grid.pixelSize / 2, hObs, rObs, best);
    elevations[i] = best > -2 ? Math.round((Math.asin(best) / DEG) * 1000) / 1000 : -90;
  }
  return {
    siteId,
    lat: t.lat,
    lon: t.lon,
    siteHeight: Number(siteHeight.toFixed(1)),
    stepDeg: AZ_STEP_DEG,
    gridResolutionM: grid.pixelSize,
    elevations,
  };
}

// ---------- The site ----------

export type GlobalSiteData = SiteData & {
  /** The horizon comes from the Moon Trek LOLA mosaics, not the 80 m / 640 m south polar grids. */
  terrain: "lola-global";
  lat: number;
  lon: number;
  method: string;
  /** Short label for tables and captions. */
  terrainLabel: string;
  local: LocalTerrain;
};

export const isGlobalSite = (s: SiteData | null | undefined): s is GlobalSiteData =>
  (s as Partial<GlobalSiteData> | null | undefined)?.terrain === "lola-global";

export function globalSiteMethod(t: LocalTerrain): string {
  return (
    `Terrain: ${GLOBAL_DEM[t.source].text}, fetched from NASA Moon Trek and resampled to a ${t.grid.pixelSize} m grid ` +
    `out to ${Math.round(t.half / 1000)} km, with a ${t.near.pixelSize} m grid for the first ` +
    `${Math.round(((t.near.width / 2 - 2) * t.near.pixelSize) / 1000)} km. The horizon is traced on it along 720 bearings from a 2 m mast, ` +
    "with lunar curvature. Sun and Earth directions come from the JPL Horizons 2027 vectors and the IAU rotation model. " +
    "This grid is coarser than the 80 m near field of the nine regions: rims and ridges are smoothed, " +
    "so times near a grazing Sun or Earth are approximate, and terrain beyond the plate is not included."
  );
}

/** Sun and Earth tracks for all of 2027 at the terrain's centre, with its terrain horizon. */
export function buildGlobalSite(t: LocalTerrain, system: SystemData, siteId = "custom"): GlobalSiteData {
  const smooth = buildSmoothSite(t.lat, t.lon, system);
  return {
    sky: { ...smooth.sky, siteId },
    horizon: computeLocalHorizon(t, siteId),
    terrain: "lola-global",
    lat: t.lat,
    lon: t.lon,
    method: globalSiteMethod(t),
    terrainLabel: `${GLOBAL_DEM[t.source].text}, ${t.grid.pixelSize} m grid`,
    local: t,
  };
}

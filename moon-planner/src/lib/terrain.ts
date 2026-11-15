// Terrain helpers for the LOLA south pole DEM (LDEM_80S_80MPP_ADJ).
//
// Projection: south polar stereographic on a sphere of radius 1737.4 km,
// scale true at the pole, x/y in meters. Longitude 0 points to +y and
// longitude 90°E to +x (the map is viewed from outside the Moon, looking
// down at the south pole). Verified against known craters by
// scripts/process-dem.ts.
//
// Shared by the preprocessing script and the app; no Node-only imports.

export const MOON_RADIUS_M = 1_737_400;

const DEG = Math.PI / 180;

// ---------- Projection ----------

export function latLonToXY(lat: number, lon: number): { x: number; y: number } {
  const r = 2 * MOON_RADIUS_M * Math.tan(((90 + lat) / 2) * DEG);
  return { x: r * Math.sin(lon * DEG), y: r * Math.cos(lon * DEG) };
}

export function xyToLatLon(x: number, y: number): { lat: number; lon: number } {
  const r = Math.hypot(x, y);
  const lat = (2 * Math.atan(r / (2 * MOON_RADIUS_M))) / DEG - 90;
  const lon = r === 0 ? 0 : Math.atan2(x, y) / DEG; // -180..180, east positive
  return { lat, lon };
}

// ---------- Height grids ----------

/**
 * A north-up raster in projected meters. (originX, originY) is the top-left
 * CORNER of pixel (0, 0); row 0 is the +y edge. Values are heights in meters
 * above the 1737.4 km sphere (NaN = no data).
 */
export type HeightGrid = {
  width: number;
  height: number;
  originX: number;
  originY: number;
  pixelSize: number; // meters
  data: Float32Array; // row-major, width * height
};

/** Bilinear height at projected (x, y), sampling pixel centers. NaN if outside or no data. */
export function sampleHeight(grid: HeightGrid, x: number, y: number): number {
  const col = (x - grid.originX) / grid.pixelSize - 0.5;
  const row = (grid.originY - y) / grid.pixelSize - 0.5;
  if (col < 0 || row < 0 || col > grid.width - 1 || row > grid.height - 1) return NaN;

  const c0 = Math.min(Math.floor(col), grid.width - 2);
  const r0 = Math.min(Math.floor(row), grid.height - 2);
  const fc = col - c0;
  const fr = row - r0;
  const i = r0 * grid.width + c0;
  const d = grid.data;
  return (
    d[i] * (1 - fc) * (1 - fr) +
    d[i + 1] * fc * (1 - fr) +
    d[i + grid.width] * (1 - fc) * fr +
    d[i + grid.width + 1] * fc * fr
  );
}

// ---------- Local directions & great circles ----------

/**
 * Unit vectors (in projected x/y) for local north and east at a longitude.
 * North follows the meridian toward the lunar north pole, which for south
 * pole sites points away from the pole (the Horizons azimuth convention).
 */
export function localNorthEast(lon: number) {
  const s = Math.sin(lon * DEG);
  const c = Math.cos(lon * DEG);
  return { north: { x: s, y: c }, east: { x: c, y: -s } };
}

/** Point reached by moving `distM` along a great circle from (lat, lon) at `azDeg` (clockwise from north). */
export function destination(lat: number, lon: number, azDeg: number, distM: number) {
  const d = distM / MOON_RADIUS_M;
  const p1 = lat * DEG;
  const az = azDeg * DEG;
  const sinP2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(az);
  const p2 = Math.asin(sinP2);
  const dLon = Math.atan2(
    Math.sin(az) * Math.sin(d) * Math.cos(p1),
    Math.cos(d) - Math.sin(p1) * sinP2,
  );
  return { lat: p2 / DEG, lon: lon + dLon / DEG };
}

// ---------- Horizon profiles ----------

/** Terrain horizon for one site, as written to public/data/horizon/<siteId>.json. */
export type HorizonProfile = {
  siteId: string;
  lat: number;
  lon: number;
  siteHeight: number; // meters above the 1737.4 km sphere (ground, without mast)
  stepDeg: number; // azimuth step; elevations[i] is at azimuth i * stepDeg
  gridResolutionM: number;
  elevations: number[]; // degrees, relative to the local horizontal plane
};

/** Terrain horizon elevation (deg) at an azimuth (deg, clockwise from north), linearly interpolated. */
export function horizonElevationAt(profile: HorizonProfile, azimuth: number): number {
  const n = profile.elevations.length;
  const pos = (((azimuth % 360) + 360) % 360) / profile.stepDeg;
  const i0 = Math.floor(pos) % n;
  const i1 = (i0 + 1) % n;
  const f = pos - Math.floor(pos);
  return profile.elevations[i0] * (1 - f) + profile.elevations[i1] * f;
}

/** True if a target at (az, el) is above the terrain horizon. */
export function isVisible(profile: HorizonProfile, az: number, el: number): boolean {
  return el > horizonElevationAt(profile, az);
}

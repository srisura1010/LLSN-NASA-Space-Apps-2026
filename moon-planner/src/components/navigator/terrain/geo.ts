// Geometry for the terrain plate. "Map" coordinates are the south polar
// stereographic metres of src/lib/terrain.ts; the "plate frame" is
// (map x, map y, up), where up is away from the Moon's centre.

import { latLonToXY, localNorthEast, MOON_RADIUS_M } from "@/lib/terrain";

export type V2 = { x: number; y: number };
export type V3 = [number, number, number];

/**
 * Local east, north and up at a map point, in the plate frame. Same maths
 * as localFrame() in shaders.ts, so the Sun built here lights the plate
 * exactly as the shader expects.
 */
export function localFrameAt(x: number, y: number): { E: V3; N: V3; U: V3 } {
  const r = Math.hypot(x, y);
  const c = 2 * Math.atan(r / (2 * MOON_RADIUS_M)); // colatitude from the south pole
  const sl = r > 1 ? x / r : 0; // sin(lon)
  const cl = r > 1 ? y / r : 1; // cos(lon)
  const sc = Math.sin(c);
  const cc = Math.cos(c);
  return {
    E: [cl, -sl, 0],
    N: [cc * sl, cc * cl, -sc],
    U: [sc * sl, sc * cl, cc],
  };
}

/**
 * Unit vector toward a body seen at (az, el) from a map point, in the plate
 * frame: dir = cos(el)(sin(az) E + cos(az) N) + sin(el) U.
 */
export function bodyVector(x: number, y: number, azDeg: number, elDeg: number): V3 {
  const { E, N, U } = localFrameAt(x, y);
  const a = (azDeg * Math.PI) / 180;
  const e = (elDeg * Math.PI) / 180;
  const h = Math.cos(e);
  const ke = h * Math.sin(a);
  const kn = h * Math.cos(a);
  const ku = Math.sin(e);
  return [
    ke * E[0] + kn * N[0] + ku * U[0],
    ke * E[1] + kn * N[1] + ku * U[1],
    ke * E[2] + kn * N[2] + ku * U[2],
  ];
}

/** Horizontal bearing for an azimuth at a longitude, as a unit vector in map x/y. */
export function bearingAt(lon: number, azDeg: number): V2 {
  const { north, east } = localNorthEast(lon);
  const a = (azDeg * Math.PI) / 180;
  const x = Math.sin(a) * east.x + Math.cos(a) * north.x;
  const y = Math.sin(a) * east.y + Math.cos(a) * north.y;
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

/** Distance (m) from p along unit direction d to the edge of the square |x|,|y| <= half. */
export function exitDistance(p: V2, d: V2, half: number): number {
  let t = Infinity;
  if (d.x > 1e-9) t = Math.min(t, (half - p.x) / d.x);
  if (d.x < -1e-9) t = Math.min(t, (-half - p.x) / d.x);
  if (d.y > 1e-9) t = Math.min(t, (half - p.y) / d.y);
  if (d.y < -1e-9) t = Math.min(t, (-half - p.y) / d.y);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

// ---------- Regions ----------

export type RegionShape = {
  id: string;
  name: string;
  code: string;
  areaKm2: number;
  /** Corners in map metres, counter-clockwise. */
  corners: V2[];
  centre: V2;
};

type RegionFeature = {
  id?: string;
  properties: { id: string; name: string; code: string; area_km2: number; centre_lat: number; centre_lon: number };
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
};

/** Region polygons from the USGS geojson ([lon, lat] rings), projected to map metres. */
export function parseRegions(geojson: { features: RegionFeature[] }): Map<string, RegionShape> {
  const out = new Map<string, RegionShape>();
  for (const f of geojson.features) {
    const ring = f.geometry.coordinates[0];
    const pts = ring.slice(0, ring.length - 1).map(([lon, lat]) => latLonToXY(lat, lon));
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += a.x * b.y - b.x * a.y;
    }
    if (area < 0) pts.reverse();
    const p = f.properties;
    out.set(p.id, {
      id: p.id,
      name: p.name,
      code: p.code,
      areaKm2: p.area_km2,
      corners: pts,
      centre: latLonToXY(p.centre_lat, p.centre_lon),
    });
  }
  return out;
}

export function pointInPolygon(p: V2, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---------- Landmarks ----------

/** Fixed reference points labelled on the plate (IAU gazetteer centre for Shackleton). */
export const LANDMARKS = [
  { id: "pole", label: "South pole", ...latLonToXY(-90, 0) },
  { id: "shackleton", label: "Shackleton", ...latLonToXY(-89.67, 129.78) },
] as const;

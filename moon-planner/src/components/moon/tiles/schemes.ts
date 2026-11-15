// The two NASA Moon Trek WMTS tile sets the Moon level draws detail from, as
// pure geometry: which tiles exist, where each lies on the sphere, and its
// address. Values are from each layer's WMTSCapabilities.xml (checked
// 2026-11-14). Nothing here touches WebGL or the network.

/** A direction in the globe's own frame: x through 0° N 0° E, y north, so longitude east is atan2(-z, x). */
export type V3 = [number, number, number];

export type SchemeId = "eq" | "sp";
export type TileId = { s: SchemeId; z: number; row: number; col: number };

export const tileKey = (t: TileId) => `${t.s}/${t.z}/${t.row}/${t.col}`;

export interface TileScheme {
  id: SchemeId;
  /** Layer name at trek.nasa.gov. */
  layer: string;
  /** First level whose texels are finer than the 4k whole-globe map; coarser tiles are never fetched. */
  minLevel: number;
  /** Last level the layer publishes. */
  maxLevel: number;
  roots(): TileId[];
  /** The four tiles one level down, less any that lie outside the scheme's part of the globe. */
  children(t: TileId): TileId[];
  parent(t: TileId): TileId | null;
  /** The point at fraction u across the tile (towards its right edge) and v down it, as a unit vector. */
  point(t: TileId, u: number, v: number): V3;
  /** Angle one texel spans on the ground, in radians. */
  texelRad(t: TileId): number;
  url(t: TileId): string;
}

const RAD = Math.PI / 180;
const TILE_PX = 256;
const MOON_RADIUS_M = 1737400;
const TREK = "https://trek.nasa.gov/tiles/Moon";

/** South of this latitude the polar stereographic set is drawn instead of the equirectangular one. It is a row edge of the latter from level 3 on. */
export const SPLIT_LAT = -67.5;

export function onSphere(latDeg: number, lonDeg: number): V3 {
  const lat = latDeg * RAD;
  const lon = lonDeg * RAD;
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)];
}

// ---------- Global equirectangular: level 0 is 2 columns by 1 row, from 180° W 90° N ----------

export type LatLonBounds = { north: number; south: number; west: number; east: number };

export function eqBounds(t: TileId): LatLonBounds {
  const span = 180 / 2 ** t.z;
  const north = 90 - t.row * span;
  const west = -180 + t.col * span;
  return { north, south: north - span, west, east: west + span };
}

/** The equirectangular tile at a level that holds a point; a point on an edge belongs to the tile south and east of it. */
export function eqTileAt(latDeg: number, lonDeg: number, z: number): TileId {
  const n = 2 ** z;
  const span = 180 / n;
  const row = Math.min(n - 1, Math.max(0, Math.floor((90 - latDeg) / span)));
  const col = Math.min(2 * n - 1, Math.max(0, Math.floor((lonDeg + 180) / span)));
  return { s: "eq", z, row, col };
}

export const EQ: TileScheme = {
  id: "eq",
  layer: "LRO_WAC_Mosaic_Global_303ppd_v02",
  // Level 3 is 4096 texels round the Moon, the same as the whole-globe map.
  minLevel: 4,
  maxLevel: 8,
  roots: () => [
    { s: "eq", z: 0, row: 0, col: 0 },
    { s: "eq", z: 0, row: 0, col: 1 },
  ],
  children(t) {
    const out: TileId[] = [];
    for (let dr = 0; dr < 2; dr++)
      for (let dc = 0; dc < 2; dc++) {
        const c: TileId = { s: "eq", z: t.z + 1, row: t.row * 2 + dr, col: t.col * 2 + dc };
        if (eqBounds(c).north > SPLIT_LAT + 1e-9) out.push(c);
      }
    return out;
  },
  parent: (t) => (t.z > 0 ? { s: "eq", z: t.z - 1, row: t.row >> 1, col: t.col >> 1 } : null),
  point(t, u, v) {
    const b = eqBounds(t);
    return onSphere(b.north + (b.south - b.north) * v, b.west + (b.east - b.west) * u);
  },
  texelRad(t) {
    const b = eqBounds(t);
    // Texels narrow towards the poles; the geometric mean of the two axes keeps high latitudes from asking for levels they cannot show.
    const nearest = b.north * b.south <= 0 ? 0 : Math.min(Math.abs(b.north), Math.abs(b.south));
    return (((b.north - b.south) * RAD) / TILE_PX) * Math.sqrt(Math.max(Math.cos(nearest * RAD), 0.25));
  },
  url: (t) => `${TREK}/EQ/${EQ.layer}/1.0.0/default/default028mm/${t.z}/${t.row}/${t.col}.jpg`,
};

// ---------- South polar stereographic: x towards 90° E, y towards 0°, metres on the plane ----------

/** Top-left corner of the grid and the width of the one level-0 tile that holds the whole mosaic. */
const SP_ORIGIN_M = 1095930;
const SP_SPAN_M = 2 * SP_ORIGIN_M;
/** Radius on the plane of the circle at SPLIT_LAT. */
const SP_SPLIT_M = 2 * MOON_RADIUS_M * Math.tan(((90 + SPLIT_LAT) / 2) * RAD);

export type PlaneBounds = { x0: number; x1: number; y0: number; y1: number };

/** x0 is the west (left) edge and y0 the top edge, which has the larger y. */
export function spBounds(t: TileId): PlaneBounds {
  const span = SP_SPAN_M / 2 ** t.z;
  const x0 = -SP_ORIGIN_M + t.col * span;
  const y0 = SP_ORIGIN_M - t.row * span;
  return { x0, x1: x0 + span, y0, y1: y0 - span };
}

export function spPlane(latDeg: number, lonDeg: number): [number, number] {
  const r = 2 * MOON_RADIUS_M * Math.tan(((90 + latDeg) / 2) * RAD);
  return [r * Math.sin(lonDeg * RAD), r * Math.cos(lonDeg * RAD)];
}

export function spLatLon(x: number, y: number): [number, number] {
  return [-90 + (2 * Math.atan(Math.hypot(x, y) / (2 * MOON_RADIUS_M))) / RAD, Math.atan2(x, y) / RAD];
}

export function spTileAt(latDeg: number, lonDeg: number, z: number): TileId {
  const n = 2 ** z;
  const span = SP_SPAN_M / n;
  const [x, y] = spPlane(latDeg, lonDeg);
  const clamp = (i: number) => Math.min(n - 1, Math.max(0, i));
  return { s: "sp", z, row: clamp(Math.floor((SP_ORIGIN_M - y) / span)), col: clamp(Math.floor((x + SP_ORIGIN_M) / span)) };
}

/** Whether any of the tile lies south of SPLIT_LAT. */
function spInCap(t: TileId) {
  const b = spBounds(t);
  const dx = Math.max(b.x0, -b.x1, 0);
  const dy = Math.max(b.y1, -b.y0, 0);
  return Math.hypot(dx, dy) < SP_SPLIT_M;
}

export const SP: TileScheme = {
  id: "sp",
  layer: "LRO_WAC_Mosaic_SPole60_100m_v02",
  // Level 2 is 2.1 km a texel, close to the whole-globe map's 2.7 km; level 5 is 268 m.
  minLevel: 3,
  maxLevel: 5,
  // The matrix is declared 2 by 1 at level 0, but the mosaic fills only the first column.
  roots: () => [{ s: "sp", z: 0, row: 0, col: 0 }],
  children(t) {
    const out: TileId[] = [];
    for (let dr = 0; dr < 2; dr++)
      for (let dc = 0; dc < 2; dc++) {
        const c: TileId = { s: "sp", z: t.z + 1, row: t.row * 2 + dr, col: t.col * 2 + dc };
        if (spInCap(c)) out.push(c);
      }
    return out;
  },
  parent: (t) => (t.z > 0 ? { s: "sp", z: t.z - 1, row: t.row >> 1, col: t.col >> 1 } : null),
  point(t, u, v) {
    const b = spBounds(t);
    const [lat, lon] = spLatLon(b.x0 + (b.x1 - b.x0) * u, b.y0 + (b.y1 - b.y0) * v);
    return onSphere(lat, lon);
  },
  texelRad: (t) => SP_SPAN_M / 2 ** t.z / TILE_PX / MOON_RADIUS_M,
  url: (t) => `${TREK}/SP/${SP.layer}/1.0.0/default/default028mm/${t.z}/${t.row}/${t.col}.png`,
};

export const SCHEMES: Record<SchemeId, TileScheme> = { eq: EQ, sp: SP };

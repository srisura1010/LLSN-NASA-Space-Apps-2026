// Loads the LOLA heightmap and the USGS region outlines once per page and
// prepares what the plate needs: a two-channel half-float height texture
// for the shaders and a 2x downsampled grid for the mesh and picking.

import { DataUtils } from "three";
import { parseRegions, type RegionShape } from "./geo";

export type HeightMeta = {
  source: string;
  width: number;
  height: number;
  pixelSize: number;
  extent: { minX: number; maxX: number; minY: number; maxY: number };
  minHeight: number;
  maxHeight: number;
};

/** Heights (m) on a regular grid; row 0 is the +y edge, column 0 the -x edge. */
export type Grid = {
  n: number;
  spacing: number;
  /** Map x of column 0 and map y of row 0 (vertex positions, m). */
  x0: number;
  y0: number;
  heights: Float32Array;
};

export type TerrainData = {
  meta: HeightMeta;
  /** Half of the plate's side (m); the map spans -half..half on both axes. */
  half: number;
  /**
   * RG half floats per pixel: R holds the height rounded to 64 m, G the
   * remainder. Both filter linearly in core WebGL2 and sum to a bilinear
   * height good to about 2 cm.
   */
  texData: Uint16Array;
  grid: Grid;
};

type Progress = (fraction: number | null) => void;

const listeners = new Set<Progress>();
let terrainPromise: Promise<TerrainData> | null = null;
let regionsPromise: Promise<Map<string, RegionShape>> | null = null;

/** Download progress of the heightmap: 0..1, or null when the size is unknown. */
export function subscribeTerrainProgress(fn: Progress): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(f: number | null) {
  for (const fn of listeners) fn(f);
}

async function fetchBinary(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The heightmap request failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  const encoded = !!res.headers.get("content-encoding");
  if (!res.body || !total || encoded) {
    emit(null);
    return res.arrayBuffer();
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    emit(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out.buffer;
}

function build(meta: HeightMeta, buf: ArrayBuffer): TerrainData {
  const { width: w, height: h, pixelSize: px } = meta;
  if (buf.byteLength !== w * h * 4) throw new Error("The heightmap file is not the expected size.");
  const heights = new Float32Array(buf);

  const texData = new Uint16Array(w * h * 2);
  for (let i = 0; i < w * h; i++) {
    const v = Number.isFinite(heights[i]) ? heights[i] : 0;
    const coarse = Math.round(v / 64) * 64;
    texData[2 * i] = DataUtils.toHalfFloat(coarse);
    texData[2 * i + 1] = DataUtils.toHalfFloat(v - coarse);
  }

  // 2x2 block means for the mesh.
  const n = Math.floor(Math.min(w, h) / 2);
  const g = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const r0 = 2 * j * w;
    const r1 = r0 + w;
    for (let i = 0; i < n; i++) {
      const c = 2 * i;
      g[j * n + i] = 0.25 * (heights[r0 + c] + heights[r0 + c + 1] + heights[r1 + c] + heights[r1 + c + 1]);
    }
  }

  return {
    meta,
    half: (meta.extent.maxX - meta.extent.minX) / 2,
    texData,
    grid: { n, spacing: 2 * px, x0: meta.extent.minX + px, y0: meta.extent.maxY - px, heights: g },
  };
}

export function loadTerrain(): Promise<TerrainData> {
  if (!terrainPromise) {
    terrainPromise = (async () => {
      const metaRes = await fetch("/data/terrain/heightmap.json");
      if (!metaRes.ok) throw new Error(`The heightmap description failed to load (HTTP ${metaRes.status}).`);
      const meta = (await metaRes.json()) as HeightMeta;
      const buf = await fetchBinary("/data/terrain/heightmap.bin");
      return build(meta, buf);
    })();
    terrainPromise.catch(() => {
      terrainPromise = null;
    });
  }
  return terrainPromise;
}

export function loadRegions(): Promise<Map<string, RegionShape>> {
  if (!regionsPromise) {
    regionsPromise = fetch("/data/artemis3-regions.geojson")
      .then((r) => {
        if (!r.ok) throw new Error(`The region outlines failed to load (HTTP ${r.status}).`);
        return r.json();
      })
      .then(parseRegions);
    regionsPromise.catch(() => {
      regionsPromise = null;
    });
  }
  return regionsPromise;
}

// ---------- Sampling and picking ----------

/** Bilinear height (m) from the grid at map (x, y), clamped to the plate. */
export function gridHeight(g: Grid, x: number, y: number): number {
  const fx = Math.min(Math.max((x - g.x0) / g.spacing, 0), g.n - 1);
  const fy = Math.min(Math.max((g.y0 - y) / g.spacing, 0), g.n - 1);
  const i = Math.min(Math.floor(fx), g.n - 2);
  const j = Math.min(Math.floor(fy), g.n - 2);
  const u = fx - i;
  const v = fy - j;
  const k = j * g.n + i;
  const d = g.heights;
  return (d[k] * (1 - u) + d[k + 1] * u) * (1 - v) + (d[k + g.n] * (1 - u) + d[k + g.n + 1] * u) * v;
}

export function gridRange(g: Grid): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of g.heights) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

type Vec = { x: number; y: number; z: number };

/**
 * First hit of a scene-space ray (km, y up, z = -map y) on the displayed
 * relief, as map metres. Marches the grid, then bisects the crossing.
 */
export function intersectRelief(
  g: Grid,
  range: { min: number; max: number },
  exaggeration: number,
  o: Vec,
  d: Vec,
): { x: number; y: number } | null {
  const k = exaggeration / 1000;
  const lo = [(g.x0) / 1000, range.min * k, -g.y0 / 1000];
  const hi = [(g.x0 + (g.n - 1) * g.spacing) / 1000, range.max * k, -(g.y0 - (g.n - 1) * g.spacing) / 1000];
  const oa = [o.x, o.y, o.z];
  const da = [d.x, d.y, d.z];
  let t0 = 0;
  let t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(da[a]) < 1e-12) {
      if (oa[a] < lo[a] || oa[a] > hi[a]) return null;
      continue;
    }
    let ta = (lo[a] - oa[a]) / da[a];
    let tb = (hi[a] - oa[a]) / da[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  const above = (t: number) => {
    const x = o.x + d.x * t;
    const z = o.z + d.z * t;
    return o.y + d.y * t - gridHeight(g, x * 1000, -z * 1000) * k;
  };
  const step = (g.spacing / 1000) * 0.5;
  let prev = t0;
  if (above(prev) < 0) return { x: (o.x + d.x * prev) * 1000, y: -(o.z + d.z * prev) * 1000 };
  for (let t = t0 + step; t <= t1 + step; t += step) {
    const tt = Math.min(t, t1);
    if (above(tt) < 0) {
      let a = prev;
      let b = tt;
      for (let i = 0; i < 12; i++) {
        const m = 0.5 * (a + b);
        if (above(m) < 0) b = m;
        else a = m;
      }
      return { x: (o.x + d.x * b) * 1000, y: -(o.z + d.z * b) * 1000 };
    }
    prev = tt;
    if (tt >= t1) break;
  }
  return null;
}

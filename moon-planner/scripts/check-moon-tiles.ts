// Check the Moon level's detail tile selector and cache (src/components/moon/tiles)
// without WebGL or the network: what a whole-globe view and close views ask
// for, that tile bounds and tile lookup agree, and that the manager never
// leaves a hole, caps its requests and gives up quietly when offline.
//
// Usage: npx tsx scripts/check-moon-tiles.ts

import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import { TileManager } from "../src/components/moon/tiles/manager";
import { EQ, SCHEMES, SP, SPLIT_LAT, eqBounds, eqTileAt, onSphere, spBounds, spLatLon, spTileAt, tileKey, type TileId } from "../src/components/moon/tiles/schemes";
import { discDiameter, selectTiles, type TileView } from "../src/components/moon/tiles/select";

let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failed++;
};

/** The Moon level's camera: 30° field of view, looking at the globe's centre from `distance` radii above lat, lon. */
function viewFrom(lat: number, lon: number, distance: number, width = 1440, height = 1400): TileView {
  const cam = new PerspectiveCamera(30, width / height, 0.1, 40);
  const dir = onSphere(lat, lon);
  cam.position.set(dir[0] * distance, dir[1] * distance, dir[2] * distance);
  if (Math.abs(lat) > 89.9) cam.up.set(1, 0, 0);
  cam.lookAt(new Vector3(0, 0, 0));
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const clip = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  return { eye: [cam.position.x, cam.position.y, cam.position.z], clip: clip.elements, fovY: (30 * Math.PI) / 180, heightPx: height };
}
const schemes = [EQ, SP];
const summary = (v: TileView) => {
  const s = selectTiles(v, schemes);
  const by = (id: string) => s.tiles.filter((t) => t.tile.s === id);
  const lv = (id: string) => by(id).reduce((z, t) => Math.max(z, t.tile.z), 0);
  return { s, eq: by("eq").length, sp: by("sp").length, eqMax: lv("eq"), spMax: lv("sp") };
};

async function main() {
  // 1. Whole-globe views ask for nothing: the 4k map is already as fine as the screen.
  for (const [name, d] of [["default distance 4.7", 4.7], ["zoomed out 7.5", 7.5], ["just outside the detail range 3.5", 3.5]] as const) {
    const v = viewFrom(-35, 0, d);
    const { s } = summary(v);
    check(!s.active && s.tiles.length === 0, `whole globe, ${name}: disc ${discDiameter(v).toFixed(2)} view heights, ${s.tiles.length} tiles`);
  }

  // 2. Close views ask for a bounded set.
  const pole = summary(viewFrom(-85, 0, 1.9 * 1.3));
  check(pole.s.active && pole.s.tiles.length > 0 && pole.s.tiles.length <= 140, `south pole arrival (2.47 radii): ${pole.s.tiles.length} tiles, polar ${pole.sp} to level ${pole.spMax}, equirectangular ${pole.eq} to level ${pole.eqMax}, error allowed ${pole.s.maxError.toFixed(2)} px`);
  const poleClose = summary(viewFrom(-88, 0, 1.9));
  check(poleClose.s.tiles.length > 0 && poleClose.s.tiles.length <= 140, `south pole at the site gate (1.9 radii): ${poleClose.s.tiles.length} tiles, polar ${poleClose.sp} to level ${poleClose.spMax}, equirectangular ${poleClose.eq} to level ${poleClose.eqMax}, error allowed ${poleClose.s.maxError.toFixed(2)} px`);
  const near = summary(viewFrom(5, 3, 1.45));
  check(near.s.tiles.length > 0 && near.s.tiles.length <= 140 && near.sp === 0, `near side closest (1.45 radii, 1400 px): ${near.s.tiles.length} tiles to level ${near.eqMax}, error allowed ${near.s.maxError.toFixed(2)} px`);
  const nearLow = summary(viewFrom(5, 3, 1.45, 900, 650));
  check(nearLow.s.tiles.length > 0 && nearLow.s.tiles.length <= 140, `near side closest on a 650 px drawing: ${nearLow.s.tiles.length} tiles to level ${nearLow.eqMax}`);
  const mid = summary(viewFrom(5, 3, 2.6));
  check(mid.s.tiles.length > 0 && mid.eqMax <= near.eqMax, `near side at 2.6 radii: ${mid.s.tiles.length} tiles to level ${mid.eqMax}`);
  check(near.s.tiles.every((t) => t.tile.z >= EQ.minLevel && t.tile.z <= EQ.maxLevel) && pole.s.tiles.every((t) => t.tile.z >= SCHEMES[t.tile.s].minLevel && t.tile.z <= SCHEMES[t.tile.s].maxLevel), `every selected tile is between its layer's first useful level and its last (eq ${EQ.minLevel}-${EQ.maxLevel}, sp ${SP.minLevel}-${SP.maxLevel})`);

  // The view centre is covered, the far side is not, and no selected tile contains another.
  const centreTile = near.s.tiles.some((t) => tileKey(eqTileAt(5, 3, t.tile.z)) === t.key);
  const farSide = near.s.tiles.some((t) => { const b = eqBounds(t.tile); return b.west >= 100 || b.east <= -100; });
  check(centreTile && !farSide, "near side: the tile under the view centre is selected, nothing from the far side");
  const keys = new Set(pole.s.tiles.concat(near.s.tiles).map((t) => t.key));
  let nested = 0;
  for (const t of pole.s.tiles.concat(near.s.tiles)) for (let p = SCHEMES[t.tile.s].parent(t.tile); p; p = SCHEMES[t.tile.s].parent(p)) if (keys.has(tileKey(p))) nested++;
  check(nested === 0, "no selected tile lies inside another selected tile");
  check(pole.s.tiles.filter((t) => t.tile.s === "eq").every((t) => eqBounds(t.tile).south >= SPLIT_LAT - 1e-9), `equirectangular tiles stop at ${-SPLIT_LAT}° S, where the polar set takes over`);

  // 3. Tile → bounds → tile.
  let trips = 0;
  let bad = 0;
  for (let z = 0; z <= EQ.maxLevel; z++) {
    const rows = 2 ** z;
    for (let k = 0; k < 400; k++) {
      const t: TileId = { s: "eq", z, row: (k * 7919) % rows, col: (k * 104729) % (2 * rows) };
      const b = eqBounds(t);
      const back = eqTileAt((b.north + b.south) / 2, (b.west + b.east) / 2, z);
      const corner = eqTileAt(b.north, b.west, z);
      trips++;
      if (tileKey(back) !== tileKey(t) || tileKey(corner) !== tileKey(t)) bad++;
    }
  }
  for (let z = 0; z <= SP.maxLevel; z++) {
    const n = 2 ** z;
    for (let k = 0; k < 400; k++) {
      const t: TileId = { s: "sp", z, row: (k * 7919) % n, col: (k * 104729) % n };
      const b = spBounds(t);
      const [lat, lon] = spLatLon((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
      trips++;
      if (tileKey(spTileAt(lat, lon, z)) !== tileKey(t)) bad++;
    }
  }
  check(bad === 0, `tile → bounds → tile round trip: ${trips} tiles, ${bad} mismatches`);
  const e0 = eqBounds({ s: "eq", z: 0, row: 0, col: 0 });
  check(e0.west === -180 && e0.east === 0 && e0.north === 90 && e0.south === -90, "equirectangular level 0 is two tiles from 180° W, 90° N");
  // Each child's four corners lie on the parent's surface at the matching fractions.
  let drift = 0;
  for (const s of schemes) {
    const t = s.id === "eq" ? eqTileAt(-40, 100, 5) : spTileAt(-80, 30, 3);
    for (const c of [0, 1, 2, 3]) {
      const child: TileId = { s: s.id, z: t.z + 1, row: t.row * 2 + (c >> 1), col: t.col * 2 + (c & 1) };
      const a = s.point(child, 1, 1);
      const b = s.point(t, ((c & 1) + 1) / 2, ((c >> 1) + 1) / 2);
      drift = Math.max(drift, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }
  check(drift < 1e-12, `children share their parent's surface points (largest gap ${drift.toExponential(1)})`);
  const sp90 = SP.point(spTileAt(-80, 90, 4), 0, 0);
  const [plat, plon] = spLatLon(1e5, 0);
  check(Math.abs(plon - 90) < 1e-9 && plat > -90 && sp90[2] < 0, "polar plane: +x is 90° E, +y is 0°");

  // 4. The manager: request cap, parent stands in until children load, cache budget, offline.
  type Fake = { url: string };
  let inflight = 0;
  let peak = 0;
  let disposed = 0;
  let aborted = 0;
  const pending: (() => void)[] = [];
  const m = new TileManager<Fake>({
    schemes: SCHEMES,
    maxTiles: 40,
    load: (url, signal) =>
      new Promise<Fake>((resolve, reject) => {
        inflight++;
        peak = Math.max(peak, inflight);
        signal.addEventListener("abort", () => { inflight--; aborted++; reject(new Error("aborted")); });
        pending.push(() => { if (!signal.aborted) { inflight--; resolve({ url }); } });
      }),
    dispose: () => { disposed++; },
  });
  const flush = async () => { while (pending.length) { pending.splice(0).forEach((f) => f()); await new Promise((r) => setTimeout(r, 0)); } };
  const coarse = selectTiles(viewFrom(5, 3, 2.6), schemes).tiles;
  let r = m.update(coarse);
  check(r.draw.length === 0 && r.status.loading === coarse.length, `first update draws nothing and reports ${r.status.loading} loading`);
  while (m.size < coarse.length) { await flush(); m.update(coarse); }
  r = m.update(coarse);
  check(r.draw.length === coarse.length && r.status.loading === 0 && peak <= 6, `all ${coarse.length} loaded; most requests in flight at once ${peak} (cap 6)`);
  const fine = near.s.tiles;
  r = m.update(fine);
  const standIns = r.draw.filter((d) => !fine.some((f) => f.key === d.key));
  const covered = fine.every((f) => { for (let p: TileId | null = f.tile; p; p = EQ.parent(p)) if (r.draw.some((d) => d.key === tileKey(p as TileId))) return true; return false; });
  check(covered && standIns.length > 0, `zooming in: every wanted tile is covered by a loaded ancestor while ${r.status.loading} load (${standIns.length} stand-ins drawn)`);
  const before = aborted;
  m.update(coarse);
  check(aborted - before === 6, `zooming back out stops the ${aborted - before} requests in flight for the finer level`);
  r = m.update(fine);
  while (r.status.loading > 0) { await flush(); r = m.update(fine); }
  check(r.draw.length === fine.length && m.size <= Math.max(40, fine.length) && disposed > 0, `cache holds ${m.size} tiles against a budget of 40 with ${fine.length} on screen; ${disposed} freed`);

  let attempts = 0;
  const off = new TileManager<Fake>({ schemes: SCHEMES, load: () => { attempts++; return Promise.reject(new Error("offline")); }, dispose: () => undefined });
  let o = off.update(fine);
  for (let i = 0; i < 20; i++) { await new Promise((res) => setTimeout(res, 0)); o = off.update(fine); }
  check(o.status.unavailable && o.draw.length === 0 && attempts <= 6, `offline: gives up after ${attempts} failed requests and draws the base only`);

  // One tile failing twice hands its place to its parent.
  const target = fine[0];
  const parentKey = tileKey(EQ.parent(target.tile) as TileId);
  const flaky = new TileManager<Fake>({ schemes: SCHEMES, load: (url) => (url === EQ.url(target.tile) ? Promise.reject(new Error("404")) : Promise.resolve({ url })), dispose: () => undefined });
  let f = flaky.update(fine);
  for (let i = 0; i < 40; i++) { await new Promise((res) => setTimeout(res, 0)); f = flaky.update(fine); }
  check(!f.status.unavailable && f.status.loading === 0 && f.draw.some((d) => d.key === parentKey) && !f.draw.some((d) => d.key === target.key), "a tile that fails twice is replaced by its parent");

  console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
}

main();

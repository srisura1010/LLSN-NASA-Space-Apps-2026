"use client";

// Detail tiles drawn over the Moon globe. Each frame the selector picks the
// tiles the view needs, the manager fetches what is missing, and every loaded
// tile becomes a small patch of sphere just above the whole-globe mesh, printed
// by the same shader with the same uniforms, so shading and map lines agree.

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  SRGBColorSpace,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  type Group,
  type IUniform,
  type PerspectiveCamera,
} from "three";
import { GLOBE_VERT, globeFragment } from "../globeShader";
import { TileManager, type ManagerStatus } from "./manager";
import { SCHEMES, SPLIT_LAT, type TileId } from "./schemes";
import { selectTiles } from "./select";

export type TileStatus = ManagerStatus & { /** The globe is large enough in the view for detail to be drawn. */ active: boolean };

const TILE_FRAG = globeFragment("tile");
const SCHEME_LIST = [SCHEMES.eq, SCHEMES.sp];
/** Quads along each side of a tile's patch. */
const SEGMENTS = 16;
/** Patches sit this far above the unit sphere, and each level a little above the one before, so a parent standing in for a missing tile lies under its loaded neighbours. */
const LIFT = 2e-4;
const LIFT_PER_LEVEL = 3e-5;
/**
 * Gain and offset on the tile's grey before the shared tone curve. Fitted to the whole-globe map between 55° S and
 * 55° N: the LROC WAC mosaic averages 61/255 darker with the same spread.
 */
const TONE = new Vector2(1, 0.24);
/** The polar set is cut at the split latitude; the other never crosses it. */
const SPLIT_Y = Math.sin((SPLIT_LAT * Math.PI) / 180);
const NO_SPLIT = 2;

async function loadTile(url: string, signal: AbortSignal): Promise<Texture> {
  const res = await fetch(url, { signal, mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`Tile ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none" });
  const t = new Texture(bitmap);
  // Row 0 of the image is the tile's top edge, and the patch's v runs down from it.
  t.flipY = false;
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function disposeTile(t: Texture) {
  (t.image as ImageBitmap | null)?.close?.();
  t.dispose();
}

function patch(tile: TileId): BufferGeometry {
  const scheme = SCHEMES[tile.s];
  const n = SEGMENTS + 1;
  const r = 1 + LIFT + LIFT_PER_LEVEL * tile.z + (tile.s === "sp" ? LIFT_PER_LEVEL / 2 : 0);
  const position = new Float32Array(n * n * 3);
  const normal = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const p = scheme.point(tile, i / SEGMENTS, j / SEGMENTS);
      normal.set(p, k * 3);
      position.set([p[0] * r, p[1] * r, p[2] * r], k * 3);
      uv.set([i / SEGMENTS, j / SEGMENTS], k * 2);
    }
  // u runs east and v south in both schemes, so this winding faces outward.
  const index = new Uint16Array(SEGMENTS * SEGMENTS * 6);
  let q = 0;
  for (let j = 0; j < SEGMENTS; j++)
    for (let i = 0; i < SEGMENTS; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      index.set([a, c, b, b, c, d], q);
      q += 6;
    }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(position, 3));
  g.setAttribute("normal", new BufferAttribute(normal, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * The tile patches, as children of the globe's own parent so they turn with it. `globe` is the whole-globe mesh, whose
 * material's uniforms the patches share.
 */
export function TileLayer({ globe, onStatus }: { globe: RefObject<Mesh | null>; onStatus?: (s: TileStatus) => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const group = useRef<Group>(null);
  const meshes = useRef(new Map<string, Mesh>());
  const last = useRef("");
  const manager = useRef<TileManager<Texture> | null>(null);
  const scratch = useMemo(() => ({ inverse: new Matrix4(), clip: new Matrix4(), eye: new Vector3() }), []);

  useEffect(() => {
    const m = new TileManager<Texture>({ schemes: SCHEMES, load: loadTile, dispose: disposeTile, onChange: () => invalidate() });
    manager.current = m;
    const drawn = meshes.current;
    const g = group.current;
    // Back on the network: let the next frame ask again.
    const online = () => {
      m.retry();
      invalidate();
    };
    window.addEventListener("online", online);
    invalidate();
    return () => {
      window.removeEventListener("online", online);
      manager.current = null;
      for (const mesh of drawn.values()) {
        g?.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as ShaderMaterial).dispose();
      }
      drawn.clear();
      m.dispose();
      onStatus?.({ active: false, level: 0, loading: 0, unavailable: false });
      invalidate();
    };
  }, [invalidate, onStatus]);

  useFrame(({ camera, size, viewport }) => {
    const g = group.current;
    const m = manager.current;
    const base = globe.current;
    if (!g || !m || !base) return;
    const cam = camera as PerspectiveCamera;
    cam.updateMatrixWorld();
    g.updateWorldMatrix(true, false);
    scratch.inverse.copy(g.matrixWorld).invert();
    scratch.eye.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(scratch.inverse);
    scratch.clip.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(g.matrixWorld);
    const selection = selectTiles(
      { eye: [scratch.eye.x, scratch.eye.y, scratch.eye.z], clip: scratch.clip.elements, fovY: (cam.fov * Math.PI) / 180, heightPx: size.height * Math.min(viewport.dpr, 2) },
      SCHEME_LIST,
    );
    const { draw, status } = m.update(selection.tiles);

    const shared = (base.material as ShaderMaterial).uniforms;
    const drawn = meshes.current;
    const keep = new Set<string>();
    for (const d of draw) {
      keep.add(d.key);
      if (drawn.has(d.key)) continue;
      const uniforms: Record<string, IUniform> = { ...shared, uTile: { value: d.value }, uTileTone: { value: TONE }, uSplit: { value: d.tile.s === "sp" ? SPLIT_Y : NO_SPLIT } };
      const mesh = new Mesh(patch(d.tile), new ShaderMaterial({ vertexShader: GLOBE_VERT, fragmentShader: TILE_FRAG, uniforms }));
      drawn.set(d.key, mesh);
      g.add(mesh);
    }
    for (const [key, mesh] of drawn) {
      if (keep.has(key)) continue;
      g.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as ShaderMaterial).dispose();
      drawn.delete(key);
    }

    const sig = `${selection.active}|${status.level}|${status.loading}|${status.unavailable}`;
    if (sig !== last.current) {
      last.current = sig;
      onStatus?.({ ...status, active: selection.active });
    }
  });

  return <group ref={group} />;
}

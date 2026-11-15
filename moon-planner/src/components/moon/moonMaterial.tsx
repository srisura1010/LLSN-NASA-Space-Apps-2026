"use client";

// The Moon as a printed relief globe: the shader, its maps and the mesh, shared
// by the Moon level and the System level so the two draw the same body. The
// mesh is a unit sphere in the Moon's body-fixed frame (x through 0° N 0° E,
// y north); the parent places, turns and sizes it.

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { BackSide, Color, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2, Vector3, type Mesh, type PerspectiveCamera, type ShaderMaterial, type Texture } from "three";
import type { Vec3 } from "@/lib/system";
import { RENDER, TOKENS } from "@/lib/tokens";
import { GLOBE_VERT, globeFragment } from "./globeShader";
import { TileLayer, type TileStatus } from "./tiles/TileLayer";

export { PLATE_HALF_KM } from "./globeShader";

const INK = TOKENS.ink;
const PAPER = TOKENS.paper;
const RAD = Math.PI / 180;

/** The 2k colour map and the 1k elevation map come first; the 4k colour map and the fine relief replace and join them when loaded. */
export type Textures = { map: Texture; height: Texture };
export type FineTextures = { map: Texture; detail: Texture };

/** Mipmaps and anisotropic filtering keep the maps sharp towards the limb; the renderer caps the level at what the GPU offers. */
function prepare(t: Texture, colour: boolean) {
  t.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
  t.wrapS = RepeatWrapping;
  t.anisotropy = 16;
  return t;
}

// The maps are kept for the session once loaded, so stepping between the levels does not fetch or decode them again.
let base: Promise<Textures> | null = null;
let fine: Promise<FineTextures> | null = null;

export function loadTextures(): Promise<Textures> {
  if (!base) {
    const loader = new TextureLoader();
    base = Promise.all([loader.loadAsync("/textures/moon_color_2k.jpg"), loader.loadAsync("/textures/moon_height_1k.jpg")]).then(
      ([map, height]) => ({ map: prepare(map, true), height: prepare(height, false) }),
      () => {
        base = null;
        throw new Error("The Moon's colour and height maps did not load.");
      },
    );
  }
  return base;
}

export function loadFineTextures(): Promise<FineTextures> {
  if (!fine) {
    const loader = new TextureLoader();
    fine = Promise.all([loader.loadAsync("/textures/moon_color_4k.jpg"), loader.loadAsync("/textures/moon_relief_4k.jpg")]).then(
      ([map, detail]) => ({ map: prepare(map, true), detail: prepare(detail, false) }),
      (e: unknown) => {
        fine = null;
        throw e;
      },
    );
  }
  return fine;
}

const texelOf = (t: Texture) => {
  const img = t.image as { width: number; height: number };
  return new Vector2(1 / img.width, 1 / img.height);
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Radius in CSS pixels at which a unit sphere is drawn, from its world matrix as it stands now. */
export function screenRadius(mesh: Mesh, camera: PerspectiveCamera, height: number, at: Vector3): number {
  mesh.updateWorldMatrix(true, false);
  at.setFromMatrixPosition(mesh.matrixWorld);
  const r = mesh.matrixWorld.getMaxScaleOnAxis();
  return (r / (Math.max(camera.position.distanceTo(at), 1e-9) * Math.tan((camera.fov * RAD) / 2))) * (height / 2);
}

/** The ink line round a body's limb: a shell seen from inside, kept about one pixel wide at any size. */
export function Rim({ color = INK }: { color?: string }) {
  const shell = useRef<Mesh>(null);
  const at = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const m = shell.current;
    if (!m) return;
    m.scale.setScalar(1);
    const px = screenRadius(m, camera as PerspectiveCamera, size.height, at);
    m.scale.setScalar(1 + 1.1 / Math.max(px, 0.5));
  });
  return (
    <mesh ref={shell}>
      <sphereGeometry args={[1, 128, 64]} />
      <meshBasicMaterial color={color} side={BackSide} toneMapped={false} />
    </mesh>
  );
}

const BASE_FRAG = globeFragment("base");

/** The globe. sunDir is the unit vector to the Sun in the body-fixed scene axes. */
export function MoonGlobe({
  textures,
  fine: sharp,
  sunDir,
  tiles,
}: {
  textures: Textures;
  fine: FineTextures | null;
  sunDir: Vec3;
  /** Detail tiles are loaded over the globe when it is large in the view; leave this out where the Moon is drawn small. */
  tiles?: { onStatus?: (s: TileStatus) => void } | null;
}) {
  const dpr = useThree((s) => s.viewport.dpr);
  const mesh = useRef<Mesh>(null);
  const at = useMemo(() => new Vector3(), []);
  const uniforms = useMemo(
    () => ({
      uMap: { value: null as Texture | null },
      uHeight: { value: null as Texture | null },
      uDetail: { value: null as Texture | null },
      uHasDetail: { value: 0 },
      uBaseTexel: { value: new Vector2(1 / 1024, 1 / 512) },
      uDetailTexel: { value: new Vector2(1 / 4096, 1 / 2048) },
      uRelief: { value: 2.6 },
      uPx: { value: 1 },
      uLines: { value: 1 },
      uDash: { value: 1 },
      uSunDir: { value: new Vector3(1, 0, 0) },
      uDayLo: { value: new Color(RENDER.moonDayLo) },
      uDayHi: { value: new Color(RENDER.moonDayHi) },
      uNightLo: { value: new Color(RENDER.moonNightLo) },
      uNightHi: { value: new Color(RENDER.moonNightHi) },
      uInk: { value: new Color(INK) },
      uPaper: { value: new Color(PAPER) },
    }),
    [],
  );
  const baseTexel = useMemo(() => texelOf(textures.height), [textures.height]);
  const detailTexel = useMemo(() => (sharp ? texelOf(sharp.detail) : null), [sharp]);
  // The map lines are one pixel wide at any size, so on a small disc they would cover it: they fade out below about 100 px of radius.
  useFrame(({ camera, size }) => {
    const m = mesh.current;
    if (!m) return;
    const px = screenRadius(m, camera as PerspectiveCamera, size.height, at);
    const u = (m.material as ShaderMaterial).uniforms;
    u.uLines.value = smooth(40, 110, px);
    u.uDash.value = smooth(14, 40, px);
  });
  return (
    <>
      <mesh ref={mesh}>
        <sphereGeometry args={[1, 192, 96]} />
        <shaderMaterial
          vertexShader={GLOBE_VERT}
          fragmentShader={BASE_FRAG}
          uniforms={uniforms}
          uniforms-uMap-value={sharp?.map ?? textures.map}
          uniforms-uHeight-value={textures.height}
          uniforms-uDetail-value={sharp?.detail ?? textures.height}
          uniforms-uHasDetail-value={sharp ? 1 : 0}
          uniforms-uBaseTexel-value={baseTexel}
          uniforms-uDetailTexel-value={detailTexel ?? baseTexel}
          uniforms-uPx-value={dpr}
          uniforms-uSunDir-value={sunDir}
        />
      </mesh>
      {tiles && <TileLayer globe={mesh} onStatus={tiles.onStatus} />}
      <Rim />
    </>
  );
}

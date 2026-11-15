"use client";

// The Moon as a printed relief globe: the shader, its maps and the mesh, shared
// by the Moon level and the System level so the two draw the same body. The
// mesh is a unit sphere in the Moon's body-fixed frame (x through 0° N 0° E,
// y north); the parent places, turns and sizes it.

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { BackSide, Color, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2, Vector3, type Mesh, type PerspectiveCamera, type ShaderMaterial, type Texture } from "three";
import { MOON_RADIUS_KM, type Vec3 } from "@/lib/system";

const INK = "#121a22";
const PAPER = "#eef1f0";
const RAD = Math.PI / 180;

/** Half-width of the site-level terrain plate, km on the polar stereographic plane; its inscribed circle is 80° S. */
export const PLATE_HALF_KM = 304;

// How scripts/build-moon-textures.py packs elevation into the two 8-bit maps, in km.
const BASE_RANGE_KM = 20.5;
const DETAIL_RANGE_KM = 3;

const GLOBE_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vP;
  varying vec3 vViewN;
  varying vec3 vViewP;
  void main() {
    vUv = uv;
    vP = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewN = normalMatrix * normal;
    vViewP = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
// Grey relief print. Albedo sets the tone from mare grey to highland paper;
// slopes from the elevation maps are shaded by the real Sun, strongest near
// the terminator as on the Moon itself; past a thin penumbra band the night
// side is umbra slate with faint relief. Every map line is drawn here, one
// pixel wide at any zoom, so none can z-fight or show through the limb: the
// 30-degree graticule (light), the equator and prime meridian (full ink), the
// terminator (dashed), and the site-level plate with its 80 S circle (cased).
const GLOBE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uHeight;
  uniform sampler2D uDetail;
  uniform float uHasDetail;
  uniform vec2 uBaseTexel;
  uniform vec2 uDetailTexel;
  uniform float uRelief;
  uniform float uPx;
  uniform float uLines;
  uniform float uDash;
  uniform vec3 uSunDir;
  uniform vec3 uDayLo;
  uniform vec3 uDayHi;
  uniform vec3 uNightLo;
  uniform vec3 uNightHi;
  uniform vec3 uInk;
  uniform vec3 uPaper;
  varying vec2 vUv;
  varying vec3 vP;
  varying vec3 vViewN;
  varying vec3 vViewP;

  const float PI = 3.14159265;
  const float R_KM = ${MOON_RADIUS_KM.toFixed(1)};

  // Rise over run towards the east and the north. The east step widens with latitude so it spans the same ground everywhere.
  vec2 slopeOf(sampler2D t, vec2 texel, float rangeKm, float cl) {
    float du = min(texel.x / cl, 0.02);
    float dv = texel.y;
    float hE = texture2D(t, vUv + vec2(du, 0.0)).r - texture2D(t, vUv - vec2(du, 0.0)).r;
    float hN = texture2D(t, vUv + vec2(0.0, dv)).r - texture2D(t, vUv - vec2(0.0, dv)).r;
    return rangeKm * vec2(hE / (4.0 * PI * du * cl * R_KM), hN / (2.0 * PI * dv * R_KM));
  }

  // Coverage of a line whose centre is d away, where w is the change of d across one device pixel; hw is the half-width in CSS pixels.
  float stroke(float d, float w, float hw) {
    return 1.0 - smoothstep(hw - 0.5, hw + 0.5, d / max(w * uPx, 1e-7));
  }

  void main() {
    vec3 n = normalize(vP);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(-n.z, n.x);
    float cl = max(cos(lat), 0.04);
    vec3 east = vec3(-sin(lon), 0.0, -cos(lon));
    vec3 north = cross(n, east);
    vec2 s = slopeOf(uHeight, uBaseTexel, ${BASE_RANGE_KM.toFixed(1)}, cl);
    if (uHasDetail > 0.5) s += slopeOf(uDetail, uDetailTexel, ${DETAIL_RANGE_KM.toFixed(1)}, cl);
    vec3 bn = normalize(n - uRelief * (s.x * east + s.y * north));

    float geo = dot(n, uSunDir);
    float ndl = dot(bn, uSunDir);
    float lit = smoothstep(-0.006, 0.018, geo);
    // Brightness of a slope relative to level ground under the same Sun.
    float relief = clamp((ndl - geo) / (max(geo, 0.0) + 0.22), -1.0, 1.0);
    float fall = mix(0.72, 1.0, sqrt(clamp(geo, 0.0, 1.0)));
    float v = fall * (1.0 + 0.62 * relief);

    float tone = sqrt(dot(texture2D(uMap, vUv).rgb, vec3(0.2126, 0.7152, 0.0722)));
    tone = smoothstep(0.17, 0.8, tone);
    vec3 night = mix(uNightLo, uNightHi, tone) * (1.0 + 0.26 * clamp((ndl - geo) * 2.5, -1.0, 1.0));
    vec3 day = mix(night, mix(uDayLo, uDayHi, tone), clamp(v, 0.0, 1.0)) * (1.0 + 0.3 * max(v - 1.0, 0.0));
    vec3 col = mix(night, day, lit);

    // Slight limb darkening, so the globe keeps its edge against the paper.
    float ndv = dot(normalize(vViewN), normalize(-vViewP));
    col *= mix(0.86, 1.0, smoothstep(0.0, 0.5, ndv));

    vec3 lineCol = mix(uPaper, uInk, lit);
    float latDeg = degrees(lat);
    float lonDeg = degrees(lon);
    float g = stroke(abs(fract(latDeg / 30.0 + 0.5) - 0.5) * 30.0, fwidth(latDeg), 0.5) * step(abs(latDeg), 75.0);
    g = max(g, stroke(abs(fract(lonDeg / 30.0 + 0.5) - 0.5) * 30.0, fwidth(lonDeg), 0.5) * (1.0 - smoothstep(80.0, 84.0, abs(latDeg))));
    col = mix(col, lineCol, g * 0.3 * uLines);

    float major = max(stroke(abs(n.y), fwidth(n.y), 0.6), stroke(abs(n.z), fwidth(n.z), 0.6) * step(0.0, n.x));
    col = mix(col, lineCol, major * mix(0.4, 0.92, lit) * uLines);

    // The terminator, dashed every 2.5 degrees around the Sun's axis.
    vec3 tu = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
    vec3 tv = cross(uSunDir, tu);
    float dash = step(fract(atan(dot(n, tv), dot(n, tu)) * 72.0 / PI), 0.62);
    col = mix(col, uInk, stroke(abs(geo), fwidth(geo), 0.6) * dash * 0.92 * uDash);

    // The site-level plate (a square on the south polar stereographic plane) and the 80 S circle inscribed in it.
    if (n.y < -0.9) {
      float c80 = abs(n.y + ${Math.sin(80 * (Math.PI / 180)).toFixed(6)});
      vec2 st = 2.0 * R_KM * vec2(-n.z, n.x) / (1.0 - n.y);
      float sq = abs(max(abs(st.x), abs(st.y)) - ${PLATE_HALF_KM.toFixed(1)});
      float wc = fwidth(n.y);
      float ws = fwidth(max(abs(st.x), abs(st.y)));
      col = mix(col, uPaper, max(stroke(c80, wc, 1.9), stroke(sq, ws, 1.9)) * 0.9 * uLines);
      col = mix(col, uInk, max(stroke(c80, wc, 0.6), stroke(sq, ws, 0.6)) * uLines);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

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

/** The globe. sunDir is the unit vector to the Sun in the body-fixed scene axes. */
export function MoonGlobe({ textures, fine: sharp, sunDir }: { textures: Textures; fine: FineTextures | null; sunDir: Vec3 }) {
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
      uDayLo: { value: new Color("#5b676d") },
      uDayHi: { value: new Color("#f4f5f3") },
      uNightLo: { value: new Color("#2e4455") },
      uNightHi: { value: new Color("#496174") },
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
          fragmentShader={GLOBE_FRAG}
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
      <Rim />
    </>
  );
}

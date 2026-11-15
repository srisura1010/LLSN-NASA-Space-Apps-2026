"use client";

// Earth as a printed globe in the Moon globe's language: NASA's Blue Marble
// reduced to a cobalt sea, land in desaturated relief and an ink coastline,
// shaded by the real Sun with a crisp terminator and the same map lines. The
// mesh is a unit sphere in the Earth-fixed frame (x through 0° N 0° E, y
// north); the parent places, turns and sizes it. Also here: the marks drawn
// on Earth for launch sites.

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { Color, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, TextureLoader, Vector3, type Mesh, type PerspectiveCamera, type ShaderMaterial, type Texture } from "three";
import { alongAzimuth } from "@/lib/earthFrame";
import type { Vec3 } from "@/lib/system";
import { GLOBE_VERT } from "../moon/globeShader";
import { Cased, Flag, HIT, LABEL_TEXT, LIFT, toScene } from "../moon/marks";
import { Rim, screenRadius } from "../moon/moonMaterial";

const INK = "#121a22";
const PAPER = "#eef1f0";

/** What the System level needs to know of a launch site; src/lib/launchSites.ts's LaunchSite satisfies it. */
export type LaunchSiteMark = {
  id: string;
  name: string;
  group: "us" | "nasa-partner" | "us-partner";
  lat: number;
  lon: number;
  /** Allowed launch azimuths, degrees clockwise from north, as [from, to] pairs. */
  azimuthRanges?: [number, number][];
};

// ---------- Maps ----------

function prepare(t: Texture) {
  // The shader reads the picture's own values to tell sea from land, and prints its own colours.
  t.colorSpace = NoColorSpace;
  t.wrapS = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 16;
  return t;
}

// Kept for the session once loaded, like the Moon's maps.
let base: Promise<Texture> | null = null;
let fine: Promise<Texture> | null = null;

/** The 2k map, for first paint. */
export function loadEarthTexture(): Promise<Texture> {
  base ??= new TextureLoader().loadAsync("/textures/earth_color_2k.jpg").then(prepare, (e: unknown) => {
    base = null;
    throw e;
  });
  return base;
}

/** The 4k map, which replaces the 2k one when it has loaded. */
export function loadFineEarthTexture(): Promise<Texture> {
  fine ??= new TextureLoader().loadAsync("/textures/earth_color_4k.jpg").then(prepare, (e: unknown) => {
    fine = null;
    throw e;
  });
  return fine;
}

// ---------- Globe ----------

// Sea is told from land by blue over red in the Blue Marble picture (ice and desert have none, deep water the most).
// Land keeps the picture's lightness as a grey relief; the sea is flat cobalt, a little lighter over the shelves. The
// coastline is the contour of that sea mask, one pixel wide. Night is umbra slate, land a step lighter than sea.
const EARTH_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDir;
  uniform vec3 uSea;
  uniform vec3 uSeaNight;
  uniform vec3 uLandLo;
  uniform vec3 uLandHi;
  uniform vec3 uLandNight;
  uniform vec3 uInk;
  uniform vec3 uPaper;
  uniform float uPx;
  uniform float uLines;
  uniform float uCoast;
  varying vec2 vUv;
  varying vec3 vP;
  varying vec3 vViewN;
  varying vec3 vViewP;
  float stroke(float d, float w, float hw) {
    return 1.0 - smoothstep(hw - 0.5, hw + 0.5, d / max(w * uPx, 1e-7));
  }
  void main() {
    vec3 n = normalize(vP);
    vec3 t = texture2D(uMap, vUv).rgb;
    // The mask is read one mip level down, which evens out the picture's JPEG blocks along the coast.
    vec3 soft = texture2D(uMap, vUv, 1.0).rgb;
    float sea = smoothstep(0.03, 0.07, soft.b - soft.r);
    float lum = dot(t, vec3(0.3, 0.59, 0.11));
    vec3 land = mix(uLandLo, uLandHi, smoothstep(0.04, 0.8, lum));
    vec3 water = uSea * mix(0.94, 1.12, smoothstep(0.1, 0.4, lum));
    float geo = dot(n, uSunDir);
    float lit = smoothstep(-0.012, 0.012, geo);
    vec3 day = mix(land, water, sea) * mix(0.86, 1.0, sqrt(clamp(geo, 0.0, 1.0)));
    vec3 col = mix(mix(uLandNight, uSeaNight, sea), day, lit);
    float coast = (1.0 - smoothstep(0.6, 1.4, abs(sea - 0.5) / max(fwidth(sea) * uPx, 1e-5))) * step(1e-4, fwidth(sea));
    col = mix(col, uInk, coast * uCoast * mix(0.55, 0.8, lit));
    col *= mix(0.88, 1.0, smoothstep(0.0, 0.5, dot(normalize(vViewN), normalize(-vViewP))));
    // Map lines: paper on the sea and the night side, ink on lit land.
    vec3 line = mix(uInk, uPaper, max(sea, 1.0 - lit));
    float latDeg = degrees(asin(clamp(n.y, -1.0, 1.0)));
    float lonDeg = degrees(atan(-n.z, n.x));
    float g = stroke(abs(fract(latDeg / 30.0 + 0.5) - 0.5) * 30.0, fwidth(latDeg), 0.5) * step(abs(latDeg), 75.0);
    g = max(g, stroke(abs(fract(lonDeg / 30.0 + 0.5) - 0.5) * 30.0, fwidth(lonDeg), 0.5) * (1.0 - smoothstep(80.0, 84.0, abs(latDeg))));
    col = mix(col, line, g * 0.3 * uLines);
    float major = max(stroke(abs(n.y), fwidth(n.y), 0.6), stroke(abs(n.z), fwidth(n.z), 0.6) * step(0.0, n.x));
    col = mix(col, line, major * 0.8 * uLines);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The globe. sunDir is the unit vector to the Sun in the Earth-fixed scene axes. */
export function EarthGlobe({ map, sunDir }: { map: Texture; sunDir: Vec3 }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const mesh = useRef<Mesh>(null);
  const at = useMemo(() => new Vector3(), []);
  const uniforms = useMemo(
    () => ({
      uMap: { value: null as Texture | null },
      uSunDir: { value: new Vector3(1, 0, 0) },
      uSea: { value: new Color("#2453c2") },
      uSeaNight: { value: new Color("#273a52") },
      uLandLo: { value: new Color("#8d9897") },
      uLandHi: { value: new Color("#f1f3f1") },
      uLandNight: { value: new Color("#3d5466") },
      uInk: { value: new Color(INK) },
      uPaper: { value: new Color(PAPER) },
      uPx: { value: 1 },
      uLines: { value: 0 },
      uCoast: { value: 0 },
    }),
    [],
  );
  // One-pixel lines would cover a small disc: the graticule and then the coastline fade out as it shrinks.
  useFrame(({ camera, size }) => {
    const m = mesh.current;
    if (!m) return;
    const px = screenRadius(m, camera as PerspectiveCamera, size.height, at);
    const u = (m.material as ShaderMaterial).uniforms;
    u.uLines.value = smooth(30, 90, px);
    u.uCoast.value = smooth(70, 170, px);
  });
  return (
    <>
      <mesh ref={mesh}>
        <sphereGeometry args={[1, 192, 96]} />
        <shaderMaterial vertexShader={GLOBE_VERT} fragmentShader={EARTH_FRAG} uniforms={uniforms} uniforms-uMap-value={map} uniforms-uSunDir-value={sunDir} uniforms-uPx-value={dpr} />
      </mesh>
      <Rim />
    </>
  );
}

// ---------- Launch sites ----------

/** A geographic point in the Earth-fixed scene axes, in Earth radii. */
export const onEarth = (lat: number, lon: number, k = 1): Vec3 => toScene(alongAzimuth(lat, lon, 0, 0), k);

/** Angular length of the azimuth fan drawn at the selected site, radians of arc on the ground (about 1,300 km). */
export const FAN_REACH = 0.2;

/**
 * The allowed launch azimuths at a site, drawn on the ground: for each range the two bounding great-circle headings
 * and the arc joining them, with a thin line due north for reference. Drawn in Earth radii in the Earth-fixed axes.
 */
export function AzimuthFan({ site, reach = FAN_REACH }: { site: LaunchSiteMark; reach?: number }) {
  const { fans, north } = useMemo(() => {
    const at = (az: number, a: number) => toScene(alongAzimuth(site.lat, site.lon, az, a), LIFT);
    const fans = (site.azimuthRanges ?? []).map(([from, to]) => {
      const end = to < from ? to + 360 : to;
      const pts: Vec3[] = [];
      const edge = (az: number, out: boolean) => {
        for (let i = 0; i <= 6; i++) pts.push(at(az, reach * (out ? i / 6 : 1 - i / 6)));
      };
      edge(from, true);
      const steps = Math.max(2, Math.ceil((end - from) / 4));
      for (let i = 1; i < steps; i++) pts.push(at(from + ((end - from) * i) / steps, reach));
      edge(end, false);
      return pts;
    });
    const north: Vec3[] = [];
    for (let i = 0; i <= 6; i++) north.push(at(0, (reach * 1.15 * i) / 6));
    return { fans, north };
  }, [site, reach]);
  return (
    <>
      <Line points={north} color={PAPER} lineWidth={3} renderOrder={1} />
      <Line points={north} color={INK} lineWidth={1} renderOrder={2} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-6} />
      {fans.map((pts, i) => (
        <Cased key={i} points={pts} color={INK} casing={PAPER} />
      ))}
    </>
  );
}

const GROUP_MARK: Record<LaunchSiteMark["group"], string> = {
  us: "size-[9px] border border-paper bg-ink",
  "nasa-partner": "size-[9px] border-[1.5px] border-ink bg-paper",
  "us-partner": "size-[8px] rotate-45 border-[1.5px] border-ink bg-paper",
};
export const GROUP_NAMES: Record<LaunchSiteMark["group"], string> = {
  us: "United States launch site",
  "nasa-partner": "NASA partner agency launch site",
  "us-partner": "Launch site in a US partner country",
};

/** A launch site on Earth: its mark by group, a button when it can be chosen, and its name (a flag when selected). */
export function LaunchSiteTag({ site, selected, named, onSelect }: { site: LaunchSiteMark; selected: boolean; named: boolean; onSelect?: () => void }) {
  const mark = <span className={`block ${GROUP_MARK[site.group]}`} />;
  return (
    <div className="relative">
      {selected ? (
        <Flag text={site.name} />
      ) : (
        named && (
          <span data-box aria-hidden="true" className={`absolute top-0 left-0 block bg-paper/90 px-1 text-ink ${LABEL_TEXT}`}>
            {site.name}
          </span>
        )
      )}
      {onSelect ? (
        <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={`${site.name}, ${GROUP_NAMES[site.group].toLowerCase()}`} title={site.name} className={HIT}>
          {mark}
        </button>
      ) : (
        <span aria-hidden="true" className="absolute top-0 left-0 grid size-0 place-items-center">
          {mark}
        </span>
      )}
    </div>
  );
}

/** Where a body is overhead: a ring on the ground with its name. */
export function OverheadTag({ text, className }: { text: string; className: string }) {
  return (
    <div aria-hidden="true" className="relative">
      <span className={`absolute -top-[5px] -left-[5px] block size-[10px] rounded-full border-[1.5px] ${className}`} />
      <span data-box className={`absolute top-0 left-0 block bg-paper/90 px-1 text-ink ${LABEL_TEXT}`}>
        {text}
      </span>
    </div>
  );
}

/** Legend entries for the launch-site marks. */
export function LaunchLegend({ item }: { item: string }) {
  return (
    <>
      {(Object.keys(GROUP_MARK) as LaunchSiteMark["group"][]).map((g) => (
        <li key={g} className={item}>
          <span className="grid w-4 shrink-0 place-items-center">
            <span className={`block ${GROUP_MARK[g]}`} />
          </span>
          {GROUP_NAMES[g]}
        </li>
      ))}
      <li className={item}>
        <span className="grid w-4 shrink-0 place-items-center">
          <span className="block size-[10px] rounded-full border-[1.5px] border-ink bg-paper" />
        </span>
        Where the Moon or the Sun is overhead on Earth
      </li>
      <li className={item}>
        <span className="block h-[5px] w-4 shrink-0 border border-paper bg-ink outline outline-1 outline-rule" />
        At the selected launch site: the allowed launch azimuths, with a line due north
      </li>
    </>
  );
}

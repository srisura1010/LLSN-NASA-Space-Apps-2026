"use client";

// Moon level: the whole Moon as a printed relief globe, turned by the
// IAU/WGCCRE rotation model and lit from the Sun's real direction. It sits
// between the System level and the site-level terrain plate.

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { BackSide, Color, NoColorSpace, Quaternion, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2, Vector3, type Group, type Texture } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { elevationDeg, latLonToBody, moonFrameAt, type MoonFrame } from "@/lib/moonFrame";
import { sites, type Site } from "@/lib/sites";
import { EARTH_RADIUS_KM, MOON_RADIUS_KM, loadSystem, stateAt, systemEndMs, type SystemData, type SystemState, type Vec3 } from "@/lib/system";
import YearSlider, { fmtUtc, useYearPlayback } from "../system/YearSlider";
import { ZoomHint } from "../levels/LevelNav";
import { useZoomGate } from "../levels/useZoomGate";

export type MoonViewProps = {
  nowMs: number;
  onScrub?: (ms: number) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Zooming in past the limit over the south polar cap steps down to the terrain plate. */
  onOpenSite?: () => void;
  /** Zooming out past the limit steps up to the Earth–Moon framing of the System level. */
  onOpenSystem?: () => void;
  /** How the view was reached by zoom: "above" opens far out, "below" opens close in on the south pole. */
  entry?: "above" | "below" | null;
  /** The level indicator and step buttons, shown with the view's controls. */
  levelNav?: ReactNode;
  /** The mission window, marked on the year rail. */
  windowMs?: { startMs: number; endMs: number };
  className?: string;
};

const INK = "#121a22";
const PAPER = "#eef1f0";
const SUN = "#f0b400";
const SUN_INK = "#7a5600";
const EARTH = "#2453c2";

/** Half-width of the site-level terrain plate, km on the polar stereographic plane; its inscribed circle is 80° S. */
const PLATE_HALF_KM = 304;

/**
 * Earlier landings, shown for context. Apollo lunar module positions from the NASA NSSDCA table of lunar landing
 * sites; the 2023 and 2024 landers as located in Lunar Reconnaissance Orbiter Camera images.
 */
const LANDINGS: { id: string; short: string; name: string; lat: number; lon: number; year: number; left?: boolean }[] = [
  { id: "apollo-11", short: "A11", name: "Apollo 11", lat: 0.6742, lon: 23.4731, year: 1969 },
  { id: "apollo-12", short: "A12", name: "Apollo 12", lat: -3.0128, lon: -23.4219, year: 1969, left: true },
  { id: "apollo-14", short: "A14", name: "Apollo 14", lat: -3.6459, lon: -17.4719, year: 1971 },
  { id: "apollo-15", short: "A15", name: "Apollo 15", lat: 26.1324, lon: 3.6333, year: 1971 },
  { id: "apollo-16", short: "A16", name: "Apollo 16", lat: -8.9734, lon: 15.5011, year: 1972, left: true },
  { id: "apollo-17", short: "A17", name: "Apollo 17", lat: 20.1911, lon: 30.7723, year: 1972 },
  { id: "chandrayaan-3", short: "CY-3", name: "Chandrayaan-3", lat: -69.3741, lon: 32.32, year: 2023 },
  { id: "slim", short: "SLIM", name: "SLIM", lat: -13.316, lon: 25.251, year: 2024 },
  { id: "im-1", short: "IM-1", name: "IM-1 Odysseus", lat: -80.13, lon: 1.44, year: 2024 },
  { id: "change-6", short: "CE-6", name: "Chang'e 6", lat: -41.6385, lon: -153.9852, year: 2024 },
];

const RAD = Math.PI / 180;
/** Body-fixed x, y, z (x through 0° N 0° E, z north) to scene axes with north up, matching three's sphere UVs. */
const toScene = (v: Vec3, k = 1): Vec3 => [v[0] * k, v[2] * k, -v[1] * k];
const onGlobe = (lat: number, lon: number, k = 1): Vec3 => toScene(latLonToBody(lat, lon), k);

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtSigned = (n: number, digits = 2) => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(digits)}°`;
const fmtLat = (v: number, digits = 2) => `${Math.abs(v).toFixed(digits)}° ${v < 0 ? "S" : "N"}`;
const fmtLon = (v: number, digits = 2) => `${Math.abs(v).toFixed(digits)}° ${v < 0 ? "W" : "E"}`;

// ---------- Globe ----------

// How scripts/build-moon-textures.py packs elevation into the two 8-bit maps, in km.
const BASE_RANGE_KM = 20.5;
const DETAIL_RANGE_KM = 3;

const GLOBE_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vP;
  void main() {
    vUv = uv;
    vP = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
  uniform vec3 uSunDir;
  uniform vec3 uDayLo;
  uniform vec3 uDayHi;
  uniform vec3 uNightLo;
  uniform vec3 uNightHi;
  uniform vec3 uInk;
  uniform vec3 uPaper;
  varying vec2 vUv;
  varying vec3 vP;

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
    float ndv = dot(n, normalize(cameraPosition - vP));
    col *= mix(0.86, 1.0, smoothstep(0.0, 0.5, ndv));

    vec3 lineCol = mix(uPaper, uInk, lit);
    float latDeg = degrees(lat);
    float lonDeg = degrees(lon);
    float g = stroke(abs(fract(latDeg / 30.0 + 0.5) - 0.5) * 30.0, fwidth(latDeg), 0.5) * step(abs(latDeg), 75.0);
    g = max(g, stroke(abs(fract(lonDeg / 30.0 + 0.5) - 0.5) * 30.0, fwidth(lonDeg), 0.5) * (1.0 - smoothstep(80.0, 84.0, abs(latDeg))));
    col = mix(col, lineCol, g * 0.3);

    float major = max(stroke(abs(n.y), fwidth(n.y), 0.6), stroke(abs(n.z), fwidth(n.z), 0.6) * step(0.0, n.x));
    col = mix(col, lineCol, major * mix(0.4, 0.92, lit));

    // The terminator, dashed every 2.5 degrees around the Sun's axis.
    vec3 tu = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
    vec3 tv = cross(uSunDir, tu);
    float dash = step(fract(atan(dot(n, tv), dot(n, tu)) * 72.0 / PI), 0.62);
    col = mix(col, uInk, stroke(abs(geo), fwidth(geo), 0.6) * dash * 0.92);

    // The site-level plate (a square on the south polar stereographic plane) and the 80 S circle inscribed in it.
    if (n.y < -0.9) {
      float c80 = abs(n.y + ${Math.sin(80 * (Math.PI / 180)).toFixed(6)});
      vec2 st = 2.0 * R_KM * vec2(-n.z, n.x) / (1.0 - n.y);
      float sq = abs(max(abs(st.x), abs(st.y)) - ${PLATE_HALF_KM.toFixed(1)});
      float wc = fwidth(n.y);
      float ws = fwidth(max(abs(st.x), abs(st.y)));
      col = mix(col, uPaper, max(stroke(c80, wc, 1.9), stroke(sq, ws, 1.9)) * 0.9);
      col = mix(col, uInk, max(stroke(c80, wc, 0.6), stroke(sq, ws, 0.6)));
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** The 2k colour map and the 1k elevation map come first; the 4k colour map and the fine relief replace and join them when loaded. */
type Textures = { map: Texture; height: Texture };
type FineTextures = { map: Texture; detail: Texture };

const texelOf = (t: Texture) => {
  const img = t.image as { width: number; height: number };
  return new Vector2(1 / img.width, 1 / img.height);
};

function Globe({ textures, fine, sunDir }: { textures: Textures; fine: FineTextures | null; sunDir: Vec3 }) {
  const dpr = useThree((s) => s.viewport.dpr);
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
  const detailTexel = useMemo(() => (fine ? texelOf(fine.detail) : null), [fine]);
  return (
    <>
      <mesh>
        <sphereGeometry args={[1, 192, 96]} />
        <shaderMaterial
          vertexShader={GLOBE_VERT}
          fragmentShader={GLOBE_FRAG}
          uniforms={uniforms}
          uniforms-uMap-value={fine?.map ?? textures.map}
          uniforms-uHeight-value={textures.height}
          uniforms-uDetail-value={fine?.detail ?? textures.height}
          uniforms-uHasDetail-value={fine ? 1 : 0}
          uniforms-uBaseTexel-value={baseTexel}
          uniforms-uDetailTexel-value={detailTexel ?? baseTexel}
          uniforms-uPx-value={dpr}
          uniforms-uSunDir-value={sunDir}
        />
      </mesh>
      <mesh scale={1.006}>
        <sphereGeometry args={[1, 128, 64]} />
        <meshBasicMaterial color={INK} side={BackSide} toneMapped={false} />
      </mesh>
    </>
  );
}

// ---------- Lines to the Sun and Earth ----------

/** A coloured line over a casing, so it reads on paper, on the lit side and on the night side. Widths are screen pixels. */
/** Draws a line over its own casing: the two share a depth, so the upper one is pulled towards the camera. */
const OVER = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 };

function Cased({ points, color, casing, dash = 0 }: { points: Vec3[]; color: string; casing: string; dash?: number }) {
  const dashed = dash > 0 ? { dashed: true, dashSize: dash, gapSize: dash * 0.7 } : null;
  return (
    <>
      <Line points={points} color={casing} lineWidth={3.5} renderOrder={1} {...dashed} />
      <Line points={points} color={color} lineWidth={1.75} renderOrder={2} {...OVER} {...dashed} />
    </>
  );
}

const UP = new Vector3(0, 1, 0);
/** Length of the lines to the Sun and Earth, in Moon radii from the centre; their labels sit beside the arrowheads. */
const RAY = 1.13;

/** The line from the Moon's centre through the point where the body is overhead, out past the limb, with an arrowhead of constant screen size. */
function Ray({ dir, color, casing }: { dir: Vec3; color: string; casing: string }) {
  const head = useRef<Group>(null);
  const tip = useMemo(() => new Vector3(dir[0] * RAY, dir[1] * RAY, dir[2] * RAY), [dir]);
  const quaternion = useMemo(() => new Quaternion().setFromUnitVectors(UP, new Vector3(...dir)), [dir]);
  const points = useMemo<Vec3[]>(() => [[0, 0, 0], [tip.x, tip.y, tip.z]], [tip]);
  useFrame(({ camera, size }) => {
    // World units per CSS pixel at the tip, for a 30-degree field of view.
    head.current?.scale.setScalar((camera.position.distanceTo(tip) * 2 * Math.tan(15 * RAD)) / size.height);
  });
  return (
    <>
      <Cased points={points} color={color} casing={casing} />
      <group ref={head} position={tip} quaternion={quaternion}>
        <mesh position={[0, 4.5, 0]} renderOrder={1}>
          <coneGeometry args={[5.5, 14, 20]} />
          <meshBasicMaterial color={casing} side={BackSide} toneMapped={false} />
        </mesh>
        <mesh position={[0, 4.5, 0]} renderOrder={2}>
          <coneGeometry args={[3.5, 10, 20]} />
          <meshBasicMaterial color={color} toneMapped={false} {...OVER} />
        </mesh>
      </group>
    </>
  );
}

const LIFT = 1.003;

/** Points of the great-circle arc from a surface point towards a direction, between two angles in radians; null when the direction is overhead. */
function arcTowards(from: Vec3, towards: Vec3): ((a: number) => Vec3) | null {
  const d = from[0] * towards[0] + from[1] * towards[1] + from[2] * towards[2];
  const t: Vec3 = [towards[0] - d * from[0], towards[1] - d * from[1], towards[2] - d * from[2]];
  const l = Math.hypot(t[0], t[1], t[2]);
  if (l < 1e-3) return null;
  return (a) => {
    const c = Math.cos(a) * LIFT;
    const s = (Math.sin(a) * LIFT) / l;
    return [from[0] * c + t[0] * s, from[1] * c + t[1] * s, from[2] * c + t[2] * s];
  };
}

/** A short bearing line on the surface from the selected region towards the Sun or Earth, ending in an open arrowhead; dashed while the body is below the horizon. */
function Bearing({ from, towards, len, color, casing, below }: { from: Vec3; towards: Vec3; len: number; color: string; casing: string; below: boolean }) {
  const { shaft, head } = useMemo(() => {
    const at = arcTowards(from, towards);
    if (!at) return { shaft: null, head: null };
    const shaft: Vec3[] = [];
    for (let i = 0; i <= 10; i++) shaft.push(at(len * (0.2 + 0.8 * (i / 10))));
    const tip = at(len);
    const back = at(len * 0.84);
    const side: Vec3 = [tip[1] * back[2] - tip[2] * back[1], tip[2] * back[0] - tip[0] * back[2], tip[0] * back[1] - tip[1] * back[0]];
    const k = (len * 0.075) / Math.hypot(side[0], side[1], side[2]);
    const wing = (sign: number): Vec3 => [back[0] + side[0] * k * sign, back[1] + side[1] * k * sign, back[2] + side[2] * k * sign];
    return { shaft, head: [wing(1), tip, wing(-1)] };
  }, [from, towards, len]);
  if (!shaft || !head) return null;
  return (
    <>
      <Cased points={shaft} color={color} casing={casing} dash={below ? len * 0.07 : 0} />
      <Cased points={head} color={color} casing={casing} />
    </>
  );
}

/** A region's USGS outline draped on the sphere. */
function Outline({ points, selected }: { points: Vec3[]; selected: boolean }) {
  return (
    <>
      <Line points={points} color={PAPER} lineWidth={selected ? 5 : 3.5} renderOrder={1} />
      <Line points={points} color={INK} lineWidth={selected ? 2.5 : 1.25} renderOrder={2} {...OVER} />
    </>
  );
}

type RegionOutline = { id: string; code: string; points: Vec3[] };

/** The nine outlines from the USGS release, each edge subdivided so it follows the sphere. */
async function loadOutlines(): Promise<RegionOutline[]> {
  type Feature = { id?: string; properties?: { id?: string; code?: string }; geometry?: { type?: string; coordinates?: number[][][] } };
  const res = await fetch("/data/artemis3-regions.geojson");
  if (!res.ok) throw new Error("The region outlines did not load.");
  const json = (await res.json()) as { features?: Feature[] };
  const out: RegionOutline[] = [];
  for (const f of json.features ?? []) {
    const id = f.properties?.id ?? f.id;
    const ring = f.geometry?.type === "Polygon" ? f.geometry.coordinates?.[0] : undefined;
    if (!id || !ring || ring.length < 4) continue;
    const points: Vec3[] = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const a = onGlobe(ring[i][1], ring[i][0]);
      const b = onGlobe(ring[i + 1][1], ring[i + 1][0]);
      for (let j = 0; j < 6; j++) {
        const f1 = j / 6;
        const p: Vec3 = [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1, a[2] + (b[2] - a[2]) * f1];
        const k = LIFT / Math.hypot(p[0], p[1], p[2]);
        points.push([p[0] * k, p[1] * k, p[2] * k]);
      }
    }
    points.push(points[0]);
    out.push({ id, code: f.properties?.code ?? "", points });
  }
  return out;
}

// ---------- Labels ----------

// Labels and marks are plain DOM over the canvas. The scene projects their
// anchor points each frame, hides the ones behind the globe, sets the region
// names out in two columns, and then places the rest in priority order: text
// that would overlap text or a mark already placed is hidden, after trying
// its other positions.

type Label = {
  key: string;
  at: Vec3;
  node: ReactNode;
  /** 0 is always shown; lower numbers are placed first and so win a collision. */
  pri: number;
  /** Radius in pixels of the mark at the anchor, which no other label may cover. */
  dot?: number;
  /** The text may sit on any side of the anchor. */
  float?: boolean;
  /** The columns of region names stand clear of this point. */
  clear?: boolean;
  /** One of the region names set out in two columns beside the group, each joined to its mark by a leader. */
  callout?: boolean;
};

type Box = { el: HTMLElement; l: number; t: number; w: number; h: number };
/** Left, top, right, bottom, the label it belongs to (whose own text may touch it), and for a mark its priority: text that outranks a mark may cover it. */
type Rect = [number, number, number, number, number, number?];
const ROW = 19;
const FLOAT_AT: ((b: Box) => [number, number])[] = [
  (b) => [11, -b.h / 2],
  (b) => [-11 - b.w, -b.h / 2],
  (b) => [-b.w / 2, -13 - b.h],
  (b) => [-b.w / 2, 13],
  (b) => [9, -b.h - 5],
  () => [9, 5],
  (b) => [-9 - b.w, -b.h - 5],
  (b) => [-9 - b.w, 5],
];

function LabelProjector({ labels, overlay }: { labels: Label[]; overlay: RefObject<HTMLDivElement | null> }) {
  const invalidate = useThree((s) => s.invalidate);
  const v = useMemo(() => new Vector3(), []);
  const measured = useRef<{ labels: Label[] | null; boxes: Box[][]; order: number[] }>({ labels: null, boxes: [], order: [] });
  useEffect(() => invalidate(), [labels, invalidate]);
  useEffect(() => {
    let live = true;
    // Text widths change when the web font arrives.
    document.fonts?.ready.then(() => {
      if (!live) return;
      measured.current.labels = null;
      invalidate();
    });
    return () => {
      live = false;
    };
  }, [invalidate]);

  useFrame(({ camera, size }) => {
    const host = overlay.current;
    if (!host || host.children.length < labels.length) return;
    const m = measured.current;
    if (m.labels !== labels) {
      m.labels = labels;
      m.order = labels.map((_, i) => i).sort((a, b) => labels[a].pri - labels[b].pri || a - b);
      m.boxes = labels.map((_, i) => {
        const el = host.children[i] as HTMLElement;
        const o = el.getBoundingClientRect();
        return Array.from(el.querySelectorAll<HTMLElement>("[data-box]"), (box) => {
          const r = box.getBoundingClientRect();
          return { el: box, l: r.left - o.left, t: r.top - o.top, w: r.width, h: r.height };
        });
      });
    }
    camera.updateMatrixWorld();
    const c = camera.position;
    const xs: number[] = [];
    const ys: number[] = [];
    const placed: Rect[] = [];
    const callouts: number[] = [];
    for (let i = 0; i < labels.length; i++) {
      const el = host.children[i] as HTMLElement;
      const label = labels[i];
      const p = label.at;
      // Closest approach of the sight line from the camera to the point; inside the globe means hidden.
      const dx = p[0] - c.x;
      const dy = p[1] - c.y;
      const dz = p[2] - c.z;
      const t = Math.min(1, Math.max(0, -(c.x * dx + c.y * dy + c.z * dz) / (dx * dx + dy * dy + dz * dz)));
      const near = Math.hypot(c.x + dx * t, c.y + dy * t, c.z + dz * t);
      v.set(p[0], p[1], p[2]).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      const shown = near > 0.995 && v.z > -1 && v.z < 1 && x > -40 && y > -40 && x < size.width + 40 && y < size.height + 40;
      xs.push(shown ? x : NaN);
      ys.push(y);
      el.style.setProperty("visibility", shown ? "visible" : "hidden");
      if (!shown) continue;
      el.style.setProperty("transform", `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`);
      if (label.dot) placed.push([x - label.dot, y - label.dot, x + label.dot, y + label.dot, i, label.pri]);
      if (label.callout && m.boxes[i][0]) callouts.push(i);
    }

    // The region names: two columns, left and right of the group of marks, in the order of the marks down the page.
    if (callouts.length) {
      const cx = callouts.reduce((a, i) => a + xs[i], 0) / callouts.length;
      const cy = callouts.reduce((a, i) => a + ys[i], 0) / callouts.length;
      let reach = 0;
      for (let i = 0; i < labels.length; i++) if ((labels[i].callout || labels[i].clear) && !Number.isNaN(xs[i])) reach = Math.max(reach, Math.abs(xs[i] - cx));
      reach = Math.min(reach, size.width / 4) + 26;
      const byX = [...callouts].sort((a, b) => xs[a] - xs[b]);
      const split = Math.floor(byX.length / 2);
      for (const [side, column] of [
        [-1, byX.slice(0, split)],
        [1, byX.slice(split)],
      ] as const) {
        column.sort((a, b) => ys[a] - ys[b]);
        const top = Math.min(Math.max(cy - (column.length * ROW) / 2, 6), Math.max(6, size.height - 6 - column.length * ROW));
        column.forEach((i, row) => {
          const b = m.boxes[i][0];
          const edge = side < 0 ? Math.max(cx - reach, b.w + 6) : Math.min(cx + reach, size.width - b.w - 6);
          const left = side < 0 ? edge - b.w : edge;
          const mid = top + row * ROW + ROW / 2;
          b.el.style.setProperty("transform", `translate(${(left - xs[i]).toFixed(1)}px, ${(mid - b.h / 2 - ys[i]).toFixed(1)}px)`);
          placed.push([left - 3, mid - b.h / 2 - 1, left + b.w + 3, mid + b.h / 2 + 1, i]);
          const leader = host.children[i].querySelector<HTMLElement>("[data-leader]");
          if (leader) {
            const lx = edge - xs[i];
            const ly = mid - ys[i];
            leader.style.setProperty("width", `${Math.hypot(lx, ly).toFixed(1)}px`);
            leader.style.setProperty("transform", `rotate(${Math.atan2(ly, lx).toFixed(4)}rad)`);
          }
        });
      }
    }

    const free = (r: Rect, pri: number) =>
      placed.every((q) => q[4] === r[4] || (q[5] !== undefined && q[5] > pri) || r[0] >= q[2] || r[2] <= q[0] || r[1] >= q[3] || r[3] <= q[1]);
    for (const i of m.order) {
      const x = xs[i];
      const label = labels[i];
      if (Number.isNaN(x) || label.callout) continue;
      let done = false;
      for (const b of m.boxes[i]) {
        let ok = false;
        if (!done) {
          const spots: [number, number][] = label.float ? FLOAT_AT.map((f) => f(b)) : [[b.l, b.t]];
          for (const [ox, oy] of spots) {
            const r: Rect = [x + ox - 3, ys[i] + oy - 1, x + ox + b.w + 3, ys[i] + oy + b.h + 1, i];
            if (label.pri !== 0 && !free(r, label.pri)) continue;
            placed.push(r);
            if (label.float) b.el.style.setProperty("transform", `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`);
            ok = true;
            break;
          }
        }
        b.el.style.setProperty("visibility", ok ? "inherit" : "hidden");
        done ||= ok;
      }
    }
  });
  return null;
}

// ---------- Camera ----------

type FramingId = "pole" | "near" | "sun";
type Framing = { id: FramingId; dir: Vec3; zoom?: "near" | "far" };
const MIN_DISTANCE = 1.45;
/** Camera distance, in Moon radii, at which zooming in over the polar cap opens the site level; the plate outline is still whole in view. */
const SITE_GATE_DISTANCE = 1.9;
/** The gate is open while the point under the view centre is south of this latitude, so the site-level outline is what the view is closing on. */
const SITE_GATE_SIN = Math.sin(-70 * RAD);
/** Default camera distance: the globe spans about five sixths of the view's height, leaving room for the lines to the Sun and Earth. */
const BASE_DISTANCE = 4.7;
/** Inside this distance the nine regions are drawn one by one; beyond it (with some slack, so the change does not flicker) they are one mark. */
const REGIONS_NEAR = 3.1;
const REGIONS_FAR = 3.4;
/** From below the south pole, tipped towards the near side so the 0° meridian runs up the page. */
const POLE_DIR = onGlobe(-78, 0);
/** Arriving from the site level: almost straight down on the pole, so the plate outline fills the view. */
const POLE_CLOSE_DIR = onGlobe(-85, 0);

function Rig({ framing, onView }: { framing: Framing; onView: (distance: number, min: number, max: number, inOk: boolean) => void }) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const narrow = Math.max(1, 1.05 / aspect);
  const base = BASE_DISTANCE * narrow;
  const max = base * 1.6;

  useEffect(() => {
    const d = framing.zoom === "near" ? SITE_GATE_DISTANCE * 1.3 : framing.zoom === "far" ? max * 0.8 : base;
    camera.position.set(framing.dir[0] * d, framing.dir[1] * d, framing.dir[2] * d);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
    invalidate();
  }, [camera, base, max, framing, invalidate]);

  useFrame(({ camera: cam }) => {
    const d = cam.position.length();
    onView(d, SITE_GATE_DISTANCE, max, cam.position.y / d <= SITE_GATE_SIN);
  }, -1);

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      enableDamping={false}
      minDistance={MIN_DISTANCE}
      maxDistance={max}
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI - 0.05}
      rotateSpeed={0.55}
      zoomSpeed={1.2}
    />
  );
}

function Scene({
  textures,
  fine,
  frame,
  framing,
  labels,
  overlay,
  onView,
  outlines,
  near,
  site,
  bearingLen,
}: {
  textures: Textures;
  fine: FineTextures | null;
  frame: MoonFrame;
  framing: Framing;
  labels: Label[];
  overlay: RefObject<HTMLDivElement | null>;
  onView: (distance: number, min: number, max: number, inOk: boolean) => void;
  outlines: RegionOutline[];
  near: boolean;
  site: Site | null;
  bearingLen: number;
}) {
  const sun = useMemo(() => toScene(frame.sunDir), [frame]);
  const earth = useMemo(() => toScene(frame.earthDir), [frame]);
  const from = useMemo(() => (site ? onGlobe(site.lat, site.lon) : null), [site]);
  return (
    <>
      <color attach="background" args={[PAPER]} />
      <Rig framing={framing} onView={onView} />
      <LabelProjector labels={labels} overlay={overlay} />
      <Globe textures={textures} fine={fine} sunDir={sun} />
      <Ray dir={sun} color={SUN} casing={INK} />
      <Ray dir={earth} color={EARTH} casing={PAPER} />
      {near && outlines.map((o) => <Outline key={o.id} points={o.points} selected={o.id === site?.id} />)}
      {from && site && (
        <>
          <Bearing from={from} towards={earth} len={bearingLen} color={EARTH} casing={PAPER} below={elevationDeg(site.lat, site.lon, frame.earthKm) < 0} />
          <Bearing from={from} towards={sun} len={bearingLen} color={SUN} casing={INK} below={elevationDeg(site.lat, site.lon, frame.sunKm) < 0} />
        </>
      )}
    </>
  );
}

// ---------- Overlay marks ----------

const LABEL_TEXT = "text-[0.69rem] leading-4 font-semibold tracking-[0.1em] whitespace-nowrap uppercase select-none";

function GridTag({ text }: { text: string }) {
  return (
    <span data-box aria-hidden="true" className={`absolute block -translate-x-1/2 -translate-y-1/2 bg-paper/80 px-1 font-medium text-ink-2 ${LABEL_TEXT}`}>
      {text}
    </span>
  );
}

function EdgeTag({ text, className }: { text: string; className: string }) {
  return (
    <span data-box aria-hidden="true" className={`absolute block -translate-x-1/2 -translate-y-1/2 bg-paper/90 px-1 ${LABEL_TEXT} ${className}`}>
      {text}
    </span>
  );
}

/** A round swatch on the surface with its name on a short leader; the leader belongs to the name and hides with it. */
function PointTag({ text, swatch, below = false }: { text: string; swatch: string; below?: boolean }) {
  const leader = `after:absolute after:-left-px after:block after:h-7 after:w-px after:bg-ink ${below ? "after:bottom-full" : "after:top-full"}`;
  return (
    <div aria-hidden="true" className="relative">
      <span data-box className={`absolute left-0 block border-l border-ink bg-paper/90 px-1.5 text-ink ${LABEL_TEXT} ${leader} ${below ? "top-7" : "bottom-7"}`}>
        {text}
      </span>
      <span className={`absolute -top-[5.5px] -left-[5.5px] block size-[11px] rounded-full border border-ink ${swatch}`} />
    </div>
  );
}

function LandingMark({ text, left }: { text: string; left?: boolean }) {
  return (
    <div aria-hidden="true" className="relative">
      <span className="absolute -top-[4.5px] -left-[4.5px] block size-[9px] rounded-full border-[1.5px] border-ink bg-paper/70" />
      <span data-box className={`absolute -top-2 block bg-paper/75 px-0.5 font-medium text-ink ${LABEL_TEXT} ${left ? "right-[8px]" : "left-[8px]"}`}>
        {text}
      </span>
    </div>
  );
}

/** The flag of the selected region: its name in ink on a leader, always shown. */
function Flag({ text }: { text: string }) {
  return (
    <>
      <span aria-hidden="true" className="absolute bottom-0 left-0 block h-9 w-px bg-ink" />
      <span data-box aria-hidden="true" className={`absolute bottom-9 left-0 block bg-ink px-1.5 py-0.5 text-paper ${LABEL_TEXT}`}>
        {text}
      </span>
    </>
  );
}

const HIT = "pointer-events-auto absolute -top-3 -left-3 grid size-6 cursor-pointer place-items-center focus-visible:outline-offset-0";

/**
 * One region. Far out it is drawn only when selected, as a square with its flag. Close in, the outline on the globe
 * is the mark, and the name stands in a column beside the group on a leader, the selected one in ink.
 */
function RegionMark({ site, selected, callout, outlined, onSelect }: { site: Site; selected: boolean; callout: boolean; outlined: boolean; onSelect: (id: string) => void }) {
  return (
    <div className="relative">
      {callout ? (
        <>
          <span data-leader aria-hidden="true" className="absolute top-0 left-0 block h-px origin-left bg-ink shadow-[0_0_0_1px_rgb(238_241_240/0.7)]" />
          <span
            data-box
            aria-hidden="true"
            className={`absolute top-0 left-0 block px-1.5 ${LABEL_TEXT} ${selected ? "bg-ink text-paper" : "bg-paper/90 text-ink"}`}
          >
            {site.name}
          </span>
        </>
      ) : (
        <Flag text={site.name} />
      )}
      <button type="button" onClick={() => onSelect(site.id)} aria-pressed={selected} aria-label={`${site.name}, ${fmtLat(site.lat)}, ${fmtLon(site.lon)}`} title={site.name} className={HIT}>
        {!outlined && <span className={`block border border-paper bg-ink ${selected ? "size-[9px]" : "size-[7px]"}`} />}
      </button>
    </div>
  );
}

/** The nine regions as one mark, for distances at which they would run together. */
function ClusterMark({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="relative">
      <span
        data-box
        aria-hidden="true"
        className={`absolute top-8 left-0 block border-l border-ink bg-paper/90 px-1.5 text-ink after:absolute after:bottom-full after:-left-px after:block after:h-8 after:w-px after:bg-ink ${LABEL_TEXT}`}
      >
        9 candidate regions
      </span>
      <button type="button" onClick={onOpen} aria-label="Nine candidate regions. Zoom in on the south pole to tell them apart." title="Zoom in on the nine regions" className={HIT}>
        <span className="block size-[11px] border-[1.5px] border-ink bg-paper" />
      </button>
    </div>
  );
}

/** A name beside the tip of a line to the Sun or Earth; on a bearing line it carries the body's elevation at the region. */
function BearingTag({ text, className }: { text: string; className: string }) {
  return (
    <span data-box aria-hidden="true" className={`absolute top-0 left-0 block bg-paper px-1 ${LABEL_TEXT} ${className}`}>
      {text}
    </span>
  );
}

// ---------- Fallback when WebGL is missing ----------

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

class GlBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A flat chart of the south polar cap to 60° S, 0° up and 90° E to the right, drawn without WebGL. */
function PolarFallback({ frame, selectedId, onSelect }: { frame: MoonFrame; selectedId: string | null; onSelect: (id: string) => void }) {
  const xy = (lat: number, lon: number): [number, number] => {
    const r = (90 + lat) * 3;
    return [r * Math.sin(lon * RAD), -r * Math.cos(lon * RAD)];
  };
  const label = "fill-ink text-[4.5px] font-semibold tracking-[0.1em] uppercase";
  const edge = (lon: number, k: number) => [k * Math.sin(lon * RAD), -k * Math.cos(lon * RAD)];
  const s0 = edge(frame.subSolar.lon, 94);
  const s1 = edge(frame.subSolar.lon, 108);
  const e0 = edge(frame.subEarth.lon, 94);
  const e1 = edge(frame.subEarth.lon, 108);
  return (
    <div className="absolute inset-0 flex flex-col">
      <p className="border-b border-rule px-4 py-2 text-[0.844rem] text-ink-2">
        This browser could not start WebGL, so the globe is replaced by a flat chart of the south polar cap. The ticks at
        the edge point to the longitudes where the Sun and Earth are overhead; the table values are unaffected.
      </p>
      <svg viewBox="-125 -125 250 250" role="group" aria-label="Chart of the lunar south polar cap with the nine regions" className="min-h-0 flex-1">
        <circle r={90} fill="#dfe4e3" stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <circle r={60} fill="none" stroke="#b9c3c2" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <circle r={30} fill="none" stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={0} y1={-90} x2={0} y2={90} stroke="#b9c3c2" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={-90} y1={0} x2={90} y2={0} stroke="#b9c3c2" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={s0[0]} y1={s0[1]} x2={s1[0]} y2={s1[1]} stroke={SUN_INK} strokeWidth={3} vectorEffect="non-scaling-stroke" />
        <line x1={e0[0]} y1={e0[1]} x2={e1[0]} y2={e1[1]} stroke={EARTH} strokeWidth={3} vectorEffect="non-scaling-stroke" />
        <text x={s1[0] * 1.07} y={s1[1] * 1.07 + 1.5} textAnchor="middle" className={label}>Sun</text>
        <text x={e1[0] * 1.07} y={e1[1] * 1.07 + 1.5} textAnchor="middle" className={label}>Earth</text>
        <text x={2} y={-62} className={label}>70° S</text>
        <text x={2} y={-32} className={label}>80° S, site level</text>
        {sites.map((s) => {
          const [x, y] = xy(s.lat, s.lon);
          const on = s.id === selectedId;
          return (
            <g key={s.id} role="button" tabIndex={0} aria-label={s.name} aria-pressed={on} className="cursor-pointer" onClick={() => onSelect(s.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(s.id)}>
              <rect x={x - (on ? 2.2 : 1.5)} y={y - (on ? 2.2 : 1.5)} width={on ? 4.4 : 3} height={on ? 4.4 : 3} fill={INK} stroke={PAPER} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              {on && <text x={x + 4} y={y + 1.5} className={label}>{s.name}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- Controls and readout ----------

const BUTTON = "h-8 border border-ink px-3 text-[0.8rem] whitespace-nowrap transition-colors duration-150 focus-visible:outline-offset-2";

function Row({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <tr className="border-b border-rule align-baseline">
      <th scope="row" className="py-2 pr-3 text-left text-[0.844rem] font-normal text-ink-2">
        {label}
      </th>
      <td className="py-2 text-right text-[0.95rem] font-semibold whitespace-nowrap text-ink">
        {value}
        {note && <span className="block text-[0.8rem] font-normal text-ink-2">{note}</span>}
      </td>
    </tr>
  );
}

const H3 = "border-b border-ink pb-1.5 text-[0.75rem] font-semibold tracking-[0.08em] text-ink uppercase";

function Readout({ frame, state, site }: { frame: MoonFrame; state: SystemState; site: Site | null }) {
  return (
    <div>
      <h3 className={H3}>Circumstances</h3>
      <table className="w-full border-collapse">
        <tbody>
          <Row label="Time" value={fmtUtc(frame.ms)} />
          <Row label="Sub-solar point" value={`${fmtLat(frame.subSolar.lat)}, ${fmtLon(frame.subSolar.lon)}`} note="where the Sun is overhead" />
          <Row
            label="Sub-Earth point"
            value={`${fmtLat(frame.subEarth.lat)}, ${fmtLon(frame.subEarth.lon)}`}
            note={`libration ${fmtSigned(frame.subEarth.lat, 1)} lat, ${fmtSigned(frame.subEarth.lon, 1)} lon`}
          />
          <Row label="Moon illuminated" value={`${(state.illuminated * 100).toFixed(1)} %`} note={`${state.phaseName}, from Earth`} />
          <Row label="Earth to Moon" value={`${fmtInt(state.earthMoonKm)} km`} note={`${(state.earthMoonKm / EARTH_RADIUS_KM).toFixed(1)} Earth radii`} />
        </tbody>
      </table>

      <h3 className={`mt-6 ${H3}`}>{site ? `At ${site.name}` : "At the selected region"}</h3>
      {site ? (
        <>
          <table className="w-full border-collapse">
            <tbody>
              <Row label="Position" value={`${fmtLat(site.lat)}, ${fmtLon(site.lon)}`} />
              <Row label="Sun elevation" value={fmtSigned(elevationDeg(site.lat, site.lon, frame.sunKm))} />
              <Row label="Earth elevation" value={fmtSigned(elevationDeg(site.lat, site.lon, frame.earthKm))} />
            </tbody>
          </table>
          <p className="mt-2 text-[0.8rem] leading-snug text-ink-2">
            Elevation of each body&apos;s centre over a smooth sphere of radius 1,737.4 km. The site level measures it
            against the terrain.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[0.844rem] leading-snug text-ink-2">Choose one of the nine regions below to see how high the Sun and Earth stand there.</p>
      )}
    </div>
  );
}

function Legend({ showLandings }: { showLandings: boolean }) {
  const item = "flex items-center gap-2.5 py-1 text-[0.844rem] leading-snug text-ink-2";
  const line = "block h-0 w-4 shrink-0 border-t";
  return (
    <ul>
      <li className={item}>
        <span className="mx-[3px] block size-[10px] shrink-0 border-[1.5px] border-ink" />
        Artemis III candidate region (USGS outline when zoomed in)
      </li>
      <li className={item}>
        <span className="block size-4 shrink-0 rounded-full border border-ink" />
        Site level plate, ±304 km about the pole, and the 80° S circle
      </li>
      <li className={item}>
        <span className="block h-[5px] w-4 shrink-0 border border-ink bg-sun" />
        To the Sun: from the sub-solar point, and its bearing at the region
      </li>
      <li className={item}>
        <span className="block h-[3px] w-4 shrink-0 bg-earth" />
        To Earth: from the sub-Earth point, and its bearing at the region
      </li>
      <li className={item}>
        <span className={`${line} border-dashed border-ink`} />
        Terminator; a bearing is dashed while that body is below the horizon
      </li>
      <li className={item}>
        <span className={`${line} border-ink`} />
        Equator and prime meridian; the lighter grid is every 30°
      </li>
      <li className={item}>
        <span className="mx-[3px] block size-[10px] shrink-0 bg-umbra" />
        Night side
      </li>
      {showLandings && (
        <li className={item}>
          <span className="mx-[3px] block size-[10px] shrink-0 rounded-full border-[1.5px] border-ink" />
          Earlier landing
        </li>
      )}
    </ul>
  );
}

// ---------- View ----------

type Load = { status: "loading" } | { status: "ready"; data: SystemData; textures: Textures } | { status: "error"; message: string };

/** Mipmaps and anisotropic filtering keep the maps sharp towards the limb; the renderer caps the level at what the GPU offers. */
function prepare(t: Texture, colour: boolean) {
  t.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
  t.wrapS = RepeatWrapping;
  t.anisotropy = 16;
  return t;
}

async function loadTextures(): Promise<Textures> {
  const loader = new TextureLoader();
  try {
    const [map, height] = await Promise.all([loader.loadAsync("/textures/moon_color_2k.jpg"), loader.loadAsync("/textures/moon_height_1k.jpg")]);
    return { map: prepare(map, true), height: prepare(height, false) };
  } catch {
    throw new Error("The Moon's colour and height maps did not load.");
  }
}

function disposeAll(t: FineTextures) {
  t.map.dispose();
  t.detail.dispose();
}

async function loadFineTextures(): Promise<FineTextures> {
  const loader = new TextureLoader();
  const [map, detail] = await Promise.all([loader.loadAsync("/textures/moon_color_4k.jpg"), loader.loadAsync("/textures/moon_relief_4k.jpg")]);
  return { map: prepare(map, true), detail: prepare(detail, false) };
}

/** Where the cluster mark stands: the middle of the nine region centres. */
const CLUSTER_AT: Vec3 = (() => {
  const sum: Vec3 = [0, 0, 0];
  for (const s of sites) {
    const p = onGlobe(s.lat, s.lon);
    sum[0] += p[0];
    sum[1] += p[1];
    sum[2] += p[2];
  }
  const l = Math.hypot(sum[0], sum[1], sum[2]);
  return [sum[0] / l, sum[1] / l, sum[2] / l];
})();

const GRID_LABELS: { key: string; text: string; lat: number; lon: number }[] = [
  { key: "g-0", text: "0°", lat: -45, lon: 0 },
  { key: "g-90e", text: "90° E", lat: -45, lon: 90 },
  { key: "g-180", text: "180°", lat: -45, lon: 180 },
  { key: "g-90w", text: "90° W", lat: -45, lon: -90 },
  { key: "g-60s", text: "60° S", lat: -60, lon: 45 },
  { key: "g-30s", text: "30° S", lat: -30, lon: 45 },
  { key: "g-eq", text: "Equator", lat: 0, lon: 45 },
  { key: "g-30n", text: "30° N", lat: 30, lon: 45 },
  { key: "g-60n", text: "60° N", lat: 60, lon: 45 },
];

export default function MoonView({ nowMs, onScrub, selectedId, onSelect, onOpenSite, onOpenSystem, entry, levelNav, windowMs, className = "" }: MoonViewProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [framing, setFraming] = useState<Framing>(() =>
    entry === "below" ? { id: "pole", dir: POLE_CLOSE_DIR, zoom: "near" } : { id: "pole", dir: POLE_DIR, zoom: entry === "above" ? "far" : undefined },
  );
  const { setHost, report, hint, progress } = useZoomGate({ onIn: onOpenSite, onOut: onOpenSystem });
  // What the camera distance changes besides the picture: whether the regions are drawn one by one, and how long
  // the bearing lines are on the globe so that they stay about the same length on screen.
  const [zoom, setZoom] = useState<{ near: boolean; step: number }>({ near: entry === "below", step: 12 });
  const onView = useCallback(
    (distance: number, min: number, max: number, inOk: boolean) => {
      report(distance, min, max, inOk);
      setZoom((prev) => {
        const near = distance < (prev.near ? REGIONS_FAR : REGIONS_NEAR);
        const step = Math.round(Math.log(Math.max(distance - 1, 0.3)) / Math.log(1.1));
        return near === prev.near && step === prev.step ? prev : { near, step };
      });
    },
    [report],
  );
  const bearingLen = Math.min(0.3, Math.max(0.03, 0.062 * 1.1 ** zoom.step));
  const hintText =
    hint === "in"
      ? "Keep zooming to open the site level"
      : hint === "in-blocked"
        ? "Turn the south pole towards you, then zoom in to open the site level"
        : hint === "out"
          ? "Keep zooming out to open the System level"
          : null;
  const [showLandings, setShowLandings] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [gl] = useState(hasWebGL);
  const [fine, setFine] = useState<FineTextures | null>(null);
  const [outlines, setOutlines] = useState<RegionOutline[]>([]);

  useEffect(() => {
    let live = true;
    Promise.all([loadSystem(), loadTextures()]).then(
      ([data, textures]) => live && setLoad({ status: "ready", data, textures }),
      (e: unknown) => live && setLoad({ status: "error", message: e instanceof Error ? e.message : "The files did not load." }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  // The sharper maps and the region outlines are extras: the globe is usable without them, so a failure here is silent.
  const ready = load.status === "ready";
  useEffect(() => {
    if (!ready || !gl) return;
    let live = true;
    let loaded: FineTextures | null = null;
    loadFineTextures().then(
      (t) => {
        loaded = t;
        if (live) setFine(t);
        else disposeAll(t);
      },
      () => undefined,
    );
    loadOutlines().then(
      (o) => live && setOutlines(o),
      () => undefined,
    );
    return () => {
      live = false;
      if (loaded) disposeAll(loaded);
    };
  }, [ready, gl]);

  const data = load.status === "ready" ? load.data : null;
  const textures = load.status === "ready" ? load.textures : null;
  const ms = data ? Math.min(Math.max(nowMs, data.startMs), systemEndMs(data)) : nowMs;
  const frame = useMemo(() => (data ? moonFrameAt(data, ms) : null), [data, ms]);
  const state = useMemo(() => (data ? stateAt(data, ms) : null), [data, ms]);
  const site = useMemo(() => sites.find((s) => s.id === selectedId) ?? null, [selectedId]);

  const span = useMemo(() => (data ? { startMs: data.startMs, endMs: systemEndMs(data) } : null), [data]);
  useYearPlayback(playing, span, ms, onScrub);

  const overlay = useRef<HTMLDivElement>(null);
  const near = zoom.near;
  const outlined = near && outlines.length > 0;
  const openRegions = useCallback(() => setFraming({ id: "pole", dir: POLE_CLOSE_DIR, zoom: "near" }), []);
  const labels = useMemo<Label[]>(() => {
    if (!frame) return [];
    const out: Label[] = GRID_LABELS.map((g) => ({ key: g.key, at: onGlobe(g.lat, g.lon), pri: 5, node: <GridTag text={g.text} /> }));
    out.push({ key: "plate", at: onGlobe(-80, -140), pri: 3, node: <EdgeTag text="Site level, 80° S" className="text-ink" /> });
    if (showLandings) for (const l of LANDINGS) out.push({ key: l.id, at: onGlobe(l.lat, l.lon), pri: 4, dot: 6, node: <LandingMark text={l.short} left={l.left} /> });
    out.push({ key: "to-sun", at: toScene(frame.sunDir, RAY), pri: 1, dot: 9, float: true, node: <BearingTag text="To the Sun" className="text-sun-ink" /> });
    out.push({ key: "to-earth", at: toScene(frame.earthDir, RAY), pri: 1, dot: 9, float: true, node: <BearingTag text="To Earth" className="text-earth" /> });
    out.push({ key: "sub-solar", at: toScene(frame.sunDir), pri: 1, dot: 7, node: <PointTag text="Sub-solar point" swatch="bg-sun" /> });
    out.push({ key: "sub-earth", at: toScene(frame.earthDir), pri: 1, dot: 7, node: <PointTag text="Sub-Earth point" swatch="bg-earth" below /> });
    if (!near) out.push({ key: "cluster", at: CLUSTER_AT, pri: 2, dot: 8, node: <ClusterMark onOpen={openRegions} /> });
    // Close in, all nine; far out, only the selected one. The selected region goes last so its flag sits above its neighbours.
    for (const s of [...sites].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId))) {
      const selected = s.id === selectedId;
      if (!near && !selected) continue;
      out.push({
        key: `site-${s.id}`,
        at: onGlobe(s.lat, s.lon),
        pri: selected ? 0 : 2,
        dot: outlined ? 9 : 6,
        callout: near,
        node: <RegionMark site={s} selected={selected} callout={near} outlined={outlined} onSelect={onSelect} />,
      });
    }
    if (site) {
      // The tips of the two bearing lines, each with the body's elevation at the region; drawn last, over the leaders.
      const from = onGlobe(site.lat, site.lon);
      for (const [key, dir, km, name, className] of [
        ["bear-sun", frame.sunDir, frame.sunKm, "Sun", "text-sun-ink"],
        ["bear-earth", frame.earthDir, frame.earthKm, "Earth", "text-earth"],
      ] as const) {
        const at = arcTowards(from, toScene(dir));
        if (at) out.push({ key, at: at(bearingLen * 1.08), pri: 1, float: true, clear: true, node: <BearingTag text={`${name} ${fmtSigned(elevationDeg(site.lat, site.lon, km), 1)}`} className={className} /> });
      }
    }
    return out;
  }, [frame, showLandings, selectedId, onSelect, site, near, outlined, bearingLen, openRegions]);

  const frameTo = (id: FramingId) => {
    if (!frame) return;
    setFraming({ id, dir: id === "pole" ? POLE_DIR : toScene(id === "near" ? frame.earthDir : frame.sunDir) });
  };

  const fallback = frame ? <PolarFallback frame={frame} selectedId={selectedId} onSelect={onSelect} /> : null;

  return (
    <div className={`flex min-h-0 flex-col xl:flex-row ${className}`}>
      <section aria-label="Globe of the Moon" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-rule px-4 py-2.5">
          <h2 className="text-[1.068rem] leading-snug font-semibold text-ink">The Moon{frame ? `, ${fmtUtc(frame.ms)}` : ""}</h2>
          <div className="flex flex-wrap gap-2.5">
            <div role="group" aria-label="View from" className="flex border border-ink">
              {(
                [
                  ["pole", "South pole"],
                  ["near", "Near side"],
                  ["sun", "Sun side"],
                ] as const
              ).map(([id, text], i) => {
                const on = framing.id === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    disabled={!frame}
                    onClick={() => frameTo(id)}
                    className={`h-8 px-3 text-[0.8rem] whitespace-nowrap transition-colors duration-150 focus-visible:outline-offset-2 ${i ? "border-l border-ink" : ""} ${
                      on ? "bg-ink font-semibold text-paper" : "font-medium text-ink hover:bg-paper-3"
                    }`}
                  >
                    {text}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-pressed={showLandings}
              onClick={() => setShowLandings((v) => !v)}
              className={`${BUTTON} ${showLandings ? "bg-paper-3 font-semibold text-ink" : "font-medium text-ink hover:bg-paper-3"}`}
            >
              Earlier landings
            </button>
            {levelNav}
          </div>
        </header>

        <div ref={setHost} className="relative isolate min-h-[24rem] flex-1 overflow-hidden bg-paper">
          <ZoomHint text={hintText} progress={progress} />
          {load.status === "loading" && (
            <p role="status" className="absolute inset-0 grid place-items-center text-[0.844rem] text-ink-2">
              Loading the Moon globe and the 2027 ephemeris
            </p>
          )}
          {load.status === "error" && (
            <div role="alert" className="absolute inset-0 grid place-items-center px-6">
              <div className="max-w-[44ch] border border-ink p-4">
                <p className="text-[0.95rem] font-semibold text-ink">The Moon globe did not load.</p>
                <p className="mt-1 text-[0.844rem] text-ink-2">{load.message} Check the connection, then try again.</p>
                <button
                  type="button"
                  onClick={() => {
                    setLoad({ status: "loading" });
                    setAttempt((n) => n + 1);
                  }}
                  className={`mt-3 ${BUTTON} font-semibold text-ink hover:bg-paper-3`}
                >
                  Try again
                </button>
              </div>
            </div>
          )}
          {frame && !gl && fallback}
          {frame && textures && gl && (
            <GlBoundary fallback={fallback}>
              <Canvas
                flat
                frameloop="demand"
                dpr={[1, 2]}
                camera={{ fov: 30, position: [POLE_DIR[0] * BASE_DISTANCE, POLE_DIR[1] * BASE_DISTANCE, POLE_DIR[2] * BASE_DISTANCE], near: 0.1, far: 40 }}
                gl={{ antialias: true }}
                aria-label="Globe of the Moon lit by the Sun. Drag to turn, scroll to zoom; zooming past a limit opens the site level or the System level."
                role="img"
              >
                <Scene
                  textures={textures}
                  fine={fine}
                  frame={frame}
                  framing={framing}
                  labels={labels}
                  overlay={overlay}
                  onView={onView}
                  outlines={outlines}
                  near={near}
                  site={site}
                  bearingLen={bearingLen}
                />
              </Canvas>
              <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden">
                {labels.map((l) => (
                  <div key={l.key} className="invisible absolute top-0 left-0">
                    {l.node}
                  </div>
                ))}
              </div>
            </GlBoundary>
          )}
        </div>

        <p className="border-t border-rule px-4 py-2 text-[0.8rem] leading-snug text-ink-2">
          Drag to turn the globe, scroll to zoom; zooming in on the south pole opens the site level, zooming out opens
          the System level. The terminator, the lines to the Sun and Earth and the Moon&apos;s orientation are computed
          for the time shown; relief shading is exaggerated and no cast shadows are drawn, so use the site level for
          terrain shadow.
        </p>

        {span && onScrub && (
          <YearSlider
            startMs={span.startMs}
            endMs={span.endMs}
            ms={ms}
            windowMs={windowMs}
            playing={playing}
            onPlay={() => setPlaying((p) => !p)}
            onScrub={(t) => {
              setPlaying(false);
              onScrub(t);
            }}
          />
        )}
      </section>

      <aside className="shrink-0 border-t border-ink px-4 py-4 xl:w-[21.5rem] xl:overflow-y-auto xl:border-t-0 xl:border-l">
        {frame && state ? (
          <Readout frame={frame} state={state} site={site} />
        ) : (
          <p className="text-[0.844rem] text-ink-2">{load.status === "error" ? "No values to show." : "Loading values"}</p>
        )}

        <h3 className={`mt-6 ${H3}`}>Regions</h3>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {sites.map((s) => {
            const on = s.id === selectedId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(s.id)}
                  className={`h-7 border border-ink px-2 text-[0.8rem] whitespace-nowrap transition-colors duration-150 ${
                    on ? "bg-ink font-semibold text-paper" : "font-medium text-ink hover:bg-paper-3"
                  }`}
                >
                  {s.name}
                </button>
              </li>
            );
          })}
        </ul>

        <h3 className={`mt-6 ${H3}`}>Marks</h3>
        <div className="mt-1.5">
          <Legend showLandings={showLandings} />
        </div>
        {showLandings && (
          <table className="mt-2 w-full border-collapse text-[0.8rem]">
            <caption className="sr-only">Earlier landings shown on the globe</caption>
            <tbody>
              {LANDINGS.map((l) => (
                <tr key={l.id} className="border-b border-rule">
                  <th scope="row" className="w-11 py-1 text-left text-[0.69rem] font-semibold tracking-[0.1em] text-ink uppercase">
                    {l.short}
                  </th>
                  <td className="py-1 text-ink-2">
                    {l.name}, {l.year}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap text-ink-2">
                    {fmtLat(l.lat, 1)}, {fmtLon(l.lon, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="mt-6 border-t border-rule pt-3 text-[0.8rem] leading-snug text-ink-2">
          Orientation: IAU/WGCCRE rotation model for the Moon, with Earth and Moon positions from NASA/JPL Horizons.
          Surface: NASA SVS CGI Moon Kit colour and elevation maps from Lunar Reconnaissance Orbiter data, printed in
          grey; region outlines from the USGS. Landing coordinates: NASA NSSDCA and Lunar Reconnaissance Orbiter Camera
          site reports.
        </p>
      </aside>
    </div>
  );
}

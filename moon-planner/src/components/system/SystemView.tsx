"use client";

// System level: the Sun, Earth and Moon from JPL Horizons vectors, drawn as a
// printed orbit diagram and driven by the Navigator's clock. The Moon is the
// same relief globe as the Moon level, turned by the same rotation model, and
// carries the same lines to the Sun and Earth, so the geometry can be followed
// from here down to the site.

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { Color, Matrix4, Quaternion, Vector3, type Camera, type Group, type ShaderMaterial } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { elevationDeg, equatorialToEcliptic, moonAxes, moonFrameAt, type MoonFrame } from "@/lib/moonFrame";
import { sites, type Site } from "@/lib/sites";
import {
  AU_KM,
  EARTH_RADIUS_KM,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
  loadSystem,
  stateAt,
  systemEndMs,
  type SystemData,
  type SystemState,
  type Vec3,
} from "@/lib/system";
import YearSlider, { MONTHS, fmtUtc, useYearPlayback } from "./YearSlider";
import { ZoomHint } from "../levels/LevelNav";
import { useZoomGate } from "../levels/useZoomGate";
import {
  Bearing,
  BearingTag,
  CLUSTER_AT,
  ClusterMark,
  Flag,
  LABEL_TEXT,
  LINE_NAMES,
  LabelProjector,
  LineLegend,
  POLE_DIR,
  Ray,
  arcTowards,
  handoff,
  onGlobe,
  toScene as bodyToScene,
  type Label,
  type Sphere,
} from "../moon/marks";
import { MoonGlobe, Rim, loadFineTextures, loadTextures, type FineTextures, type Textures } from "../moon/moonMaterial";

export type SystemViewProps = {
  nowMs: number;
  onScrub?: (ms: number) => void;
  siteName?: string;
  /** Elevation of the Sun's and Earth's centres above the site's level horizon at nowMs, in degrees. */
  sunElevationDeg?: number | null;
  earthElevationDeg?: number | null;
  /** The mission window, marked on the year rail. */
  windowMs?: { startMs: number; endMs: number };
  /** Zooming in past the Earth–Moon framing's limit steps down to the Moon globe. */
  onOpenMoon?: () => void;
  /** "below" when the view was reached by zooming out of the Moon level: it opens close in on the Moon. */
  entry?: "above" | "below" | null;
  /** The level indicator and step buttons, shown with the view's controls. */
  levelNav?: ReactNode;
  className?: string;
};

type Scale = "display" | "true";
type FramingId = "system" | "pair";
/** start: where the camera opens. "near" and "far" sit just inside a zoom limit. */
type Framing = { id: FramingId; start: "default" | "near" | "far" };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RAD = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
/** Scene units per km: 1 au is 100 units. */
const U = 100 / AU_KM;
/** Display scale: how far the Earth-Moon distance and the body radii are stretched. */
const PAIR_STRETCH = 50;
const BODY_STRETCH = 800;
const SUN_STRETCH = 15;
const FOV = 35;

const INK = "#121a22";
const INK_2 = "#3a4752";
const RULE = "#b9c3c2";
const PAPER = "#eef1f0";
const SUN = "#f0b400";
const EARTH_LIT = "#2453c2";
const EARTH_DARK = "#273a52";
const MOON_LIT = "#c4cacb";
const UMBRA = "#3d5466";

/** Ecliptic x, y, z in km to scene units with ecliptic north up. */
const toScene = (v: Vec3, k = U): Vec3 => [v[0] * k, v[2] * k, -v[1] * k];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec3): Vec3 => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtSigned = (n: number, digits = 1) => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(digits)}°`;

/**
 * The rotation that carries a body's own scene axes (x through its 0° N 0° E, y through its north pole) into this
 * scene, from the body's x and z axes in equatorial J2000.
 */
function bodyOrientation(xEq: Vec3, zEq: Vec3): Quaternion {
  const yEq: Vec3 = [zEq[1] * xEq[2] - zEq[2] * xEq[1], zEq[2] * xEq[0] - zEq[0] * xEq[2], zEq[0] * xEq[1] - zEq[1] * xEq[0]];
  const s = (v: Vec3) => new Vector3(...toScene(equatorialToEcliptic(v), 1));
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(s(xEq), s(zEq), s(yEq).negate()));
}

/**
 * Earth's orientation: the pole of J2000 and the prime meridian from Greenwich mean sidereal time. Precession since
 * 2000 (about 0.4° by 2027), nutation and polar motion are left out, which is far below what this diagram shows.
 */
function earthOrientation(ms: number): Quaternion {
  const gmst = (280.46061837 + 360.98564736629 * ((ms - J2000_MS) / DAY)) * RAD;
  return bodyOrientation([Math.cos(gmst), Math.sin(gmst), 0], [0, 0, 1]);
}

// ---------- Bodies ----------

const BODY_VERT = /* glsl */ `
  varying vec3 vP;
  varying vec3 vViewN;
  varying vec3 vViewP;
  void main() {
    vP = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewN = normalMatrix * normal;
    vViewP = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
// Earth as a printed globe: cobalt day side, slate night side, a crisp terminator, and the same map lines as the
// Moon (30-degree graticule, equator and prime meridian), which fade out while the disc is small. No continents.
const EARTH_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uLit;
  uniform vec3 uDark;
  uniform vec3 uPaper;
  uniform float uPx;
  uniform float uLines;
  varying vec3 vP;
  varying vec3 vViewN;
  varying vec3 vViewP;
  float stroke(float d, float w, float hw) {
    return 1.0 - smoothstep(hw - 0.5, hw + 0.5, d / max(w * uPx, 1e-7));
  }
  void main() {
    vec3 n = normalize(vP);
    float geo = dot(n, uSunDir);
    float lit = smoothstep(-0.012, 0.012, geo);
    vec3 col = mix(uDark, uLit * mix(0.86, 1.0, sqrt(clamp(geo, 0.0, 1.0))), lit);
    col *= mix(0.88, 1.0, smoothstep(0.0, 0.5, dot(normalize(vViewN), normalize(-vViewP))));
    float latDeg = degrees(asin(clamp(n.y, -1.0, 1.0)));
    float lonDeg = degrees(atan(-n.z, n.x));
    float g = stroke(abs(fract(latDeg / 30.0 + 0.5) - 0.5) * 30.0, fwidth(latDeg), 0.5) * step(abs(latDeg), 75.0);
    g = max(g, stroke(abs(fract(lonDeg / 30.0 + 0.5) - 0.5) * 30.0, fwidth(lonDeg), 0.5) * (1.0 - smoothstep(80.0, 84.0, abs(latDeg))));
    col = mix(col, uPaper, g * 0.28 * uLines);
    float major = max(stroke(abs(n.y), fwidth(n.y), 0.6), stroke(abs(n.z), fwidth(n.z), 0.6) * step(0.0, n.x));
    col = mix(col, uPaper, major * 0.8 * uLines);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;
// Flat two-tone shading with a crisp terminator: the Moon until its maps have loaded.
const FLAT_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uLit;
  uniform vec3 uDark;
  varying vec3 vP;
  void main() {
    float t = smoothstep(-0.02, 0.02, dot(normalize(vP), uSunDir));
    gl_FragColor = vec4(mix(uDark, uLit, t), 1.0);
    #include <colorspace_fragment>
  }
`;

/** A unit sphere shaded by the Sun; sunDir is in the body's own axes. With lines it is Earth's globe. */
function LitBody({ lit, dark, sunDir, lines = false, pxRef }: { lit: string; dark: string; sunDir: Vec3; lines?: boolean; pxRef?: { current: number } }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const material = useRef<ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uSunDir: { value: new Vector3(1, 0, 0) },
      uLit: { value: new Color(lit) },
      uDark: { value: new Color(dark) },
      uPaper: { value: new Color(PAPER) },
      uPx: { value: 1 },
      uLines: { value: 0 },
    }),
    [lit, dark],
  );
  useFrame(() => {
    const t = clamp01(((pxRef?.current ?? 0) - 30) / 60);
    if (material.current) material.current.uniforms.uLines.value = t * t * (3 - 2 * t);
  });
  return (
    <>
      <mesh>
        <sphereGeometry args={[1, 96, 48]} />
        <shaderMaterial ref={material} vertexShader={BODY_VERT} fragmentShader={lines ? EARTH_FRAG : FLAT_FRAG} uniforms={uniforms} uniforms-uSunDir-value={sunDir} uniforms-uPx-value={dpr} />
      </mesh>
      <Rim />
    </>
  );
}

// ---------- Labels ----------

// Labels are plain DOM over the canvas, placed each frame by the projector the Moon level uses: text that would
// cover text or a mark already placed is hidden, lower priority numbers first.

/** Where a label stands. Bodies move with the clock and the framed point glides, so anchors are resolved each frame. */
type Anchor =
  | { kind: "point"; at: Vec3 }
  /** The top (1) or bottom (-1) of a body's disc as seen on screen. */
  | { kind: "limb"; body: "sun" | "earth" | "moon"; side: 1 | -1 }
  /** A point in the Moon's body-fixed scene axes, in Moon radii. */
  | { kind: "moon"; at: Vec3 }
  /** The arrowhead of a line from the Moon. */
  | { kind: "ray"; to: "sun" | "earth" };
type SysLabel = Label & { anchor: Anchor };

const ORIGIN: Vec3 = [0, 0, 0];

/** A body's name on a short leader from its limb; a ring marks a body too small to see. */
function BodyTag({ text, speck, below = false, sub }: { text: string; speck: boolean; below?: boolean; sub?: string }) {
  const lead = below ? (speck ? "top-[6px] h-6" : "top-0 h-5") : speck ? "bottom-[6px] h-6" : "bottom-0 h-5";
  const name = below ? (speck ? "top-[30px]" : "top-5") : speck ? "bottom-[30px]" : "bottom-5";
  return (
    <div aria-hidden="true" className="relative">
      {speck && <span className="absolute -top-[6px] -left-[6px] block size-[12px] rounded-full border border-ink" />}
      <span className={`absolute left-0 block w-px bg-ink ${lead}`} />
      <span data-box className={`absolute left-0 block border-l border-ink bg-paper/90 px-1.5 text-ink ${LABEL_TEXT} ${name}`}>
        {text}
        {sub && <span className="-mx-1.5 mt-0.5 block bg-ink px-1.5 py-0.5 text-paper">{sub}</span>}
      </span>
    </div>
  );
}

function CentredTag({ text, className }: { text: string; className: string }) {
  return (
    <span data-box aria-hidden="true" className={`absolute block -translate-x-1/2 -translate-y-1/2 ${LABEL_TEXT} ${className}`}>
      {text}
    </span>
  );
}

/** The selected region on the Moon: a square with its name on a flag, as on the Moon level. */
function SiteFlag({ text }: { text: string }) {
  return (
    <div aria-hidden="true" className="relative">
      <Flag text={text} />
      <span className="absolute -top-[4.5px] -left-[4.5px] block size-[9px] border border-paper bg-ink" />
    </div>
  );
}

// ---------- Scene ----------

type Geometry = {
  /** Scene positions relative to the Sun. */
  earth: Vec3;
  moon: Vec3;
  /** The framed point glides from here to there as the camera zooms in. */
  focusFrom: Vec3;
  focusTo: Vec3;
  sunR: number;
  earthR: number;
  moonR: number;
  stretch: number;
  pairReach: number;
  /** Earth to Moon as drawn, in Moon radii. */
  pairRadii: number;
  earthToSun: Vec3;
};

function geometry(state: SystemState, scale: Scale, framing: FramingId): Geometry {
  const stretch = scale === "display" ? PAIR_STRETCH : 1;
  const bodyK = scale === "display" ? BODY_STRETCH : 1;
  const earth = toScene(state.earth);
  const rel: Vec3 = [state.moon[0] - state.earth[0], state.moon[1] - state.earth[1], state.moon[2] - state.earth[2]];
  const moon = add(earth, toScene(rel, U * stretch));
  const moonR = MOON_RADIUS_KM * U * bodyK;
  return {
    earth,
    moon,
    focusFrom: framing === "system" ? ORIGIN : earth,
    focusTo: framing === "system" ? earth : moon,
    sunR: SUN_RADIUS_KM * U * (scale === "display" ? SUN_STRETCH : 1),
    earthR: EARTH_RADIUS_KM * U * bodyK,
    moonR,
    stretch,
    pairReach: 384_400 * U * stretch,
    pairRadii: (state.earthMoonKm * U * stretch) / moonR,
    earthToSun: unit(mul(earth, -1)),
  };
}

/** Earth's position at the start of each month, in scene units from the Sun. */
function monthPoints(data: SystemData): Vec3[] {
  const year = new Date(data.startMs + DAY).getUTCFullYear();
  return MONTHS.map((_, m) => {
    const i = Math.round((Date.UTC(year, m, 1) - data.startMs) / data.stepMs);
    const k = Math.min(Math.max(i, 0), data.count - 1) * 3;
    return toScene([data.earth[k], data.earth[k + 1], data.earth[k + 2]]);
  });
}

/** What the camera's place changes besides the picture; the scene reports it and the view turns it into marks. */
type Metrics = { moonPx: number; earthPx: number; sunPx: number; pairPx: number; moonRadii: number; poleSeen: boolean };
type OnView = (distance: number, min: number, max: number, m: Metrics) => void;

/** Tilt of the opening views above the ecliptic, in degrees. */
const TILT = { system: 50, pair: 56 };

/**
 * Camera placement and limits for each framing. The scene keeps the framed
 * point at the origin, and that point glides as the camera closes in: from the
 * Sun to Earth in the Sun–Earth–Moon framing, from Earth to the Moon in the
 * Earth–Moon framing. The inner limit of one framing meets the outer limit of
 * the next, so zooming through them reads as one move. Closing on the Moon,
 * the camera also swings to the view from below the south pole that the Moon
 * level opens with, and swings back above the ecliptic on the way out.
 */
function Rig({
  framing,
  geo,
  group,
  moonQ,
  earthPxRef,
  onView,
}: {
  framing: Framing;
  geo: Geometry;
  group: RefObject<Group | null>;
  moonQ: Quaternion;
  /** Receives Earth's radius on screen, in pixels. */
  earthPxRef: { current: number };
  onView: OnView;
}) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const narrow = Math.max(1, 1.35 / aspect);
  const pairBase = geo.pairReach * 3.6;
  const pairMax = pairBase * narrow * 1.5;
  const system = framing.id === "system";
  const base = system ? 352 : pairBase;
  // Close enough that the Moon is the size the Moon level opens it at; in true scale the limit stays further out.
  const min = system ? pairMax * 0.9 : Math.max(geo.moonR * 5.1, geo.pairReach * 0.144);
  const max = system ? base * narrow * 1.5 : pairMax;
  const q = useRef(moonQ);
  useEffect(() => {
    q.current = moonQ;
  }, [moonQ]);
  const last = useRef(0);
  const scratch = useRef<{ a: Vector3; b: Vector3; m: Metrics } | null>(null);

  useEffect(() => {
    if (framing.start === "default") {
      const d = base * narrow;
      const tilt = (system ? TILT.system : TILT.pair) * RAD;
      camera.position.set(0, d * Math.sin(tilt), d * Math.cos(tilt));
    } else if (framing.start === "near" && !system) {
      // From the Moon level: the same face of the Moon, at the size it had there.
      const dir = handoff.moonDir ?? POLE_DIR;
      camera.position.set(dir[0], dir[1], dir[2]).applyQuaternion(q.current).setLength(min * 1.35);
    } else {
      camera.position.setLength(framing.start === "near" ? min * 1.35 : max * 0.8);
    }
    last.current = 0;
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
    invalidate();
  }, [camera, base, narrow, min, max, system, framing, invalidate]);

  const { focusFrom: a, focusTo: b } = geo;
  useFrame(({ camera: cam, size }) => {
    const tmp = (scratch.current ??= { a: new Vector3(), b: new Vector3(), m: { moonPx: 0, earthPx: 0, sunPx: 0, pairPx: 0, moonRadii: 0, poleSeen: false } });
    const d = cam.position.length();
    const prev = last.current;
    last.current = d;
    if (!system && prev > 0 && Math.abs(d - prev) > 1e-7 * d) {
      const zone = pairBase * 0.5;
      const below = Math.PI / 2 - 0.06;
      const polar = Math.acos(Math.min(1, Math.max(-1, cam.position.y / d)));
      if (d < prev && d < zone) {
        // Closing on the Moon: turn towards the view from below its south pole, arriving there at the limit.
        const from = Math.min(prev, zone);
        const k = from <= min * 1.0001 ? 1 : clamp01(Math.log(from / d) / Math.log(from / min));
        const to = tmp.a.set(POLE_DIR[0], POLE_DIR[1], POLE_DIR[2]).applyQuaternion(q.current);
        const dir = tmp.b.copy(cam.position).divideScalar(d);
        const angle = dir.angleTo(to);
        if (angle > 1e-4) {
          to.crossVectors(dir, to);
          if (to.lengthSq() > 1e-10) {
            dir.applyAxisAngle(to.normalize(), angle * k);
            cam.position.copy(dir).multiplyScalar(d);
            controls.current?.update();
          }
        }
      } else if (d > prev && polar > below) {
        // Pulling away from below the ecliptic: rise to the opening tilt by the outer limit.
        const k = prev >= max * 0.9999 ? 1 : clamp01(Math.log(d / prev) / Math.log(max / prev));
        const next = polar + ((90 - TILT.pair) * RAD - polar) * k;
        const az = Math.atan2(cam.position.x, cam.position.z);
        cam.position.set(d * Math.sin(next) * Math.sin(az), d * Math.cos(next), d * Math.sin(next) * Math.cos(az));
        controls.current?.update();
      }
    }
    const f = clamp01(Math.log(base / d) / Math.log(base / (min * 1.4)));
    const e = f * f * (3 - 2 * f);
    const g = group.current?.position;
    g?.set(-(a[0] + (b[0] - a[0]) * e), -(a[1] + (b[1] - a[1]) * e), -(a[2] + (b[2] - a[2]) * e));
    cam.near = d / 200;
    cam.far = d * 50 + 250;
    cam.updateProjectionMatrix();
    if (!g) return;
    const perPx = (2 * Math.tan((FOV * RAD) / 2)) / size.height;
    const moonAt = tmp.a.set(geo.moon[0] + g.x, geo.moon[1] + g.y, geo.moon[2] + g.z);
    const moonD = Math.max(cam.position.distanceTo(moonAt), 1e-9);
    const m = tmp.m;
    m.moonPx = geo.moonR / (moonD * perPx);
    m.moonRadii = moonD / geo.moonR;
    // The nine regions are on the side of the Moon towards the camera.
    const pole = tmp.b.set(CLUSTER_AT[0], CLUSTER_AT[1], CLUSTER_AT[2]).applyQuaternion(q.current);
    m.poleSeen = pole.dot(moonAt.sub(cam.position).negate()) / moonD > 0.3;
    const earthD = Math.max(cam.position.distanceTo(tmp.a.set(geo.earth[0] + g.x, geo.earth[1] + g.y, geo.earth[2] + g.z)), 1e-9);
    m.earthPx = geo.earthR / (earthD * perPx);
    m.pairPx = (geo.pairRadii * geo.moonR) / (earthD * perPx);
    m.sunPx = geo.sunR / (Math.max(cam.position.distanceTo(tmp.a.set(g.x, g.y, g.z)), 1e-9) * perPx);
    earthPxRef.current = m.earthPx;
    onView(d, min, max, m);
  }, -1);

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      enableDamping={false}
      minDistance={min}
      maxDistance={max}
      minPolarAngle={0.08}
      maxPolarAngle={system ? Math.PI / 2 - 0.06 : Math.PI - 0.08}
      rotateSpeed={0.6}
      zoomSpeed={system ? 2.2 : 3.8}
    />
  );
}

/** What is drawn on and around the Moon at the camera's present distance. */
type Detail = { rays: boolean; onBody: boolean; close: boolean; step: number; speck: { sun: boolean; earth: boolean; moon: boolean } };

type DayTick = { ms: number; at: Vec3 };

function Scene({
  data,
  state,
  frame,
  geo,
  framing,
  months,
  days,
  labels,
  overlay,
  onView,
  textures,
  fine,
  detail,
  site,
  bearingLen,
  rayLen,
}: {
  data: SystemData;
  state: SystemState;
  frame: MoonFrame;
  geo: Geometry;
  framing: Framing;
  months: Vec3[];
  days: DayTick[];
  labels: SysLabel[];
  overlay: RefObject<HTMLDivElement | null>;
  onView: OnView;
  textures: Textures | null;
  fine: FineTextures | null;
  detail: Detail;
  site: Site | null;
  bearingLen: number;
  rayLen: { sun: { current: number }; earth: { current: number } };
}) {
  const { earth, moon, sunR, earthR, moonR, stretch, earthToSun } = geo;
  const group = useRef<Group>(null);
  const earthPx = useRef(0);

  const moonQ = useMemo(() => {
    const axes = moonAxes(state.ms);
    return bodyOrientation(axes.x, axes.z);
  }, [state.ms]);
  const earthQ = useMemo(() => earthOrientation(state.ms), [state.ms]);
  const earthSun = useMemo<Vec3>(() => {
    const v = new Vector3(...earthToSun).applyQuaternion(earthQ.clone().invert());
    return [v.x, v.y, v.z];
  }, [earthToSun, earthQ]);
  // The true directions from the Moon, in its own axes: what the Moon level draws.
  const sun = useMemo(() => bodyToScene(frame.sunDir), [frame]);
  const toEarth = useMemo(() => bodyToScene(frame.earthDir), [frame]);
  const from = useMemo(() => (site ? onGlobe(site.lat, site.lon) : null), [site]);

  // Earth's orbit at 12-hour steps, with Earth's present position put in so the line passes through the body at any zoom.
  const orbit = useMemo(() => {
    const pts: Vec3[] = [];
    const now = (state.ms - data.startMs) / data.stepMs;
    for (let i = 0; i < data.count; i += 12) {
      pts.push(toScene([data.earth[i * 3], data.earth[i * 3 + 1], data.earth[i * 3 + 2]]));
      if (now > i && now < i + 12) pts.push(earth);
    }
    return pts;
  }, [data, state.ms, earth]);

  // The Moon's path about Earth over one sidereal month centred on the current hour.
  const centre = Math.round((state.ms - data.startMs) / data.stepMs);
  const moonPath = useMemo(() => {
    const half = Math.round((27.32 * DAY) / data.stepMs / 2);
    const pts: Vec3[] = [];
    for (let i = Math.max(0, centre - half); i <= Math.min(data.count - 1, centre + half); i++) {
      const k = i * 3;
      pts.push(toScene([data.moon[k] - data.earth[k], data.moon[k + 1] - data.earth[k + 1], data.moon[k + 2] - data.earth[k + 2]], U * stretch));
    }
    return pts;
  }, [data, centre, stretch]);

  const locate = useCallback(
    (label: SysLabel, out: Vector3, camera: Camera) => {
      const a = label.anchor;
      if (a.kind === "point") out.set(a.at[0], a.at[1], a.at[2]);
      else if (a.kind === "limb") {
        const r = a.body === "sun" ? sunR : a.body === "earth" ? earthR : moonR;
        const c = a.body === "sun" ? ORIGIN : a.body === "earth" ? earth : moon;
        out.set(0, a.side * r, 0).applyQuaternion(camera.quaternion);
        out.set(out.x + c[0], out.y + c[1], out.z + c[2]);
      } else {
        const k = a.kind === "ray" ? rayLen[a.to].current * moonR : moonR;
        const p = a.kind === "ray" ? (a.to === "sun" ? sun : toEarth) : a.at;
        out.set(p[0] * k, p[1] * k, p[2] * k).applyQuaternion(moonQ);
        out.set(out.x + moon[0], out.y + moon[1], out.z + moon[2]);
      }
      const g = group.current?.position;
      if (g) out.add(g);
    },
    [earth, moon, sunR, earthR, moonR, moonQ, sun, toEarth, rayLen],
  );
  const balls = useMemo<Sphere[]>(() => [0, 1, 2].map(() => ({ x: 0, y: 0, z: 0, r: 0 })), []);
  const spheres = useCallback(() => {
    const g = group.current?.position;
    const set = (s: Sphere, c: Vec3, r: number) => {
      s.x = c[0] + (g?.x ?? 0);
      s.y = c[1] + (g?.y ?? 0);
      s.z = c[2] + (g?.z ?? 0);
      s.r = r;
    };
    set(balls[0], ORIGIN, sunR);
    set(balls[1], earth, earthR);
    set(balls[2], moon, moonR);
    return balls;
  }, [balls, earth, moon, sunR, earthR, moonR]);

  return (
    <>
      <color attach="background" args={[PAPER]} />
      <Rig framing={framing} geo={geo} group={group} moonQ={moonQ} earthPxRef={earthPx} onView={onView} />
      <group ref={group}>
        <Line points={orbit} color={INK} lineWidth={1} />
        <Line points={[ORIGIN, earth]} color={RULE} lineWidth={1} />
        {months.map((p, i) => (
          <Line key={i} points={[mul(p, 0.982), mul(p, 1.018)]} color={INK} lineWidth={1} />
        ))}

        <group scale={sunR}>
          <mesh>
            <sphereGeometry args={[1, 64, 32]} />
            <meshBasicMaterial color={SUN} toneMapped={false} />
          </mesh>
          <Rim />
        </group>

        <group position={earth}>
          <Line points={moonPath} color={INK} lineWidth={1} />
          {framing.id === "pair" && days.map((t) => <Line key={t.ms} points={[mul(t.at, 0.978), mul(t.at, 1.022)]} color={INK} lineWidth={1} />)}
        </group>
        <Line points={[earth, moon]} color={RULE} lineWidth={1} />

        <group position={earth} quaternion={earthQ} scale={earthR}>
          <LitBody lit={EARTH_LIT} dark={EARTH_DARK} sunDir={earthSun} lines pxRef={earthPx} />
        </group>

        <group position={moon} quaternion={moonQ} scale={moonR}>
          {textures ? <MoonGlobe textures={textures} fine={fine} sunDir={sun} /> : <LitBody lit={MOON_LIT} dark={UMBRA} sunDir={sun} />}
          {detail.rays && (
            <>
              <Ray dir={sun} color={SUN} casing={INK} beyondPx={26} lenRef={rayLen.sun} />
              <Ray dir={toEarth} color={EARTH_LIT} casing={PAPER} beyondPx={26} maxLen={geo.pairRadii * 0.55} lenRef={rayLen.earth} />
            </>
          )}
          {detail.close && from && site && (
            <>
              <Bearing from={from} towards={toEarth} len={bearingLen} color={EARTH_LIT} casing={PAPER} below={elevationDeg(site.lat, site.lon, frame.earthKm) < 0} />
              <Bearing from={from} towards={sun} len={bearingLen} color={SUN} casing={INK} below={elevationDeg(site.lat, site.lon, frame.sunKm) < 0} />
            </>
          )}
        </group>
      </group>
      <LabelProjector labels={labels} overlay={overlay} locate={locate} spheres={spheres} />
    </>
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

/** A flat plan from ecliptic north, drawn without WebGL. The Earth-Moon distance is stretched 50 times. */
function PlanFallback({ data, state }: { data: SystemData; state: SystemState }) {
  const k = 100 / AU_KM;
  const path = useMemo(() => {
    let d = "";
    for (let i = 0; i < data.count; i += 24) d += `${i ? "L" : "M"}${(data.earth[i * 3] * k).toFixed(2)} ${(-data.earth[i * 3 + 1] * k).toFixed(2)}`;
    return `${d}Z`;
  }, [data, k]);
  const ex = state.earth[0] * k;
  const ey = -state.earth[1] * k;
  const mx = ex + (state.moon[0] - state.earth[0]) * k * PAIR_STRETCH;
  const my = ey - (state.moon[1] - state.earth[1]) * k * PAIR_STRETCH;
  const label = "fill-ink text-[4px] font-semibold tracking-[0.1em] uppercase";
  return (
    <div className="absolute inset-0 flex flex-col">
      <p className="border-b border-rule px-4 py-2 text-[0.844rem] text-ink-2">
        This browser could not start WebGL, so the 3D diagram is replaced by a flat plan seen from ecliptic north. The
        table values are unaffected.
      </p>
      <svg viewBox="-125 -125 250 250" role="img" aria-label="Plan of Earth's orbit with the Sun, Earth and Moon" className="min-h-0 flex-1">
        <path d={path} fill="none" stroke={INK_2} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={0} y1={0} x2={ex} y2={ey} stroke={RULE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <circle r={7} fill={SUN} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <circle cx={ex} cy={ey} r={12.85} fill="none" stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <circle cx={ex} cy={ey} r={2.4} fill={EARTH_LIT} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <circle cx={mx} cy={my} r={1.2} fill={MOON_LIT} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <text x={0} y={-10} textAnchor="middle" className={label}>Sun</text>
        <text x={ex} y={ey - 15.5} textAnchor="middle" className={label}>Earth and Moon</text>
      </svg>
    </div>
  );
}

// ---------- Controls and readout ----------

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex border border-ink">
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={`h-8 px-3 text-[0.8rem] whitespace-nowrap transition-colors duration-150 focus-visible:outline-offset-2 ${
              i ? "border-l border-ink" : ""
            } ${on ? "bg-ink font-semibold text-paper" : "font-medium text-ink hover:bg-paper-3"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The Moon's disc as seen from Earth with ecliptic north up. */
function PhaseDisc({ illuminated, waxing }: { illuminated: number; waxing: boolean }) {
  const r = 22;
  const rx = Math.max(0.01, r * Math.abs(1 - 2 * illuminated));
  const d = `M0 ${-r}A${r} ${r} 0 0 1 0 ${r}A${rx} ${r} 0 0 ${illuminated > 0.5 ? 1 : 0} 0 ${-r}Z`;
  return (
    <svg viewBox="-24 -24 48 48" className="size-14 shrink-0" aria-hidden="true">
      <circle r={r} fill={UMBRA} />
      <path d={d} fill="#dfe4e3" transform={waxing ? undefined : "scale(-1 1)"} />
      <circle r={r} fill="none" stroke={INK} strokeWidth={1} />
    </svg>
  );
}

function Row({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <tr className="border-b border-rule align-baseline">
      <th scope="row" className="py-2 pr-2 text-left text-[0.844rem] font-normal whitespace-nowrap text-ink-2">
        {label}
      </th>
      <td className="py-2 text-right text-[0.95rem] font-semibold whitespace-nowrap text-ink tabular-nums">
        {value}
        {note && <span className="block text-[0.8rem] font-normal text-ink-2">{note}</span>}
      </td>
    </tr>
  );
}

function fmtLight(s: number) {
  if (s < 60) return `${s.toFixed(3)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

const H3 = "border-b border-ink pb-1.5 text-[0.75rem] font-semibold tracking-[0.08em] text-ink uppercase";

function Legend() {
  const item = "flex items-center gap-2.5 py-1 text-[0.844rem] leading-snug text-ink-2";
  return (
    <ul>
      <LineLegend item={item} />
      <li className={item}>
        <span className="block h-0 w-4 shrink-0 border-t border-ink" />
        Earth&apos;s orbit, ticked at each month, and the Moon&apos;s path over one month, ticked at each day (0 h UTC)
      </li>
      <li className={item}>
        <span className="mx-[3px] block size-[10px] shrink-0 border-[1.5px] border-ink" />
        Artemis III candidate regions at the Moon&apos;s south pole; the selected one is named
      </li>
      <li className={item}>
        <span className="mx-[3px] block size-[10px] shrink-0 bg-umbra" />
        Night side
      </li>
    </ul>
  );
}

function Readout({ state, siteName, sunEl, earthEl }: { state: SystemState; siteName?: string; sunEl?: number | null; earthEl?: number | null }) {
  const el = (v?: number | null) => (v == null || !Number.isFinite(v) ? "Not available" : fmtSigned(v, 2));
  return (
    <div>
      <h3 className={H3}>Circumstances</h3>
      <table className="w-full border-collapse">
        <tbody>
          <Row label="Time" value={fmtUtc(state.ms)} />
          <Row label="Earth to Sun" value={`${state.sunEarthAu.toFixed(4)} au`} note={`${fmtInt(state.sunEarthKm / 1000)},000 km`} />
          <Row label="Earth to Moon" value={`${fmtInt(state.earthMoonKm)} km`} note={`${(state.earthMoonKm / EARTH_RADIUS_KM).toFixed(1)} Earth radii`} />
          <Row label="Moon illuminated" value={`${(state.illuminated * 100).toFixed(1)} %`} note={`Phase angle ${state.phaseAngleDeg.toFixed(1)}°`} />
          <Row label="Light to the Moon" value={fmtLight(state.lightTimeEarthMoonS)} note="from Earth, one way" />
          <Row label="Light from the Sun" value={fmtLight(state.lightTimeSunEarthS)} note="to Earth" />
        </tbody>
      </table>

      <div className="mt-4 flex items-center gap-3.5">
        <PhaseDisc illuminated={state.illuminated} waxing={state.waxing} />
        <p className="text-[0.844rem] leading-snug text-ink-2">
          <span className="block text-[0.95rem] font-semibold text-ink">{state.phaseName}</span>
          The Moon from Earth, ecliptic north up.
        </p>
      </div>

      {siteName && (
        <>
          <h3 className={`mt-6 ${H3}`}>At {siteName}</h3>
          <table className="w-full border-collapse">
            <tbody>
              <Row label="Sun elevation" value={el(sunEl)} />
              <Row label="Earth elevation" value={el(earthEl)} />
            </tbody>
          </table>
          <p className="mt-2 text-[0.8rem] leading-snug text-ink-2">
            Elevation of each body&apos;s centre above the level horizon at the site. The Navigator tab measures it
            against the terrain.
          </p>
        </>
      )}
    </div>
  );
}

// ---------- View ----------

type Load = { status: "loading" } | { status: "ready"; data: SystemData } | { status: "error"; message: string };

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Each 0 h UTC along the Moon's drawn path (one sidereal month about now), as its position from Earth in scene units. */
function dayTicks(data: SystemData, ms: number, stretch: number): DayTick[] {
  const half = (27.32 * DAY) / 2;
  const out: DayTick[] = [];
  for (let t = Math.ceil((ms - half) / DAY) * DAY; t <= ms + half; t += DAY) {
    const i = Math.round((t - data.startMs) / data.stepMs);
    if (i < 0 || i >= data.count) continue;
    const k = i * 3;
    out.push({ ms: t, at: toScene([data.moon[k] - data.earth[k], data.moon[k + 1] - data.earth[k + 1], data.moon[k + 2] - data.earth[k + 2]], U * stretch) });
  }
  return out;
}

const FAR: Detail = { rays: false, onBody: false, close: false, step: 12, speck: { sun: false, earth: false, moon: false } };

export default function SystemView({ nowMs, onScrub, siteName, sunElevationDeg, earthElevationDeg, windowMs, onOpenMoon, entry, levelNav, className = "" }: SystemViewProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [scale, setScale] = useState<Scale>("display");
  const [framing, setFraming] = useState<Framing>(() => (entry === "below" ? { id: "pair", start: "near" } : { id: "system", start: "default" }));
  const [playing, setPlaying] = useState(false);
  const [gl] = useState(hasWebGL);
  const [textures, setTextures] = useState<Textures | null>(null);
  const [fine, setFine] = useState<FineTextures | null>(null);
  const [detail, setDetail] = useState<Detail>(FAR);

  useEffect(() => {
    let live = true;
    loadSystem().then(
      (data) => live && setLoad({ status: "ready", data }),
      (e: unknown) => live && setLoad({ status: "error", message: e instanceof Error ? e.message : "The ephemeris file did not load." }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  // The Moon's maps are the Moon level's, and are extras here: until they arrive, or if they fail, the Moon is a plain two-tone body.
  useEffect(() => {
    if (!gl) return;
    let live = true;
    loadTextures().then(
      (t) => live && setTextures(t),
      () => undefined,
    );
    loadFineTextures().then(
      (t) => live && setFine(t),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gl]);

  const data = load.status === "ready" ? load.data : null;
  const ms = data ? Math.min(Math.max(nowMs, data.startMs), systemEndMs(data)) : nowMs;
  const state = useMemo(() => (data ? stateAt(data, ms) : null), [data, ms]);
  const frame = useMemo(() => (data ? moonFrameAt(data, ms) : null), [data, ms]);
  const site = useMemo(() => sites.find((s) => s.name === siteName) ?? null, [siteName]);

  const overlay = useRef<HTMLDivElement>(null);
  const rayLen = useMemo(() => ({ sun: { current: 1.13 }, earth: { current: 1.13 } }), []);
  const months = useMemo(() => (data ? monthPoints(data) : []), [data]);
  const geo = useMemo(() => (state ? geometry(state, scale, framing.id) : null), [state, scale, framing.id]);
  const dayMs = Math.floor(ms / HOUR);
  const days = useMemo(() => (data ? dayTicks(data, dayMs * HOUR, scale === "display" ? PAIR_STRETCH : 1) : []), [data, dayMs, scale]);
  // The bearing marks keep about the same length on screen, and match the Moon level's where the two levels meet.
  const bearingLen = Math.min(0.3, Math.max(0.03, 0.073 * 1.1 ** detail.step));

  const labels = useMemo<SysLabel[]>(() => {
    if (!geo || !state || !frame) return [];
    const { earth } = geo;
    const { speck } = detail;
    const out: SysLabel[] = [];
    const push = (key: string, anchor: Anchor, pri: number, node: ReactNode, more?: Partial<Label>) => out.push({ key, at: ORIGIN, anchor, pri, node, ...more });
    push("sun", { kind: "limb", body: "sun", side: 1 }, 0, <BodyTag text="Sun" speck={speck.sun} />, { free: true });
    push("earth", { kind: "limb", body: "earth", side: 1 }, 0, <BodyTag text="Earth" speck={speck.earth} />, { free: true });
    if (detail.onBody) {
      push("moon", { kind: "limb", body: "moon", side: 1 }, 0, <BodyTag text="Moon" speck={false} />, { free: true });
      if (site) push("site", { kind: "moon", at: onGlobe(site.lat, site.lon) }, 0, <SiteFlag text={site.name} />, { dot: 6 });
      push("cluster", { kind: "moon", at: CLUSTER_AT }, 2, <ClusterMark onOpen={() => onOpenMoon?.()} hint="Open the Moon level to tell them apart." />, { dot: 8 });
    } else {
      push("moon", { kind: "limb", body: "moon", side: -1 }, 0, <BodyTag text="Moon · 9 candidate regions" sub={site?.name} speck={speck.moon} below />, { free: true });
    }
    if (detail.rays) {
      push("to-sun", { kind: "ray", to: "sun" }, 1, <BearingTag text={LINE_NAMES.sun} className="text-sun-ink" />, { dot: 9, float: true });
      push("to-earth", { kind: "ray", to: "earth" }, 1, <BearingTag text={LINE_NAMES.earth} className="text-earth" />, { dot: 9, float: true });
    }
    if (detail.close && site) {
      const from = onGlobe(site.lat, site.lon);
      for (const [key, dir, km, name, className] of [
        ["bear-sun", frame.sunDir, frame.sunKm, "Sun", "text-sun-ink"],
        ["bear-earth", frame.earthDir, frame.earthKm, "Earth", "text-earth"],
      ] as const) {
        const at = arcTowards(from, bodyToScene(dir));
        if (at) push(key, { kind: "moon", at: at(bearingLen * 1.08) }, 1, <BearingTag text={`${name} ${fmtSigned(elevationDeg(site.lat, site.lon, km), 1)}`} className={className} />, { float: true });
      }
    }
    months.forEach((p, i) => push(MONTHS[i], { kind: "point", at: mul(p, 1.075) }, 4, <CentredTag text={MONTHS[i]} className="font-medium text-ink-2" />));
    if (framing.id === "pair") {
      for (const t of days) {
        if ((new Date(t.ms).getUTCDate() - 1) % 7) continue;
        push(`day-${t.ms}`, { kind: "point", at: add(earth, mul(t.at, 1.09)) }, 5, <CentredTag text={DAY_LABEL.format(t.ms)} className="font-medium text-ink-2" />);
      }
    }
    return out;
  }, [geo, state, frame, framing.id, months, days, detail, site, bearingLen, onOpenMoon]);

  // The zoom chain: Sun–Earth–Moon, then Earth–Moon, then down to the Moon level.
  const zoomIn = useCallback(() => {
    if (framing.id === "system") setFraming({ id: "pair", start: "far" });
    else onOpenMoon?.();
  }, [framing.id, onOpenMoon]);
  const zoomOut = useCallback(() => setFraming({ id: "system", start: "near" }), []);
  const { setHost, report, rearm, hint, progress } = useZoomGate({
    onIn: framing.id === "system" || onOpenMoon ? zoomIn : undefined,
    onOut: framing.id === "pair" ? zoomOut : undefined,
  });
  useEffect(() => rearm(), [framing, rearm]);
  const onView = useCallback<OnView>(
    (distance, min, max, m) => {
      report(distance, min, max);
      setDetail((prev) => {
        // Each switch has some slack, so a mark does not flicker at its threshold.
        const rays = m.pairPx > (prev.rays ? 16 : 19);
        const onBody = m.poleSeen && m.moonPx > (prev.onBody ? 22 : 26);
        const close = onBody && m.moonPx > (prev.close ? 64 : 74);
        const step = Math.round(Math.log(Math.max(m.moonRadii - 1, 0.3)) / Math.log(1.1));
        const sun = m.sunPx < 5;
        const earth = m.earthPx < 5;
        const moon = m.moonPx < 5;
        const same = rays === prev.rays && onBody === prev.onBody && close === prev.close && step === prev.step && sun === prev.speck.sun && earth === prev.speck.earth && moon === prev.speck.moon;
        return same ? prev : { rays, onBody, close, step, speck: { sun, earth, moon } };
      });
    },
    [report],
  );
  const hintText =
    hint === "in"
      ? framing.id === "system"
        ? "Keep zooming in for the Earth–Moon framing"
        : "Keep zooming to open the Moon level"
      : hint === "out"
        ? "Keep zooming out for the Sun–Earth–Moon framing"
        : null;

  const span = useMemo(() => (data ? { startMs: data.startMs, endMs: systemEndMs(data) } : null), [data]);
  useYearPlayback(playing, span, ms, onScrub);

  const caption =
    scale === "display"
      ? `Display scale, not to scale: Earth and the Moon are drawn ${BODY_STRETCH} times too large, the Sun ${SUN_STRETCH} times, and the Earth to Moon distance ${PAIR_STRETCH} times too long, so all three can be seen at once. Positions, the Moon's orientation, the terminator and the table are true; the line to the Sun keeps its true direction, which the stretch can leave up to 7° off the Sun as drawn.`
      : "True scale: sizes and distances keep their real ratios, so the bodies are specks inside the rings that mark them. Zoom in on the Earth–Moon framing to find them; the lines from the Moon and its terminator are true.";

  return (
    <div className={`flex min-h-0 flex-col xl:flex-row ${className}`}>
      <section aria-label="Sun, Earth and Moon diagram" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-rule px-4 py-2.5">
          <h2 className="text-[1.068rem] leading-snug font-semibold text-ink">
            The Sun, Earth and Moon{state ? `, ${fmtUtc(state.ms)}` : ""}
          </h2>
          <div className="flex flex-wrap gap-2.5">
            <Segmented
              label="Framing"
              value={framing.id}
              onChange={(id) => setFraming({ id, start: "default" })}
              options={[
                { id: "system", label: "Sun–Earth–Moon" },
                { id: "pair", label: "Earth–Moon" },
              ]}
            />
            <Segmented
              label="Scale"
              value={scale}
              onChange={setScale}
              options={[
                { id: "display", label: "Display scale" },
                { id: "true", label: "True scale" },
              ]}
            />
            {levelNav}
          </div>
        </header>

        <div ref={setHost} className="relative isolate min-h-[22rem] flex-1 overflow-hidden bg-paper">
          <ZoomHint text={hintText} progress={progress} />
          {load.status === "loading" && (
            <p role="status" className="absolute inset-0 grid place-items-center text-[0.844rem] text-ink-2">
              Loading the 2027 ephemeris
            </p>
          )}
          {load.status === "error" && (
            <div role="alert" className="absolute inset-0 grid place-items-center px-6">
              <div className="max-w-[44ch] border border-ink p-4">
                <p className="text-[0.95rem] font-semibold text-ink">The Sun, Earth and Moon positions did not load.</p>
                <p className="mt-1 text-[0.844rem] text-ink-2">{load.message}</p>
                <button
                  type="button"
                  onClick={() => {
                    setLoad({ status: "loading" });
                    setAttempt((n) => n + 1);
                  }}
                  className="mt-3 h-8 border border-ink px-3 text-[0.8rem] font-semibold text-ink hover:bg-paper-3"
                >
                  Try again
                </button>
              </div>
            </div>
          )}
          {data && state && !gl && <PlanFallback data={data} state={state} />}
          {data && state && frame && geo && gl && (
            <GlBoundary fallback={<PlanFallback data={data} state={state} />}>
              <Canvas
                flat
                frameloop="demand"
                dpr={[1, 2]}
                camera={{ fov: FOV, position: [0, 260, 203], near: 1, far: 5000 }}
                gl={{ antialias: true }}
                aria-label="3D diagram of the Sun, Earth and Moon. Drag to turn, scroll to zoom; zooming past a limit changes the framing or opens the Moon level."
                role="img"
              >
                <Scene
                  data={data}
                  state={state}
                  frame={frame}
                  geo={geo}
                  framing={framing}
                  months={months}
                  days={days}
                  labels={labels}
                  overlay={overlay}
                  onView={onView}
                  textures={textures}
                  fine={fine}
                  detail={detail}
                  site={site}
                  bearingLen={bearingLen}
                  rayLen={rayLen}
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

        <p className="border-t border-rule px-4 py-2 text-[0.8rem] leading-snug text-ink-2">{caption}</p>

        {data && onScrub && (
          <YearSlider
            startMs={data.startMs}
            endMs={systemEndMs(data)}
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
        {state ? (
          <Readout state={state} siteName={siteName} sunEl={sunElevationDeg} earthEl={earthElevationDeg} />
        ) : (
          <p className="text-[0.844rem] text-ink-2">{load.status === "error" ? "No values to show." : "Loading values"}</p>
        )}
        <h3 className={`mt-6 ${H3}`}>Marks</h3>
        <div className="mt-1.5">
          <Legend />
        </div>
        <p className="mt-6 border-t border-rule pt-3 text-[0.8rem] leading-snug text-ink-2">
          Positions: NASA/JPL Horizons vector tables for Earth and the Moon, hourly through 2027, heliocentric ecliptic
          J2000; values between the hours are interpolated. The Moon&apos;s orientation: IAU/WGCCRE rotation model; its
          surface: NASA SVS CGI Moon Kit maps from Lunar Reconnaissance Orbiter data. Earth is a plain globe turned by
          sidereal time, without continents.
        </p>
      </aside>
    </div>
  );
}

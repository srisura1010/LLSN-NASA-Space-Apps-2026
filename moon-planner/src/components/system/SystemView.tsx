"use client";

// System level: the Sun, Earth and Moon from JPL Horizons vectors, drawn as a
// printed orbit diagram and driven by the Navigator's clock. The Moon is the
// same relief globe as the Moon level, turned by the same rotation model, and
// carries the same lines to the Sun and Earth, so the geometry can be followed
// from here down to the site.

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { Color, Matrix4, Quaternion, Vector3, type Camera, type Group, type ShaderMaterial, type Texture } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { earthAxes, earthFixedToEquatorial, earthFrameAt, latLonToEarthFixed, type EarthFrame } from "@/lib/earthFrame";
import { elevationDeg, equatorialToEcliptic, moonAxes, moonFrameAt, type LatLon, type MoonFrame } from "@/lib/moonFrame";
import { sites, type Site } from "@/lib/sites";
import {
  AU_KM,
  EARTH_RADIUS_KM,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
  loadSystem,
  positionsAt,
  stateAt,
  systemEndMs,
  type SystemData,
  type SystemState,
  type Vec3,
} from "@/lib/system";
import { RENDER, TOKENS } from "@/lib/tokens";
import { MONTHS, fmtFull, fmtInt, fmtLatLon, fmtSigned } from "@/lib/format";
import { hasWebGL } from "@/lib/webgl";
import { ErrorBoundary, Row, SectionLabel, Segmented, ToggleButton, buttonClass } from "../ui";
import YearSlider, { useYearPlayback } from "./YearSlider";
import { ZoomHint } from "../levels/LevelNav";
import { useZoomGate } from "../levels/useZoomGate";
import {
  Bearing,
  BearingTag,
  Cased,
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
import { AzimuthFan, EarthGlobe, LaunchLegend, LaunchSiteTag, OverheadTag, loadEarthTexture, loadFineEarthTexture, onEarth, type LaunchSiteMark } from "./earthGlobe";
import { HOUR } from "@/lib/format";

export type { LaunchSiteMark } from "./earthGlobe";

/** A transfer from a launch site to the Moon, drawn as an estimate: where the site is at launch and the Moon at arrival. */
export type TransferArc = { launchMs: number; arrivalMs: number; launchSiteId: string };

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
  /** Launch sites marked on Earth. src/lib/launchSites.ts's LAUNCH_SITES can be passed as it is. */
  launchSites?: readonly LaunchSiteMark[];
  /** The chosen launch site. Left out, the view keeps its own choice. */
  selectedLaunchSiteId?: string | null;
  onSelectLaunchSite?: (id: string) => void;
  /** Draws a line from the launch site at launch to the Moon at arrival. The view does not compute it. */
  transferArc?: TransferArc | null;
  className?: string;
  /**
   * The workspace's inspector rail. When given, the view's side panel (circumstances, point, marks) is drawn
   * there instead of beside the view; null while the rail is still mounting.
   */
  inspector?: HTMLElement | null;
};

type Scale = "display" | "true";
type FramingId = "system" | "pair" | "earth";
/** start: where the camera opens. "near" and "far" sit just inside a zoom limit. */
type Framing = { id: FramingId; start: "default" | "near" | "far" };
/** What the Earth–Moon framing turns about and zooms towards: the middle of the line between the two, or one of them. */
type Focus = "both" | "earth" | "moon";
/** auto: chosen by zooming in on the pair, and given up again by zooming back out. */
type FocusState = { id: Focus; auto: boolean };
/** How far along the line from Earth to the Moon each focus stands. */
const FOCUS_AT: Record<Focus, number> = { earth: 0, both: 0.5, moon: 1 };
type Preset = "top" | "side" | "reset";
/** What the view's buttons and keys ask of the camera. zoom answers with the limit it already rests on, if any. */
type RigApi = { preset: (kind: Preset) => void; orbit: (azimuth: number, polar: number) => void; zoom: (factor: number) => "in" | "out" | null };
/** Earth's and the Moon's discs on screen, in pixels from the view's top left. */
type Discs = { ex: number; ey: number; er: number; mx: number; my: number; mr: number };
const GLIDE_MS = 520;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const DAY = 24 * HOUR;
const RAD = Math.PI / 180;
/** Scene units per km: 1 au is 100 units. */
const U = 100 / AU_KM;
/** Display scale: how far the Earth-Moon distance and the body radii are stretched. */
const PAIR_STRETCH = 50;
const BODY_STRETCH = 800;
const SUN_STRETCH = 15;
const FOV = 35;

const INK = TOKENS.ink;
const INK_2 = TOKENS.ink2;
const RULE = TOKENS.rule;
const PAPER = TOKENS.paper;
const SUN = TOKENS.sun;
const EARTH_LIT = RENDER.earthSea;
const EARTH_DARK = RENDER.earthNight;
const MOON_LIT = RENDER.moonLimb;
/** The line from Earth to the Moon. */
const MOON_LINE = TOKENS.ink2;
const UMBRA = TOKENS.umbra;

/** Ecliptic x, y, z in km to scene units with ecliptic north up. */
const toScene = (v: Vec3, k = U): Vec3 => [v[0] * k, v[2] * k, -v[1] * k];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec3): Vec3 => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const fmtPlace = (p: LatLon) => fmtLatLon(p.lat, p.lon, 1);

/**
 * The rotation that carries a body's own scene axes (x through its 0° N 0° E, y through its north pole) into this
 * scene, from the body's x and z axes in equatorial J2000.
 */
function bodyOrientation(xEq: Vec3, zEq: Vec3): Quaternion {
  const yEq: Vec3 = [zEq[1] * xEq[2] - zEq[2] * xEq[1], zEq[2] * xEq[0] - zEq[0] * xEq[2], zEq[0] * xEq[1] - zEq[1] * xEq[0]];
  const s = (v: Vec3) => new Vector3(...toScene(equatorialToEcliptic(v), 1));
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(s(xEq), s(zEq), s(yEq).negate()));
}

/** Earth's orientation from the Earth Rotation Angle about the pole of date (src/lib/earthFrame.ts). */
function earthOrientation(ms: number): Quaternion {
  const axes = earthAxes(ms);
  return bodyOrientation(axes.x, axes.z);
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
// Earth until its map has loaded, or if it fails to: cobalt day side, slate night side, a crisp terminator, and the
// same map lines as the Moon (30-degree graticule, equator and prime meridian), which fade out while the disc is small.
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

/** A unit sphere shaded by the Sun; sunDir is in the body's own axes. With lines it is Earth without its map. */
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
  | { kind: "ray"; to: "sun" | "earth" }
  /** A point in Earth's body-fixed scene axes, in Earth radii; with len, that many radii out along it (the tip of a line from Earth). */
  | { kind: "earth"; at: Vec3; len?: { current: number } };
type SysLabel = Label & { anchor: Anchor };

const ORIGIN: Vec3 = [0, 0, 0];

/** A body's name on a short leader from its limb; a ring marks a body too small to see. */
function BodyTag({ text, speck, below = false, sub, onPick }: { text: string; speck: boolean; below?: boolean; sub?: string; onPick?: () => void }) {
  const lead = below ? (speck ? "top-[6px] h-6" : "top-0 h-5") : speck ? "bottom-[6px] h-6" : "bottom-0 h-5";
  const name = below ? (speck ? "top-[30px]" : "top-5") : speck ? "bottom-[30px]" : "bottom-5";
  return (
    <div aria-hidden="true" className="relative">
      {speck && <span className="absolute -top-[6px] -left-[6px] block size-[12px] rounded-full border border-ink" />}
      <span className={`absolute left-0 block w-px bg-ink ${lead}`} />
      <span
        data-box
        onClick={onPick}
        title={onPick ? "Centre the view here" : undefined}
        className={`absolute left-0 block border-l border-ink bg-paper/90 px-1.5 text-ink ${LABEL_TEXT} ${name} ${onPick ? "pointer-events-auto cursor-pointer hover:bg-paper-3" : ""}`}
      >
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
  // The Earth framing draws Earth and the Moon to one scale, so the enlarged Moon cannot stand between Earth and the camera.
  const stretch = scale === "display" ? (framing === "earth" ? BODY_STRETCH : PAIR_STRETCH) : 1;
  const bodyK = scale === "display" ? BODY_STRETCH : 1;
  const earth = toScene(state.earth);
  const rel: Vec3 = [state.moon[0] - state.earth[0], state.moon[1] - state.earth[1], state.moon[2] - state.earth[2]];
  const moon = add(earth, toScene(rel, U * stretch));
  const moonR = MOON_RADIUS_KM * U * bodyK;
  return {
    earth,
    moon,
    focusFrom: framing === "system" ? ORIGIN : earth,
    focusTo: framing === "pair" ? moon : earth,
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
const TILT = { system: 50, pair: 46, earth: 24 };

/** Which way the Earth framing looks: a direction in Earth's body-fixed scene axes, and a key that changes when it should be applied again. */
type Facing = { dir: Vec3 | null; key: string };

/** A camera move in progress: the direction turns and the distance closes together, easing out. */
type CamGlide = { from: Vector3; to: Vector3; fromD: number; toD: number; t0: number; dur: number };

/** The margin kept around what a framing has to hold, as a share of the view. */
const FIT = 0.93;

/**
 * The distance from which the Earth–Moon framing holds the whole pair at any time of the month, looking down at
 * the given angle above the ecliptic at the middle of the line between them: Earth, the Moon, and the Moon's
 * path, which reaches one and a half Earth–Moon distances from that middle.
 */
function pairFit(geo: Geometry, aspect: number, tiltDeg: number) {
  const tanV = Math.tan((FOV * RAD) / 2) * FIT;
  const t = tiltDeg * RAD;
  const reach = geo.pairReach * 1.06 * 1.5 + geo.moonR;
  return reach * Math.max(Math.cos(t) + Math.sin(t) / tanV, 1 / (tanV * aspect));
}

/**
 * Camera placement and limits for each framing. The scene keeps the framed
 * point at the origin. In the Sun–Earth–Moon framing that point glides from
 * the Sun to Earth as the camera closes in. The Earth–Moon framing turns about
 * and zooms towards its focus: the middle of the line between the two bodies,
 * which holds both in view all month, or either body. Zooming in on the pair
 * moves the focus to the body nearer the pointer, so the wheel alone still
 * arrives somewhere: on the Moon the camera swings to the view from below the
 * south pole that the Moon level opens with, and on Earth it stops where the
 * Earth framing takes over. The inner limit of one framing meets the outer
 * limit of the next, so zooming through them reads as one move. The Earth
 * framing orbits Earth, close enough to read the continents, and can be
 * turned to stand over a chosen point.
 */
function Rig({
  framing,
  geo,
  group,
  moonQ,
  earthQ,
  facing,
  earthPxRef,
  onView,
  focus,
  onFocus,
  apiRef,
  onDiscs,
  pointer,
}: {
  framing: Framing;
  geo: Geometry;
  group: RefObject<Group | null>;
  moonQ: Quaternion;
  earthQ: Quaternion;
  facing: Facing;
  /** Receives Earth's radius on screen, in pixels. */
  earthPxRef: { current: number };
  onView: OnView;
  focus: FocusState;
  onFocus: (id: Focus, auto: boolean) => void;
  apiRef: { current: RigApi | null };
  onDiscs: (ex: number, ey: number, er: number, mx: number, my: number, mr: number) => void;
  pointer: { current: { x: number; y: number } | null };
}) {
  const discs = useRef<Discs>({ ex: 0, ey: 0, er: 0, mx: 0, my: 0, mr: 0 });
  const camera = useThree((s) => s.camera);
  const dom = useThree((s) => s.gl.domElement);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const narrow = Math.max(1, 1.35 / aspect);
  const fit = pairFit(geo, aspect, TILT.pair);
  const topFit = pairFit(geo, aspect, 90);
  const pairMax = fit * 1.5;
  // Close enough that the Moon is the size the Moon level opens it at; in true scale the limit stays further out.
  const moonMin = Math.max(geo.moonR * 5.1, geo.pairReach * 0.144);
  // Where Earth is about the size the Earth framing shows it from its outer limit.
  const earthMin = Math.max(geo.earthR * 6, geo.pairReach * 0.144);
  // Inside this the pair no longer fits about its middle, and the focus goes to one body.
  const bothMin = geo.pairReach * 1.9;
  const system = framing.id === "system";
  const pair = framing.id === "pair";
  const onEarthOnly = framing.id === "earth";
  const base = system ? 352 : onEarthOnly ? geo.earthR * 4 : fit;
  const min = system ? pairMax * 0.9 : onEarthOnly ? geo.earthR * 1.7 : focus.id === "moon" ? moonMin : focus.id === "earth" ? earthMin : Math.min(moonMin, earthMin);
  const max = system ? Math.max(base * narrow * 1.5, pairMax * 1.4) : onEarthOnly ? geo.earthR * 9 : pairMax;
  const minPolar = pair ? 0.02 : 0.08;
  const maxPolar = system ? Math.PI / 2 - 0.06 : Math.PI - 0.08;
  const q = useRef(moonQ);
  const live = useRef({ earthQ, facing, onEarthOnly, pair, min, max, minPolar, maxPolar, focus, fit, topFit, pairMax, moonMin, earthMin, bothMin, geo, aspect });
  useEffect(() => {
    q.current = moonQ;
    live.current = { earthQ, facing, onEarthOnly, pair, min, max, minPolar, maxPolar, focus, fit, topFit, pairMax, moonMin, earthMin, bothMin, geo, aspect };
  }, [moonQ, earthQ, facing, onEarthOnly, pair, min, max, minPolar, maxPolar, focus, fit, topFit, pairMax, moonMin, earthMin, bothMin, geo, aspect]);
  const last = useRef(0);
  const at = useRef(FOCUS_AT[focus.id]);
  const atGlide = useRef<{ from: number; to: number; t0: number; dur: number } | null>(null);
  const camGlide = useRef<CamGlide | null>(null);
  const moved = useRef(0);
  const scratch = useRef<{ a: Vector3; b: Vector3; m: Metrics } | null>(null);

  const glideTo = useCallback(
    (to: Vector3 | null, toD: number, ms = GLIDE_MS) => {
      const d = camera.position.length();
      const from = camera.position.clone().divideScalar(d);
      camGlide.current = { from, to: to ?? from, fromD: d, toD, t0: performance.now(), dur: reducedMotion() ? 0 : ms };
      invalidate();
    },
    [camera, invalidate],
  );

  // Taking hold of the view ends a glide; the wheel does not, so the wheel's own momentum cannot cut one short.
  useEffect(() => {
    const stop = () => {
      camGlide.current = null;
    };
    dom.addEventListener("pointerdown", stop);
    return () => dom.removeEventListener("pointerdown", stop);
  }, [dom]);

  const scaleKey = geo.pairReach;
  useEffect(() => {
    const now = live.current;
    camGlide.current = null;
    atGlide.current = null;
    if (now.pair) {
      const tilt = TILT.pair * RAD;
      if (framing.start === "near" && now.focus.id === "moon") {
        // From the Moon level: the same face of the Moon, at the size it had there, then back far enough to show Earth beside it.
        const dir = handoff.moonDir ?? POLE_DIR;
        camera.position.set(dir[0], dir[1], dir[2]).applyQuaternion(q.current).setLength(now.moonMin * 1.35);
        at.current = 1;
        const { earth, moon, earthR } = now.geo;
        const lx = moon[0] - earth[0];
        const lz = moon[2] - earth[2];
        const span = Math.hypot(lx, moon[1] - earth[1], lz);
        const side = new Vector3(-lz, 0, lx).normalize();
        if (side.dot(camera.position) < 0) side.negate();
        side.multiplyScalar(Math.cos(tilt)).setY(Math.sin(tilt));
        const d = (span + earthR * 1.3) / (Math.tan((FOV * RAD) / 2) * now.aspect * 0.8);
        glideTo(side, Math.min(now.pairMax * 0.8, Math.max(now.moonMin * 1.35, d)), 900);
      } else if (framing.start === "near") {
        // From the Earth framing: the same side of Earth, a little further off.
        camera.position.setLength(now.earthMin * 1.35);
        at.current = 0;
      } else if (framing.start === "far") {
        // From the Sun–Earth–Moon framing, which rests on Earth: the focus glides out from there.
        camera.position.setLength(now.pairMax * 0.8);
        at.current = 0;
      } else {
        camera.position.set(0, now.fit * Math.sin(tilt), now.fit * Math.cos(tilt));
        at.current = FOCUS_AT[now.focus.id];
      }
    } else if (framing.start === "default") {
      const d = base * narrow;
      const tilt = TILT[framing.id] * RAD;
      camera.position.set(0, d * Math.sin(tilt), d * Math.cos(tilt));
      // The Earth framing keeps facing its chosen point when the scale changes under it.
      const dir = now.onEarthOnly ? now.facing.dir : null;
      if (dir) camera.position.set(dir[0], dir[1], dir[2]).applyQuaternion(now.earthQ).setLength(d);
    } else {
      camera.position.setLength(framing.start === "near" ? now.min * 1.35 : now.max * 0.8);
    }
    last.current = 0;
    controls.current?.target.set(0, 0, 0);
    if (!camGlide.current) controls.current?.update();
    invalidate();
  }, [camera, base, narrow, scaleKey, framing, glideTo, invalidate]);

  // A change of focus glides the framed point along the line between the bodies, keeping the direction of view.
  const lastFocus = useRef(focus.id);
  useEffect(() => {
    const changed = lastFocus.current !== focus.id;
    lastFocus.current = focus.id;
    const now = live.current;
    if (!now.pair) return;
    const to = FOCUS_AT[focus.id];
    if (Math.abs(to - at.current) > 1e-6) atGlide.current = { from: at.current, to, t0: performance.now(), dur: reducedMotion() ? 0 : GLIDE_MS };
    // Chosen by hand from closer than the new focus allows: draw back to where it reads.
    if (changed && !focus.auto && !camGlide.current) {
      const d = camera.position.length();
      if (focus.id === "both") {
        if (d < now.bothMin * 1.2) glideTo(null, now.fit);
      } else {
        const limit = focus.id === "moon" ? now.moonMin : now.earthMin;
        if (d < limit * 1.3) glideTo(null, limit * 1.35);
      }
    }
    invalidate();
  }, [focus, framing, camera, glideTo, invalidate]);

  // The Earth framing turns to stand over the chosen point, at the distance it has; Earth goes on turning under it.
  useEffect(() => {
    const now = live.current;
    const dir = now.facing.dir;
    if (!now.onEarthOnly || !dir) return;
    const d = Math.min(now.max, Math.max(now.min, camera.position.length()));
    camera.position.set(dir[0], dir[1], dir[2]).applyQuaternion(now.earthQ).setLength(d);
    last.current = 0;
    controls.current?.update();
    invalidate();
  }, [camera, facing.key, framing, invalidate]);

  // What the view's buttons and keys do.
  useEffect(() => {
    apiRef.current = {
      preset(kind) {
        const now = live.current;
        if (!now.pair) return;
        const p = camera.position;
        const d = p.length();
        const both = now.focus.id === "both" || kind === "reset";
        const tilt = TILT.pair * RAD;
        if (kind === "reset") glideTo(new Vector3(0, Math.sin(tilt), Math.cos(tilt)), now.fit);
        else if (kind === "top") {
          // The plan of the orbit, from ecliptic north, turned as the view already is.
          const az = Math.atan2(p.x, p.z);
          glideTo(new Vector3(Math.sin(0.02) * Math.sin(az), Math.cos(0.02), Math.sin(0.02) * Math.cos(az)), both ? Math.min(now.max, now.topFit) : d);
        } else {
          // Edge-on to the ecliptic, square to the line between the bodies, from the nearer side.
          const { earth, moon } = now.geo;
          const side = new Vector3(-(moon[2] - earth[2]), 0, moon[0] - earth[0]).normalize();
          if (side.dot(p) < 0) side.negate();
          glideTo(side.setY(Math.tan(0.05)).normalize(), both ? now.fit : d);
        }
      },
      orbit(azimuth, polar) {
        const now = live.current;
        const p = camera.position;
        const d = p.length();
        const pol = Math.min(now.maxPolar, Math.max(now.minPolar, Math.acos(Math.min(1, Math.max(-1, p.y / d))) + polar));
        const az = Math.atan2(p.x, p.z) + azimuth;
        camGlide.current = null;
        p.set(d * Math.sin(pol) * Math.sin(az), d * Math.cos(pol), d * Math.sin(pol) * Math.cos(az));
        last.current = 0;
        controls.current?.update();
        invalidate();
      },
      zoom(factor) {
        const now = live.current;
        const p = camera.position;
        const d = p.length();
        if (factor < 1 && d <= now.min * 1.01) return "in";
        if (factor > 1 && d >= now.max * 0.99) return "out";
        camGlide.current = null;
        p.setLength(Math.min(now.max, Math.max(now.min, d * factor)));
        controls.current?.update();
        invalidate();
        return null;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, camera, glideTo, invalidate]);

  const { focusFrom: a, focusTo: b } = geo;
  useFrame(({ camera: cam, size }) => {
    const tmp = (scratch.current ??= { a: new Vector3(), b: new Vector3(), m: { moonPx: 0, earthPx: 0, sunPx: 0, pairPx: 0, moonRadii: 0, poleSeen: false } });
    const t = performance.now();
    let gliding = false;
    let placed = false;
    const cg = camGlide.current;
    if (cg) {
      const k = cg.dur > 0 ? clamp01((t - cg.t0) / cg.dur) : 1;
      const e = 1 - (1 - k) ** 3;
      const dir = tmp.a.copy(cg.from);
      const angle = cg.from.angleTo(cg.to);
      if (angle > 1e-4) {
        const axis = tmp.b.crossVectors(cg.from, cg.to);
        if (axis.lengthSq() > 1e-10) dir.applyAxisAngle(axis.normalize(), angle * e);
      }
      cam.position.copy(dir).multiplyScalar(cg.fromD * (cg.toD / cg.fromD) ** e);
      cam.lookAt(0, 0, 0);
      placed = true;
      if (k >= 1) {
        camGlide.current = null;
        controls.current?.update();
      } else gliding = true;
    }
    const ag = atGlide.current;
    if (ag) {
      const k = ag.dur > 0 ? clamp01((t - ag.t0) / ag.dur) : 1;
      at.current = ag.from + (ag.to - ag.from) * (1 - (1 - k) ** 3);
      if (k >= 1) atGlide.current = null;
      else gliding = true;
    }
    if (gliding) invalidate();
    const d = cam.position.length();
    const prev = placed ? 0 : last.current;
    last.current = d;
    if (pair && prev > 0 && Math.abs(d - prev) > 1e-7 * d) {
      const zone = geo.pairReach * 1.8;
      const below = Math.PI / 2 - 0.06;
      const polar = Math.acos(Math.min(1, Math.max(-1, cam.position.y / d)));
      if (d < prev && d < zone && focus.id === "moon") {
        // Closing on the Moon: turn towards the view from below its south pole, arriving there at the limit.
        const from = Math.min(prev, zone);
        const k = from <= moonMin * 1.0001 ? 1 : clamp01(Math.log(from / d) / Math.log(from / moonMin));
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
      if (t - moved.current > 400) {
        if (focus.id === "both" && d < prev && d < bothMin) {
          // Zooming in on the pair: carry on towards the body nearer the pointer, or with none the view's centre.
          moved.current = t;
          const s = discs.current;
          const px = pointer.current?.x ?? size.width / 2;
          const py = pointer.current?.y ?? size.height / 2;
          onFocus(Math.hypot(s.mx - px, s.my - py) <= Math.hypot(s.ex - px, s.ey - py) * 1.05 ? "moon" : "earth", true);
        } else if (focus.id !== "both" && focus.auto && d > prev && d > bothMin * 1.25) {
          moved.current = t;
          onFocus("both", true);
        }
      }
    }
    const g = group.current?.position;
    if (pair) {
      const k = at.current;
      g?.set(-(geo.earth[0] + (geo.moon[0] - geo.earth[0]) * k), -(geo.earth[1] + (geo.moon[1] - geo.earth[1]) * k), -(geo.earth[2] + (geo.moon[2] - geo.earth[2]) * k));
    } else {
      const f = clamp01(Math.log(base / d) / Math.log(base / (min * 1.4)));
      const e = f * f * (3 - 2 * f);
      g?.set(-(a[0] + (b[0] - a[0]) * e), -(a[1] + (b[1] - a[1]) * e), -(a[2] + (b[2] - a[2]) * e));
    }
    cam.near = d / 200;
    cam.far = d * 50 + 250;
    cam.updateProjectionMatrix();
    if (!g) return;
    cam.updateMatrixWorld();
    const perPx = (2 * Math.tan((FOV * RAD) / 2)) / size.height;
    const s = discs.current;
    const moonAt = tmp.a.set(geo.moon[0] + g.x, geo.moon[1] + g.y, geo.moon[2] + g.z);
    const moonD = Math.max(cam.position.distanceTo(moonAt), 1e-9);
    const m = tmp.m;
    m.moonPx = geo.moonR / (moonD * perPx);
    m.moonRadii = moonD / geo.moonR;
    tmp.b.copy(moonAt).project(cam);
    s.mx = ((tmp.b.x + 1) / 2) * size.width;
    s.my = ((1 - tmp.b.y) / 2) * size.height;
    s.mr = m.moonPx;
    // The nine regions are on the side of the Moon towards the camera.
    const pole = tmp.b.set(CLUSTER_AT[0], CLUSTER_AT[1], CLUSTER_AT[2]).applyQuaternion(q.current);
    m.poleSeen = pole.dot(moonAt.sub(cam.position).negate()) / moonD > 0.3;
    const earthAt = tmp.a.set(geo.earth[0] + g.x, geo.earth[1] + g.y, geo.earth[2] + g.z);
    const earthD = Math.max(cam.position.distanceTo(earthAt), 1e-9);
    m.earthPx = geo.earthR / (earthD * perPx);
    m.pairPx = (geo.pairRadii * geo.moonR) / (earthD * perPx);
    tmp.b.copy(earthAt).project(cam);
    s.ex = ((tmp.b.x + 1) / 2) * size.width;
    s.ey = ((1 - tmp.b.y) / 2) * size.height;
    s.er = m.earthPx;
    m.sunPx = geo.sunR / (Math.max(cam.position.distanceTo(tmp.a.set(g.x, g.y, g.z)), 1e-9) * perPx);
    earthPxRef.current = m.earthPx;
    onDiscs(s.ex, s.ey, s.er, s.mx, s.my, s.mr);
    // With the pair framed there is no inner limit to rest on: zooming in moves the focus instead.
    onView(d, pair && focus.id === "both" ? 0 : min, max, m);
  }, -1);

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      enableDamping={false}
      minDistance={min}
      maxDistance={max}
      minPolarAngle={minPolar}
      maxPolarAngle={maxPolar}
      rotateSpeed={0.6}
      zoomSpeed={system ? 2.2 : onEarthOnly ? 1.6 : 3.8}
    />
  );
}

/** What is drawn on and around the Moon at the camera's present distance. */
type Detail = {
  rays: boolean;
  onBody: boolean;
  close: boolean;
  step: number;
  /** Earth's size on screen: 0 small, 1 large enough for the launch-site marks, 2 for their names, the lines from Earth and the azimuth fan. */
  earth: 0 | 1 | 2;
  speck: { sun: boolean; earth: boolean; moon: boolean };
};

/** The transfer line as drawn, in scene units from Earth's centre. */
type Arc = { points: Vec3[]; mid: Vec3; end: Vec3; dash: number };

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
  earthMap,
  earthFrame,
  earthRay,
  facing,
  fanSite,
  arc,
  focus,
  onFocus,
  apiRef,
  onDiscs,
  pointer,
}: {
  focus: FocusState;
  onFocus: (id: Focus, auto: boolean) => void;
  apiRef: { current: RigApi | null };
  onDiscs: (ex: number, ey: number, er: number, mx: number, my: number, mr: number) => void;
  pointer: { current: { x: number; y: number } | null };
  data: SystemData;
  state: SystemState;
  frame: MoonFrame;
  earthMap: Texture | null;
  earthFrame: EarthFrame;
  earthRay: { sun: { current: number }; moon: { current: number } };
  facing: Facing;
  /** The selected launch site, whose azimuth fan is drawn while Earth is large. */
  fanSite: LaunchSiteMark | null;
  arc: Arc | null;
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
  const { earth, moon, sunR, earthR, moonR, stretch } = geo;
  const group = useRef<Group>(null);
  const earthPx = useRef(0);

  const moonQ = useMemo(() => {
    const axes = moonAxes(state.ms);
    return bodyOrientation(axes.x, axes.z);
  }, [state.ms]);
  const earthQ = useMemo(() => earthOrientation(state.ms), [state.ms]);
  // The true directions from Earth, in its own axes.
  const earthSun = useMemo(() => bodyToScene(earthFrame.sunDir), [earthFrame]);
  const earthMoon = useMemo(() => bodyToScene(earthFrame.moonDir), [earthFrame]);
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
      } else if (a.kind === "earth") {
        const k = (a.len?.current ?? 1) * earthR;
        out.set(a.at[0] * k, a.at[1] * k, a.at[2] * k).applyQuaternion(earthQ);
        out.set(out.x + earth[0], out.y + earth[1], out.z + earth[2]);
      } else {
        const k = a.kind === "ray" ? rayLen[a.to].current * moonR : moonR;
        const p = a.kind === "ray" ? (a.to === "sun" ? sun : toEarth) : a.at;
        out.set(p[0] * k, p[1] * k, p[2] * k).applyQuaternion(moonQ);
        out.set(out.x + moon[0], out.y + moon[1], out.z + moon[2]);
      }
      const g = group.current?.position;
      if (g) out.add(g);
    },
    [earth, moon, sunR, earthR, moonR, moonQ, earthQ, sun, toEarth, rayLen],
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
      <Rig framing={framing} geo={geo} group={group} moonQ={moonQ} earthQ={earthQ} facing={facing} earthPxRef={earthPx} onView={onView} focus={focus} onFocus={onFocus} apiRef={apiRef} onDiscs={onDiscs} pointer={pointer} />
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
          {arc && <Cased points={arc.points} color={INK} casing={PAPER} dash={arc.dash} />}
        </group>
        <Line points={[earth, moon]} color={RULE} lineWidth={1} />

        <group position={earth} quaternion={earthQ} scale={earthR}>
          {earthMap ? <EarthGlobe map={earthMap} sunDir={earthSun} /> : <LitBody lit={EARTH_LIT} dark={EARTH_DARK} sunDir={earthSun} lines pxRef={earthPx} />}
          {detail.earth === 2 && (
            <>
              <Ray dir={earthSun} color={SUN} casing={INK} beyondPx={26} lenRef={earthRay.sun} />
              <Ray dir={earthMoon} color={MOON_LINE} casing={PAPER} beyondPx={26} maxLen={((geo.pairRadii * moonR) / earthR) * 0.55} lenRef={earthRay.moon} />
              {fanSite && <AzimuthFan site={fanSite} />}
            </>
          )}
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

function FaceButton({ on = false, onClick, children }: { on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <ToggleButton on={on} onClick={onClick}>
      {children}
    </ToggleButton>
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
      <path d={d} fill={RENDER.moonLit} transform={waxing ? undefined : "scale(-1 1)"} />
      <circle r={r} fill="none" stroke={INK} strokeWidth={1} />
    </svg>
  );
}

function fmtLight(s: number) {
  if (s < 60) return `${s.toFixed(3)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

function Legend({ launch }: { launch: boolean }) {
  const item = "flex items-center gap-2.5 py-1 text-[0.844rem] leading-snug text-ink-2";
  return (
    <ul>
      <LineLegend item={item} />
      {launch && <LaunchLegend item={item} />}
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

function Readout({
  state,
  siteName,
  sunEl,
  earthEl,
  earthFrame,
  launchSite,
}: {
  state: SystemState;
  siteName?: string;
  sunEl?: number | null;
  earthEl?: number | null;
  earthFrame: EarthFrame | null;
  launchSite: LaunchSiteMark | null;
}) {
  const el = (v?: number | null) => (v == null || !Number.isFinite(v) ? "Not available" : fmtSigned(v, 2));
  return (
    <div>
      <SectionLabel>Circumstances</SectionLabel>
      <table className="w-full border-collapse">
        <tbody>
          <Row label="Time" value={fmtFull(state.ms)} />
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
          <SectionLabel className="mt-6">At {siteName}</SectionLabel>
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

      {earthFrame && (
        <>
          <SectionLabel className="mt-6">On Earth</SectionLabel>
          <table className="w-full border-collapse">
            <tbody>
              <Row label="Sun overhead at" value={fmtPlace(earthFrame.subSolar)} />
              <Row label="Moon overhead at" value={fmtPlace(earthFrame.subLunar)} />
              {launchSite && (
                <>
                  <Row label="Launch site" value={launchSite.name} note={fmtPlace(launchSite)} />
                  <Row label="Sun elevation there" value={fmtSigned(elevationDeg(launchSite.lat, launchSite.lon, earthFrame.sunKm, EARTH_RADIUS_KM), 1)} />
                  <Row label="Moon elevation there" value={fmtSigned(elevationDeg(launchSite.lat, launchSite.lon, earthFrame.moonKm, EARTH_RADIUS_KM), 1)} />
                </>
              )}
            </tbody>
          </table>
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

const FAR: Detail = { rays: false, onBody: false, close: false, step: 12, earth: 0, speck: { sun: false, earth: false, moon: false } };

export default function SystemView({
  nowMs,
  onScrub,
  siteName,
  sunElevationDeg,
  earthElevationDeg,
  windowMs,
  onOpenMoon,
  entry,
  levelNav,
  launchSites,
  selectedLaunchSiteId,
  onSelectLaunchSite,
  transferArc,
  className = "",
  inspector,
}: SystemViewProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [scale, setScale] = useState<Scale>("display");
  const [framing, setFraming] = useState<Framing>(() => (entry === "below" ? { id: "pair", start: "near" } : { id: "system", start: "default" }));
  const [focus, setFocus] = useState<FocusState>(() => ({ id: entry === "below" ? "moon" : "both", auto: false }));
  // Set when zooming in on the pair has moved the focus to a body, and shown for a moment as a note.
  const [nudge, setNudge] = useState<Focus | null>(null);
  const [playing, setPlaying] = useState(false);
  const [gl] = useState(hasWebGL);
  const [textures, setTextures] = useState<Textures | null>(null);
  const [fine, setFine] = useState<FineTextures | null>(null);
  const [detail, setDetail] = useState<Detail>(FAR);
  const [earthMap, setEarthMap] = useState<Texture | null>(null);
  const [ownSite, setOwnSite] = useState<string | null>(null);
  // Where the Earth framing looks: a fixed direction on Earth, or with none the selected launch site. n counts the requests.
  const [aim, setAim] = useState<{ dir: Vec3 | null; n: number }>({ dir: null, n: 0 });

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
    // Earth's map likewise: the 2k one first, the 4k one over it; without either Earth is the plain cobalt globe.
    loadEarthTexture().then(
      (t) => live && setEarthMap((prev) => prev ?? t),
      () => undefined,
    );
    loadFineEarthTexture().then(
      (t) => live && setEarthMap(t),
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
  const earthFrame = useMemo(() => (data ? earthFrameAt(data, ms) : null), [data, ms]);
  const launchId = selectedLaunchSiteId !== undefined ? selectedLaunchSiteId : ownSite;
  const launchSite = useMemo(() => launchSites?.find((s) => s.id === launchId) ?? null, [launchSites, launchId]);
  const facing = useMemo<Facing>(
    () => ({ dir: aim.dir ?? (launchSite ? onEarth(launchSite.lat, launchSite.lon) : null), key: `${aim.n}:${aim.dir ? "" : (launchSite?.id ?? "")}` }),
    [aim, launchSite],
  );
  const chooseSite = useCallback(
    (id: string) => {
      setOwnSite(id);
      setAim((a) => ({ dir: null, n: a.n + 1 }));
      onSelectLaunchSite?.(id);
    },
    [onSelectLaunchSite],
  );
  const earthRay = useMemo(() => ({ sun: { current: 1.13 }, moon: { current: 1.13 } }), []);

  const overlay = useRef<HTMLDivElement>(null);
  const rig = useRef<RigApi | null>(null);
  const discs = useRef<Discs>({ ex: 0, ey: 0, er: 0, mx: 0, my: 0, mr: 0 });
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hostEl = useRef<HTMLDivElement | null>(null);
  const pressed = useRef<{ x: number; y: number } | null>(null);
  // Where the two discs stand, for the pointer and for tests.
  const onDiscs = useCallback((ex: number, ey: number, er: number, mx: number, my: number, mr: number) => {
    discs.current = { ex, ey, er, mx, my, mr };
    if (hostEl.current) hostEl.current.dataset.bodies = [ex, ey, er, mx, my, mr].map((v) => v.toFixed(1)).join(",");
  }, []);
  const onFocus = useCallback((id: Focus, auto: boolean) => {
    setFocus((prev) => (prev.id === id && prev.auto === auto ? prev : { id, auto }));
    setNudge(auto && id !== "both" ? id : null);
  }, []);
  const pick = useCallback((id: Focus) => onFocus(id, false), [onFocus]);
  useEffect(() => {
    if (!nudge) return;
    const timer = window.setTimeout(() => setNudge(null), 2600);
    return () => window.clearTimeout(timer);
  }, [nudge]);
  const rayLen = useMemo(() => ({ sun: { current: 1.13 }, earth: { current: 1.13 } }), []);
  const months = useMemo(() => (data ? monthPoints(data) : []), [data]);
  const geo = useMemo(() => (state ? geometry(state, scale, framing.id) : null), [state, scale, framing.id]);
  const dayMs = Math.floor(ms / HOUR);
  const days = useMemo(() => (data ? dayTicks(data, dayMs * HOUR, scale === "display" ? PAIR_STRETCH : 1) : []), [data, dayMs, scale]);
  // The transfer line: from where the site stands at launch to where the Moon is at arrival, both about Earth as it is
  // drawn now, bowed back against the Moon's motion as a transfer ellipse is. A sketch of the route, not a trajectory.
  const arc = useMemo<Arc | null>(() => {
    const from = transferArc ? launchSites?.find((s) => s.id === transferArc.launchSiteId) : null;
    if (!data || !geo || !transferArc || !from) return null;
    const moonAt = (t: number): Vec3 => {
      const p = positionsAt(data, t);
      return toScene([p.moon[0] - p.earth[0], p.moon[1] - p.earth[1], p.moon[2] - p.earth[2]], U * geo.stretch);
    };
    const a = toScene(equatorialToEcliptic(earthFixedToEquatorial(latLonToEarthFixed(from.lat, from.lon), earthAxes(transferArc.launchMs))), geo.earthR);
    const end = moonAt(transferArc.arrivalMs);
    const motion = unit(add(moonAt(transferArc.arrivalMs + HOUR), mul(end, -1)));
    const chord = add(end, mul(a, -1));
    const len = Math.hypot(chord[0], chord[1], chord[2]);
    const b = add(end, mul(chord, -geo.moonR / len));
    const c = add(mul(add(a, b), 0.5), mul(motion, -0.14 * len));
    const points: Vec3[] = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      points.push(add(add(mul(a, (1 - t) * (1 - t)), mul(c, 2 * t * (1 - t))), mul(b, t * t)));
    }
    // Its name stands at the middle, or in the Earth framing a few Earth radii out, where it can be seen.
    return { points, mid: points[framing.id === "earth" ? 3 : 24], end, dash: framing.id === "earth" ? geo.earthR * 0.12 : len * 0.012 };
  }, [data, geo, transferArc, launchSites, framing.id]);
  // The bearing marks keep about the same length on screen, and match the Moon level's where the two levels meet.
  const bearingLen = Math.min(0.3, Math.max(0.03, 0.073 * 1.1 ** detail.step));

  const labels = useMemo<SysLabel[]>(() => {
    if (!geo || !state || !frame) return [];
    const { earth } = geo;
    const { speck } = detail;
    const onPair = framing.id === "pair";
    const out: SysLabel[] = [];
    const push = (key: string, anchor: Anchor, pri: number, node: ReactNode, more?: Partial<Label>) => out.push({ key, at: ORIGIN, anchor, pri, node, ...more });
    push("sun", { kind: "limb", body: "sun", side: 1 }, 0, <BodyTag text="Sun" speck={speck.sun} />, { free: true });
    push("earth", { kind: "limb", body: "earth", side: 1 }, 0, <BodyTag text="Earth" speck={speck.earth} onPick={onPair ? () => pick("earth") : undefined} />, { free: true });
    if (detail.onBody) {
      push("moon", { kind: "limb", body: "moon", side: 1 }, 0, <BodyTag text="Moon" speck={false} onPick={onPair ? () => pick("moon") : undefined} />, { free: true });
      if (site) push("site", { kind: "moon", at: onGlobe(site.lat, site.lon) }, 0, <SiteFlag text={site.name} />, { dot: 6 });
      push("cluster", { kind: "moon", at: CLUSTER_AT }, 2, <ClusterMark onOpen={() => onOpenMoon?.()} hint="Open the Moon level to tell them apart." />, { dot: 8 });
    } else {
      push("moon", { kind: "limb", body: "moon", side: -1 }, 0, <BodyTag text={onPair ? "Moon" : "Moon · 9 candidate regions"} sub={site?.name} speck={speck.moon} below onPick={onPair ? () => pick("moon") : undefined} />, { free: true });
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
    if (launchSites && detail.earth > 0) {
      for (const s of launchSites) {
        const on = s.id === launchId;
        push(
          `launch-${s.id}`,
          { kind: "earth", at: onEarth(s.lat, s.lon, 1.003) },
          on ? 0 : 3,
          <LaunchSiteTag site={s} selected={on} named={detail.earth === 2} onSelect={() => chooseSite(s.id)} />,
          { dot: 6, float: !on },
        );
      }
    }
    if (detail.earth === 2 && earthFrame) {
      push("earth-to-sun", { kind: "earth", at: bodyToScene(earthFrame.sunDir), len: earthRay.sun }, 1, <BearingTag text={LINE_NAMES.sun} className="text-sun-ink" />, { dot: 9, float: true });
      push("earth-to-moon", { kind: "earth", at: bodyToScene(earthFrame.moonDir), len: earthRay.moon }, 1, <BearingTag text="To the Moon" className="text-ink" />, { dot: 9, float: true });
      push("over-sun", { kind: "earth", at: bodyToScene(earthFrame.sunDir, 1.003) }, 2, <OverheadTag text="Sun overhead" className="border-ink bg-sun" />, { dot: 6, float: true });
      push("over-moon", { kind: "earth", at: bodyToScene(earthFrame.moonDir, 1.003) }, 2, <OverheadTag text="Moon overhead" className="border-ink bg-paper" />, { dot: 6, float: true });
    }
    if (arc) {
      push("transfer", { kind: "point", at: add(earth, arc.mid) }, 1, <BearingTag text="Transfer, estimate" className="text-ink" />, { float: true });
      push("arrival", { kind: "point", at: add(earth, arc.end) }, 2, <OverheadTag text="Moon at arrival" className="border-ink bg-paper" />, { dot: 6, float: true, free: true });
    }
    months.forEach((p, i) => push(MONTHS[i], { kind: "point", at: mul(p, 1.075) }, 4, <CentredTag text={MONTHS[i]} className="font-medium text-ink-2" />));
    if (framing.id === "pair") {
      // The distance stands on the line between the two, clear of whichever body the view has closed on.
      const k = focus.id === "both" ? 0.5 : focus.id === "moon" ? 0.62 : 0.38;
      push(
        "pair-km",
        { kind: "point", at: add(earth, mul(add(geo.moon, mul(earth, -1)), k)) },
        0,
        <CentredTag text={`${fmtInt(state.earthMoonKm)} km`} className="border border-rule bg-paper px-1.5 text-ink tabular-nums" />,
        { free: true },
      );
      for (const t of days) {
        if ((new Date(t.ms).getUTCDate() - 1) % 7) continue;
        push(`day-${t.ms}`, { kind: "point", at: add(earth, mul(t.at, 1.09)) }, 5, <CentredTag text={DAY_LABEL.format(t.ms)} className="font-medium text-ink-2" />);
      }
    }
    return out;
  }, [geo, state, frame, framing.id, focus.id, pick, months, days, detail, site, bearingLen, onOpenMoon, launchSites, launchId, chooseSite, earthFrame, earthRay, arc]);

  // The zoom chain: Sun–Earth–Moon, then Earth–Moon, then by its focus down to the Moon level or into the Earth
  // framing. With the pair framed, zooming in first moves the focus to a body (the rig does that). Zooming out of the
  // Earth framing returns to Earth–Moon about Earth.
  const zoomIn = useCallback(() => {
    if (framing.id === "system") {
      setFocus({ id: "both", auto: false });
      setFraming({ id: "pair", start: "far" });
    } else if (framing.id === "pair" && focus.id === "moon") onOpenMoon?.();
    else if (framing.id === "pair" && focus.id === "earth") setFraming({ id: "earth", start: "far" });
  }, [framing.id, focus.id, onOpenMoon]);
  const zoomOut = useCallback(() => {
    if (framing.id === "earth") {
      setFocus({ id: "earth", auto: false });
      setFraming({ id: "pair", start: "near" });
    } else setFraming({ id: "system", start: "near" });
  }, [framing.id]);
  const canIn = framing.id === "system" || (framing.id === "pair" && (focus.id === "earth" || (focus.id === "moon" && Boolean(onOpenMoon))));
  const canOut = framing.id !== "system";
  const { setHost, report, rearm, hint, progress } = useZoomGate({ onIn: canIn ? zoomIn : undefined, onOut: canOut ? zoomOut : undefined });
  const hostRef = useCallback(
    (el: HTMLDivElement | null) => {
      hostEl.current = el;
      setHost(el);
    },
    [setHost],
  );
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
        const onEarthLevel = m.earthPx > (prev.earth === 2 ? 140 : 155) ? 2 : m.earthPx > (prev.earth > 0 ? 92 : 100) ? 1 : 0;
        const sun = m.sunPx < 5;
        const earth = m.earthPx < 5;
        const moon = m.moonPx < 5;
        const same = onEarthLevel === prev.earth && rays === prev.rays && onBody === prev.onBody && close === prev.close && step === prev.step && sun === prev.speck.sun && earth === prev.speck.earth && moon === prev.speck.moon;
        return same ? prev : { rays, onBody, close, step, earth: onEarthLevel, speck: { sun, earth, moon } };
      });
    },
    [report],
  );
  const inText = framing.id === "system" ? "Keep zooming in for the Earth–Moon framing" : focus.id === "earth" ? "Keep zooming to open the Earth view" : "Keep zooming to open the Moon level";
  const inLabel = framing.id === "system" ? "Earth–Moon framing" : focus.id === "earth" ? "Open Earth view" : "Open Moon level";
  const hintText =
    hint === "in"
      ? inText
      : hint === "out"
        ? framing.id === "earth"
          ? "Keep zooming out for the Earth–Moon framing"
          : "Keep zooming out for the Sun–Earth–Moon framing"
        : framing.id === "pair" && nudge && nudge === focus.id && (nudge === "earth" || onOpenMoon)
          ? inText
          : null;
  const hintAction = !hintText
    ? null
    : hint === "out"
      ? { label: framing.id === "earth" ? "Earth–Moon framing" : "Sun–Earth–Moon framing", onClick: zoomOut }
      : { label: inLabel, onClick: zoomIn };

  // A click or double-click on a body centres the view on it; a double-click on empty paper frames both again.
  const bodyAt = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }): Focus | null => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const d = discs.current;
    const moon = Math.hypot(d.mx - x, d.my - y) - Math.max(d.mr, 12);
    const earth = Math.hypot(d.ex - x, d.ey - y) - Math.max(d.er, 12);
    return Math.min(moon, earth) > 5 ? null : moon <= earth ? "moon" : "earth";
  };
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey || !rig.current) return;
    const turn = 8 * RAD;
    if (e.key === "ArrowLeft") rig.current.orbit(-turn, 0);
    else if (e.key === "ArrowRight") rig.current.orbit(turn, 0);
    else if (e.key === "ArrowUp") rig.current.orbit(0, -turn);
    else if (e.key === "ArrowDown") rig.current.orbit(0, turn);
    else if (e.key === "+" || e.key === "=") {
      // On a limit the key does what the wheel's last notches do.
      if (rig.current.zoom(1 / 1.25) === "in" && canIn) zoomIn();
    } else if (e.key === "-" || e.key === "_") {
      if (rig.current.zoom(1.25) === "out" && canOut) zoomOut();
    } else return;
    e.preventDefault();
  };

  const span = useMemo(() => (data ? { startMs: data.startMs, endMs: systemEndMs(data) } : null), [data]);
  useYearPlayback(playing, span, ms, onScrub);

  const earthNote =
    " Earth is NASA's Blue Marble printed as sea, land relief and coastline, turned by Earth's rotation angle for this time, so the lit side and the marks are true. Ecliptic north is up, so Earth's axis leans 23.4°. Launch azimuths are measured clockwise from north.";
  const caption =
    framing.id === "earth"
      ? (scale === "display"
          ? "Earth framing: Earth and the Moon are drawn to one scale here, the Moon about 60 Earth radii away along the line to it, so it is usually out of view."
          : "Earth framing, true scale.") + earthNote
      : (framing.id === "pair"
          ? "Earth–Moon framing: drag to turn the view about its centre (both bodies, Earth or the Moon), scroll to zoom towards it; click a body or its name to centre on it, double-click empty paper for both. With the diagram focused, the arrow keys turn it and + and − zoom. "
          : "") +
        (scale === "display"
      ? `Display scale, not to scale: Earth and the Moon are drawn ${BODY_STRETCH} times too large, the Sun ${SUN_STRETCH} times, and the Earth to Moon distance ${PAIR_STRETCH} times too long, so all three can be seen at once. Positions, the Moon's orientation, the terminator and the table are true; the line to the Sun keeps its true direction, which the stretch can leave up to 7° off the Sun as drawn.`
      : "True scale: sizes and distances keep their real ratios, so the bodies are specks inside the rings that mark them. Zoom in on the Earth–Moon framing to find them; the lines from the Moon and its terminator are true.");

  // The side panel, beside the view or in the workspace inspector.
  const panel = (
    <>
        {state ? (
          <Readout state={state} siteName={siteName} sunEl={sunElevationDeg} earthEl={earthElevationDeg} earthFrame={earthFrame} launchSite={launchSite} />
        ) : (
          <p className="text-[0.844rem] text-ink-2">{load.status === "error" ? "No values to show." : "Loading values"}</p>
        )}
        <SectionLabel className="mt-6">Marks</SectionLabel>
        <div className="mt-1.5">
          <Legend launch={Boolean(launchSites?.length)} />
        </div>
        <p className="mt-6 border-t border-rule pt-3 text-[0.8rem] leading-snug text-ink-2">
          Positions: NASA/JPL Horizons vector tables for Earth and the Moon, hourly through 2027, heliocentric ecliptic
          J2000; values between the hours are interpolated. The Moon&apos;s orientation: IAU/WGCCRE rotation model; its
          surface: NASA SVS CGI Moon Kit maps from Lunar Reconnaissance Orbiter data. Earth&apos;s orientation: the
          Earth Rotation Angle about the pole of date; its surface: NASA Earth Observatory Blue Marble Next Generation
          (July 2004, topography and bathymetry), printed here as sea, land relief and coastline.
        </p>
    </>
  );

  return (
    <div className={`flex min-h-0 flex-col xl:flex-row ${className}`}>
      <section aria-label="Sun, Earth and Moon diagram" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-rule px-4 py-2.5">
          <h2 className="text-[1.068rem] leading-snug font-semibold text-ink">
            The Sun, Earth and Moon{state ? `, ${fmtFull(state.ms)}` : ""}
          </h2>
          <div className="flex flex-wrap gap-2.5">
            <Segmented
              label="Framing"
              value={framing.id}
              onChange={(id) => {
                setFraming({ id, start: "default" });
                setFocus({ id: "both", auto: false });
                // The Earth framing opens over the selected launch site, or with none over the day side.
                if (id === "earth") setAim((a) => ({ dir: launchSite || !earthFrame ? null : bodyToScene(earthFrame.sunDir), n: a.n + 1 }));
              }}
              options={[
                { id: "system", label: "Sun–Earth–Moon" },
                { id: "pair", label: "Earth–Moon" },
                { id: "earth", label: "Earth" },
              ]}
            />
            <Segmented
              label="Scale"
              value={scale}
              onChange={(v) => {
                setScale(v);
                // The view opens afresh at the new scale, about the focus it has.
                setFraming((f) => ({ id: f.id, start: "default" }));
              }}
              options={[
                { id: "display", label: "Display scale" },
                { id: "true", label: "True scale" },
              ]}
            />
          </div>
        </header>

        {framing.id === "earth" && earthFrame && (
          <div className="flex items-start gap-3 border-b border-rule px-4 py-2">
            <span id="face-label" className="pt-1.5 text-[0.75rem] font-semibold tracking-[0.08em] text-ink uppercase">
              Face
            </span>
            <div role="group" aria-labelledby="face-label" className="flex min-w-0 flex-wrap gap-1.5">
              {launchSites?.map((s) => (
                <FaceButton key={s.id} on={s.id === launchId && !aim.dir} onClick={() => chooseSite(s.id)}>
                  {s.name}
                </FaceButton>
              ))}
              <FaceButton onClick={() => setAim((a) => ({ dir: bodyToScene(earthFrame.sunDir), n: a.n + 1 }))}>Day side</FaceButton>
              <FaceButton onClick={() => setAim((a) => ({ dir: bodyToScene(earthFrame.moonDir), n: a.n + 1 }))}>Moon overhead</FaceButton>
            </div>
          </div>
        )}

        {framing.id === "pair" && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule px-4 py-2">
            <span className="text-[0.75rem] font-semibold tracking-[0.08em] text-ink uppercase">Centre on</span>
            <Segmented
              label="Centre the view on"
              value={focus.id}
              onChange={pick}
              options={[
                { id: "both", label: "Both" },
                { id: "earth", label: "Earth" },
                { id: "moon", label: "Moon" },
              ]}
            />
            <div role="group" aria-label="View presets" className="flex flex-wrap gap-1.5">
              <FaceButton onClick={() => rig.current?.preset("top")}>Top view</FaceButton>
              <FaceButton onClick={() => rig.current?.preset("side")}>Side view</FaceButton>
              <FaceButton
                onClick={() => {
                  rig.current?.preset("reset");
                  pick("both");
                }}
              >
                Reset view
              </FaceButton>
            </div>
          </div>
        )}

        <div
          ref={hostRef}
          tabIndex={0}
          role="group"
          aria-label="Diagram. Arrow keys turn the view; plus and minus zoom."
          data-framing={framing.id}
          data-focus={framing.id === "pair" ? focus.id : undefined}
          onKeyDown={onKey}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            pointer.current = { x: e.clientX - box.left, y: e.clientY - box.top };
          }}
          onPointerLeave={() => {
            pointer.current = null;
          }}
          onPointerDown={(e) => {
            pressed.current = { x: e.clientX, y: e.clientY };
          }}
          onClick={(e) => {
            const from = pressed.current;
            if (framing.id !== "pair" || !(e.target instanceof HTMLCanvasElement) || !from || Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;
            const body = bodyAt(e);
            if (body) pick(body);
          }}
          onDoubleClick={(e) => {
            if (framing.id === "pair" && e.target instanceof HTMLCanvasElement) pick(bodyAt(e) ?? "both");
          }}
          className="relative isolate min-h-[22rem] flex-1 overflow-hidden bg-paper focus-visible:outline-2 focus-visible:-outline-offset-2"
        >
          {levelNav && <div className="pointer-events-none absolute top-2 left-2 z-20">{levelNav}</div>}
          <ZoomHint text={hintText} progress={progress} action={hintAction} />
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
                  className={`mt-3 ${buttonClass.secondary}`}
                >
                  Try again
                </button>
              </div>
            </div>
          )}
          {data && state && !gl && <PlanFallback data={data} state={state} />}
          {data && state && frame && earthFrame && geo && gl && (
            <ErrorBoundary fallback={<PlanFallback data={data} state={state} />}>
              <Canvas
                flat
                frameloop="demand"
                dpr={[1, 2]}
                camera={{ fov: FOV, position: [0, 260, 203], near: 1, far: 5000 }}
                gl={{ antialias: true }}
                aria-label="3D diagram of the Sun, Earth and Moon. Drag to turn, scroll to zoom; zooming past a limit changes the framing or opens the Moon level. In the Earth–Moon framing, click a body to centre the view on it."
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
                  earthMap={earthMap}
                  earthFrame={earthFrame}
                  earthRay={earthRay}
                  facing={facing}
                  fanSite={launchSite}
                  arc={arc}
                  focus={focus}
                  onFocus={onFocus}
                  apiRef={rig}
                  onDiscs={onDiscs}
                  pointer={pointer}
                />
              </Canvas>
              <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden">
                {labels.map((l) => (
                  <div key={l.key} className="invisible absolute top-0 left-0">
                    {l.node}
                  </div>
                ))}
              </div>
            </ErrorBoundary>
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

      {inspector === undefined ? (
        <aside className="shrink-0 border-t border-ink px-4 py-4 xl:w-[21.5rem] xl:overflow-y-auto xl:border-t-0 xl:border-l">{panel}</aside>
      ) : inspector ? (
        createPortal(<div className="px-4 py-4">{panel}</div>, inspector)
      ) : null}
    </div>
  );
}

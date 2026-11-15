"use client";

// System level: the Sun, Earth and Moon from JPL Horizons vectors, drawn as a
// printed orbit diagram and driven by the Navigator's clock.

import { Component, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { BackSide, Color, Quaternion, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
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

export type SystemViewProps = {
  nowMs: number;
  onScrub?: (ms: number) => void;
  siteName?: string;
  /** Elevation of the Sun's and Earth's centres above the site's level horizon at nowMs, in degrees. */
  sunElevationDeg?: number | null;
  earthElevationDeg?: number | null;
  /** The mission window, marked on the year rail. */
  windowMs?: { startMs: number; endMs: number };
  /** Shows an "Open Moon level" button that steps down to the Moon globe. */
  onOpenMoon?: () => void;
  className?: string;
};

type Scale = "display" | "true";
type Framing = "system" | "pair";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Scene units per km: 1 au is 100 units. */
const U = 100 / AU_KM;
/** Display scale: how far the Earth-Moon distance and the body radii are stretched. */
const PAIR_STRETCH = 50;
const BODY_STRETCH = 800;
const SUN_STRETCH = 15;

const INK = "#121a22";
const INK_2 = "#3a4752";
const RULE = "#b9c3c2";
const PAPER = "#eef1f0";
const SUN = "#f0b400";
const SUN_INK = "#7a5600";
const EARTH_LIT = "#2453c2";
const EARTH_DARK = "#1c2b47";
const MOON_LIT = "#c4cacb";
const UMBRA = "#3d5466";

/** Ecliptic x, y, z in km to scene units with ecliptic north up. */
const toScene = (v: Vec3, k = U): Vec3 => [v[0] * k, v[2] * k, -v[1] * k];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec3): Vec3 => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtSigned = (n: number, digits = 1) => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(digits)}°`;

// ---------- Scene ----------

const BODY_VERT = /* glsl */ `
  varying vec3 vN;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
// Flat two-tone shading with a crisp terminator, as a printed diagram would show it.
const BODY_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uLit;
  uniform vec3 uDark;
  varying vec3 vN;
  void main() {
    float t = smoothstep(-0.02, 0.02, dot(normalize(vN), uSunDir));
    gl_FragColor = vec4(mix(uDark, uLit, t), 1.0);
    #include <colorspace_fragment>
  }
`;

function Outline({ radius }: { radius: number }) {
  return (
    <mesh scale={1.06}>
      <sphereGeometry args={[radius, 48, 24]} />
      <meshBasicMaterial color={INK} side={BackSide} toneMapped={false} />
    </mesh>
  );
}

function LitBody({ position, radius, lit, dark, sunDir }: { position: Vec3; radius: number; lit: string; dark: string; sunDir: Vec3 }) {
  const uniforms = useMemo(
    () => ({ uSunDir: { value: new Vector3(1, 0, 0) }, uLit: { value: new Color(lit) }, uDark: { value: new Color(dark) } }),
    [lit, dark],
  );
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[radius, 64, 32]} />
        <shaderMaterial vertexShader={BODY_VERT} fragmentShader={BODY_FRAG} uniforms={uniforms} uniforms-uSunDir-value={sunDir} />
      </mesh>
      <Outline radius={radius} />
    </group>
  );
}

// Labels are plain DOM over the canvas; the scene projects their anchor points each frame.

type Label = { key: string; at: Vec3; node: ReactNode };

const LABEL_TEXT = "text-[0.69rem] leading-4 font-semibold tracking-[0.1em] whitespace-nowrap uppercase select-none";

/** A body's name on a short leader; in true scale a ring marks the speck. */
function BodyTag({ text, speck, below = false }: { text: string; speck: boolean; below?: boolean }) {
  const lead = below ? (speck ? "top-[6px] h-6" : "top-0 h-5") : speck ? "bottom-[6px] h-6" : "bottom-0 h-5";
  const name = below ? (speck ? "top-[30px]" : "top-5") : speck ? "bottom-[30px]" : "bottom-5";
  return (
    <div className="relative">
      {speck && <span className="absolute -top-[6px] -left-[6px] block size-[12px] rounded-full border border-ink" />}
      <span className={`absolute left-0 block w-px bg-ink ${lead}`} />
      <span className={`absolute left-0 block bg-paper/85 pr-1 pl-1.5 text-ink ${LABEL_TEXT} ${name}`}>{text}</span>
    </div>
  );
}

function CentredTag({ text, className }: { text: string; className: string }) {
  return <span className={`absolute block -translate-x-1/2 -translate-y-1/2 ${LABEL_TEXT} ${className}`}>{text}</span>;
}

function LabelProjector({ points, overlay }: { points: Vec3[]; overlay: RefObject<HTMLDivElement | null> }) {
  const v = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const host = overlay.current;
    if (!host) return;
    camera.updateMatrixWorld();
    for (let i = 0; i < points.length; i++) {
      const el = host.children[i] as HTMLElement | undefined;
      if (!el) continue;
      v.set(points[i][0], points[i][1], points[i][2]).project(camera);
      const shown = v.z > -1 && v.z < 1;
      el.style.setProperty("visibility", shown ? "visible" : "hidden");
      if (shown) el.style.setProperty("transform", `translate3d(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px, 0)`);
    }
  });
  return null;
}

type Geometry = {
  /** Scene positions relative to the Sun. */
  earth: Vec3;
  moon: Vec3;
  focus: Vec3;
  sunR: number;
  earthR: number;
  moonR: number;
  stretch: number;
  pairReach: number;
  earthToSun: Vec3;
  speck: boolean;
};

function geometry(state: SystemState, scale: Scale, framing: Framing): Geometry {
  const stretch = scale === "display" ? PAIR_STRETCH : 1;
  const bodyK = scale === "display" ? BODY_STRETCH : 1;
  const earth = toScene(state.earth);
  const rel: Vec3 = [state.moon[0] - state.earth[0], state.moon[1] - state.earth[1], state.moon[2] - state.earth[2]];
  return {
    earth,
    moon: add(earth, toScene(rel, U * stretch)),
    focus: framing === "system" ? [0, 0, 0] : earth,
    sunR: SUN_RADIUS_KM * U * (scale === "display" ? SUN_STRETCH : 1),
    earthR: EARTH_RADIUS_KM * U * bodyK,
    moonR: MOON_RADIUS_KM * U * bodyK,
    stretch,
    pairReach: 384_400 * U * stretch,
    earthToSun: unit(mul(earth, -1)),
    speck: scale === "true",
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

const UP = new Vector3(0, 1, 0);

function SunArrow({ from, dir, reach }: { from: Vec3; dir: Vec3; reach: number }) {
  const a = add(from, mul(dir, reach * 1.1));
  const b = add(from, mul(dir, reach * 1.3));
  const quaternion = new Quaternion().setFromUnitVectors(UP, new Vector3(...dir));
  return (
    <>
      <Line points={[a, b]} color={SUN_INK} lineWidth={1.5} />
      <mesh position={b} quaternion={quaternion}>
        <coneGeometry args={[reach * 0.022, reach * 0.08, 16]} />
        <meshBasicMaterial color={SUN_INK} toneMapped={false} />
      </mesh>
    </>
  );
}

/** Camera placement and limits for each framing; the scene keeps the framed body at the origin. */
function Rig({ framing, pairReach }: { framing: Framing; pairReach: number }) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const base = framing === "system" ? 365 : pairReach * 4.8;
  const narrow = Math.max(1, 1.35 / aspect);

  useEffect(() => {
    const d = base * narrow;
    const tilt = ((framing === "system" ? 52 : 58) * Math.PI) / 180;
    camera.position.set(0, d * Math.sin(tilt), d * Math.cos(tilt));
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
    invalidate();
  }, [camera, base, narrow, framing, invalidate]);

  useFrame(({ camera: cam }) => {
    const d = cam.position.length();
    cam.near = d / 200;
    cam.far = d * 50 + 250;
    cam.updateProjectionMatrix();
  }, -1);

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      enableDamping={false}
      minDistance={base * 0.12}
      maxDistance={base * narrow * 2.2}
      minPolarAngle={0.08}
      maxPolarAngle={Math.PI / 2 - 0.06}
      rotateSpeed={0.6}
    />
  );
}

function Scene({
  data,
  state,
  geo,
  framing,
  months,
  labelPoints,
  overlay,
}: {
  data: SystemData;
  state: SystemState;
  geo: Geometry;
  framing: Framing;
  months: Vec3[];
  labelPoints: Vec3[];
  overlay: RefObject<HTMLDivElement | null>;
}) {
  const { earth, moon, focus, sunR, earthR, moonR, stretch, pairReach, earthToSun } = geo;
  const moonToSun = unit(mul(moon, -1));

  const orbit = useMemo(() => {
    const pts: Vec3[] = [];
    for (let i = 0; i < data.count; i += 6) pts.push(toScene([data.earth[i * 3], data.earth[i * 3 + 1], data.earth[i * 3 + 2]]));
    return pts;
  }, [data]);

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

  return (
    <>
      <color attach="background" args={[PAPER]} />
      <Rig framing={framing} pairReach={pairReach} />
      <LabelProjector points={labelPoints} overlay={overlay} />
      <group position={mul(focus, -1)}>
        <Line points={orbit} color={INK_2} lineWidth={1} />
        <Line points={[[0, 0, 0], earth]} color={RULE} lineWidth={1} />
        {framing === "system" && months.map((p, i) => <Line key={i} points={[mul(p, 0.975), mul(p, 1.025)]} color={INK} lineWidth={1} />)}

        <group>
          <mesh>
            <sphereGeometry args={[sunR, 48, 24]} />
            <meshBasicMaterial color={SUN} toneMapped={false} />
          </mesh>
          <Outline radius={sunR} />
        </group>

        <group position={earth}>
          <Line points={moonPath} color={INK} lineWidth={1} />
        </group>
        <Line points={[earth, moon]} color={RULE} lineWidth={1} />

        <LitBody position={earth} radius={earthR} lit={EARTH_LIT} dark={EARTH_DARK} sunDir={earthToSun} />
        <LitBody position={moon} radius={moonR} lit={MOON_LIT} dark={UMBRA} sunDir={moonToSun} />

        {framing === "pair" && <SunArrow from={earth} dir={earthToSun} reach={pairReach} />}
      </group>
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

function fmtLight(s: number) {
  if (s < 60) return `${s.toFixed(3)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

function Readout({ state, siteName, sunEl, earthEl }: { state: SystemState; siteName?: string; sunEl?: number | null; earthEl?: number | null }) {
  const el = (v?: number | null) => (v == null || !Number.isFinite(v) ? "Not available" : fmtSigned(v, 2));
  return (
    <div>
      <h3 className="border-b border-ink pb-1.5 text-[0.75rem] font-semibold tracking-[0.08em] text-ink uppercase">Circumstances</h3>
      <table className="w-full border-collapse">
        <tbody>
          <Row label="Time" value={fmtUtc(state.ms)} />
          <Row label="Earth to Sun" value={`${state.sunEarthAu.toFixed(4)} au`} note={`${fmtInt(state.sunEarthKm / 1000)},000 km`} />
          <Row label="Earth to Moon" value={`${fmtInt(state.earthMoonKm)} km`} note={`${(state.earthMoonKm / EARTH_RADIUS_KM).toFixed(1)} Earth radii`} />
          <Row label="Moon illuminated" value={`${(state.illuminated * 100).toFixed(1)} %`} note={`Phase angle ${state.phaseAngleDeg.toFixed(1)}°`} />
          <Row label="Light time to Moon" value={fmtLight(state.lightTimeEarthMoonS)} note="one way" />
          <Row label="Light time from Sun" value={fmtLight(state.lightTimeSunEarthS)} />
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
          <h3 className="mt-6 border-b border-ink pb-1.5 text-[0.75rem] font-semibold tracking-[0.08em] text-ink uppercase">
            At {siteName}
          </h3>
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

export default function SystemView({ nowMs, onScrub, siteName, sunElevationDeg, earthElevationDeg, windowMs, onOpenMoon, className = "" }: SystemViewProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [scale, setScale] = useState<Scale>("display");
  const [framing, setFraming] = useState<Framing>("system");
  const [playing, setPlaying] = useState(false);
  const [gl] = useState(hasWebGL);

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

  const data = load.status === "ready" ? load.data : null;
  const ms = data ? Math.min(Math.max(nowMs, data.startMs), systemEndMs(data)) : nowMs;
  const state = useMemo(() => (data ? stateAt(data, ms) : null), [data, ms]);

  const overlay = useRef<HTMLDivElement>(null);
  const months = useMemo(() => (data ? monthPoints(data) : []), [data]);
  const geo = useMemo(() => (state ? geometry(state, scale, framing) : null), [state, scale, framing]);
  const labels = useMemo<Label[]>(() => {
    if (!geo || !state) return [];
    const { earth, moon, speck } = geo;
    const out: Label[] = [];
    if (framing === "system") {
      months.forEach((p, i) => out.push({ key: MONTHS[i], at: mul(p, 1.085), node: <CentredTag text={MONTHS[i]} className="font-medium text-ink-2" /> }));
      out.push({ key: "sun", at: [0, speck ? 0 : geo.sunR * 1.08, 0], node: <BodyTag text="Sun" speck={speck} /> });
    } else {
      out.push({
        key: "to-sun",
        at: add(earth, mul(geo.earthToSun, geo.pairReach * 1.42)),
        node: <CentredTag text={`To the Sun, ${state.sunEarthAu.toFixed(3)} au`} className="bg-paper/85 px-1 text-sun-ink" />,
      });
    }
    out.push({ key: "earth", at: add(earth, [0, speck ? 0 : geo.earthR * 1.08, 0]), node: <BodyTag text="Earth" speck={speck} /> });
    out.push({ key: "moon", at: add(moon, [0, speck ? 0 : -geo.moonR * 1.1, 0]), node: <BodyTag text="Moon" speck={speck} below /> });
    return out;
  }, [geo, state, framing, months]);
  const labelPoints = useMemo(() => (geo ? labels.map((l) => add(l.at, mul(geo.focus, -1))) : []), [labels, geo]);

  const span = useMemo(() => (data ? { startMs: data.startMs, endMs: systemEndMs(data) } : null), [data]);
  useYearPlayback(playing, span, ms, onScrub);

  const caption =
    scale === "display"
      ? `Display scale, not to scale: Earth and the Moon are drawn ${BODY_STRETCH} times too large, the Sun ${SUN_STRETCH} times, and the Earth to Moon distance ${PAIR_STRETCH} times too long, so all three can be seen at once. Positions, lighting and the table are true.`
      : "True scale: sizes and distances keep their real ratios, so the bodies are specks inside the rings that mark them. Zoom in on the Earth and Moon framing to find them.";

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
              value={framing}
              onChange={setFraming}
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
            {onOpenMoon && (
              <button
                type="button"
                onClick={onOpenMoon}
                className="h-8 border border-ink px-3 text-[0.8rem] font-medium whitespace-nowrap text-ink transition-colors duration-150 hover:bg-paper-3"
              >
                Open Moon level
              </button>
            )}
          </div>
        </header>

        <div className="relative isolate min-h-[22rem] flex-1 overflow-hidden bg-paper">
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
          {data && state && geo && gl && (
            <GlBoundary fallback={<PlanFallback data={data} state={state} />}>
              <Canvas
                flat
                frameloop="demand"
                dpr={[1, 2]}
                camera={{ fov: 35, position: [0, 260, 203], near: 1, far: 5000 }}
                gl={{ antialias: true }}
                aria-label="3D diagram of the Sun, Earth and Moon. Drag to turn, scroll to zoom."
                role="img"
              >
                <Scene data={data} state={state} geo={geo} framing={framing} months={months} labelPoints={labelPoints} overlay={overlay} />
              </Canvas>
              <div ref={overlay} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
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
        <p className="mt-6 border-t border-rule pt-3 text-[0.8rem] leading-snug text-ink-2">
          Positions: NASA/JPL Horizons vector tables for Earth and the Moon, hourly through 2027, heliocentric ecliptic
          J2000. Values between the hours are interpolated.
        </p>
      </aside>
    </div>
  );
}

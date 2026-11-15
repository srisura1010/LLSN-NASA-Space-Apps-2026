"use client";

// Moon level: the whole Moon as a printed relief globe, turned by the
// IAU/WGCCRE rotation model and lit from the Sun's real direction. It sits
// between the System level and the site-level terrain plate.

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { elevationDeg, moonFrameAt, type MoonFrame } from "@/lib/moonFrame";
import { sites, type Site } from "@/lib/sites";
import { EARTH_RADIUS_KM, loadSystem, stateAt, systemEndMs, type SystemData, type SystemState, type Vec3 } from "@/lib/system";
import YearSlider, { fmtUtc, useYearPlayback } from "../system/YearSlider";
import { ZoomHint } from "../levels/LevelNav";
import { useZoomGate } from "../levels/useZoomGate";
import { BearingTag, Bearing, CLUSTER_AT, ClusterMark, Flag, HIT, LABEL_TEXT, LINE_NAMES, LIFT, LineLegend, LabelProjector, OVER, POLE_DIR, RAY, Ray, arcTowards, handoff, onGlobe, toScene, type Label } from "./marks";
import { MoonGlobe, loadFineTextures, loadTextures, type FineTextures, type Textures } from "./moonMaterial";
import type { TileStatus } from "./tiles/TileLayer";

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
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtSigned = (n: number, digits = 2) => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(digits)}°`;
const fmtLat = (v: number, digits = 2) => `${Math.abs(v).toFixed(digits)}° ${v < 0 ? "S" : "N"}`;
const fmtLon = (v: number, digits = 2) => `${Math.abs(v).toFixed(digits)}° ${v < 0 ? "W" : "E"}`;

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
    handoff.moonDir = [cam.position.x / d, cam.position.y / d, cam.position.z / d];
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
  onTiles,
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
  /** Given when detail tiles are on; told what the tile layer is drawing and fetching. */
  onTiles: ((s: TileStatus) => void) | null;
}) {
  const tiles = useMemo(() => (onTiles ? { onStatus: onTiles } : null), [onTiles]);
  const sun = useMemo(() => toScene(frame.sunDir), [frame]);
  const earth = useMemo(() => toScene(frame.earthDir), [frame]);
  const from = useMemo(() => (site ? onGlobe(site.lat, site.lon) : null), [site]);
  return (
    <>
      <color attach="background" args={[PAPER]} />
      <Rig framing={framing} onView={onView} />
      <LabelProjector labels={labels} overlay={overlay} />
      <MoonGlobe textures={textures} fine={fine} sunDir={sun} tiles={tiles} />
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
      <LineLegend item={item} />
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
  // Detail tiles come from NASA Moon Trek as the view closes in; off, the globe is drawn from the bundled maps alone.
  const [detail, setDetail] = useState(true);
  const [tileStatus, setTileStatus] = useState<TileStatus | null>(null);
  const detailText = !detail
    ? "Detail: bundled maps only"
    : tileStatus?.unavailable
      ? "Detail tiles unavailable"
      : !tileStatus?.active
        ? "Detail: zoom in for NASA Moon Trek tiles"
        : `Detail: NASA Moon Trek tiles${tileStatus.level ? `, level ${tileStatus.level}` : ""}${tileStatus.loading ? ` · loading ${tileStatus.loading}` : ""}`;
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
    loadFineTextures().then(
      (t) => live && setFine(t),
      () => undefined,
    );
    loadOutlines().then(
      (o) => live && setOutlines(o),
      () => undefined,
    );
    return () => {
      live = false;
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
    out.push({ key: "to-sun", at: toScene(frame.sunDir, RAY), pri: 1, dot: 9, float: true, node: <BearingTag text={LINE_NAMES.sun} className="text-sun-ink" /> });
    out.push({ key: "to-earth", at: toScene(frame.earthDir, RAY), pri: 1, dot: 9, float: true, node: <BearingTag text={LINE_NAMES.earth} className="text-earth" /> });
    out.push({ key: "sub-solar", at: toScene(frame.sunDir), pri: 1, dot: 7, node: <PointTag text="Sub-solar point" swatch="bg-sun" /> });
    out.push({ key: "sub-earth", at: toScene(frame.earthDir), pri: 1, dot: 7, node: <PointTag text="Sub-Earth point" swatch="bg-earth" below /> });
    if (!near) out.push({ key: "cluster", at: CLUSTER_AT, pri: 2, dot: 8, node: <ClusterMark onOpen={openRegions} hint="Zoom in on the south pole to tell them apart." /> });
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
                  onTiles={detail ? setTileStatus : null}
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

        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-t border-rule px-4 py-2">
          <p className="min-w-[16rem] flex-1 text-[0.8rem] leading-snug text-ink-2">
            Drag to turn the globe, scroll to zoom; zooming in on the south pole opens the site level, zooming out opens
            the System level. The terminator, the lines to the Sun and Earth and the Moon&apos;s orientation are
            computed for the time shown; relief shading is exaggerated and no cast shadows are drawn, so use the site
            level for terrain shadow.
          </p>
          {gl && (
            // The status keeps a fixed width, so its changing count never reflows the caption and resizes the globe above it.
            <div className="flex items-center gap-3">
              <p data-tile-status className="text-[0.8rem] leading-snug whitespace-nowrap text-ink-2 tabular-nums sm:min-w-[23rem] sm:text-right">
                {detailText}
              </p>
              <button
                type="button"
                aria-pressed={detail}
                onClick={() => setDetail((v) => !v)}
                title="Load sharper surface tiles from NASA Moon Trek when zoomed in; needs a network connection"
                className={`h-7 border border-ink px-2 text-[0.8rem] whitespace-nowrap transition-colors duration-150 focus-visible:outline-offset-2 ${
                  detail ? "bg-paper-3 font-semibold text-ink" : "font-medium text-ink hover:bg-paper-3"
                }`}
              >
                Detail tiles
              </button>
            </div>
          )}
        </div>

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
          grey, with Lunar Reconnaissance Orbiter Camera mosaic tiles from NASA Moon Trek when zoomed in; region
          outlines from the USGS. Landing coordinates: NASA NSSDCA and Lunar Reconnaissance Orbiter Camera site
          reports.
        </p>
      </aside>
    </div>
  );
}

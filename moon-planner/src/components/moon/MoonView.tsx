"use client";

// Moon level: the whole Moon as a printed relief globe, turned by the
// IAU/WGCCRE rotation model and lit from the Sun's real direction. It sits
// between the System level and the site-level terrain plate.

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Vector3, type Camera } from "three";
import type { SmoothSiteData } from "@/lib/anySite";
import { bodyToLatLon, elevationDeg, moonFrameAt, type LatLon, type MoonFrame } from "@/lib/moonFrame";
import { sites, type Site } from "@/lib/sites";
import { EARTH_RADIUS_KM, loadSystem, stateAt, systemEndMs, type SystemData, type SystemState, type Vec3 } from "@/lib/system";
import { RENDER, TOKENS } from "@/lib/tokens";
import { fmtInt, fmtLat, fmtLon, fmtSigned } from "@/lib/format";
import { hasWebGL } from "@/lib/webgl";
import { ErrorBoundary, Popover, Row, SectionLabel, Segmented, ToggleButton, buttonClass, toggleClass } from "../ui";
import { ZoomHint } from "../levels/LevelNav";
import { useZoomGate } from "../levels/useZoomGate";
import { BearingTag, Bearing, CLUSTER_AT, ClusterMark, Flag, HIT, LABEL_TEXT, LINE_NAMES, LIFT, LineLegend, LabelProjector, OVER, POLE_DIR, RAY, Ray, arcTowards, handoff, onGlobe, toScene, type Label } from "./marks";
import { MoonGlobe, loadFineTextures, loadTextures, type FineTextures, type Textures } from "./moonMaterial";
import PointPanel, { type PickedPoint } from "./PointPanel";
import { REGION_GATE_LAT, centreOf, siteTarget, viewCentre } from "./siteTarget";
import type { TileStatus } from "./tiles/TileLayer";

export type MoonViewProps = {
  nowMs: number;
  onScrub?: (ms: number) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /**
   * Zooming in past the limit steps down to the site level of the place at the centre of the view, given here; the
   * rule for what opens there is siteTarget.
   */
  onOpenSite?: (centre: LatLon) => void;
  /** Zooming out past the limit steps up to the Earth–Moon framing of the System level. */
  onOpenSystem?: () => void;
  /** How the view was reached by zoom: "above" opens far out, "below" opens close in on the south pole. */
  entry?: "above" | "below" | null;
  /** Arriving from the site level of a point outside the nine regions, the view opens close in on that point instead. */
  entryPoint?: LatLon | null;
  /** The level indicator and step buttons, shown with the view's controls. */
  levelNav?: ReactNode;
  /** The mission window, marked on the year rail. */
  windowMs?: { startMs: number; endMs: number };
  /** A point picked anywhere on the globe, its smooth-horizon tracks, and what can be done with it. */
  point?: PickedPoint | null;
  pointSite?: SmoothSiteData | null;
  onPoint?: (p: PickedPoint | null) => void;
  onPointTerrain?: (lat: number, lon: number) => void;
  onPointCompare?: () => void;
  className?: string;
  /**
   * The workspace's inspector rail. When given, the view's side panel (circumstances, point, marks) is drawn
   * there instead of beside the view; null while the rail is still mounting.
   */
  inspector?: HTMLElement | null;
};

const INK = TOKENS.ink;
const PAPER = TOKENS.paper;
const SUN = TOKENS.sun;
const SUN_INK = TOKENS.sunInk;
const EARTH = TOKENS.earth;

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

/** Landings offered as quick picks for the point panel: low latitudes, a high southern latitude and the far side. */
const QUICK_PICKS = ["apollo-11", "apollo-15", "chandrayaan-3", "change-6"].map((id) => LANDINGS.find((l) => l.id === id)!);

const RAD = Math.PI / 180;


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

type FramingId = "pole" | "near" | "sun" | "point";
type Framing = { id: FramingId; dir: Vec3; zoom?: "near" | "far" | "close" };
const MIN_DISTANCE = 1.45;
/** Camera distance, in Moon radii, at which zooming in over the polar cap opens the site level; the plate outline is still whole in view. */
const SITE_GATE_DISTANCE = 1.9;
/** Default camera distance: the globe spans about five sixths of the view's height, leaving room for the lines to the Sun and Earth. */
const BASE_DISTANCE = 4.7;
/** Inside this distance the nine regions are drawn one by one; beyond it (with some slack, so the change does not flicker) they are one mark. */
const REGIONS_NEAR = 3.1;
const REGIONS_FAR = 3.4;
/** Arriving from the site level: almost straight down on the pole, so the plate outline fills the view. */
const POLE_CLOSE_DIR = onGlobe(-85, 0);

/** What the rig reports each frame: the camera distance, the far limit, and the place at the centre of the view. */
type OnView = (distance: number, max: number, centre: LatLon) => void;

function Rig({ framing, onView }: { framing: Framing; onView: OnView }) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const narrow = Math.max(1, 1.05 / aspect);
  const base = BASE_DISTANCE * narrow;
  const max = base * 1.6;

  useEffect(() => {
    const d = framing.zoom === "near" ? SITE_GATE_DISTANCE * 1.3 : framing.zoom === "close" ? MIN_DISTANCE * 1.3 : framing.zoom === "far" ? max * 0.8 : base;
    camera.position.set(framing.dir[0] * d, framing.dir[1] * d, framing.dir[2] * d);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
    invalidate();
  }, [camera, base, max, framing, invalidate]);

  useFrame(({ camera: cam }) => {
    const d = cam.position.length();
    handoff.moonDir = [cam.position.x / d, cam.position.y / d, cam.position.z / d];
    viewCentre.current = centreOf(handoff.moonDir);
    onView(d, max, viewCentre.current);
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

/** Keeps the scene's camera where the pointer handlers outside the canvas can read it. */
function CameraTap({ cameraRef }: { cameraRef: { current: Camera | null } }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    cameraRef.current = camera;
    return () => {
      cameraRef.current = null;
    };
  }, [camera, cameraRef]);
  return null;
}

/**
 * The selenographic point under a pixel: the sight line is intersected with the unit sphere of the globe, which sits
 * at the origin in body-fixed scene axes, so no mesh is involved. Null off the limb.
 */
function pointUnder(camera: Camera, rect: DOMRect, clientX: number, clientY: number): LatLon | null {
  camera.updateMatrixWorld();
  const o = camera.position;
  const d = new Vector3(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2, 0.5).unproject(camera).sub(o).normalize();
  const b = o.dot(d);
  const disc = b * b - (o.lengthSq() - 1);
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t <= 0) return null;
  // Scene axes back to body-fixed: the inverse of toScene.
  const ll = bodyToLatLon([o.x + d.x * t, -(o.z + d.z * t), o.y + d.y * t]);
  return { lat: Math.round(ll.lat * 1e4) / 1e4 || 0, lon: Math.round(ll.lon * 1e4) / 1e4 || 0 };
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
  cameraRef,
}: {
  textures: Textures;
  fine: FineTextures | null;
  frame: MoonFrame;
  framing: Framing;
  labels: Label[];
  overlay: RefObject<HTMLDivElement | null>;
  onView: OnView;
  outlines: RegionOutline[];
  near: boolean;
  site: Site | null;
  bearingLen: number;
  /** Given when detail tiles are on; told what the tile layer is drawing and fetching. */
  onTiles: ((s: TileStatus) => void) | null;
  cameraRef: { current: Camera | null };
}) {
  const tiles = useMemo(() => (onTiles ? { onStatus: onTiles } : null), [onTiles]);
  const sun = useMemo(() => toScene(frame.sunDir), [frame]);
  const earth = useMemo(() => toScene(frame.earthDir), [frame]);
  const from = useMemo(() => (site ? onGlobe(site.lat, site.lon) : null), [site]);
  return (
    <>
      <color attach="background" args={[PAPER]} />
      <Rig framing={framing} onView={onView} />
      <CameraTap cameraRef={cameraRef} />
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

/** The picked point: a diamond on the surface with its coordinates beside it, on whichever side is free. */
function PinMark({ text }: { text: string }) {
  return (
    <div aria-hidden="true" data-pin className="relative">
      <span className="absolute -top-[6px] -left-[6px] block size-3 rotate-45 border-[1.5px] border-ink bg-paper" />
      <span className="absolute -top-[1.5px] -left-[1.5px] block size-[3px] bg-ink" />
      <span data-box className={`absolute top-0 left-0 block border border-ink bg-paper px-1.5 text-ink ${LABEL_TEXT}`}>
        {text}
      </span>
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
      <p className="border-b border-rule px-4 py-2 text-body text-ink-2">
        This browser could not start WebGL, so the globe is replaced by a flat chart of the south polar cap. The ticks at
        the edge point to the longitudes where the Sun and Earth are overhead; the table values are unaffected.
      </p>
      <svg viewBox="-125 -125 250 250" role="group" aria-label="Chart of the lunar south polar cap with the nine regions" className="min-h-0 flex-1">
        <circle r={90} fill={RENDER.moonLit} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <circle r={60} fill="none" stroke={TOKENS.rule} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <circle r={30} fill="none" stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={0} y1={-90} x2={0} y2={90} stroke={TOKENS.rule} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={-90} y1={0} x2={90} y2={0} stroke={TOKENS.rule} strokeWidth={1} vectorEffect="non-scaling-stroke" />
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

function Readout({ frame, state, site }: { frame: MoonFrame; state: SystemState; site: Site | null }) {
  return (
    <div>
      <SectionLabel>At the time shown</SectionLabel>
      <table className="w-full border-collapse">
        <tbody>
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

      <SectionLabel className="mt-6">{site ? `At ${site.name}` : "At the selected region"}</SectionLabel>
      {site ? (
        <>
          <table className="w-full border-collapse">
            <tbody>
              <Row label="Position" value={`${fmtLat(site.lat)}, ${fmtLon(site.lon)}`} />
              <Row label="Sun elevation" value={fmtSigned(elevationDeg(site.lat, site.lon, frame.sunKm), 2)} />
              <Row label="Earth elevation" value={fmtSigned(elevationDeg(site.lat, site.lon, frame.earthKm), 2)} />
            </tbody>
          </table>
          <p className="mt-2 text-small leading-snug text-ink-2">
            Elevation of each body&apos;s centre over a smooth sphere of radius 1,737.4 km. The site level measures it
            against the terrain.
          </p>
        </>
      ) : (
        <p className="mt-2 text-body leading-snug text-ink-2">Choose one of the nine regions below to see how high the Sun and Earth stand there.</p>
      )}
    </div>
  );
}

function Legend({ showLandings, showPoint }: { showLandings: boolean; showPoint: boolean }) {
  const item = "flex items-center gap-2.5 py-1 text-body leading-snug text-ink-2";
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
      {showPoint && (
        <li className={item}>
          <span className="mx-[3px] block size-[10px] shrink-0 rotate-45 border-[1.5px] border-ink" />
          Picked point, smooth horizon with no terrain
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

export default function MoonView({
  nowMs,
  onScrub,
  selectedId,
  onSelect,
  onOpenSite,
  onOpenSystem,
  entry,
  entryPoint = null,
  levelNav,
  windowMs,
  point = null,
  pointSite = null,
  onPoint,
  onPointTerrain,
  onPointCompare,
  className = "",
  inspector,
}: MoonViewProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Opened from a link that carries a point, the globe starts turned to it.
  const [framing, setFraming] = useState<Framing>(() =>
    entry === "below" && entryPoint
      ? { id: "point", dir: onGlobe(entryPoint.lat, entryPoint.lon), zoom: entryPoint.lat <= REGION_GATE_LAT ? "near" : "close" }
      : entry === "below"
        ? { id: "pole", dir: POLE_CLOSE_DIR, zoom: "near" }
        : !entry && point
          ? { id: "point", dir: onGlobe(point.lat, point.lon) }
          : { id: "pole", dir: POLE_DIR, zoom: entry === "above" ? "far" : undefined },
  );
  // Pick mode: a click on the globe that is not a drag drops the pin. Shift-click does the same with the mode off.
  const [pickMode, setPickMode] = useState(false);
  const cameraRef = useRef<Camera | null>(null);
  const press = useRef<{ id: number; x: number; y: number; shift: boolean } | null>(null);
  const onPressDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    press.current = e.button === 0 && e.target instanceof HTMLCanvasElement ? { id: e.pointerId, x: e.clientX, y: e.clientY, shift: e.shiftKey } : null;
  };
  const onPressUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    const camera = cameraRef.current;
    if (!p || p.id !== e.pointerId || !camera || !onPoint) return;
    if (!(pickMode || p.shift || e.shiftKey) || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) return;
    const hit = pointUnder(camera, e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);
    if (hit) onPoint(hit);
  };
  /** A point typed in or chosen from the list: set it and turn the globe to it. */
  const setPointAndFrame = (lat: number, lon: number) => {
    onPoint?.({ lat, lon });
    setFraming({ id: "point", dir: onGlobe(lat, lon) });
  };
  // The gate opens the site level of whatever is at the centre of the view when it fires.
  const centreRef = useRef<LatLon | null>(null);
  const openCentre = useCallback(() => {
    if (centreRef.current) onOpenSite?.(centreRef.current);
  }, [onOpenSite]);
  const { setHost, report, hint, progress } = useZoomGate({ onIn: onOpenSite ? openCentre : undefined, onOut: onOpenSystem });
  // The view centre, kept as state only while the camera is near the zoom-in limit, where the hint names it.
  const [centre, setCentre] = useState<LatLon | null>(null);
  // What the camera distance changes besides the picture: whether the regions are drawn one by one, and how long
  // the bearing lines are on the globe so that they stay about the same length on screen.
  const [zoom, setZoom] = useState<{ near: boolean; step: number }>({ near: entry === "below", step: 12 });
  const onView = useCallback(
    (distance: number, max: number, at: LatLon) => {
      // Over the polar cap the gate opens early, while the plate outline is still whole in view; anywhere else the
      // camera goes all the way in first, so the detail tiles can be looked at without leaving the Moon level.
      const min = at.lat <= REGION_GATE_LAT ? SITE_GATE_DISTANCE : MIN_DISTANCE;
      centreRef.current = at;
      report(distance, min, max, true);
      const shown = distance <= min * 1.2 ? at : null;
      setCentre((prev) => (prev === shown || (prev && shown && prev.lat === shown.lat && prev.lon === shown.lon) ? prev : shown));
      setZoom((prev) => {
        const near = distance < (prev.near ? REGIONS_FAR : REGIONS_NEAR);
        const step = Math.round(Math.log(Math.max(distance - 1, 0.3)) / Math.log(1.1));
        return near === prev.near && step === prev.step ? prev : { near, step };
      });
    },
    [report],
  );
  const bearingLen = Math.min(0.3, Math.max(0.03, 0.062 * 1.1 ** zoom.step));
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

  // The zoom-in hint names what will open: the picked point, the selected region, or the place at the view centre.
  const target = hint === "in" && centre ? siteTarget(centre, point) : null;
  const hintText = target
    ? target.kind === "region"
      ? `Keep zooming to open ${site ? site.name : "the site level"}`
      : `Keep zooming to open ${target.kind === "point" ? "the picked point" : "a site here"}: ${fmtLat(target.lat)}, ${fmtLon(target.lon)}`
    : hint === "out"
      ? "Keep zooming out to open the System level"
      : null;

  const hintAction = target
    ? { label: target.kind === "region" ? `Open ${site ? site.name : "site level"}` : "Open site level", onClick: openCentre }
    : hint === "out" && onOpenSystem
      ? { label: "Open System level", onClick: onOpenSystem }
      : null;


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
    // The picked point ranks under the selected region and over everything else; its text moves to a free side, so it never covers the region's flag.
    if (point) out.push({ key: "pin", at: onGlobe(point.lat, point.lon), pri: 0.5, dot: 9, float: true, node: <PinMark text={`Point ${fmtLat(point.lat)}, ${fmtLon(point.lon)}`} /> });
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
  }, [frame, showLandings, selectedId, onSelect, site, near, outlined, bearingLen, openRegions, point]);

  const frameTo = (id: FramingId) => {
    if (!frame) return;
    setFraming({ id, dir: id === "pole" ? POLE_DIR : toScene(id === "near" ? frame.earthDir : frame.sunDir) });
  };

  const fallback = frame ? <PolarFallback frame={frame} selectedId={selectedId} onSelect={onSelect} /> : null;

  // The side panel, beside the view or in the workspace inspector.
  const panel = (
    <>
        {frame && state ? (
          <Readout frame={frame} state={state} site={site} />
        ) : (
          <p className="text-body text-ink-2">{load.status === "error" ? "No values to show." : "Loading values"}</p>
        )}

        {onPoint && (
          <PointPanel
            className="mt-6"
            point={point}
            site={pointSite}
            nowMs={ms}
            windowMs={windowMs}
            onScrub={onScrub}
            onSet={setPointAndFrame}
            onClear={() => onPoint(null)}
            onTerrain={onPointTerrain}
            onCompare={onPointCompare}
            quickPicks={QUICK_PICKS}
          />
        )}

        {/* In the workspace the regions are in the ranking beside the view. */}
        {inspector === undefined && (
          <>
        <SectionLabel className="mt-6">Regions</SectionLabel>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {sites.map((s) => {
            const on = s.id === selectedId;
            return (
              <li key={s.id}>
                <ToggleButton on={on} size="sm" onClick={() => onSelect(s.id)}>
                  {s.name}
                </ToggleButton>
              </li>
            );
          })}
        </ul>
          </>
        )}

        <SectionLabel className="mt-6">Marks</SectionLabel>
        <div className="mt-1.5">
          <Legend showLandings={showLandings} showPoint={!!point} />
        </div>
        {showLandings && (
          <table className="mt-2 w-full border-collapse text-small">
            <caption className="sr-only">Earlier landings shown on the globe</caption>
            <tbody>
              {LANDINGS.map((l) => (
                <tr key={l.id} className="border-b border-rule">
                  <th scope="row" className="w-11 py-1 text-left text-label font-semibold tracking-[0.1em] text-ink uppercase">
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

        <p className="mt-6 border-t border-rule pt-3 text-small leading-snug text-ink-2">
          Orientation: IAU/WGCCRE rotation model for the Moon, with Earth and Moon positions from NASA/JPL Horizons.
          Surface: NASA SVS CGI Moon Kit colour and elevation maps from Lunar Reconnaissance Orbiter data, printed in
          grey, with Lunar Reconnaissance Orbiter Camera mosaic tiles from NASA Moon Trek when zoomed in; region
          outlines from the USGS. Landing coordinates: NASA NSSDCA and Lunar Reconnaissance Orbiter Camera site
          reports.
        </p>
    </>
  );

  return (
    <div className={`flex min-h-0 flex-col xl:flex-row ${className}`}>
      <section aria-label="Globe of the Moon" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <h2 className="sr-only">The Moon</h2>

        <div className="relative flex min-h-0 flex-1 flex-col">
        <div role="toolbar" aria-label="Moon view" className="z-30 flex flex-wrap justify-end gap-1 max-md:justify-start max-md:border-b max-md:border-rule max-md:bg-paper-2 max-md:p-2 md:absolute md:top-2 md:right-2 md:max-w-[calc(100%-15rem)]">
            <Segmented
              label="View from"
              value={framing.id as FramingId}
              disabled={!frame}
              onChange={frameTo}
              className="bg-paper"
              options={[
                { id: "pole", label: "South pole" },
                { id: "near", label: "Near side" },
                { id: "sun", label: "Sun side" },
              ]}
            />
            {onPoint && (
              <ToggleButton data-tour="pick-point" on={pickMode} disabled={!frame || !gl} onClick={() => setPickMode((v) => !v)} title="Click the globe to drop a pin and read the Sun and Earth there. Shift-click works at any time." className={pickMode ? "" : "bg-paper"}>
                Pick a point
              </ToggleButton>
            )}
            <Popover label="Layers on the globe" button={<>Layers</>} buttonClassName={`${toggleClass(false, "md")} bg-paper`} panelClassName="w-[17rem] p-2">
              <fieldset>
                <legend className="px-1 pb-1.5 text-label font-semibold tracking-[0.08em] text-ink-2 uppercase">Show on the globe</legend>
                <label className="flex cursor-pointer items-center gap-2 px-1 py-1 text-body text-ink hover:bg-paper-2">
                  <input type="checkbox" checked={showLandings} onChange={(e) => setShowLandings(e.target.checked)} className="size-4 accent-[var(--color-ink)]" />
                  Earlier landings
                </label>
                {gl && (
                  <label className="flex cursor-pointer items-center gap-2 px-1 py-1 text-body text-ink hover:bg-paper-2" title="Load sharper surface tiles from NASA Moon Trek when zoomed in; needs a network connection">
                    <input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} className="size-4 accent-[var(--color-ink)]" />
                    Detail tiles from NASA Moon Trek
                  </label>
                )}
              </fieldset>
              {gl && (
                <p data-tile-status className="mt-1 border-t border-rule px-1 pt-1.5 text-label leading-snug text-ink-2 tabular-nums">
                  {detailText}
                </p>
              )}
            </Popover>
            <Popover label="About this view" button={<>About</>} title="How to read the Moon view" buttonClassName={`${toggleClass(false, "md")} bg-paper`} panelClassName="w-[min(24rem,calc(100vw-2rem))] p-3">
              <p className="text-body leading-snug text-ink">
                Drag to turn the globe, scroll to zoom, shift-click to pick a point. Zooming all the way in opens the site level of the place at the centre of the view (the selected region over the south pole); zooming out opens the System level.
              </p>
              <p className="mt-2 text-small leading-snug text-ink-2">
                The terminator, the lines to the Sun and Earth and the Moon&apos;s orientation are computed for the time shown. Relief shading is exaggerated and no cast shadows are drawn, so use the site level for terrain shadow.
              </p>
            </Popover>
          </div>
        <div
          ref={setHost}
          onPointerDownCapture={onPressDown}
          onPointerUpCapture={onPressUp}
          className={`relative isolate min-h-[18rem] flex-1 overflow-hidden bg-paper ${pickMode ? "cursor-crosshair" : ""}`}
        >
          {levelNav && <div className="pointer-events-none absolute top-2 left-2 z-20">{levelNav}</div>}
          {/* The view's controls, top right over the globe: framing, pick a point, layers and how to read it. */}
          <p className="pointer-events-none absolute bottom-2 left-2 z-10 border border-rule bg-paper/90 px-2 py-0.5 text-label text-ink-2 max-sm:hidden">
            Drag to turn · scroll to zoom · shift-click to pick a point
          </p>
          <div className="pointer-events-none absolute inset-x-0 top-11 bottom-0 z-20">
            <ZoomHint text={hintText} progress={progress} action={hintAction} />
          </div>
          {target && (
            // The spot the hint names: four hairline ticks about the view centre, cased in paper so they read on the night side.
            <svg data-centre-mark aria-hidden="true" viewBox="-14 -14 28 28" className="pointer-events-none absolute top-1/2 left-1/2 z-10 size-7 -translate-x-1/2 -translate-y-1/2">
              <path d="M-13 0h8M5 0h8M0-13v8M0 5v8" fill="none" stroke={PAPER} strokeWidth="3" />
              <path d="M-13 0h8M5 0h8M0-13v8M0 5v8" fill="none" stroke={INK} strokeWidth="1" />
            </svg>
          )}
          {pickMode && frame && (
            <p role="status" className="pointer-events-none absolute bottom-9 left-2 z-10 border border-ink bg-paper px-2.5 py-1 text-small leading-snug text-ink">
              Click the globe to drop a pin. Drag still turns it.
            </p>
          )}
          {load.status === "loading" && (
            <p role="status" className="absolute inset-0 grid place-items-center text-body text-ink-2">
              Loading the Moon globe and the 2027 ephemeris
            </p>
          )}
          {load.status === "error" && (
            <div role="alert" className="absolute inset-0 grid place-items-center px-6">
              <div className="max-w-[44ch] border border-ink p-4">
                <p className="text-lead font-semibold text-ink">The Moon globe did not load.</p>
                <p className="mt-1 text-body text-ink-2">{load.message} Check the connection, then try again.</p>
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
          {frame && !gl && fallback}
          {frame && textures && gl && (
            <ErrorBoundary fallback={fallback}>
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
                  cameraRef={cameraRef}
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

        </div>
      </section>

      {inspector === undefined ? (
        <aside className="shrink-0 border-t border-ink px-4 py-4 xl:w-[21.5rem] xl:overflow-y-auto xl:border-t-0 xl:border-l">{panel}</aside>
      ) : inspector ? (
        createPortal(<div className="px-4 py-4">{panel}</div>, inspector)
      ) : null}
    </div>
  );
}

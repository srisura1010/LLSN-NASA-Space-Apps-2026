"use client";

// The terrain plate: LOLA south polar relief in 3D, lit by the Sun at the
// selected site's time, with the nine USGS regions outlined and pickable.

import { Canvas } from "@react-three/fiber";
import {
  Component,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Vector3 } from "three";
import { EARTH_RADIUS_DEG, SUN_RADIUS_DEG, type SiteData } from "@/lib/sky";
import type { LocalTerrain } from "@/lib/localTerrain";
import { formatLatLon, sites } from "@/lib/sites";
import { horizonElevationAt, latLonToXY } from "@/lib/terrain";
import { EXAGGERATION, RELIEF, rgbToHex, scoreTint, TOKENS, type RGB } from "./terrain/constants";
import { gridHeight, gridRange, loadRegions, loadTerrain, localTerrainData, subscribeTerrainProgress, type TerrainData } from "./terrain/data";
import { localLonStep } from "./terrain/engine";
import { bearingAt, bodyVector, exitDistance, LANDMARKS, type RegionShape } from "./terrain/geo";
import { PlateBridge } from "./terrain/bridge";
import { MinusIcon, PlusIcon, RecentreIcon } from "./terrain/icons";
import PlanView from "./terrain/PlanView";
import { Indicators, LabelLayer, type PlateLabel } from "./terrain/PlateLabels";
import { RoseDrawer, buildRoseData } from "./terrain/rose";
import { RoseLayer, ScaleBar } from "./terrain/RoseLayer";
import TerrainScene from "./terrain/Scene";
import { ZoomHint } from "../levels/LevelNav";
import { useZoomGate } from "../levels/useZoomGate";

export type TerrainPlateProps = {
  selectedId: string;
  onSelect: (id: string) => void;
  /** Apparent Sun position at the selected site (deg), or null when unknown. */
  sun: { az: number; el: number } | null;
  /** Apparent Earth position at the selected site (deg), or null when unknown. */
  earth: { az: number; el: number } | null;
  /** 0..1 per region id, higher is better; tints outlines and labels from umbra to sun. */
  regionValues?: Record<string, number>;
  /**
   * A point outside the nine regions. Used when selectedId names none of them:
   * the plate flies to it, flags it and lights the terrain for it.
   */
  customSite?: { lat: number; lon: number } | null;
  /**
   * Terrain around the custom site when it lies off the south polar plate
   * (north of 80° S): the plate then shows this terrain, centred on the site,
   * instead of the polar one. Ignored while one of the nine regions is selected.
   */
  local?: { terrain: LocalTerrain | null; error?: string | null; onRetry?: () => void } | null;
  /** The selected site's tracks over the mission window, for its Sun and Earth bearing paths. */
  track?: { site: SiteData; startMs: number; endMs: number } | null;
  /** Figure title, shown in the caption bar above the plate with the legend. */
  caption?: ReactNode;
  /** Zooming out past the whole-plate view steps up to the Moon level. */
  onZoomOut?: () => void;
  /** The level indicator and step buttons, shown in the caption bar. */
  levelNav?: ReactNode;
  className?: string;
};

type Focus = { id: string; name: string; lat: number; lon: number; custom: boolean };

const K = EXAGGERATION / 1000;
/** Camera distance, km, past which the whole plate is in view and zooming out leaves the site level. */
const LEVEL_OUT_KM = 1100;
/** The same for a plate around any point, which is half the size. */
const LOCAL_LEVEL_OUT_KM = 700;
const NO_REGIONS: null[] = sites.map(() => null);

const latText = (v: number) => (v === 0 ? "0°" : `${Math.abs(v)}° ${v < 0 ? "S" : "N"}`);
const lonText = (v: number) => {
  const w = ((v + 540) % 360) - 180;
  return w === 0 ? "0°" : Math.abs(w) === 180 ? "180°" : `${Math.abs(w)}° ${w < 0 ? "W" : "E"}`;
};

/** Where f crosses `target` on a..b, or null when the ends do not bracket it. */
function crossing(f: (t: number) => number, a: number, b: number, target: number): number | null {
  let fa = f(a) - target;
  const fb = f(b) - target;
  if (!(fa * fb <= 0)) return null;
  for (let i = 0; i < 30; i++) {
    const m = 0.5 * (a + b);
    const fm = f(m) - target;
    if (fa * fm <= 0) b = m;
    else {
      a = m;
      fa = fm;
    }
  }
  return 0.5 * (a + b);
}

// ---------- Environment ----------

let webgl2: boolean | null = null;
function hasWebGL2(): boolean {
  if (webgl2 === null) {
    try {
      const c = document.createElement("canvas");
      const ctx = c.getContext("webgl2");
      webgl2 = !!ctx;
      ctx?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}

const noSubscribe = () => () => {};
function useWebGL2(): "checking" | "ok" | "none" {
  return useSyncExternalStore(
    noSubscribe,
    () => (hasWebGL2() ? "ok" : "none"),
    () => "checking",
  );
}

const motionQuery = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(motionQuery);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(motionQuery).matches,
    () => false,
  );
}

class GlBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// ---------- Component ----------

export default function TerrainPlate({
  selectedId,
  onSelect,
  sun,
  earth,
  regionValues,
  customSite,
  local,
  track,
  caption,
  onZoomOut,
  levelNav,
  className,
}: TerrainPlateProps) {
  const gl = useWebGL2();
  const [glFailed, setGlFailed] = useState<"lost" | "error" | null>(null);
  const [polarTerrain, setTerrain] = useState<TerrainData | null>(null);
  const [regionMap, setRegionMap] = useState<Map<string, RegionShape> | null>(null);
  const [polarError, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hovered, setHovered] = useState(-1);
  const reducedMotion = useReducedMotion();
  const [bridge] = useState(() => new PlateBridge());
  const [rose] = useState(() => new RoseDrawer(K));
  const descId = useId();

  useEffect(() => {
    bridge.setRose(rose);
    return () => bridge.setRose(null);
  }, [bridge, rose]);

  const selectedIndex = sites.findIndex((s) => s.id === selectedId);
  // A plate around the custom site, in place of the south polar one.
  const localMode = selectedIndex < 0 && !!local;
  const localTerrain = localMode ? (local?.terrain ?? null) : null;
  const terrain = useMemo(
    () => (localMode ? (localTerrain ? localTerrainData(localTerrain) : null) : polarTerrain),
    [localMode, localTerrain, polarTerrain],
  );
  const error = localMode ? (local?.error ?? null) : polarError;
  const plateKey = localMode ? `local:${localTerrain ? `${localTerrain.lat},${localTerrain.lon}` : ""}` : "polar";
  const [readyKey, setReadyKey] = useState(plateKey);
  if (readyKey !== plateKey) {
    setReadyKey(plateKey);
    setReady(false);
    setHovered(-1);
  }

  const { setHost, report, hint: zoomHint, progress: zoomProgress } = useZoomGate({ onOut: onZoomOut });
  const outKm = localMode ? LOCAL_LEVEL_OUT_KM : LEVEL_OUT_KM;
  useEffect(() => {
    bridge.setOnDistance((d) => report(d, 0, outKm));
    return () => bridge.setOnDistance(null);
  }, [bridge, report, outKm]);
  const stageRef = useCallback(
    (el: HTMLDivElement | null) => {
      bridge.attachStage(el);
      setHost(el);
    },
    [bridge, setHost],
  );

  useEffect(() => {
    let alive = true;
    loadRegions()
      .then((m) => alive && setRegionMap(m))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (gl !== "ok" || localMode) return;
    let alive = true;
    const unsub = subscribeTerrainProgress((f) => alive && setProgress(f));
    loadTerrain()
      .then((d) => alive && setTerrain(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
      unsub();
    };
  }, [gl, attempt, localMode]);

  const localRetry = local?.onRetry;
  const retry = useCallback(() => {
    setError(null);
    setReady(false);
    setGlFailed(null);
    setAttempt((a) => a + 1);
    if (localMode) localRetry?.();
  }, [localMode, localRetry]);

  // ---------- Derived geometry ----------

  const regions = useMemo(() => (localMode ? NO_REGIONS : sites.map((s) => regionMap?.get(s.id) ?? null)), [regionMap, localMode]);
  const names = useMemo(() => sites.map((s) => s.name), []);
  const customLat = selectedIndex < 0 ? customSite?.lat : undefined;
  const customLon = selectedIndex < 0 ? customSite?.lon : undefined;
  const selected = useMemo<Focus | null>(() => {
    if (selectedIndex >= 0) return { ...sites[selectedIndex], custom: false };
    if (customLat === undefined || customLon === undefined) return null;
    return { id: selectedId, name: "Custom site", lat: customLat, lon: customLon, custom: true };
  }, [selectedIndex, selectedId, customLat, customLon]);
  const range = useMemo(() => (terrain ? gridRange(terrain.grid) : { min: -7254, max: 7007 }), [terrain]);

  const site = useMemo(() => {
    if (!selected) return null;
    if (localMode) {
      // The plate is centred on the site; the default view looks north across about two thirds of it.
      return { x: 0, y: 0, h: terrain ? gridHeight(terrain.grid, 0, 0) : 0, spanM: 20000, from: { x: 0, y: -1 }, widthKm: 200 };
    }
    const p = latLonToXY(selected.lat, selected.lon);
    const c = regions[selectedIndex]?.corners ?? [];
    let span = 20000;
    c.forEach((a, i) => {
      const b = c[(i + 1) % c.length];
      span = Math.max(span, Math.hypot(b.x - a.x, b.y - a.y));
    });
    return { x: p.x, y: p.y, h: terrain ? gridHeight(terrain.grid, p.x, p.y) : 0, spanM: span };
  }, [selected, selectedIndex, regions, terrain, localMode]);

  const sunAz = sun?.az;
  const sunEl = sun?.el;
  const earthAz = earth?.az;
  // On a local plate x is east and y north at the site, which is the polar frame at longitude 0 on the pole.
  const frameLon = localMode ? 0 : selected?.lon;
  const sunVec = useMemo<[number, number, number] | null>(() => {
    if (!site || sunAz === undefined || sunEl === undefined) return null;
    if (!localMode) return bodyVector(site.x, site.y, sunAz, sunEl);
    const a = (sunAz * Math.PI) / 180;
    const e = (sunEl * Math.PI) / 180;
    return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
  }, [site, sunAz, sunEl, localMode]);
  const sunBearing = useMemo(() => (frameLon !== undefined && sunAz !== undefined ? bearingAt(frameLon, sunAz) : null), [frameLon, sunAz]);
  const earthBearing = useMemo(() => (frameLon !== undefined && earthAz !== undefined ? bearingAt(frameLon, earthAz) : null), [frameLon, earthAz]);

  // ---------- Bearing rose ----------

  const roseSite = track?.site ?? null;
  const roseStart = track?.startMs ?? 0;
  const roseEnd = track?.endMs ?? 0;
  const selectedLon = frameLon;
  const roseData = useMemo(
    () =>
      site && selectedLon !== undefined
        ? buildRoseData(roseSite, roseStart, roseEnd, { x: site.x, y: site.y, h: site.h }, selectedLon)
        : null,
    [site, selectedLon, roseSite, roseStart, roseEnd],
  );
  useEffect(() => {
    rose.setData(roseData);
    bridge.invalidate();
  }, [rose, roseData, bridge]);

  const sunUp =
    roseSite && sunAz !== undefined && sunEl !== undefined
      ? sunEl + SUN_RADIUS_DEG > horizonElevationAt(roseSite.horizon, sunAz)
      : false;
  const earthEl = earth?.el;
  const earthUp =
    roseSite && earthAz !== undefined && earthEl !== undefined
      ? earthEl + EARTH_RADIUS_DEG > horizonElevationAt(roseSite.horizon, earthAz)
      : false;
  useEffect(() => {
    rose.setNow(sunAz !== undefined && earthAz !== undefined ? { sunAz, earthAz, sunUp, earthUp } : null);
    bridge.invalidate();
  }, [rose, bridge, sunAz, earthAz, sunUp, earthUp]);

  const tints = useMemo<(RGB | null)[] | null>(() => {
    if (!regionValues) return null;
    return sites.map((s) => (typeof regionValues[s.id] === "number" ? scoreTint(regionValues[s.id]) : null));
  }, [regionValues]);
  const tintHex = useMemo(() => tints?.map((t) => (t ? rgbToHex(t) : null)) ?? null, [tints]);

  // ---------- Overlay anchors ----------

  const scenePoint = useCallback(
    (x: number, y: number, lift = 0) => new Vector3(x / 1000, (terrain ? gridHeight(terrain.grid, x, y) : 0) * K + lift, -y / 1000),
    [terrain],
  );

  const recentre = useCallback(() => bridge.recentre(), [bridge]);

  const labels = useMemo<PlateLabel[]>(() => {
    if (!terrain || !regionMap) return [];
    const out: PlateLabel[] = [];
    sites.forEach((s, i) => {
      const r = regions[i];
      if (!r) return;
      const isSel = i === selectedIndex;
      out.push({
        id: s.id,
        kind: isSel ? "flag" : "chip",
        anchor: scenePoint(r.centre.x, r.centre.y),
        priority: isSel ? 0 : i === hovered ? 1 : 2,
        text: s.name,
        detail: isSel ? formatLatLon(s.lat, s.lon) : undefined,
        tint: tintHex?.[i] ?? null,
        hovered: i === hovered,
        onActivate: isSel ? recentre : () => onSelect(s.id),
        ariaLabel: isSel ? undefined : `Select ${s.name}`,
        srText: isSel ? ", selected. Re-centre the view" : undefined,
      });
    });
    if (localMode && localTerrain) {
      if (selected && site) {
        out.push({
          id: "custom-site",
          kind: "flag",
          anchor: scenePoint(site.x, site.y),
          priority: 0,
          text: selected.name,
          detail: formatLatLon(selected.lat, selected.lon),
          onActivate: recentre,
          srText: ", selected. Re-centre the view",
        });
      }
      // Graticule labels where the drawn parallels meet the west side and the meridians the south side.
      const pr = localTerrain.projection;
      const e = terrain.half * 0.86;
      const step = localLonStep(localTerrain.lat);
      const latAt = (y: number) => pr.unproject(-e, y).lat;
      for (let lat = Math.ceil(Math.min(latAt(-e), latAt(e))); lat <= Math.max(latAt(-e), latAt(e)); lat++) {
        const y = crossing(latAt, -e, e, lat);
        if (y !== null) out.push({ id: `lat${lat}`, kind: "quiet", anchor: scenePoint(-e, y, 1), priority: 5, text: latText(lat) });
      }
      const dlonAt = (x: number) => ((pr.unproject(x, -e).lon - localTerrain.lon + 540) % 360) - 180;
      const d0 = dlonAt(-e);
      const d1 = dlonAt(e);
      if (d1 > d0 && d1 - d0 < 180) {
        for (let lon = Math.ceil((localTerrain.lon + d0) / step) * step; lon <= localTerrain.lon + d1; lon += step) {
          const x = crossing(dlonAt, -e, e, lon - localTerrain.lon);
          if (x !== null) out.push({ id: `lon${lon}`, kind: "quiet", anchor: scenePoint(x, -e, 1), priority: 5, text: lonText(lon) });
        }
      }
      const edge = terrain.half - 4000;
      out.push({ id: "north", kind: "quiet", anchor: scenePoint(0, edge, 1), priority: 4, text: "North" });
      return out;
    }
    if (selected?.custom && site) {
      out.push({
        id: "custom-site",
        kind: "flag",
        anchor: scenePoint(site.x, site.y),
        priority: 0,
        text: selected.name,
        detail: formatLatLon(selected.lat, selected.lon),
        onActivate: recentre,
        srText: ", selected. Re-centre the view",
      });
    }
    for (const m of LANDMARKS) {
      if (m.id === "pole") out.push({ id: m.id, kind: "pole", anchor: scenePoint(m.x, m.y), priority: 1, text: m.label, detail: "90° S" });
      else out.push({ id: m.id, kind: "mark", anchor: scenePoint(m.x, m.y), priority: 3, text: m.label });
    }
    // Graticule: the latitude circles the plate draws, labelled on the diagonal meridians.
    for (const lat of [-88, -86, -84, -82]) {
      for (const lon of [45, 135, -45, -135]) {
        const q = latLonToXY(lat, lon);
        out.push({ id: `lat${lat}_${lon}`, kind: "quiet", anchor: scenePoint(q.x, q.y, 1), priority: 5, text: `${-lat}° S` });
      }
    }
    const h = terrain.half - 4000;
    const meridians = [
      { id: "m0", text: "0°", x: 0, y: h },
      { id: "m90e", text: "90° E", x: h, y: 0 },
      { id: "m180", text: "180°", x: 0, y: -h },
      { id: "m90w", text: "90° W", x: -h, y: 0 },
    ];
    for (const m of meridians) out.push({ id: m.id, kind: "quiet", anchor: scenePoint(m.x, m.y, 1), priority: 4, text: m.text });
    return out;
  }, [terrain, regionMap, regions, selectedIndex, selected, site, hovered, scenePoint, tintHex, recentre, onSelect, localMode, localTerrain]);

  useEffect(() => {
    const place = (bearing: { x: number; y: number } | null) => {
      if (!terrain || !site || !bearing) return null;
      const at = scenePoint(site.x, site.y);
      const near = new Vector3(at.x + (bearing.x * 6000) / 1000, at.y, at.z - (bearing.y * 6000) / 1000);
      const t = exitDistance(site, bearing, terrain.half - 1500);
      return { site: at, near, edge: scenePoint(site.x + bearing.x * t, site.y + bearing.y * t) };
    };
    bridge.setIndicator("sun", place(sunBearing));
    bridge.setIndicator("earth", place(earthBearing));
  }, [bridge, terrain, site, sunBearing, earthBearing, scenePoint]);

  // ---------- Interaction ----------

  const onPick = useCallback(
    (i: number) => {
      const s = sites[i];
      if (!s) return;
      if (i === selectedIndex) bridge.recentre();
      else onSelect(s.id);
    },
    [bridge, onSelect, selectedIndex],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const c = bridge;
    const step = Math.PI / 18;
    const map: Record<string, () => void> = {
      ArrowLeft: () => c.orbit(step, 0),
      ArrowRight: () => c.orbit(-step, 0),
      ArrowUp: () => c.orbit(0, step / 2),
      ArrowDown: () => c.orbit(0, -step / 2),
      "+": () => c.zoom(1),
      "=": () => c.zoom(1),
      "-": () => c.zoom(-1),
      Home: () => c.recentre(),
      "0": () => c.recentre(),
    };
    const fn = map[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };

  // ---------- Render ----------

  const showPlan = gl === "none" || glFailed !== null;
  const showCanvas = gl === "ok" && !glFailed && terrain && regionMap && !error;
  const loading = !showPlan && !error && !ready;
  const pct = progress === null ? null : Math.round(progress * 100);

  const lit = sunVec !== null;
  const focusName = selected ? (selected.custom ? `Custom site at ${formatLatLon(selected.lat, selected.lon)}` : selected.name) : "";
  const description = selected
    ? `${focusName} selected. ${
        sun ? `Sun at azimuth ${sun.az.toFixed(1)}°, elevation ${sun.el.toFixed(1)}°.` : "Sun position unknown."
      } ${earth ? `Earth at azimuth ${earth.az.toFixed(1)}°, elevation ${earth.el.toFixed(1)}°.` : ""}`
    : "No region selected.";

  // The plate takes the height its slot gives it. A floor of its own taller
  // than the slot's would push the scale bar and view tools out of sight.
  return (
    <figure className={`relative flex flex-col overflow-hidden bg-paper text-ink ${className ?? ""}`}>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 border-b border-rule bg-paper px-4 py-1">
        {caption}
        {levelNav}
        <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[0.75rem] text-ink-2">
          {lit ? (
            <>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="block h-2.5 w-4 outline outline-1 -outline-offset-1 outline-rule"
                  style={{ background: `linear-gradient(90deg, ${rgbToHex(RELIEF.litLo)}, ${rgbToHex(RELIEF.litHi)})` }}
                />
                Sunlit
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="block h-2.5 w-4" style={{ background: rgbToHex(RELIEF.shadowLo) }} />
                Shadow
              </span>
            </>
          ) : (
            <span className="font-semibold text-ink">
              {sun ? "No site selected: relief only" : "No Sun position for this time: relief only"}
            </span>
          )}
          {regionValues && !localMode && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="block h-2.5 w-6" style={{ background: `linear-gradient(90deg, ${TOKENS.umbra}, ${TOKENS.sun})` }} />
              Score
            </span>
          )}
          {track && (
            <span className="flex items-center gap-1.5">
              <svg aria-hidden width="22" height="12" viewBox="0 0 22 12" className="shrink-0">
                <path d="M1 11.5A10 10 0 0 1 21 11.5" className="fill-none stroke-ink" strokeWidth="1" />
                <path d="M4.5 11.5A6.5 6.5 0 0 1 17.5 11.5" className="fill-none stroke-sun-ink" strokeWidth="3.5" />
                <path d="M4.5 11.5A6.5 6.5 0 0 1 17.5 11.5" className="fill-none stroke-sun" strokeWidth="2" />
              </svg>
              Bearings to the Sun and to Earth, ticked as Fig. 2
            </span>
          )}
        </span>
      </figcaption>
      <div
        ref={stageRef}
        className="group/stage relative min-h-0 flex-1 overflow-hidden bg-paper outline-none"
        tabIndex={showCanvas ? 0 : -1}
        role="group"
        aria-roledescription="3D terrain view"
        aria-label={localMode ? "Terrain plate around the custom site" : "Terrain plate of the lunar south pole"}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
      >
        <ZoomHint text={zoomHint === "out" && showCanvas ? "Keep zooming out to open the Moon level" : null} progress={zoomProgress} />
        {showCanvas && (
          <GlBoundary key={attempt} onError={() => setGlFailed("error")}>
            <div className="absolute inset-0" aria-hidden>
              <Canvas
                frameloop="demand"
                flat
                dpr={[1, 2]}
                gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
                camera={{ fov: 30, near: 0.5, far: 8000, position: [0, 500, 500] }}
                onCreated={({ gl: renderer }) => {
                  renderer.setClearColor(0x000000, 0);
                  // A shader this GPU cannot compile would leave the plate blank; show the plan instead.
                  renderer.debug.onShaderError = (ctx, program) => {
                    console.error("Terrain plate shader failed:", ctx.getProgramInfoLog(program));
                    setGlFailed("error");
                  };
                  renderer.domElement.addEventListener("webglcontextlost", (ev) => {
                    // A canvas taken off the page (the plate changed while its terrain loads) loses its context on purpose.
                    if (!renderer.domElement.isConnected) return;
                    ev.preventDefault();
                    setGlFailed("lost");
                  });
                }}
              >
                {/* Keyed inside the one canvas: a new plate gets a new scene, camera rig and first view, on the same GL context. */}
                <TerrainScene
                  key={plateKey}
                  data={terrain}
                  range={range}
                  regions={regions}
                  selectedIndex={selectedIndex}
                  hoveredIndex={hovered}
                  onHover={setHovered}
                  onPick={onPick}
                  sun={sunVec}
                  site={site}
                  sunBearing={sunBearing}
                  earthBearing={earthBearing}
                  tints={tints}
                  bridge={bridge}
                  reducedMotion={reducedMotion}
                  onFirstFrame={() => setReady(true)}
                />
              </Canvas>
            </div>
            <div className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ${ready ? "opacity-100" : "opacity-0"}`}>
              <RoseLayer drawer={rose} />
              <LabelLayer bridge={bridge} labels={labels} />
              <Indicators bridge={bridge} sun={sun} earth={earth} />
            </div>
          </GlBoundary>
        )}

        {showPlan && (
          <div className="absolute inset-0 flex flex-col">
            <p className="border-b border-rule bg-paper-2 px-3 py-2 text-[0.79rem] text-ink-2">
              {glFailed === "lost"
                ? "The 3D view stopped because the graphics context was lost. "
                : localMode
                  ? "This browser cannot draw the 3D terrain (WebGL 2 is off or unavailable), so this is a flat plan with the site's Sun and Earth bearings; north is up. "
                  : "This browser cannot draw the 3D terrain (WebGL 2 is off or unavailable), so this is a flat plan of the regions. "}
              {glFailed && (
                <button type="button" onClick={retry} className="font-semibold text-earth underline underline-offset-2 hover:text-ink">
                  Restart the 3D view
                </button>
              )}
            </p>
            <div className="min-h-0 flex-1 p-2">
              <PlanView
                regions={regions}
                names={names}
                selectedIndex={selectedIndex}
                onSelect={(i) => sites[i] && onSelect(sites[i].id)}
                site={site}
                siteLabel={selected?.custom ? selected.name : null}
                sunBearing={sunBearing}
                earthBearing={earthBearing}
                tints={tintHex}
                half={localMode ? (localTerrain?.half ?? 122880) : 304000}
                plain={localMode}
              />
            </div>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-end bg-paper-2 p-4" role="status" aria-live="polite">
            <div className="w-full max-w-[22rem]">
              <p className="text-[0.79rem] font-semibold uppercase tracking-[0.06em] text-ink">Loading LOLA terrain</p>
              <p className="mt-0.5 text-[0.79rem] text-ink-2 tabular-nums">
                {gl === "checking"
                  ? "Checking graphics support"
                  : terrain
                    ? "Tracing shadows for the current Sun"
                    : localMode
                      ? "Fetching the terrain around this point from NASA Moon Trek, 4 to 8 MB"
                      : `South polar heightmap, 3.6 MB${pct !== null ? `, ${pct}%` : ""}`}
              </p>
              <div className="mt-2 h-px w-full bg-rule">
                {(terrain || pct !== null) && (
                  <div className="h-px bg-ink transition-[width] duration-150" style={{ width: `${terrain ? 100 : pct}%` }} />
                )}
              </div>
            </div>
          </div>
        )}

        {/* View tools and the plate's scale note, over the plate's lower corners. */}
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex items-end justify-between gap-3">
          <div ref={(el) => bridge.attachReserved("scale", el)} className="flex flex-wrap items-end gap-x-3 gap-y-1">
            {showCanvas && <ScaleBar drawer={rose} />}
            <p className={`bg-paper/85 px-1.5 py-0.5 text-[0.702rem] leading-snug text-ink-2 ${localMode && error ? "hidden" : ""}`}>
              {localMode ? (localTerrain ? `${localTerrain.label}; ±${Math.round(localTerrain.half / 1000)} km` : "LOLA terrain from NASA Moon Trek") : "LOLA 640 m grid"}, relief ×{EXAGGERATION}
              {lit ? "; shadows traced at true scale" : ""}
            </p>
          </div>
          <span ref={(el) => bridge.attachReserved("tools", el)} className="pointer-events-auto flex" role="toolbar" aria-label="View">
            <ToolButton label="Zoom out" onClick={() => bridge.zoom(-1)} disabled={!ready || !showCanvas}>
              <MinusIcon className="h-4 w-4" />
            </ToolButton>
            <ToolButton label="Zoom in" onClick={() => bridge.zoom(1)} disabled={!ready || !showCanvas}>
              <PlusIcon className="h-4 w-4" />
            </ToolButton>
            <ToolButton
              label={selected ? `Re-centre on ${selected.custom ? "the custom site" : selected.name}` : "Show the whole plate"}
              onClick={recentre}
              disabled={!ready || !showCanvas}
            >
              <RecentreIcon className="h-4 w-4" />
            </ToolButton>
          </span>
        </div>

        {/* Focus ring above the canvas, which would otherwise cover an outline. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 hidden border-2 border-earth group-focus-visible/stage:block"
        />

        {error && !showPlan && (
          <div className="absolute inset-0 flex items-end bg-paper-2 p-4" role="alert">
            <div className="max-w-[26rem]">
              <p className="text-[0.79rem] font-semibold uppercase tracking-[0.06em] text-ink">Terrain unavailable</p>
              <p className="mt-0.5 text-[0.79rem] text-ink-2">
                {error}
                {localMode ? " Until it loads, the numbers beside this plate use a smooth horizon." : " Check the connection, then try again."}
              </p>
              <button
                type="button"
                onClick={retry}
                className="mt-2 border border-ink bg-paper px-2.5 py-1 text-[0.79rem] font-semibold text-ink transition-colors duration-150 hover:bg-paper-3"
              >
                Try again
              </button>
            </div>
          </div>
        )}
      </div>

      <p id={descId} className="sr-only">
        {description} Drag to orbit, scroll to zoom. With the view focused, arrow keys orbit, plus and minus zoom, Home
        re-centres.
      </p>
    </figure>
  );
}

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="-ml-px flex h-8 w-8 items-center justify-center border border-ink-3 bg-paper text-ink transition-colors duration-150 first:ml-0 hover:z-10 hover:border-ink hover:bg-paper-2 active:bg-paper-3 disabled:cursor-default disabled:text-ink-3 disabled:hover:border-ink-3 disabled:hover:bg-paper"
    >
      {children}
    </button>
  );
}

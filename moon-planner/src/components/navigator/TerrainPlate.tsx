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
import { formatLatLon, sites } from "@/lib/sites";
import { latLonToXY } from "@/lib/terrain";
import { EXAGGERATION, RELIEF, rgbToHex, scoreTint, TOKENS, type RGB } from "./terrain/constants";
import { gridHeight, gridRange, loadRegions, loadTerrain, subscribeTerrainProgress, type TerrainData } from "./terrain/data";
import { bearingAt, bodyVector, exitDistance, LANDMARKS, type RegionShape } from "./terrain/geo";
import { PlateBridge } from "./terrain/bridge";
import { MinusIcon, PlusIcon, RecentreIcon } from "./terrain/icons";
import PlanView from "./terrain/PlanView";
import { Indicators, LabelLayer, type PlateLabel } from "./terrain/PlateLabels";
import TerrainScene from "./terrain/Scene";

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
  className?: string;
};

type Focus = { id: string; name: string; lat: number; lon: number; custom: boolean };

const K = EXAGGERATION / 1000;

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

export default function TerrainPlate({ selectedId, onSelect, sun, earth, regionValues, customSite, className }: TerrainPlateProps) {
  const gl = useWebGL2();
  const [glFailed, setGlFailed] = useState<"lost" | "error" | null>(null);
  const [terrain, setTerrain] = useState<TerrainData | null>(null);
  const [regionMap, setRegionMap] = useState<Map<string, RegionShape> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hovered, setHovered] = useState(-1);
  const reducedMotion = useReducedMotion();
  const [bridge] = useState(() => new PlateBridge());
  const descId = useId();

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
    if (gl !== "ok") return;
    let alive = true;
    const unsub = subscribeTerrainProgress((f) => alive && setProgress(f));
    loadTerrain()
      .then((d) => alive && setTerrain(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
      unsub();
    };
  }, [gl, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setReady(false);
    setGlFailed(null);
    setAttempt((a) => a + 1);
  }, []);

  // ---------- Derived geometry ----------

  const regions = useMemo(() => sites.map((s) => regionMap?.get(s.id) ?? null), [regionMap]);
  const names = useMemo(() => sites.map((s) => s.name), []);
  const selectedIndex = sites.findIndex((s) => s.id === selectedId);
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
    const p = latLonToXY(selected.lat, selected.lon);
    const c = regions[selectedIndex]?.corners ?? [];
    let span = 20000;
    c.forEach((a, i) => {
      const b = c[(i + 1) % c.length];
      span = Math.max(span, Math.hypot(b.x - a.x, b.y - a.y));
    });
    return { x: p.x, y: p.y, h: terrain ? gridHeight(terrain.grid, p.x, p.y) : 0, spanM: span };
  }, [selected, selectedIndex, regions, terrain]);

  const sunAz = sun?.az;
  const sunEl = sun?.el;
  const earthAz = earth?.az;
  const sunVec = useMemo(
    () => (site && sunAz !== undefined && sunEl !== undefined ? bodyVector(site.x, site.y, sunAz, sunEl) : null),
    [site, sunAz, sunEl],
  );
  const sunBearing = useMemo(() => (selected && sunAz !== undefined ? bearingAt(selected.lon, sunAz) : null), [selected, sunAz]);
  const earthBearing = useMemo(() => (selected && earthAz !== undefined ? bearingAt(selected.lon, earthAz) : null), [selected, earthAz]);

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
    for (const m of LANDMARKS) out.push({ id: m.id, kind: "mark", anchor: scenePoint(m.x, m.y), priority: 3, text: m.label });
    const h = terrain.half - 4000;
    const meridians = [
      { id: "m0", text: "0°", x: 0, y: h },
      { id: "m90e", text: "90° E", x: h, y: 0 },
      { id: "m180", text: "180°", x: 0, y: -h },
      { id: "m90w", text: "90° W", x: -h, y: 0 },
    ];
    for (const m of meridians) out.push({ id: m.id, kind: "quiet", anchor: scenePoint(m.x, m.y, 1), priority: 4, text: m.text });
    return out;
  }, [terrain, regionMap, regions, selectedIndex, selected, site, hovered, scenePoint, tintHex, recentre, onSelect]);

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

  return (
    <figure className={`relative flex min-h-[18rem] flex-col overflow-hidden border border-rule bg-paper text-ink ${className ?? ""}`}>
      <div
        className="group/stage relative min-h-0 flex-1 overflow-hidden bg-paper outline-none"
        tabIndex={showCanvas ? 0 : -1}
        role="group"
        aria-roledescription="3D terrain view"
        aria-label="Terrain plate of the lunar south pole"
        aria-describedby={descId}
        onKeyDown={onKeyDown}
      >
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
                    ev.preventDefault();
                    setGlFailed("lost");
                  });
                }}
              >
                <TerrainScene
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
                half={304000}
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

        {/* Focus ring above the canvas, which would otherwise cover an outline. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 hidden border-2 border-earth group-focus-visible/stage:block"
        />

        {error && !showPlan && (
          <div className="absolute inset-0 flex items-end bg-paper-2 p-4" role="alert">
            <div className="max-w-[26rem]">
              <p className="text-[0.79rem] font-semibold uppercase tracking-[0.06em] text-ink">Terrain unavailable</p>
              <p className="mt-0.5 text-[0.79rem] text-ink-2">{error} Check the connection, then try again.</p>
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

      <figcaption className="border-t border-rule bg-paper px-3 py-1.5 text-[0.79rem] leading-snug text-ink-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {lit ? (
            <>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="block h-2.5 w-2.5 border border-ink-3" style={{ background: rgbToHex(RELIEF.litHi) }} />
                Sunlit
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="block h-2.5 w-2.5" style={{ background: rgbToHex(RELIEF.shadowLo) }} />
                Shadow
              </span>
            </>
          ) : (
            <span className="font-semibold text-ink">
              {sun ? "No site selected: relief only" : "No Sun position for this time: relief only"}
            </span>
          )}
          {regionValues && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="block h-2.5 w-8" style={{ background: `linear-gradient(90deg, ${TOKENS.umbra}, ${TOKENS.sun})` }} />
              Region score, low to high
            </span>
          )}
          <span className="ml-auto flex items-center gap-1" role="toolbar" aria-label="View">
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
        <p className="mt-0.5">
          LOLA terrain, 640 m grid, relief exaggerated {EXAGGERATION}×.
          {lit ? " Shadows traced at true scale; site figures use 80 m horizons." : ""}
        </p>
      </figcaption>

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
      className="flex h-8 w-8 items-center justify-center border border-rule bg-paper text-ink transition-colors duration-150 hover:border-ink hover:bg-paper-2 active:bg-paper-3 disabled:cursor-default disabled:text-ink-3 disabled:hover:border-rule disabled:hover:bg-paper"
    >
      {children}
    </button>
  );
}

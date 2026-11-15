"use client";

import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { covers, loadSite, rankSites, sampleAt, type MissionScore, type SiteData } from "@/lib/sky";
import { isUp } from "@/lib/contacts";
import { sites } from "@/lib/sites";
import { DAY, HOUR, fmtLatLon } from "@/lib/format";
import { DATA_END_MS } from "@/lib/mission";
import { launchSites } from "@/lib/launchSites";
import { customHorizonMethod, loadCustomSite, validateSitePoint } from "@/lib/customSite";
import { SMOOTH_METHOD, buildSmoothSite, isSmoothSite } from "@/lib/anySite";
import { buildGlobalSite, isGlobalSite, loadLocalTerrain } from "@/lib/localTerrain";
import { loadSystem, type SystemData } from "@/lib/system";
import { CUSTOM_ID, PLAN_KEYS, POINT_ID, POLAR_CUSTOM_LAT, readUrl, writeUrl, type View } from "@/state/url";
import { PlanProvider, stateFromUrl, usePlan, usePlanField, usePlanStore, type PlanState } from "@/state/plan";
import { siteTarget, viewCentre } from "../moon/siteTarget";
import HorizonPlot from "./HorizonPlot";
import RegionTable, { CustomSiteForm, type CustomSiteState, type RankedRow } from "./RegionTable";
import MissionControls, { ChangeNote } from "./MissionControls";
import SiteBulletin from "./SiteBulletin";
import ComparePanel, { tiedRanks, type CompareOption } from "./ComparePanel";
import AboutPanel from "./AboutPanel";
import LaunchPanel from "../launch/LaunchPanel";
import LevelNav, { type Level } from "../levels/LevelNav";
import { Drawer, ErrorBoundary, Toast } from "../ui";
import AppBar, { type Mode } from "../shell/AppBar";

const TerrainPlate = dynamic(() => import("./TerrainPlate"), { ssr: false, loading: () => <PlateLoading /> });

const SystemView = dynamic(() => import("../system/SystemView"), { ssr: false, loading: () => <SystemLoading /> });

const MoonView = dynamic(() => import("../moon/MoonView"), { ssr: false, loading: () => <MoonLoading /> });

const Controls = memo(MissionControls);

// ---------- Constants ----------

const SITE_IDS = new Set(sites.map((s) => s.id));
/** Top of the ranking for the default window (14 Nov 2027); shown until the ranking is ready. */
const FALLBACK_SITE = "de-gerlache-2";
/** Extra track fetched for a custom site past the window, so one- and two-week slips stay covered. */
const CUSTOM_MARGIN_MS = 14 * DAY;
/** Playback runs through the whole window in this many milliseconds. */
const PLAY_SPAN_MS = 12_000;

/** The launch sites in the shape the System view draws: marks plus the allowed azimuth fan. */
const LAUNCH_MARKS = launchSites.map((s) => ({ id: s.id, name: s.name, group: s.group, lat: s.lat, lon: s.lon, azimuthRanges: s.azimuths.map((r) => [r.min, r.max] as [number, number]) }));

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- Small pieces ----------

function PanelProblem({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex h-full min-h-24 items-center justify-center bg-paper-2 px-6 py-6 text-center">
      <p className="max-w-[46ch] text-[0.95rem] text-ink">{children}</p>
    </div>
  );
}

function PlateLoading() {
  return (
    <div className="flex h-full w-full items-end bg-paper-2 p-4" aria-busy="true">
      <p className="text-[0.844rem] text-ink-2">Loading the LOLA terrain plate</p>
    </div>
  );
}

function SystemLoading() {
  return (
    <div role="status" className="grid h-full min-h-[22rem] place-items-center bg-paper">
      <p className="text-[0.844rem] text-ink-2">Loading the Sun, Earth and Moon diagram</p>
    </div>
  );
}

function MoonLoading() {
  return (
    <div role="status" className="grid h-full min-h-[22rem] place-items-center bg-paper">
      <p className="text-[0.844rem] text-ink-2">Loading the Moon globe</p>
    </div>
  );
}

/** The three zoom levels and the tabs that show them, from the outermost in. */
const LEVEL_VIEWS: { level: Level; view: View }[] = [
  { level: "system", view: "system" },
  { level: "moon", view: "moon" },
  { level: "site", view: "navigator" },
];
/** Length of the crossfade when zooming carries the view to another level; matches duration-200. */
const LEVEL_FADE_MS = 200;

type SiteMeta = { id: string; name: string; lat: number; lon: number; custom: boolean };

/** Fig. 1's title: the plate's number and the site it is centred on. */
function PlateTitle({ meta }: { meta: SiteMeta }) {
  return (
    <span className="text-[0.95rem] font-semibold text-ink">
      <span className="mr-2 text-[0.75rem] font-bold tracking-[0.1em] uppercase">Fig. 1</span>
      Terrain at {meta.name}
      {meta.custom ? <span className="ml-2 text-[0.844rem] font-normal text-ink-2">custom site</span> : null}
    </span>
  );
}

const subscribeResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};

/**
 * Height of the horizon plot's drawing area. On wide screens the bottom band
 * has to fit under the plate in one screen, so it follows the window height.
 */
function usePlotHeight(): number | undefined {
  return useSyncExternalStore(
    subscribeResize,
    () => (window.innerWidth >= 1280 ? Math.round(Math.min(220, Math.max(124, window.innerHeight * 0.165))) : undefined),
    () => undefined,
  );
}

function BandSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <div className="h-5 w-2/3 bg-paper-2 motion-safe:animate-pulse" />
      <div className="h-[13rem] bg-paper-2 motion-safe:animate-pulse" />
      <div className="h-10 bg-paper-2 motion-safe:animate-pulse" />
    </div>
  );
}

// ---------- Skeleton for the first paint ----------

export function NavigatorSkeleton() {
  return (
    <div className="relative flex h-dvh min-h-[38rem] flex-col overflow-hidden" aria-busy="true">
      <p className="sr-only" role="status">
        Loading the Navigator
      </p>
      <div className="flex h-14 shrink-0 items-center gap-6 border-b border-ink bg-paper px-4" aria-hidden="true">
        <div className="h-4 w-56 bg-paper-3" />
        <div className="mx-auto h-4 w-52 bg-paper-3" />
        <div className="h-9 w-44 bg-paper-3" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(19rem,22rem)_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)_21rem]">
        <div className="space-y-3 border-b border-rule bg-paper-2 px-4 py-4 md:border-r md:border-b-0" aria-hidden="true">
          <div className="h-5 w-3/4 bg-paper-3" />
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="h-8 bg-paper-3" />
          ))}
        </div>
        <div className="min-h-[22rem] bg-paper-2" aria-hidden="true" />
        <div className="hidden border-l border-rule xl:block" aria-hidden="true" />
      </div>
    </div>
  );
}

// ---------- The app ----------

type Load = { status: "loading" } | { status: "ready"; data: SiteData } | { status: "error"; message: string };
/** Same point to the 4 decimals the URL keeps. */
const samePoint = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.abs(a.lat - b.lat) < 5e-5 && Math.abs(a.lon - b.lon) < 5e-5;

export default function NavigatorApp() {
  const params = useSearchParams();
  return (
    <PlanProvider initial={() => stateFromUrl(readUrl(new URLSearchParams(params.toString())))}>
      <Navigator />
    </PlanProvider>
  );
}

function Navigator() {
  const params = useSearchParams();
  const pathname = usePathname();
  const query = params.toString();
  const [home] = useState(pathname);
  const store = usePlanStore();

  // The shared plan (src/state/plan.tsx); each field keeps the name and shape it had as local state.
  const [view, setView] = usePlanField("view");
  const [aboutOpen, setAboutOpen] = usePlanField("aboutOpen");
  const [startMs, setStartMs] = usePlanField("startMs");
  const [durationHours, setDurationHours] = usePlanField("durationHours");
  const [nowMs, setNowMs] = usePlanField("nowMs");
  const [selectedId, setSelectedId] = usePlanField("selectedId");
  const [change, setChange] = usePlanField("change");
  const [gap, setGap] = usePlanField("gap");
  const [picked, setPicked] = usePlanField("picked");
  const [playing, setPlaying] = usePlanField("playing");
  const [custom, setCustom] = usePlanField("custom");
  const [customReq, setCustomReq] = usePlanField("customReq");
  const customLat = custom?.lat;
  const customLon = custom?.lon;
  // A point picked at the Moon level; its smooth-horizon tracks come from the ephemeris.
  const [point, setPoint] = usePlanField("point");
  // Launch from Earth: the chosen launch site, lift-off and transfer time, shared by the Launch tab and the System view.
  const [launchSiteId, setLaunchSiteId] = usePlanField("launchSiteId");
  const [launchPick, setLaunchPick] = usePlanField("launchPick");
  const [transitDays, setTransitDays] = usePlanField("transitDays");
  const transferArc = useMemo(
    () => (launchPick ? { launchMs: launchPick.launchMs, arrivalMs: launchPick.arrivalMs, launchSiteId: launchPick.launchSiteId } : null),
    [launchPick],
  );

  const [loads, setLoads] = useState<Record<string, Load>>(() =>
    Object.fromEntries(sites.map((s) => [s.id, { status: "loading" } as Load])),
  );
  const [system, setSystem] = useState<SystemData | null>(null);

  // ---- URL in ----
  // The page stays mounted across client navigations (and is kept alive while
  // another route shows), so a later visit with new search params, such as a
  // second pick on the landing page, must reset the plan. Our own URL writes
  // come back here too; they are recognised and skipped. A link that names no
  // site or window (the navbar's bare /tool, or ?view=about) keeps the current
  // plan and only switches the tab it names; the URL is then written back.
  // Applied before paint, in one store update.
  const seenQuery = useRef(query);
  const ownQuery = useRef<string | null>(null);
  const urlEpoch = usePlan((s) => s.urlEpoch);
  useLayoutEffect(() => {
    if (pathname !== home || query === seenQuery.current) return;
    seenQuery.current = query;
    if (query === ownQuery.current) return;
    const incoming = new URLSearchParams(query);
    const namesPlan = PLAN_KEYS.some((k) => incoming.has(k));
    if (!namesPlan && incoming.has("view")) {
      store.setState((s) => ({ view: readUrl(incoming).view, urlEpoch: s.urlEpoch + 1 }));
    } else if (namesPlan) {
      const u = readUrl(incoming);
      const next = stateFromUrl(u);
      const prev = store.getState().custom;
      const uEnd = u.startMs + u.hours * HOUR;
      // Keep a custom site that is already loaded for this point and window.
      const keepCustom =
        !!u.custom &&
        !!prev &&
        samePoint(prev, u.custom) &&
        prev.status !== "error" &&
        !(prev.status === "ready" && !(prev.data && covers(prev.data, u.startMs, uEnd)));
      const update: Partial<PlanState> = { ...next, systemMs: null, urlEpoch: store.getState().urlEpoch + 1 };
      if (keepCustom) {
        delete update.custom;
        delete update.customReq;
      }
      store.setState(update);
    } else {
      store.setState((s) => ({ urlEpoch: s.urlEpoch + 1 }));
    }
  }, [query, pathname, home, store]);

  const endMs = startMs + durationHours * HOUR;

  // ---- Data: the nine regions in parallel (loadSite caches), and the custom site ----

  const fetchSite = useCallback((id: string) => {
    loadSite(id).then(
      (data) => setLoads((prev) => ({ ...prev, [id]: { status: "ready", data } })),
      (err) => setLoads((prev) => ({ ...prev, [id]: { status: "error", message: errorText(err) } })),
    );
  }, []);

  useEffect(() => {
    for (const s of sites) fetchSite(s.id);
  }, [fetchSite]);

  // loadCustomSite caches by point and span, so running this again (strict mode,
  // or the page coming back into view) does not fetch again.
  useEffect(() => {
    if (!customReq) return;
    let alive = true;
    const { lat, lon, fromMs, toMs } = customReq;
    if (lat > POLAR_CUSTOM_LAT) {
      // Anywhere north of 80° S: tracks from the packed ephemeris, terrain from NASA Moon Trek.
      // If the terrain does not load the site still opens, on a smooth horizon, and says so.
      Promise.all([
        loadSystem(),
        loadLocalTerrain(lat, lon).then(
          (terrain) => ({ terrain, error: null }),
          (err) => ({ terrain: null, error: errorText(err) }),
        ),
      ]).then(
        ([sys, t]) => {
          if (!alive) return;
          if (t.terrain) setCustom({ lat, lon, status: "ready", data: buildGlobalSite(t.terrain, sys, CUSTOM_ID) });
          else {
            const smooth = buildSmoothSite(lat, lon, sys);
            setCustom({ lat, lon, status: "ready", data: { ...smooth, sky: { ...smooth.sky, siteId: CUSTOM_ID } }, terrainError: t.error ?? "" });
          }
        },
        (err) => {
          if (alive) setCustom({ lat, lon, status: "error", message: `The 2027 ephemeris did not load (${errorText(err)}). Check the connection, then try again.` });
        },
      );
      return () => {
        alive = false;
      };
    }
    loadCustomSite(lat, lon, fromMs, Math.min(DATA_END_MS, toMs + CUSTOM_MARGIN_MS)).then(
      (data) => {
        if (alive) setCustom({ lat, lon, status: "ready", data });
      },
      (err) => {
        if (alive) setCustom({ lat, lon, status: "error", message: errorText(err) });
      },
    );
    return () => {
      alive = false;
    };
  }, [customReq, setCustom]);

  // The ephemeris is only needed once a point is picked; loadSystem caches it for the Moon and System levels.
  const wantSystem = !!point && !system;
  useEffect(() => {
    if (!wantSystem) return;
    let alive = true;
    loadSystem().then(
      (d) => alive && setSystem(d),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [wantSystem]);
  const pointSite = useMemo(() => (point && system ? buildSmoothSite(point.lat, point.lon, system) : null), [point, system]);

  const retrySite = useCallback(
    (id: string) => {
      setLoads((prev) => ({ ...prev, [id]: { status: "loading" } }));
      fetchSite(id);
    },
    [fetchSite],
  );

  // ---- Ranking ----

  const rankingReady = sites.every((s) => loads[s.id].status !== "loading");
  const customData = custom?.status === "ready" && custom.data && covers(custom.data, startMs, endMs) ? custom.data : null;

  const rankable = useMemo(() => {
    const m = new Map<string, SiteData>();
    for (const s of sites) {
      const l = loads[s.id];
      if (l.status === "ready") m.set(s.id, l.data);
    }
    if (customData) m.set(CUSTOM_ID, customData);
    return m;
  }, [loads, customData]);

  const ranking = useMemo(
    () => (rankingReady ? rankSites(rankable, startMs, durationHours) : []),
    [rankingReady, rankable, startMs, durationHours],
  );
  const ranks = useMemo(() => tiedRanks(ranking), [ranking]);
  const scores = useMemo(() => new Map(ranking.map((r) => [r.siteId, r])), [ranking]);

  const baseline = useMemo(() => {
    if (!change || !rankingReady) return null;
    const fromEnd = change.fromStartMs + change.fromHours * HOUR;
    const usable = new Map([...rankable].filter(([, d]) => covers(d, change.fromStartMs, fromEnd)));
    const r = rankSites(usable, change.fromStartMs, change.fromHours);
    return { ranks: tiedRanks(r), scores: new Map(r.map((x) => [x.siteId, x])) };
  }, [change, rankable, rankingReady]);

  // ---- Selection ----

  let effectiveId: string;
  if (selectedId === CUSTOM_ID && custom) effectiveId = CUSTOM_ID;
  else if (selectedId && SITE_IDS.has(selectedId)) effectiveId = selectedId;
  else effectiveId = ranking[0]?.siteId ?? FALLBACK_SITE;

  const customName = custom ? fmtLatLon(custom.lat, custom.lon) : "";
  const nameOf = useCallback(
    (id: string) => (id === CUSTOM_ID ? customName : (sites.find((s) => s.id === id)?.name ?? id)),
    [customName],
  );

  const meta: SiteMeta = useMemo(() => {
    if (effectiveId === CUSTOM_ID && custom) return { id: CUSTOM_ID, name: customName, lat: custom.lat, lon: custom.lon, custom: true };
    const s = sites.find((x) => x.id === effectiveId) ?? sites[0];
    return { id: s.id, name: s.name, lat: s.lat, lon: s.lon, custom: false };
  }, [effectiveId, custom, customName]);

  let selectedData: SiteData | null = null;
  let selectedStatus: "loading" | "ready" | "error" = "loading";
  let selectedError: string | undefined;
  if (effectiveId === CUSTOM_ID && custom) {
    selectedData = customData;
    selectedStatus = custom.status === "error" ? "error" : customData ? "ready" : "loading";
    selectedError = custom.message;
  } else {
    const l = loads[effectiveId];
    if (l?.status === "ready") {
      selectedData = l.data;
      selectedStatus = "ready";
    } else if (l?.status === "error") {
      selectedStatus = "error";
      selectedError = l.message;
    }
  }

  const sample = useMemo(() => (selectedData ? sampleAt(selectedData, nowMs) : null), [selectedData, nowMs]);

  // Keep the latest effective id for handlers without re-creating them.
  const effectiveRef = useRef(effectiveId);
  useEffect(() => {
    effectiveRef.current = effectiveId;
  }, [effectiveId]);

  const select = useCallback((id: string) => setSelectedId(id), [setSelectedId]);

  // ---- Window changes ----

  const applyWindow = useCallback(
    (s: number, h: number, reason: string | null) => {
      setSelectedId((prev) => prev ?? effectiveRef.current);
      if (reason) {
        setChange((prev) => {
          const from = prev ?? { fromStartMs: startMs, fromHours: durationHours };
          if (from.fromStartMs === s && from.fromHours === h) return null;
          return { fromStartMs: from.fromStartMs, fromHours: from.fromHours, reason };
        });
      } else {
        setChange(null);
      }
      setNowMs((prev) => Math.min(s + h * HOUR, Math.max(s, s + (prev - startMs))));
      setStartMs(s);
      setDurationHours(h);
      if (custom && custom.status !== "error") {
        const fits = custom.status === "ready" && custom.data && covers(custom.data, s, s + h * HOUR);
        if (!fits) {
          setCustom({ lat: custom.lat, lon: custom.lon, status: "loading" });
          setCustomReq({ lat: custom.lat, lon: custom.lon, fromMs: s, toMs: s + h * HOUR });
        }
      }
    },
    [setSelectedId, setNowMs, setStartMs, setDurationHours, custom, setChange, startMs, durationHours, setCustom, setCustomReq],
  );

  const undoChange = useCallback(() => {
    if (!change) return;
    applyWindow(change.fromStartMs, change.fromHours, null);
  }, [change, applyWindow]);

  const dismissChange = useCallback(() => setChange(null), [setChange]);

  const moveStart = useCallback(
    (ms: number) => applyWindow(ms, durationHours, "Best start in the next two weeks"),
    [applyWindow, durationHours],
  );

  // ---- Custom site ----

  const addCustom = useCallback(
    (lat: number, lon: number) => {
      setCustom({ lat, lon, status: "loading" });
      setSelectedId(CUSTOM_ID);
      setCustomReq({ lat, lon, fromMs: startMs, toMs: endMs });
    },
    [setCustom, setSelectedId, setCustomReq, startMs, endMs],
  );

  const retrySelected = useCallback(() => {
    if (effectiveId === CUSTOM_ID) {
      if (custom) addCustom(custom.lat, custom.lon);
    } else retrySite(effectiveId);
  }, [effectiveId, custom, addCustom, retrySite]);

  const removeCustom = useCallback(() => {
    setCustomReq(null);
    setCustom(null);
    setSelectedId((prev) => (prev === CUSTOM_ID ? null : prev));
    setPicked((prev) => (prev ? prev.filter((p) => p !== CUSTOM_ID) : prev));
  }, [setCustom, setCustomReq, setPicked, setSelectedId]);

  // ---- Picked point ----

  const pickPoint = useCallback((p: { lat: number; lon: number } | null) => {
    setPoint(p);
    if (!p) setPicked((prev) => (prev ? prev.filter((id) => id !== POINT_ID) : prev));
  }, [setPicked, setPoint]);

  // ---- Time ----

  const scrub = useCallback((ms: number) => {
    setPlaying(false);
    setNowMs(ms);
  }, [setNowMs, setPlaying]);

  // The System view's rail covers all of 2027. Inside the mission window it moves the shared clock;
  // outside it, the System and Moon levels share their own time, which is kept when stepping between them and
  // dropped at the site level, which only covers the window.
  const [systemMs, setSystemMs] = usePlanField("systemMs");
  const systemNow = systemMs ?? nowMs;
  const scrubSystem = useCallback(
    (ms: number) => {
      if (ms >= startMs && ms <= endMs) {
        setSystemMs(null);
        scrub(ms);
      } else {
        setSystemMs(ms);
      }
    },
    [startMs, endMs, setSystemMs, scrub],
  );
  // How the level on show was reached by zoom or step: from the level above it, or from the one below.
  const [arrival, setArrival] = useState<"above" | "below" | null>(null);
  const [fading, setFading] = useState(false);
  const hop = useRef(0);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => () => window.clearTimeout(hop.current), []);

  const showView = useCallback((v: View, from: "above" | "below" | null) => {
    if (v !== "moon" && v !== "system") setSystemMs(null);
    setArrival(from);
    setView(v);
  }, [setSystemMs, setView]);
  const changeView = useCallback(
    (v: View) => {
      window.clearTimeout(hop.current);
      hop.current = 0;
      setFading(false);
      showView(v, null);
    },
    [showView],
  );
  /** Step to another level. A step made by zooming crossfades, unless reduced motion is asked for. */
  const goLevel = useCallback(
    (to: Level, byZoom: boolean) => {
      if (hop.current) return;
      const next = LEVEL_VIEWS.findIndex((l) => l.level === to);
      const now = LEVEL_VIEWS.findIndex((l) => l.view === viewRef.current);
      if (next < 0 || next === now) return;
      const v = LEVEL_VIEWS[next].view;
      const from = now < 0 ? null : next > now ? "above" : "below";
      if (!byZoom || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        showView(v, from);
        return;
      }
      setFading(true);
      hop.current = window.setTimeout(() => {
        showView(v, from);
        // Two frames, so the new level is mounted clear before it fades in.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            hop.current = 0;
            setFading(false);
          }),
        );
      }, LEVEL_FADE_MS);
    },
    [showView],
  );
  const stepLevel = useCallback((to: Level) => goLevel(to, false), [goLevel]);
  const zoomToSystem = useCallback(() => goLevel("system", true), [goLevel]);
  const zoomToMoon = useCallback(() => goLevel("moon", true), [goLevel]);
  const systemSample = useMemo(
    () => (view === "system" && selectedData ? sampleAt(selectedData, systemNow) : null),
    [view, selectedData, systemNow],
  );
  const systemWindow = useMemo(() => ({ startMs, endMs }), [startMs, endMs]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const rate = (endMs - startMs) / PLAY_SPAN_MS;
    const tick = (t: number) => {
      const dt = Math.min(100, t - last);
      last = t;
      setNowMs((prev) => {
        const next = prev + dt * rate;
        return next > endMs ? startMs : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, startMs, endMs, setNowMs]);

  const togglePlay = useCallback(() => setPlaying((p) => !p), [setPlaying]);

  // ---- Views ----

  // About & data opens as a drawer over the current mode.
  const pendingAnchor = useRef<string | null>(null);
  const showAbout = useCallback(() => {
    pendingAnchor.current = "about-check";
    setAboutOpen(true);
  }, [setAboutOpen]);
  const openAbout = useCallback(() => setAboutOpen(true), [setAboutOpen]);
  const closeAbout = useCallback(() => setAboutOpen(false), [setAboutOpen]);
  useEffect(() => {
    if (!aboutOpen || !pendingAnchor.current) return;
    document.getElementById(pendingAnchor.current)?.scrollIntoView({ block: "start" });
    pendingAnchor.current = null;
  }, [aboutOpen]);
  // A link such as /tool?view=about#about-ai opens on that section. The anchor is kept until the regions have
  // loaded, because the check table above it grows when they do (and the URL write drops the hash).
  const linkAnchor = useRef<string | null>(null);
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (/^about-[a-z]+$/.test(id)) linkAnchor.current = id;
  }, [urlEpoch]);
  useEffect(() => {
    const id = linkAnchor.current;
    if (!aboutOpen || !id) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
    if (rankingReady) linkAnchor.current = null;
  }, [aboutOpen, urlEpoch, rankingReady]);

  // ---- Modes ----
  // Plan holds the three zoom levels (site, Moon, System); switching back to Plan returns to the last one used.
  const lastPlanView = useRef<View>(view === "launch" || view === "compare" ? "navigator" : view);
  useEffect(() => {
    if (view === "navigator" || view === "moon" || view === "system") lastPlanView.current = view;
  }, [view]);
  const mode: Mode = view === "launch" || view === "compare" ? view : "plan";
  const changeMode = useCallback((m: Mode) => changeView(m === "plan" ? lastPlanView.current : m), [changeView]);
  const [windowOpen, setWindowOpen] = useState(false);

  // ---- URL ----

  const urlAt = playing ? 0 : Math.round(((nowMs - startMs) / HOUR) * 10) / 10;
  useEffect(() => {
    const t = window.setTimeout(() => {
      const q = writeUrl({
        site: effectiveId,
        startMs,
        hours: durationHours,
        view,
        cmp: picked,
        custom: customLat !== undefined && customLon !== undefined ? { lat: customLat, lon: customLon } : null,
        pt: point,
        atHours: urlAt,
        gap,
        launchSiteId,
        launchPick,
        transitDays,
        about: aboutOpen,
      });
      const next = `${window.location.pathname}?${q}`;
      if (next !== window.location.pathname + window.location.search + window.location.hash) {
        ownQuery.current = new URLSearchParams(q).toString();
        window.history.replaceState(null, "", next);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [effectiveId, startMs, durationHours, view, picked, customLat, customLon, point, urlAt, gap, launchSiteId, launchPick, transitDays, aboutOpen, urlEpoch]);

  // ---- Derived props for panels ----

  // How the custom site's horizon was made, for its row in the ranking and the bulletin.
  const customTerrainError = custom?.terrainError;
  const customTag = isGlobalSite(customData)
    ? `LOLA global, ${customData.horizon.gridResolutionM} m grid`
    : isSmoothSite(customData)
      ? "Smooth horizon"
      : undefined;
  const customNote = isGlobalSite(customData)
    ? `Custom site. Terrain: ${customData.terrainLabel}`
    : isSmoothSite(customData)
      ? "Custom site on a smooth horizon: its terrain did not load"
      : undefined;

  const rows: RankedRow[] = useMemo(
    () =>
      ranking.map((r) => ({
        id: r.siteId,
        name: nameOf(r.siteId),
        custom: r.siteId === CUSTOM_ID,
        tag: r.siteId === CUSTOM_ID ? customTag : undefined,
        score: r,
        rank: ranks.get(r.siteId) ?? 0,
        prevRank: baseline?.ranks.get(r.siteId) ?? null,
      })),
    [ranking, ranks, baseline, nameOf, customTag],
  );

  const pending = useMemo(
    () => (custom && custom.status === "loading" ? [{ id: CUSTOM_ID, name: customName }] : []),
    [custom, customName],
  );

  const failed = useMemo(
    () =>
      sites
        .filter((s) => loads[s.id].status === "error")
        .map((s) => ({ id: s.id, name: s.name, message: (loads[s.id] as { message: string }).message })),
    [loads],
  );

  // Mission score (0..1) per region for the current window, as ranked in the table.
  const regionValues = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of ranking) if (SITE_IDS.has(r.siteId)) out[r.siteId] = r.score;
    return out;
  }, [ranking]);

  const score: MissionScore | null = scores.get(effectiveId) ?? null;
  const before: MissionScore | null = baseline?.scores.get(effectiveId) ?? null;

  const note = useMemo(
    () =>
      change ? (
        <ChangeNote
          change={change}
          startMs={startMs}
          siteName={meta.name}
          before={before}
          after={score}
          rankBefore={baseline?.ranks.get(effectiveId) ?? null}
          rankAfter={ranks.get(effectiveId) ?? null}
          total={ranking.length}
          onUndo={undoChange}
          onDismiss={dismissChange}
        />
      ) : null,
    [change, startMs, meta.name, before, score, baseline, effectiveId, ranks, ranking.length, undoChange, dismissChange],
  );

  const customState: CustomSiteState = custom
    ? { lat: custom.lat, lon: custom.lon, status: custom.status, message: custom.message }
    : null;

  const compareOptions: CompareOption[] = useMemo(() => {
    const out: CompareOption[] = sites.map((s) => ({ id: s.id, name: s.name, site: rankable.get(s.id) ?? null }));
    if (custom) out.push({ id: CUSTOM_ID, name: customName, custom: true, site: customData });
    if (point) out.push({ id: POINT_ID, name: fmtLatLon(point.lat, point.lon), noTerrain: true, site: pointSite });
    return out;
  }, [rankable, custom, customName, customData, point, pointSite]);

  const comparePicked = useMemo(() => {
    if (picked) return picked;
    const other = ranking.find((r) => r.siteId !== effectiveId)?.siteId;
    return other ? [effectiveId, other] : [effectiveId];
  }, [picked, ranking, effectiveId]);

  /** Hand a picked point to the terrain-aware custom-site path and open it at the site level. */
  const pointToTerrain = useCallback(
    (lat: number, lon: number) => {
      // The same rule as the custom-site form (validateSitePoint); PointPanel only offers it for points that pass.
      const v = validateSitePoint(lat, lon);
      if (!v.ok) return;
      addCustom(v.lat, v.lon);
      changeView("navigator");
    },
    [addCustom, changeView],
  );

  /**
   * Step down from the Moon level to the site level of the place at the centre of the view: the picked point if it
   * is close by, the selected region over the south polar cap, and anywhere else the centre itself, which becomes
   * the picked point. A point opens through the same load as "Open site level".
   */
  const openSiteAt = useCallback(
    (centre: { lat: number; lon: number } | null, byZoom: boolean) => {
      if (hop.current) return;
      const t = centre ? siteTarget(centre, point) : null;
      // A point the site level cannot open (within 0.1° of a pole, or off the polar grid) keeps the current site.
      const v = t && t.kind !== "region" ? validateSitePoint(t.lat, t.lon) : null;
      if (t && v?.ok) {
        if (t.kind === "centre") pickPoint({ lat: t.lat, lon: t.lon });
        // The same point, already loaded, is opened as it stands.
        if (custom && custom.status === "ready" && samePoint(custom, v)) setSelectedId(CUSTOM_ID);
        else addCustom(v.lat, v.lon);
      }
      goLevel("site", byZoom);
    },
    [point, goLevel, pickPoint, custom, setSelectedId, addCustom],
  );
  const zoomToSite = useCallback((centre: { lat: number; lon: number }) => openSiteAt(centre, true), [openSiteAt]);
  /** The Moon level's step buttons: down to the site level follows the same rule as zooming in. */
  const stepFromMoon = useCallback(
    (to: Level) => (to === "site" ? openSiteAt(viewCentre.current, false) : goLevel(to, false)),
    [openSiteAt, goLevel],
  );
  // Leaving the site level of a point outside the nine regions, the Moon level opens centred on that point.
  const moonEntryLat = custom?.lat;
  const moonEntryLon = custom?.lon;
  const moonEntryPoint = useMemo(
    () => (effectiveId === CUSTOM_ID && moonEntryLat !== undefined && moonEntryLon !== undefined ? { lat: moonEntryLat, lon: moonEntryLon } : null),
    [effectiveId, moonEntryLat, moonEntryLon],
  );

  /** Put the picked point in the Compare view, beside what is already there, and open it. */
  const comparePoint = useCallback(() => {
    const base = comparePicked.filter((id) => id !== POINT_ID).slice(0, 2);
    setPicked([...base, POINT_ID]);
    changeView("compare");
  }, [comparePicked, setPicked, changeView]);

  const aboutEntries = useMemo(
    () => sites.map((s) => ({ id: s.id, name: s.name, site: rankable.get(s.id) ?? null })),
    [rankable],
  );

  const sun = sample ? { az: sample.sunAz, el: sample.sunEl } : null;
  const earth = sample ? { az: sample.earthAz, el: sample.earthEl } : null;
  // Up or down at the time shown, from the one up test (isUp) every view uses.
  const sunUpNow = selectedData ? isUp(selectedData, "sun", nowMs) : false;
  const earthUpNow = selectedData ? isUp(selectedData, "earth", nowMs) : false;
  const upNow = useMemo(() => ({ sun: sunUpNow, earth: earthUpNow }), [sunUpNow, earthUpNow]);
  const customPoint = useMemo(
    () => (customLat !== undefined && customLon !== undefined ? { lat: customLat, lon: customLon } : null),
    [customLat, customLon],
  );
  const methodNote = !meta.custom || !selectedData
    ? undefined
    : isGlobalSite(selectedData)
      ? selectedData.method
      : isSmoothSite(selectedData)
        ? `The terrain around this point did not load from NASA Moon Trek${customTerrainError ? ` (${customTerrainError})` : ""}, so these numbers use a smooth horizon. Press Replace site to try again. ${SMOOTH_METHOD}`
        : customHorizonMethod(selectedData.horizon);
  const customTerrainData = custom?.data;
  const retryCustom = useCallback(() => {
    if (customLat !== undefined && customLon !== undefined) addCustom(customLat, customLon);
  }, [customLat, customLon, addCustom]);
  const customStatus = custom?.status;
  const customMessage = custom?.message;
  // The plate around a custom site north of 80° S; the south polar plate serves the rest.
  const plateLocal = useMemo(() => {
    if (customLat === undefined || customLat <= POLAR_CUSTOM_LAT) return null;
    return {
      terrain: isGlobalSite(customTerrainData) ? customTerrainData.local : null,
      error:
        customStatus === "error"
          ? (customMessage ?? "The custom site did not load.")
          : customStatus === "ready" && !isGlobalSite(customTerrainData)
            ? customTerrainError || "The terrain around this point did not load from NASA Moon Trek."
            : null,
      onRetry: retryCustom,
    };
  }, [customLat, customTerrainData, customStatus, customMessage, customTerrainError, retryCustom]);
  const plotHeight = usePlotHeight();
  // The Sun's and Earth's bearing paths on the plate cover the same window as Fig. 2.
  const plateTrack = useMemo(() => (selectedData ? { site: selectedData, startMs, endMs } : null), [selectedData, startMs, endMs]);
  const fade = `transition-opacity duration-200 motion-reduce:transition-none ${fading ? "opacity-0" : "opacity-100"}`;

  return (
    <div className="relative flex flex-col xl:h-dvh xl:min-h-[38rem] xl:overflow-hidden">
      <h1 className="sr-only">Lunar Landing Site Navigator</h1>
      <AppBar
        mode={mode}
        onMode={changeMode}
        startMs={startMs}
        endMs={endMs}
        hours={durationHours}
        windowOpen={windowOpen}
        onWindowOpen={setWindowOpen}
        onAbout={openAbout}
        windowControls={(close) => (
          <Controls
            startMs={startMs}
            durationHours={durationHours}
            site={selectedData}
            siteName={meta.name}
            onApply={applyWindow}
            onDone={close}
            layout="stack"
            className="p-4"
          />
        )}
      />

      {note && (
        <div className="pointer-events-none fixed top-16 right-3 z-50">
          <Toast>{note}</Toast>
        </div>
      )}

      {view === "navigator" && (
        <div
          role="tabpanel"
          id="workspace"
          aria-labelledby="mode-plan"
          className={`grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(19rem,22rem)_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)_21rem] ${fade}`}
        >
          <div className="relative border-b border-rule bg-paper-2 md:row-span-2 md:border-r md:border-b-0 xl:row-span-1 xl:overflow-y-auto">
            <RegionTable
              rows={rows}
              loading={!rankingReady}
              pending={pending}
              failed={failed}
              onRetry={retrySite}
              selectedId={effectiveId}
              onSelect={select}
              limitHours={gap}
              onLimitChange={setGap}
            />
            <CustomSiteForm state={customState} onSubmit={addCustom} onRemove={removeCustom} className="border-t border-rule" />
          </div>

          <div className="relative flex min-w-0 flex-col md:col-start-2 xl:overflow-y-auto">
            <section aria-label={`Fig. 1, terrain at ${meta.name}`} className="flex flex-col xl:min-h-[17rem] xl:flex-1">
              <div className="relative h-[24rem] overflow-hidden bg-paper-2 sm:h-[30rem] xl:h-auto xl:flex-1">
                <ErrorBoundary
                  fallback={
                    <PanelProblem>
                      The 3D terrain could not start in this browser, which may have WebGL turned off. The ranking, plots
                      and bulletin still work.
                    </PanelProblem>
                  }
                >
                  <TerrainPlate
                    selectedId={effectiveId}
                    onSelect={select}
                    sun={sun}
                    earth={earth}
                    up={upNow}
                    regionValues={regionValues}
                    customSite={customPoint}
                    local={plateLocal}
                    track={plateTrack}
                    caption={<PlateTitle meta={meta} />}
                    onZoomOut={zoomToMoon}
                    levelNav={<LevelNav level="site" onLevel={stepLevel} />}
                    className="h-full w-full"
                  />
                </ErrorBoundary>
              </div>
            </section>

            <section
              aria-label={`Fig. 2, horizon and time from ${meta.name}`}
              className="border-t border-ink bg-paper px-4 pt-1.5 pb-2.5 xl:shrink-0"
            >
              {selectedData ? (
                <ErrorBoundary
                  key={`plot-${effectiveId}`}
                  fallback={<PanelProblem>The horizon plot could not be drawn for {meta.name}.</PanelProblem>}
                >
                  <HorizonPlot
                    site={selectedData}
                    siteName={meta.name}
                    nowMs={nowMs}
                    startMs={startMs}
                    endMs={endMs}
                    figure="Fig. 2"
                    plotHeight={plotHeight}
                    onScrub={scrub}
                    playing={playing}
                    onTogglePlay={togglePlay}
                    className="w-full"
                  />
                </ErrorBoundary>
              ) : selectedStatus === "error" ? (
                <PanelProblem>No tracks for {meta.name}, so there is no horizon plot or time rail. The bulletin has the details.</PanelProblem>
              ) : (
                <BandSkeleton />
              )}
            </section>
          </div>

          <section
            aria-labelledby="bulletin-title"
            className="relative border-t border-rule md:col-start-2 xl:col-start-3 xl:overflow-y-auto xl:border-t-0 xl:border-l"
          >
            <SiteBulletin
              name={meta.name}
              lat={meta.lat}
              lon={meta.lon}
              custom={meta.custom}
              customNote={meta.custom ? customNote : undefined}
              methodNote={methodNote}
              status={selectedStatus}
              error={selectedError}
              site={selectedData}
              score={score}
              rank={ranks.get(effectiveId) ?? null}
              total={ranking.length}
              before={before}
              startMs={startMs}
              endMs={endMs}
              durationHours={durationHours}
              limitHours={gap}
              onUseStart={moveStart}
              onShowAbout={showAbout}
              onRetry={retrySelected}
            />
          </section>
        </div>
      )}

      {view === "system" && (
        <div role="tabpanel" id="workspace" aria-labelledby="mode-plan" className={`relative min-h-0 flex-1 xl:overflow-hidden ${fade}`}>
          <SystemView
            nowMs={systemNow}
            onScrub={scrubSystem}
            siteName={meta.name}
            sunElevationDeg={systemSample?.sunEl}
            earthElevationDeg={systemSample?.earthEl}
            windowMs={systemWindow}
            onOpenMoon={zoomToMoon}
            entry={arrival}
            levelNav={<LevelNav level="system" onLevel={stepLevel} />}
            launchSites={LAUNCH_MARKS}
            selectedLaunchSiteId={launchSiteId ?? undefined}
            onSelectLaunchSite={setLaunchSiteId}
            transferArc={transferArc}
            className="h-full"
          />
        </div>
      )}

      {view === "moon" && (
        <div role="tabpanel" id="workspace" aria-labelledby="mode-plan" className={`relative min-h-0 flex-1 xl:overflow-hidden ${fade}`}>
          <MoonView
            nowMs={systemNow}
            onScrub={scrubSystem}
            selectedId={effectiveId}
            onSelect={select}
            onOpenSite={zoomToSite}
            onOpenSystem={zoomToSystem}
            entry={arrival}
            entryPoint={moonEntryPoint}
            levelNav={<LevelNav level="moon" onLevel={stepFromMoon} />}
            windowMs={systemWindow}
            point={point}
            pointSite={pointSite}
            onPoint={pickPoint}
            onPointTerrain={pointToTerrain}
            onPointCompare={comparePoint}
            className="h-full"
          />
        </div>
      )}

      {view === "launch" && (
        <div role="tabpanel" id="workspace" aria-labelledby="mode-launch" className="relative flex min-h-0 flex-1 flex-col xl:overflow-hidden">
          <LaunchPanel
            arrivalMs={startMs}
            windowHours={durationHours}
            siteName={meta.name}
            selectedLaunchSiteId={launchSiteId}
            onSelectLaunchSite={setLaunchSiteId}
            onPickOpportunity={setLaunchPick}
            initialPick={launchPick}
            transitDays={transitDays}
            onTransitDaysChange={setTransitDays}
            className="min-h-0 flex-1 overflow-y-auto"
          />
        </div>
      )}

      {view === "compare" && (
        <div role="tabpanel" id="workspace" aria-labelledby="mode-compare" className="relative min-h-0 flex-1 xl:overflow-y-auto">
          <ComparePanel
            options={compareOptions}
            picked={comparePicked}
            onPickedChange={setPicked}
            rankable={rankable}
            ranks={ranks}
            scores={scores}
            total={ranking.length}
            loading={!rankingReady}
            startMs={startMs}
            durationHours={durationHours}
            nowMs={nowMs}
            onScrub={scrub}
            limitHours={gap}
          />
        </div>
      )}

      <Drawer open={aboutOpen} onClose={closeAbout} label="About & data">
        <div className="sticky top-0 z-10 flex items-center gap-4 border-b border-ink bg-paper px-4 py-2.5 xl:px-8">
          <p className="text-[0.75rem] font-semibold tracking-[0.08em] text-ink uppercase">About &amp; data</p>
          <p className="hidden min-w-0 truncate text-[0.75rem] text-ink-2 sm:block">Data: JPL Horizons, hourly for 2027 · LOLA LDEM_80S, 80 m</p>
          <button type="button" onClick={closeAbout} className="ml-auto inline-flex h-8 items-center gap-1.5 border border-ink px-2.5 text-[0.8rem] font-medium text-ink hover:bg-paper-3">
            Close<span className="sr-only"> About &amp; data</span>
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
        </div>
        <AboutPanel entries={aboutEntries} loading={!rankingReady} />
      </Drawer>
    </div>
  );
}

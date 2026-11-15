"use client";

import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Component,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { loadSite, rankSites, sampleAt, type MissionScore, type SiteData } from "@/lib/sky";
import { formatLatLon, sites } from "@/lib/sites";
import { customHorizonMethod, loadCustomSite } from "@/lib/customSite";
import { POINT_SITE_ID, SMOOTH_METHOD, buildSmoothSite, isSmoothSite } from "@/lib/anySite";
import { buildGlobalSite, isGlobalSite, loadLocalTerrain } from "@/lib/localTerrain";
import { loadSystem, type SystemData } from "@/lib/system";
import HorizonPlot from "./HorizonPlot";
import RegionTable, { CustomSiteForm, GAP_LIMITS, type CustomSiteState, type RankedRow } from "./RegionTable";
import MissionControls, {
  ChangeNote,
  DATA_END_MS,
  DATA_START_MS,
  DAY,
  DEFAULT_HOURS,
  DEFAULT_START_MS,
  HOUR,
  MAX_HOURS,
  MIN_HOURS,
  fmtLength,
  fmtSpan,
  type WindowChange,
} from "./MissionControls";
import SiteBulletin, { covers } from "./SiteBulletin";
import ComparePanel, { tiedRanks, type CompareOption } from "./ComparePanel";
import AboutPanel from "./AboutPanel";
import LevelNav, { type Level } from "../levels/LevelNav";

const TerrainPlate = dynamic(() => import("./TerrainPlate"), { ssr: false, loading: () => <PlateLoading /> });

const SystemView = dynamic(() => import("../system/SystemView"), { ssr: false, loading: () => <SystemLoading /> });

const MoonView = dynamic(() => import("../moon/MoonView"), { ssr: false, loading: () => <MoonLoading /> });

const Controls = memo(MissionControls);

// ---------- Constants and URL state ----------

const CUSTOM_ID = "custom";
const SITE_IDS = new Set(sites.map((s) => s.id));
/** Top of the ranking for the default window (14 Nov 2027); shown until the ranking is ready. */
const FALLBACK_SITE = "de-gerlache-2";
const DEFAULT_GAP = 48;
/** Extra track fetched for a custom site past the window, so one- and two-week slips stay covered. */
const CUSTOM_MARGIN_MS = 14 * DAY;
/** Playback runs through the whole window in this many milliseconds. */
const PLAY_SPAN_MS = 12_000;

type View = "navigator" | "moon" | "system" | "compare" | "about";
const TABS: { id: View; label: string }[] = [
  { id: "navigator", label: "Navigator" },
  { id: "moon", label: "Moon" },
  { id: "system", label: "System" },
  { id: "compare", label: "Compare" },
  { id: "about", label: "About & data" },
];

type UrlState = {
  site: string | null;
  startMs: number;
  hours: number;
  view: View;
  cmp: string[] | null;
  custom: { lat: number; lon: number } | null;
  /** A point picked at the Moon level, anywhere on the globe. */
  pt: { lat: number; lon: number } | null;
  atHours: number;
  gap: number;
};

/**
 * Start time from the URL, floored to the hour (UTC). Accepts a date
 * (2027-07-15), the form this page writes (2027-07-15T06:00Z) and a full
 * ISO time (2027-07-15T06:00:00.000Z). Impossible dates are rejected.
 */
function parseStartParam(v: string | null): number | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::?(\d{2})(?::?(\d{2})(?:\.\d+)?)?)?)?Z?$/i.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = m[4] ? Number(m[4]) : 0;
  if (h > 23 || Number(m[5] ?? 0) > 59 || Number(m[6] ?? 0) > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h);
  const t = new Date(ms);
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return ms;
}

function readUrl(p: URLSearchParams): UrlState {
  let hours = Number(p.get("hours"));
  if (!Number.isFinite(hours) || hours < MIN_HOURS || hours > MAX_HOURS) hours = DEFAULT_HOURS;
  let startMs = parseStartParam(p.get("start")) ?? DEFAULT_START_MS;
  if (startMs < DATA_START_MS || startMs >= DATA_END_MS) startMs = DEFAULT_START_MS;
  if (startMs + hours * HOUR > DATA_END_MS) startMs = Math.floor((DATA_END_MS - hours * HOUR) / HOUR) * HOUR;

  let custom: UrlState["custom"] = null;
  const c = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(p.get("custom") ?? "");
  if (c) {
    const lat = Number(c[1]);
    const lon = Number(c[2]);
    // South of 80° S the custom site uses the polar LOLA grids; anywhere else, the Moon Trek mosaics.
    if (lat <= 90 && lat >= -90 && lon >= -180 && lon <= 360) custom = { lat, lon: lat > POLAR_CUSTOM_LAT && lon > 180 ? lon - 360 : lon };
  }
  let pt: UrlState["pt"] = null;
  const q = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(p.get("pt") ?? "");
  if (q) {
    const lat = Number(q[1]);
    const lon = Number(q[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 360) pt = { lat, lon: lon > 180 ? lon - 360 : lon };
  }
  const valid = (id: string) => SITE_IDS.has(id) || (id === CUSTOM_ID && !!custom) || (id === POINT_SITE_ID && !!pt);
  const siteParam = p.get("site");
  const viewParam = p.get("view");
  const cmp = (p.get("cmp") ?? "").split(",").filter(valid).slice(0, 3);
  const at = Number(p.get("at"));
  const gap = Number(p.get("gap"));
  return {
    site: siteParam && valid(siteParam) ? siteParam : null,
    startMs,
    hours,
    view: TABS.some((t) => t.id === viewParam) ? (viewParam as View) : "navigator",
    cmp: cmp.length ? cmp : null,
    custom,
    pt,
    atHours: Number.isFinite(at) && at > 0 && at <= hours ? at : 0,
    gap: GAP_LIMITS.includes(gap) ? gap : DEFAULT_GAP,
  };
}

function isoStart(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}T${two(d.getUTCHours())}:00Z`;
}

function writeUrl(s: {
  site: string;
  startMs: number;
  hours: number;
  view: View;
  cmp: string[] | null;
  custom: { lat: number; lon: number } | null;
  pt: { lat: number; lon: number } | null;
  atHours: number;
  gap: number;
}): string {
  const parts = [`site=${encodeURIComponent(s.site)}`, `start=${isoStart(s.startMs)}`, `hours=${Number(s.hours.toFixed(3))}`];
  if (s.view !== "navigator") parts.push(`view=${s.view}`);
  if (s.cmp?.length) parts.push(`cmp=${s.cmp.map(encodeURIComponent).join(",")}`);
  if (s.custom) parts.push(`custom=${s.custom.lat.toFixed(4)},${s.custom.lon.toFixed(4)}`);
  if (s.pt) parts.push(`pt=${Number(s.pt.lat.toFixed(4))},${Number(s.pt.lon.toFixed(4))}`);
  if (s.atHours > 0.05) parts.push(`at=${Number(s.atHours.toFixed(1))}`);
  if (s.gap !== DEFAULT_GAP) parts.push(`gap=${s.gap}`);
  return parts.join("&");
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- Small pieces ----------

class PanelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

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

function Tabs({ view, onChange, className = "" }: { view: View; onChange: (v: View) => void; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const n = TABS.length;
    const next =
      e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(TABS[next].id);
    refs.current[next]?.focus();
  }
  return (
    <div role="tablist" aria-label="Views" className={`flex ${className}`}>
      {TABS.map((t, i) => {
        const on = view === t.id;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={on}
            aria-controls={on ? `view-${t.id}` : undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={`h-10 flex-1 px-2 text-[0.79rem] whitespace-nowrap transition-colors duration-150 focus-visible:outline-offset-[-2px] sm:px-3.5 sm:text-[0.844rem] xl:flex-none ${
              on
                ? "font-semibold text-ink shadow-[inset_0_-2px_0_var(--color-ink)]"
                : "font-medium text-ink-2 hover:text-ink hover:shadow-[inset_0_-1px_0_var(--color-ink-2)]"
            }`}
          >
            {t.label}
          </button>
        );
      })}
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

/**
 * The bulletin's masthead: its name, the issue (the window on show) and the
 * data it was computed from, with the three views as its sections.
 */
const Masthead = memo(function Masthead({
  startMs,
  endMs,
  hours,
  view,
  onView,
}: {
  startMs: number;
  endMs: number;
  hours: number;
  view: View;
  onView: (v: View) => void;
}) {
  return (
    <header className="flex flex-col border-b border-ink bg-paper xl:flex-row xl:items-end xl:justify-between xl:gap-8 xl:pl-4">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 pt-2 pb-1.5 xl:px-0">
        <h1 className="text-[1rem] leading-tight font-bold tracking-[0.08em] text-ink uppercase">Landing window bulletin</h1>
        <p className="text-[0.844rem] text-ink tabular-nums">
          <span className="sr-only">Window </span>
          {fmtSpan(startMs, endMs)}
          <span className="text-ink-2">, {fmtLength(hours)}</span>
        </p>
        <p className="text-[0.75rem] text-ink-2">Data: JPL Horizons, hourly for 2027 · LOLA LDEM_80S, 80 m</p>
      </div>
      <Tabs view={view} onChange={onView} className="border-t border-rule xl:border-t-0" />
    </header>
  );
});

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
    <div className="relative flex flex-col xl:h-[calc(100dvh-2.75rem)] xl:overflow-hidden" aria-busy="true">
      <p className="sr-only" role="status">
        Loading the Navigator
      </p>
      <div className="flex items-baseline gap-4 border-b border-ink bg-paper px-4 pt-3 pb-2.5" aria-hidden="true">
        <div className="h-4 w-56 bg-paper-3" />
        <div className="h-3.5 w-80 bg-paper-3" />
      </div>
      <div className="border-b border-rule bg-paper-2 px-4 py-3">
        <div className="flex flex-wrap gap-5" aria-hidden="true">
          {[15, 10, 15, 11].map((w, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="h-3 w-20 bg-paper-3" />
              <div className="h-8 bg-paper-3" style={{ width: `${w}rem` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="grid flex-1 grid-cols-1 md:grid-cols-[minmax(19rem,22rem)_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)_21rem]">
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
type CustomRecord = {
  lat: number;
  lon: number;
  status: "loading" | "ready" | "error";
  data?: SiteData;
  message?: string;
  /** Why the terrain around a point north of 80° S did not load; its data then has a smooth horizon. */
  terrainError?: string;
};
/** Custom sites north of this latitude take their terrain from NASA Moon Trek (src/lib/localTerrain.ts). */
const POLAR_CUSTOM_LAT = -80;
/** A custom-site load: the point and the window it must cover. Each new object starts a load. */
type CustomRequest = { lat: number; lon: number; fromMs: number; toMs: number };

/** Same point to the 4 decimals the URL keeps. */
const samePoint = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.abs(a.lat - b.lat) < 5e-5 && Math.abs(a.lon - b.lon) < 5e-5;

export default function NavigatorApp() {
  const params = useSearchParams();
  const pathname = usePathname();
  const query = params.toString();
  const [init] = useState(() => readUrl(new URLSearchParams(query)));
  const [home] = useState(pathname);

  const [view, setView] = useState<View>(init.view);
  const [startMs, setStartMs] = useState(init.startMs);
  const [durationHours, setDurationHours] = useState(init.hours);
  const [nowMs, setNowMs] = useState(init.startMs + init.atHours * HOUR);
  const [selectedId, setSelectedId] = useState<string | null>(init.site);
  const [change, setChange] = useState<WindowChange | null>(null);
  const [gap, setGap] = useState(init.gap);
  const [picked, setPicked] = useState<string[] | null>(init.cmp);
  const [playing, setPlaying] = useState(false);
  const [loads, setLoads] = useState<Record<string, Load>>(() =>
    Object.fromEntries(sites.map((s) => [s.id, { status: "loading" } as Load])),
  );
  const [custom, setCustom] = useState<CustomRecord | null>(() =>
    init.custom ? { ...init.custom, status: "loading" } : null,
  );
  const [customReq, setCustomReq] = useState<CustomRequest | null>(() =>
    init.custom ? { ...init.custom, fromMs: init.startMs, toMs: init.startMs + init.hours * HOUR } : null,
  );

  // A point picked at the Moon level, and the ephemeris its smooth-horizon tracks are computed from.
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(init.pt);
  const [system, setSystem] = useState<SystemData | null>(null);

  // ---- URL in ----
  // The page stays mounted across client navigations (and is kept alive while
  // another route shows), so a later visit with new search params, such as a
  // second pick on the landing page, must reset the view. Our own URL writes
  // come back here too; they are recognised and skipped. A link that names no
  // site or window (the navbar's bare /tool, or ?view=about) keeps the current
  // plan and only switches the tab it names; the URL is then written back.
  const [seenQuery, setSeenQuery] = useState(query);
  const [ownQuery, setOwnQuery] = useState<string | null>(null);
  const [urlEpoch, setUrlEpoch] = useState(0);
  if (pathname === home && query !== seenQuery) {
    setSeenQuery(query);
    const incoming = new URLSearchParams(query);
    const namesPlan = ["site", "start", "hours", "custom", "cmp", "pt"].some((k) => incoming.has(k));
    if (query !== ownQuery && !namesPlan && incoming.has("view")) {
      setView(readUrl(incoming).view);
      setUrlEpoch((n) => n + 1);
    } else if (query !== ownQuery && namesPlan) {
      const u = readUrl(incoming);
      setView(u.view);
      setStartMs(u.startMs);
      setDurationHours(u.hours);
      setNowMs(u.startMs + u.atHours * HOUR);
      setSelectedId(u.site);
      setChange(null);
      setGap(u.gap);
      setPicked(u.cmp);
      setPoint(u.pt);
      setPlaying(false);
      setUrlEpoch((n) => n + 1);
      const uEnd = u.startMs + u.hours * HOUR;
      if (!u.custom) {
        setCustom(null);
        setCustomReq(null);
      } else if (
        !custom ||
        !samePoint(custom, u.custom) ||
        custom.status === "error" ||
        (custom.status === "ready" && !(custom.data && covers(custom.data, u.startMs, uEnd)))
      ) {
        setCustom({ ...u.custom, status: "loading" });
        setCustomReq({ ...u.custom, fromMs: u.startMs, toMs: uEnd });
      }
    }
  }

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
  }, [customReq]);

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

  const customName = custom ? formatLatLon(custom.lat, custom.lon) : "";
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

  const select = useCallback((id: string) => setSelectedId(id), []);

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
    [startMs, durationHours, custom],
  );

  const undoChange = useCallback(() => {
    if (!change) return;
    applyWindow(change.fromStartMs, change.fromHours, null);
  }, [change, applyWindow]);

  const dismissChange = useCallback(() => setChange(null), []);

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
    [startMs, endMs],
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
  }, []);

  // ---- Picked point ----

  const pickPoint = useCallback((p: { lat: number; lon: number } | null) => {
    setPoint(p);
    if (!p) setPicked((prev) => (prev ? prev.filter((id) => id !== POINT_SITE_ID) : prev));
  }, []);

  // ---- Time ----

  const scrub = useCallback((ms: number) => {
    setPlaying(false);
    setNowMs(ms);
  }, []);

  // The System view's rail covers all of 2027. Inside the mission window it moves the shared clock;
  // outside it, the System and Moon levels share their own time, which is kept when stepping between them and
  // dropped at the site level, which only covers the window.
  const [systemMs, setSystemMs] = useState<number | null>(null);
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
    [startMs, endMs, scrub],
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
  }, []);
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
  const zoomToSite = useCallback(() => goLevel("site", true), [goLevel]);
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
  }, [playing, startMs, endMs]);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);

  // ---- Views ----

  const pendingAnchor = useRef<string | null>(null);
  const showAbout = useCallback(() => {
    pendingAnchor.current = "about-check";
    setView("about");
  }, []);
  useEffect(() => {
    if (view !== "about" || !pendingAnchor.current) return;
    document.getElementById(pendingAnchor.current)?.scrollIntoView({ block: "start" });
    pendingAnchor.current = null;
  }, [view]);
  // A link such as /tool?view=about#about-ai opens on that section.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (view === "about" && /^about-[a-z]+$/.test(id)) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [view, urlEpoch]);

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
        custom: custom ? { lat: custom.lat, lon: custom.lon } : null,
        pt: point,
        atHours: urlAt,
        gap,
      });
      const next = `${window.location.pathname}?${q}`;
      if (next !== window.location.pathname + window.location.search + window.location.hash) {
        setOwnQuery(new URLSearchParams(q).toString());
        window.history.replaceState(null, "", next);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [effectiveId, startMs, durationHours, view, picked, custom, point, urlAt, gap, seenQuery]);

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
    if (point) out.push({ id: POINT_SITE_ID, name: formatLatLon(point.lat, point.lon), noTerrain: true, site: pointSite });
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
      addCustom(lat, lon);
      changeView("navigator");
    },
    [addCustom, changeView],
  );

  /** Put the picked point in the Compare view, beside what is already there, and open it. */
  const comparePoint = useCallback(() => {
    const base = comparePicked.filter((id) => id !== POINT_SITE_ID).slice(0, 2);
    setPicked([...base, POINT_SITE_ID]);
    changeView("compare");
  }, [comparePicked, changeView]);

  const aboutEntries = useMemo(
    () => sites.map((s) => ({ id: s.id, name: s.name, site: rankable.get(s.id) ?? null })),
    [rankable],
  );

  const sun = sample ? { az: sample.sunAz, el: sample.sunEl } : null;
  const earth = sample ? { az: sample.earthAz, el: sample.earthEl } : null;
  const customLat = custom?.lat;
  const customLon = custom?.lon;
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
  const windowLabel = `${fmtSpan(startMs, endMs)}, ${fmtLength(durationHours)}`;
  const plotHeight = usePlotHeight();
  // The Sun's and Earth's bearing paths on the plate cover the same window as Fig. 2.
  const plateTrack = useMemo(() => (selectedData ? { site: selectedData, startMs, endMs } : null), [selectedData, startMs, endMs]);
  const fade = `transition-opacity duration-200 motion-reduce:transition-none ${fading ? "opacity-0" : "opacity-100"}`;

  return (
    <div className="relative flex flex-col xl:h-[calc(100dvh-2.75rem)] xl:min-h-[38rem] xl:overflow-hidden">
      <Masthead startMs={startMs} endMs={endMs} hours={durationHours} view={view} onView={changeView} />

      <div className="border-b border-rule bg-paper-2">
        <Controls
          startMs={startMs}
          durationHours={durationHours}
          site={selectedData}
          siteName={meta.name}
          onApply={applyWindow}
          className="px-4 pt-2 pb-2.5"
        />
      </div>

      {view === "navigator" && (
        <div
          role="tabpanel"
          id="view-navigator"
          aria-labelledby="tab-navigator"
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
              windowLabel={windowLabel}
              note={note}
            />
            <CustomSiteForm state={customState} onSubmit={addCustom} onRemove={removeCustom} className="border-t border-rule" />
          </div>

          <div className="relative flex min-w-0 flex-col md:col-start-2 xl:overflow-y-auto">
            <section aria-label={`Fig. 1, terrain at ${meta.name}`} className="flex flex-col xl:min-h-[17rem] xl:flex-1">
              <div className="relative h-[24rem] overflow-hidden bg-paper-2 sm:h-[30rem] xl:h-auto xl:flex-1">
                <PanelBoundary
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
                    regionValues={regionValues}
                    customSite={customPoint}
                    local={plateLocal}
                    track={plateTrack}
                    caption={<PlateTitle meta={meta} />}
                    onZoomOut={zoomToMoon}
                    levelNav={<LevelNav level="site" onLevel={stepLevel} />}
                    className="h-full w-full"
                  />
                </PanelBoundary>
              </div>
            </section>

            <section
              aria-label={`Fig. 2, horizon and time from ${meta.name}`}
              className="border-t border-ink bg-paper px-4 pt-1.5 pb-2.5 xl:shrink-0"
            >
              {selectedData ? (
                <PanelBoundary
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
                </PanelBoundary>
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
        <div role="tabpanel" id="view-system" aria-labelledby="tab-system" className={`relative min-h-0 flex-1 xl:overflow-hidden ${fade}`}>
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
            className="h-full"
          />
        </div>
      )}

      {view === "moon" && (
        <div role="tabpanel" id="view-moon" aria-labelledby="tab-moon" className={`relative min-h-0 flex-1 xl:overflow-hidden ${fade}`}>
          <MoonView
            nowMs={systemNow}
            onScrub={scrubSystem}
            selectedId={effectiveId}
            onSelect={select}
            onOpenSite={zoomToSite}
            onOpenSystem={zoomToSystem}
            entry={arrival}
            levelNav={<LevelNav level="moon" onLevel={stepLevel} />}
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

      {view === "compare" && (
        <div role="tabpanel" id="view-compare" aria-labelledby="tab-compare" className="relative min-h-0 flex-1 xl:overflow-y-auto">
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
            note={note}
          />
        </div>
      )}

      {view === "about" && (
        <div role="tabpanel" id="view-about" aria-labelledby="tab-about" className="relative min-h-0 flex-1 xl:overflow-y-auto">
          <AboutPanel entries={aboutEntries} loading={!rankingReady} />
        </div>
      )}
    </div>
  );
}

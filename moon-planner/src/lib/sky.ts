// Browser-side sky model: Sun and Earth tracks from JPL Horizons (packed by
// scripts/build-sky.ts) measured against each site's LOLA terrain horizon
// (scripts/process-dem.ts). Everything here is pure and client-safe.

import { horizonElevationAt, type HorizonProfile } from "./terrain";

export type SkyData = {
  siteId: string;
  startMs: number;
  stepMs: number;
  count: number;
  sunAz: number[];
  sunEl: number[];
  earthAz: number[];
  earthEl: number[];
};

export type SiteData = { sky: SkyData; horizon: HorizonProfile };

/** Apparent angular radius of the Sun's disc (deg), mean. */
export const SUN_RADIUS_DEG = 0.2665;
/** Apparent angular radius of Earth's disc from the Moon (deg), mean. */
export const EARTH_RADIUS_DEG = 0.95;

const HOUR = 3_600_000;

// ---------- Loading ----------

const cache = new Map<string, Promise<SiteData>>();

export function loadSite(siteId: string): Promise<SiteData> {
  let p = cache.get(siteId);
  if (!p) {
    p = Promise.all([
      fetch(`/data/sky/${siteId}.json`).then((r) => {
        if (!r.ok) throw new Error(`No sky data for ${siteId}`);
        return r.json() as Promise<SkyData>;
      }),
      fetch(`/data/horizon/${siteId}.json`).then((r) => {
        if (!r.ok) throw new Error(`No terrain horizon for ${siteId}`);
        return r.json() as Promise<HorizonProfile>;
      }),
    ]).then(([sky, horizon]) => ({ sky, horizon }));
    p.catch(() => cache.delete(siteId));
    cache.set(siteId, p);
  }
  return p;
}

// ---------- Sampling ----------

export function rangeOf(sky: SkyData): { startMs: number; endMs: number } {
  return { startMs: sky.startMs, endMs: sky.startMs + (sky.count - 1) * sky.stepMs };
}

/** Linear interpolation of an azimuth series, handling the 360° wrap. */
function lerpAz(a: number, b: number, f: number): number {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return (((a + d * f) % 360) + 360) % 360;
}

export type SkySample = {
  ms: number;
  sunAz: number;
  sunEl: number;
  earthAz: number;
  earthEl: number;
  /** Terrain horizon elevation under the Sun / Earth (deg). */
  sunHorizon: number;
  earthHorizon: number;
  /** Fraction of the Sun's disc above the terrain (0..1, linear approximation). */
  sunFraction: number;
  /** Any part of Earth's disc above the terrain (direct-to-Earth line of sight). */
  earthUp: boolean;
};

export function sampleAt({ sky, horizon }: SiteData, ms: number): SkySample {
  const pos = Math.min(Math.max((ms - sky.startMs) / sky.stepMs, 0), sky.count - 1);
  const i = Math.min(Math.floor(pos), sky.count - 2);
  const f = pos - i;
  const sunAz = lerpAz(sky.sunAz[i], sky.sunAz[i + 1], f);
  const sunEl = sky.sunEl[i] + (sky.sunEl[i + 1] - sky.sunEl[i]) * f;
  const earthAz = lerpAz(sky.earthAz[i], sky.earthAz[i + 1], f);
  const earthEl = sky.earthEl[i] + (sky.earthEl[i + 1] - sky.earthEl[i]) * f;
  const sunHorizon = horizonElevationAt(horizon, sunAz);
  const earthHorizon = horizonElevationAt(horizon, earthAz);
  return {
    ms,
    sunAz,
    sunEl,
    earthAz,
    earthEl,
    sunHorizon,
    earthHorizon,
    sunFraction: discFraction(sunEl - sunHorizon, SUN_RADIUS_DEG),
    earthUp: earthEl + EARTH_RADIUS_DEG > earthHorizon,
  };
}

function discFraction(centreAboveDeg: number, radiusDeg: number): number {
  return Math.min(1, Math.max(0, (centreAboveDeg + radiusDeg) / (2 * radiusDeg)));
}

/** Per-step visibility flags for the stored series (no interpolation). */
function flagsAt({ sky, horizon }: SiteData, i: number) {
  const sun = discFraction(sky.sunEl[i] - horizonElevationAt(horizon, sky.sunAz[i]), SUN_RADIUS_DEG);
  const earth = sky.earthEl[i] + EARTH_RADIUS_DEG > horizonElevationAt(horizon, sky.earthAz[i]);
  return { sun, earth };
}

// ---------- Windows and statistics ----------

export type Span = { startMs: number; endMs: number };

export type WindowStats = {
  startMs: number;
  endMs: number;
  hours: number;
  /** Share of the window with any of the Sun's disc above terrain (0..1). */
  sunlit: number;
  /** Mean visible fraction of the Sun's disc (0..1): a power proxy. */
  sunPower: number;
  /** Share of the window with Earth in line of sight (0..1). */
  earthVisible: number;
  /** Share with both sunlight and Earth (0..1). */
  both: number;
  longestDarkHours: number;
  longestNoCommsHours: number;
  /** Mean solar elevation above the terrain horizon while lit (deg). */
  meanSunClearance: number;
  /**
   * Highest elevation of the Sun's centre above the terrain horizon at any
   * step (deg); negative when the Sun never clears it. Splits equal scores.
   */
  maxSunClearance: number;
  darkSpans: Span[];
  noCommsSpans: Span[];
};

function stepRange(sky: SkyData, startMs: number, endMs: number): [number, number] {
  const i0 = Math.max(0, Math.ceil((startMs - sky.startMs) / sky.stepMs));
  const i1 = Math.min(sky.count - 1, Math.floor((endMs - sky.startMs) / sky.stepMs));
  return [i0, i1];
}

export function windowStats(site: SiteData, startMs: number, endMs: number): WindowStats {
  const { sky, horizon } = site;
  const [i0, i1] = stepRange(sky, startMs, endMs);
  let lit = 0;
  let power = 0;
  let earth = 0;
  let both = 0;
  let clearance = 0;
  let maxClearance = -Infinity;
  const darkSpans: Span[] = [];
  const noCommsSpans: Span[] = [];
  let darkStart = -1;
  let commsStart = -1;
  const n = Math.max(0, i1 - i0 + 1);

  for (let i = i0; i <= i1; i++) {
    const t = sky.startMs + i * sky.stepMs;
    // Same rule as flagsAt(), with the Sun's clearance kept for the statistics.
    const sunClear = sky.sunEl[i] - horizonElevationAt(horizon, sky.sunAz[i]);
    const f = {
      sun: discFraction(sunClear, SUN_RADIUS_DEG),
      earth: sky.earthEl[i] + EARTH_RADIUS_DEG > horizonElevationAt(horizon, sky.earthAz[i]),
    };
    if (sunClear > maxClearance) maxClearance = sunClear;
    if (f.sun > 0) {
      lit++;
      power += f.sun;
      clearance += sunClear;
      if (darkStart >= 0) darkSpans.push({ startMs: darkStart, endMs: t });
      darkStart = -1;
    } else if (darkStart < 0) darkStart = t;
    if (f.earth) {
      earth++;
      if (commsStart >= 0) noCommsSpans.push({ startMs: commsStart, endMs: t });
      commsStart = -1;
    } else if (commsStart < 0) commsStart = t;
    if (f.sun > 0 && f.earth) both++;
  }
  const tEnd = sky.startMs + i1 * sky.stepMs;
  if (darkStart >= 0) darkSpans.push({ startMs: darkStart, endMs: tEnd });
  if (commsStart >= 0) noCommsSpans.push({ startMs: commsStart, endMs: tEnd });
  const longest = (spans: Span[]) => spans.reduce((m, s) => Math.max(m, (s.endMs - s.startMs) / HOUR), 0);

  return {
    startMs,
    endMs,
    hours: (endMs - startMs) / HOUR,
    sunlit: n ? lit / n : 0,
    sunPower: n ? power / n : 0,
    earthVisible: n ? earth / n : 0,
    both: n ? both / n : 0,
    longestDarkHours: longest(darkSpans),
    longestNoCommsHours: longest(noCommsSpans),
    meanSunClearance: lit ? clearance / lit : 0,
    maxSunClearance: n ? maxClearance : 0,
    darkSpans,
    noCommsSpans,
  };
}

export type NextEvent = { kind: "rise" | "set"; atMs: number } | null;

/** Next sunrise/sunset (body "sun") or Earthrise/Earthset ("earth") after ms, within the data. */
export function nextEvent(site: SiteData, ms: number, body: "sun" | "earth"): NextEvent {
  const { sky } = site;
  const up = (i: number) => (body === "sun" ? flagsAt(site, i).sun > 0 : flagsAt(site, i).earth);
  let i = Math.max(0, Math.floor((ms - sky.startMs) / sky.stepMs));
  if (i >= sky.count - 1) return null;
  const start = up(i);
  for (i = i + 1; i < sky.count; i++) {
    if (up(i) !== start) return { kind: start ? "set" : "rise", atMs: sky.startMs + i * sky.stepMs };
  }
  return null;
}

// ---------- Ranking ----------

export type MissionScore = WindowStats & { siteId: string; score: number; reasons: string[] };

/**
 * Score a mission window. Weights: power 45%, Earth contact 30%, shortest
 * worst-case darkness 25% (darkness at or beyond the whole window scores 0).
 */
export function scoreWindow(siteId: string, s: WindowStats): MissionScore {
  const darkPenalty = s.hours > 0 ? Math.min(1, s.longestDarkHours / s.hours) : 1;
  const score = 0.45 * s.sunPower + 0.3 * s.earthVisible + 0.25 * (1 - darkPenalty);
  const reasons: string[] = [];
  reasons.push(`Sun up ${Math.round(s.sunlit * 100)}% of the window`);
  reasons.push(`Earth in view ${Math.round(s.earthVisible * 100)}%`);
  if (s.longestDarkHours > 0) reasons.push(`longest dark spell ${formatHours(s.longestDarkHours)}`);
  else reasons.push("no darkness");
  return { ...s, siteId, score, reasons };
}

const TIE = 1e-9;

/**
 * Ranking order, best first: score, then the Sun's highest clearance over
 * the terrain (a continuous key, so two always-dark or always-lit regions
 * still separate), then time with Earth in view. 0 only when all three match.
 */
export function compareScores(a: MissionScore, b: MissionScore): number {
  if (Math.abs(a.score - b.score) > TIE) return b.score - a.score;
  if (Math.abs(a.maxSunClearance - b.maxSunClearance) > TIE) return b.maxSunClearance - a.maxSunClearance;
  if (Math.abs(a.earthVisible - b.earthVisible) > TIE) return b.earthVisible - a.earthVisible;
  return 0;
}

export function rankSites(sites: Map<string, SiteData>, startMs: number, durationHours: number): MissionScore[] {
  const endMs = startMs + durationHours * HOUR;
  return [...sites.entries()].map(([id, d]) => scoreWindow(id, windowStats(d, startMs, endMs))).sort(compareScores);
}

/** Best start time for a mission of durationHours, searched every stepHours in [fromMs, toMs]. */
export function bestStart(site: SiteData, fromMs: number, toMs: number, durationHours: number, stepHours = 6): MissionScore | null {
  const { endMs } = rangeOf(site.sky);
  let best: MissionScore | null = null;
  for (let t = fromMs; t <= toMs && t + durationHours * HOUR <= endMs; t += stepHours * HOUR) {
    const s = scoreWindow(site.sky.siteId, windowStats(site, t, t + durationHours * HOUR));
    if (!best || s.score > best.score) best = s;
  }
  return best;
}

// ---------- Formatting ----------

export function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h)} h`;
  const d = Math.floor(h / 24);
  const r = Math.round(h - d * 24);
  return r ? `${d} d ${r} h` : `${d} d`;
}

export function formatUtc(ms: number): string {
  const d = new Date(ms);
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

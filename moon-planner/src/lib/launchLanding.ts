// Conditions at the landing site for a given touchdown time: whether the Sun
// and Earth are up at landing, when they next rise or set, and the same stay
// statistics the Navigator shows (missionScore). Pure; client-safe.

import { bodyAt, isUp, nextContact, type ContactEvent } from "./contacts";
import { HOUR, fmtDuration, pct } from "./format";
import { covers, missionScore, sampleAt, type MissionScore, type SiteData } from "./sky";

export type LandingQuality = "good" | "partial" | "poor";

export type LandingConditions = {
  landingMs: number;
  stayHours: number;
  stayEndMs: number;
  /** Any of the Sun's disc above the terrain at landing. */
  sunUp: boolean;
  /** Fraction of the Sun's disc above the terrain at landing (0..1). */
  sunFraction: number;
  /** Height of the Sun's upper edge above the terrain at landing (deg); negative when below. */
  sunClearanceDeg: number;
  earthUp: boolean;
  /** Height of Earth's upper edge above the terrain at landing (deg); negative when below. */
  earthClearanceDeg: number;
  /** Next sunrise or sunset after landing, within the data; null if none. */
  nextSun: ContactEvent | null;
  /** Next Earthrise or Earthset after landing, within the data; null if none. */
  nextEarth: ContactEvent | null;
  /** Stay statistics and score, identical to the Navigator's for the same window. */
  stay: MissionScore;
  quality: LandingQuality;
  reason: string;
};

export const QUALITY_ORDER: Record<LandingQuality, number> = { good: 0, partial: 1, poor: 2 };

export const QUALITY_LABEL: Record<LandingQuality, string> = {
  good: "Sun and Earth up",
  partial: "One of Sun and Earth up",
  poor: "Sun and Earth down",
};

const inHours = (from: number, ev: ContactEvent | null) => (ev ? fmtDuration((ev.ms - from) / HOUR) : null);

function reasonFor(c: Omit<LandingConditions, "quality" | "reason">): string {
  const sunPart = `Sun up ${pct(c.stay.sunlit)} of the stay`;
  const sunrise = c.nextSun && c.nextSun.kind === "sunrise" ? inHours(c.landingMs, c.nextSun) : null;
  const earthrise = c.nextEarth && c.nextEarth.kind === "earthrise" ? inHours(c.landingMs, c.nextEarth) : null;
  if (c.sunUp && c.earthUp) return `Lands in sunlight with Earth in view; ${sunPart}.`;
  if (!c.sunUp && c.earthUp)
    return sunrise
      ? `Lands in the dark: the Sun rises ${sunrise} later. ${sunPart}.`
      : `Lands in the dark, with no sunrise before the 2027 data ends.`;
  if (c.sunUp && !c.earthUp)
    return earthrise
      ? `Lands without Earth in view: Earth rises in ${earthrise}. ${sunPart}.`
      : `Lands without Earth in view, with no Earthrise before the 2027 data ends. ${sunPart}.`;
  const sr = sunrise ? `the Sun rises in ${sunrise}` : "no sunrise before the data ends";
  const er = earthrise ? `Earth in ${earthrise}` : "no Earthrise before the data ends";
  return `Lands in the dark and without Earth in view: ${sr}, ${er}. ${sunPart}.`;
}

/**
 * Conditions for a landing at `landingMs` followed by a stay of `stayHours`.
 * Null when the landing or the end of the stay falls outside the site's data.
 */
export function landingConditions(site: SiteData, landingMs: number, stayHours: number): LandingConditions | null {
  if (!Number.isFinite(landingMs) || !(stayHours >= 0)) return null;
  const stayEndMs = landingMs + stayHours * HOUR;
  if (!covers(site, landingMs, stayEndMs)) return null;
  const s = sampleAt(site, landingMs);
  const base = {
    landingMs,
    stayHours,
    stayEndMs,
    sunUp: isUp(site, "sun", landingMs),
    sunFraction: s.sunFraction,
    sunClearanceDeg: bodyAt(site, "sun", landingMs).clearance,
    earthUp: isUp(site, "earth", landingMs),
    earthClearanceDeg: bodyAt(site, "earth", landingMs).clearance,
    nextSun: nextContact(site, "sun", landingMs),
    nextEarth: nextContact(site, "earth", landingMs),
    stay: missionScore(site, landingMs, stayEndMs),
  };
  const quality: LandingQuality = base.sunUp && base.earthUp ? "good" : base.sunUp || base.earthUp ? "partial" : "poor";
  return { ...base, quality, reason: reasonFor(base) };
}

/** Score in whole points, as the app shows it; scores that show the same count as equal. */
export const scorePoints = (c: LandingConditions) => Math.round(c.stay.score * 100);

/** Best first: landing quality, then stay score in whole points. */
export function compareLandings(a: LandingConditions | null, b: LandingConditions | null): number {
  if (!a || !b) return Number(!a) - Number(!b);
  return QUALITY_ORDER[a.quality] - QUALITY_ORDER[b.quality] || scorePoints(b) - scorePoints(a);
}

export type OrbitLine = { minTiltDeg: number; kind: "polar" | "near-polar" | null; text: string; pass: string | null };

/** The site-specific lunar orbit line: the minimum orbit tilt to pass over a latitude. */
export function orbitLine(siteName: string, latDeg: number): OrbitLine {
  const a = Math.abs(latDeg);
  const latText = `${a.toFixed(1)}° ${latDeg < 0 ? "S" : "N"}`;
  const tilt = Math.round(a * 10) / 10;
  const kind = a >= 87 ? "polar" : a >= 80 ? "near-polar" : null;
  const text = `To pass over ${siteName} (latitude ${latText}) the lunar orbit must be tilted at least ${tilt.toFixed(1)}° to the Moon's equator${
    kind ? `: a ${kind} orbit` : ""
  }.`;
  const pass = a >= 80 ? `A polar orbit passes within ${(90 - a).toFixed(1)}° of this site on every lap, about every 2 hours.` : null;
  return { minTiltDeg: tilt, kind, text, pass };
}

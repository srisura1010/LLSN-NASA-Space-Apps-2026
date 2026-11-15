// Rise and set contacts of the Sun and Earth against a site's terrain horizon.
//
// A body counts as up while any part of its disc clears the terrain, the same
// rule src/lib/sky.ts uses for its visibility flags, so contact times line up
// with windowStats and nextEvent. Flags change between hourly ephemeris steps;
// each change is refined to the minute by sampling the interpolated track at
// 5-minute sub-steps against the interpolated horizon.

import { EARTH_RADIUS_DEG, SUN_RADIUS_DEG, nextEvent, sampleAt, type SiteData } from "@/lib/sky";
import { horizonElevationAt } from "@/lib/terrain";

export type Body = "sun" | "earth";
export type ContactKind = "sunrise" | "sunset" | "earthrise" | "earthset";
export type ContactEvent = { kind: ContactKind; ms: number; az: number; el: number };
export type VisibilitySpan = { startMs: number; endMs: number; up: boolean };

const SUB_STEPS = 12;

export const bodyOf = (kind: ContactKind): Body => (kind === "sunrise" || kind === "sunset" ? "sun" : "earth");
export const isRise = (kind: ContactKind) => kind === "sunrise" || kind === "earthrise";
const kindOf = (body: Body, rising: boolean): ContactKind =>
  body === "sun" ? (rising ? "sunrise" : "sunset") : rising ? "earthrise" : "earthset";

/** Upper-limb clearance over the terrain (deg) at stored step i; > 0 means up. */
function stepClearance({ sky, horizon }: SiteData, body: Body, i: number): number {
  return body === "sun"
    ? sky.sunEl[i] + SUN_RADIUS_DEG - horizonElevationAt(horizon, sky.sunAz[i])
    : sky.earthEl[i] + EARTH_RADIUS_DEG - horizonElevationAt(horizon, sky.earthAz[i]);
}

/** Interpolated position and upper-limb clearance (deg) of a body at ms. */
export function bodyAt(site: SiteData, body: Body, ms: number): { az: number; el: number; clearance: number } {
  const s = sampleAt(site, ms);
  return body === "sun"
    ? { az: s.sunAz, el: s.sunEl, clearance: s.sunEl + SUN_RADIUS_DEG - s.sunHorizon }
    : { az: s.earthAz, el: s.earthEl, clearance: s.earthEl + EARTH_RADIUS_DEG - s.earthHorizon };
}

/** The crossing inside the step bracket (i - 1, i]; the last one if the track grazes the terrain. */
function refine(site: SiteData, body: Body, i: number): { ms: number; az: number; el: number } {
  const { sky } = site;
  const t0 = sky.startMs + (i - 1) * sky.stepMs;
  const dt = sky.stepMs / SUB_STEPS;
  let pt = t0;
  let pc = stepClearance(site, body, i - 1);
  let a = t0;
  let ca = pc;
  let b = t0 + sky.stepMs;
  let cb = stepClearance(site, body, i);
  for (let k = 1; k <= SUB_STEPS; k++) {
    const t = k === SUB_STEPS ? t0 + sky.stepMs : t0 + k * dt;
    const c = k === SUB_STEPS ? stepClearance(site, body, i) : bodyAt(site, body, t).clearance;
    if ((c > 0) !== (pc > 0)) {
      a = pt;
      ca = pc;
      b = t;
      cb = c;
    }
    pt = t;
    pc = c;
  }
  const f = ca === cb ? 1 : ca / (ca - cb);
  const ms = a + Math.min(1, Math.max(0, f)) * (b - a);
  const p = bodyAt(site, body, ms);
  return { ms, az: p.az, el: p.el };
}

function stepIndex(site: SiteData, ms: number): number {
  return (ms - site.sky.startMs) / site.sky.stepMs;
}

function bodyContacts(site: SiteData, body: Body, startMs: number, endMs: number): ContactEvent[] {
  const out: ContactEvent[] = [];
  const first = Math.max(1, Math.ceil(stepIndex(site, startMs)));
  const last = Math.min(site.sky.count - 1, Math.ceil(stepIndex(site, endMs)));
  if (first > last) return out;
  let prevUp = stepClearance(site, body, first - 1) > 0;
  for (let i = first; i <= last; i++) {
    const up = stepClearance(site, body, i) > 0;
    if (up !== prevUp) {
      const c = refine(site, body, i);
      if (c.ms > startMs && c.ms <= endMs) out.push({ kind: kindOf(body, up), ...c });
    }
    prevUp = up;
  }
  return out;
}

/** Every sunrise, sunset, Earthrise and Earthset in (startMs, endMs], in time order. */
export function contactEvents(site: SiteData, startMs: number, endMs: number): ContactEvent[] {
  return [...bodyContacts(site, "sun", startMs, endMs), ...bodyContacts(site, "earth", startMs, endMs)].sort(
    (p, q) => p.ms - q.ms,
  );
}

/** Whether the body is up at ms, consistent with the refined contact times. */
export function isUpAt(site: SiteData, body: Body, ms: number): boolean {
  const { sky } = site;
  const pos = Math.min(Math.max(stepIndex(site, ms), 0), sky.count - 1);
  const j = Math.floor(pos);
  const upJ = stepClearance(site, body, j) > 0;
  if (pos === j || j >= sky.count - 1) return upJ;
  const upNext = stepClearance(site, body, j + 1) > 0;
  if (upJ === upNext) return upJ;
  return ms >= refine(site, body, j + 1).ms ? upNext : upJ;
}

/** Alternating up/down spans covering [startMs, endMs] for one body. */
export function visibilitySpans(site: SiteData, body: Body, startMs: number, endMs: number): VisibilitySpan[] {
  if (!(endMs > startMs)) return [];
  const spans: VisibilitySpan[] = [];
  let up = isUpAt(site, body, startMs);
  let from = startMs;
  for (const e of bodyContacts(site, body, startMs, endMs)) {
    if (e.ms > from) spans.push({ startMs: from, endMs: e.ms, up });
    up = isRise(e.kind);
    from = e.ms;
  }
  if (endMs > from) spans.push({ startMs: from, endMs, up });
  return spans;
}

/** The next rise or set of a body after ms, found with nextEvent and refined to the minute. */
export function nextContact(site: SiteData, body: Body, ms: number): ContactEvent | null {
  let ev = nextEvent(site, ms, body);
  for (let guard = 0; ev && guard < 4; guard++) {
    const i = Math.round(stepIndex(site, ev.atMs));
    const c = refine(site, body, i);
    if (c.ms > ms) return { kind: kindOf(body, ev.kind === "rise"), ...c };
    ev = nextEvent(site, ev.atMs, body);
  }
  return null;
}

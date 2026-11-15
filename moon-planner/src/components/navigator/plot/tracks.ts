// Screen geometry for a Sun or Earth track over a mission window: polyline
// runs split where the body crosses the terrain or the panorama seam, and
// time ticks aligned to UTC hours.

import type { SiteData } from "@/lib/sky";
import { bodyAt, bodyOf, type Body, type ContactEvent } from "@/lib/contacts";
import { DAY_MS, HOUR_MS } from "@/lib/format";
import { azDelta, azToU, pxPerDegX, pxPerDegY, xOfU, yOfEl, type Frame } from "./scale";

export type Pt = { x: number; y: number };
export type TrackRun = { up: boolean; points: Pt[] };
/** A point on the track with its unit normal (pointing up, or right on steep tracks). */
export type TrackMark = Pt & { ms: number; nx: number; ny: number; up: boolean };
export type TrackTick = TrackMark & { major: boolean };

export type Track = {
  body: Body;
  runs: TrackRun[];
  ticks: TrackTick[];
  /** Hours between minor ticks (1 when the scale allows it). */
  tickHours: number;
  start: TrackMark | null;
  end: (TrackMark & { tx: number; ty: number }) | null;
  /** Every drawn vertex, used to keep labels off the line. */
  vertices: Pt[];
};

const TICK_CHOICES = [1, 2, 3, 6, 12, 24];
const MIN_TICK_GAP_PX = 5;
const TANGENT_MS = 10 * 60_000;

/** Screen-space tangent and normal of the track at ms. */
function frameAt(site: SiteData, body: Body, ms: number, f: Frame) {
  const a = bodyAt(site, body, ms - TANGENT_MS);
  const b = bodyAt(site, body, ms + TANGENT_MS);
  let tx = azDelta(a.az, b.az) * pxPerDegX(f);
  let ty = -(b.el - a.el) * pxPerDegY(f);
  const len = Math.hypot(tx, ty);
  if (len < 1e-9) {
    tx = 1;
    ty = 0;
  } else {
    tx /= len;
    ty /= len;
  }
  let nx = -ty;
  let ny = tx;
  if (ny > 0.2 || (Math.abs(ny) <= 0.2 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { tx, ty, nx, ny };
}

function markAt(site: SiteData, body: Body, ms: number, f: Frame): TrackMark {
  const p = bodyAt(site, body, ms);
  const { nx, ny } = frameAt(site, body, ms, f);
  return { ms, x: xOfU(f, azToU(p.az)), y: yOfEl(f, p.el), nx, ny, up: p.clearance > 0 };
}

export function buildTrack(
  site: SiteData,
  body: Body,
  startMs: number,
  endMs: number,
  contacts: ContactEvent[],
  f: Frame,
): Track {
  const empty: Track = { body, runs: [], ticks: [], tickHours: 24, start: null, end: null, vertices: [] };
  if (!(endMs > startMs)) return empty;
  const { sky } = site;

  const times = [startMs, endMs];
  const firstStep = sky.startMs + Math.ceil((startMs - sky.startMs) / sky.stepMs) * sky.stepMs;
  for (let t = firstStep; t < endMs; t += sky.stepMs) if (t > startMs) times.push(t);
  for (const c of contacts) if (bodyOf(c.kind) === body && c.ms > startMs && c.ms < endMs) times.push(c.ms);
  times.sort((a, b) => a - b);

  const samples = times
    .filter((t, i) => i === 0 || t - times[i - 1] > 1000)
    .map((ms) => {
      const p = bodyAt(site, body, ms);
      return { ms, az: p.az, el: p.el, u: azToU(p.az) };
    });

  const kx = pxPerDegX(f);
  const ky = pxPerDegY(f);
  const pt = (u: number, el: number): Pt => ({ x: xOfU(f, u), y: yOfEl(f, el) });

  const runs: TrackRun[] = [];
  let run: TrackRun | null = null;
  let lengthPx = 0;
  for (let k = 0; k < samples.length - 1; k++) {
    const a = samples[k];
    const b = samples[k + 1];
    const up = bodyAt(site, body, (a.ms + b.ms) / 2).clearance > 0;
    if (!run || run.up !== up) {
      run = { up, points: [pt(a.u, a.el)] };
      runs.push(run);
    }
    const d = azDelta(a.az, b.az);
    lengthPx += Math.hypot(d * kx, (b.el - a.el) * ky);
    const uEnd = a.u + d;
    if (uEnd >= 180 || uEnd < -180) {
      // Crosses the seam: finish at one edge, carry on from the other.
      const edge = uEnd >= 180 ? 180 : -180;
      const frac = d === 0 ? 0 : (edge - a.u) / d;
      const el = a.el + frac * (b.el - a.el);
      run.points.push(pt(edge, el));
      run = { up, points: [pt(-edge, el)] };
      runs.push(run);
    }
    run.points.push(pt(b.u, b.el));
  }

  const hours = (endMs - startMs) / HOUR_MS;
  const pxPerHour = hours > 0 ? lengthPx / hours : 0;
  const tickHours = TICK_CHOICES.find((h) => h * pxPerHour >= MIN_TICK_GAP_PX) ?? 24;
  const tickMs = tickHours * HOUR_MS;

  const ticks: TrackTick[] = [];
  for (let t = Math.ceil(startMs / tickMs) * tickMs; t <= endMs; t += tickMs) {
    ticks.push({ ...markAt(site, body, t, f), major: t % DAY_MS === 0 });
  }

  const endMark = markAt(site, body, endMs, f);
  const { tx, ty } = frameAt(site, body, endMs - TANGENT_MS, f);

  return {
    body,
    runs,
    ticks,
    tickHours,
    start: markAt(site, body, startMs, f),
    end: { ...endMark, tx, ty },
    vertices: runs.flatMap((r) => r.points),
  };
}

/** SVG path data for a polyline. */
export function polylineD(points: Pt[]): string {
  let d = "";
  for (let i = 0; i < points.length; i++) {
    d += `${i ? "L" : "M"}${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
  }
  return d;
}

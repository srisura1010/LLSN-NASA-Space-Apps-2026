// Geometry for the horizon plate: the terrain horizon seen from a region's
// centre, cropped to the stretch of sky the Sun crosses during one stay, with
// the Sun's and Earth's hourly paths split where they pass behind terrain.
// Pure: takes pixel dimensions, returns path strings and placed labels.

import { EARTH_RADIUS_DEG, SUN_RADIUS_DEG, type SiteData } from "@/lib/sky";
import { horizonElevationAt } from "@/lib/terrain";
import { CONTACT_NAME, HOUR_MS, fmtDay, fmtTime, type Contact } from "./model";

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

export type PlateLabel = {
  x: number;
  y: number;
  /** Optional bold lead word set in the tone colour, followed by `text` in ink. */
  lead?: string;
  text: string;
  anchor: "start" | "middle" | "end";
  tone: "ink" | "ink-2" | "sun" | "earth" | "umbra";
  weight: "regular" | "bold";
  halo: "paper" | "terrain";
};

export type TrackGeometry = {
  /** Runs of the path, split where the body passes behind terrain. */
  runs: { visible: boolean; d: string }[];
  /** Tick marks as path data, grouped by size and visibility. */
  ticks: { size: "minor" | "six" | "day"; visible: boolean; d: string }[];
  tickHours: number;
  start: Pt & { visible: boolean };
  end: Pt & { visible: boolean; angle: number };
};

export type ContactMark = {
  contact: Contact;
  at: Pt;
  leader: string;
  labels: PlateLabel[];
};

export type Plate = {
  width: number;
  height: number;
  inner: { left: number; right: number; top: number; bottom: number };
  terrain: string;
  horizon: string;
  grid: { y: { y: number; label: string; zero: boolean }[]; x: { x: number; label: string; compass: boolean }[] };
  sun: TrackGeometry;
  earth: TrackGeometry | null;
  earthOffView: { side: "left" | "right"; azimuth: number } | null;
  contacts: ContactMark[];
  labels: PlateLabel[];
  exaggeration: number;
};

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const LABEL_PX = 11; // plate label size
const CHAR_W = 0.68 * LABEL_PX; // tracked caps and tabular figures, measured for Public Sans

const mod360 = (a: number) => ((a % 360) + 360) % 360;
const textW = (s: string) => s.length * CHAR_W + 2;
const r1 = (v: number) => Math.round(v * 10) / 10;

function unwrap(az: number[], ref: number): number[] {
  const out: number[] = [];
  let prev = ref;
  for (const a of az) {
    const u = prev + (mod360(a - prev + 180) - 180);
    out.push(u);
    prev = u;
  }
  return out;
}

function pathOf(pts: Pt[]): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${r1(p.x)} ${r1(p.y)}`).join("");
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function labelBox(l: { x: number; y: number; lead?: string; text: string; anchor: PlateLabel["anchor"] }): Box {
  const w = textW(l.lead ? `${l.lead} ${l.text}` : l.text);
  const x = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
  return { x: x - 2, y: l.y - LABEL_PX, w: w + 4, h: LABEL_PX + 4 };
}

type Body = {
  az: number[]; // unwrapped
  el: number[];
  margin: number[]; // degrees of disc above terrain (> 0 = visible)
};

function bodySeries(site: SiteData, i0: number, hours: number, which: "sun" | "earth", ref: number | null): Body {
  const { sky, horizon } = site;
  const azRaw = which === "sun" ? sky.sunAz : sky.earthAz;
  const elRaw = which === "sun" ? sky.sunEl : sky.earthEl;
  const radius = which === "sun" ? SUN_RADIUS_DEG : EARTH_RADIUS_DEG;
  const az: number[] = [];
  const el: number[] = [];
  const margin: number[] = [];
  for (let h = 0; h <= hours; h++) {
    const a = azRaw[i0 + h];
    const e = elRaw[i0 + h];
    az.push(a);
    el.push(e);
    margin.push(e + radius - horizonElevationAt(horizon, a));
  }
  return { az: unwrap(az, ref ?? az[0]), el, margin };
}

function crossingT(m0: number, m1: number) {
  return m0 === m1 ? 0 : m0 / (m0 - m1);
}

function track(points: Pt[], margin: number[], tickHours: number, half: Record<"minor" | "six" | "day", number>): TrackGeometry {
  const runs: { visible: boolean; pts: Pt[] }[] = [];
  let cur = { visible: margin[0] > 0, pts: [points[0]] };
  for (let h = 1; h < points.length; h++) {
    const visible = margin[h] > 0;
    if (visible !== cur.visible) {
      const c = lerp(points[h - 1], points[h], crossingT(margin[h - 1], margin[h]));
      cur.pts.push(c);
      runs.push(cur);
      cur = { visible, pts: [c] };
    }
    cur.pts.push(points[h]);
  }
  runs.push(cur);

  const groups = new Map<string, string[]>();
  for (let h = 0; h < points.length; h += tickHours) {
    const size = h % 24 === 0 ? "day" : h % 6 === 0 ? "six" : "minor";
    const a = points[Math.max(0, h - 1)];
    const b = points[Math.min(points.length - 1, h + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const p = points[h];
    const l = half[size];
    const key = `${size}|${margin[h] > 0 ? 1 : 0}`;
    const list = groups.get(key) ?? [];
    list.push(`M${r1(p.x - nx * l)} ${r1(p.y - ny * l)}L${r1(p.x + nx * l)} ${r1(p.y + ny * l)}`);
    groups.set(key, list);
  }
  const ticks = [...groups.entries()].map(([key, list]) => {
    const [size, vis] = key.split("|");
    return { size: size as "minor" | "six" | "day", visible: vis === "1", d: list.join("") };
  });

  const n = points.length - 1;
  const last = points[n];
  const prev = points[Math.max(0, n - 2)];
  return {
    runs: runs.map((r) => ({ visible: r.visible, d: pathOf(r.pts) })),
    ticks,
    tickHours,
    start: { ...points[0], visible: margin[0] > 0 },
    end: { ...last, visible: margin[n] > 0, angle: (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI },
  };
}

function meanStep(points: Pt[]) {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return s / Math.max(1, points.length - 1);
}

function pickStep(pxPerHour: number, options: number[], minPx: number) {
  return options.find((h) => pxPerHour * h >= minPx) ?? options[options.length - 1];
}

export function buildPlate(
  site: SiteData,
  startMs: number,
  hours: number,
  contacts: Contact[],
  width: number,
  height: number,
): Plate {
  const { sky, horizon } = site;
  const i0 = Math.round((startMs - sky.startMs) / sky.stepMs);

  const sun = bodySeries(site, i0, hours, "sun", null);
  const sMin = Math.min(...sun.az);
  const sMax = Math.max(...sun.az);
  const mid = (sMin + sMax) / 2;
  const earth = bodySeries(site, i0, hours, "earth", mid);
  const eMin = Math.min(...earth.az);
  const eMax = Math.max(...earth.az);

  // Crop: the Sun's sweep, widened to take in Earth when both fit a readable view.
  let lo = Math.min(sMin, eMin);
  let hi = Math.max(sMax, eMax);
  const earthIn = hi - lo <= 165;
  if (!earthIn) {
    lo = sMin;
    hi = sMax;
  }
  const pad = Math.max(5, (hi - lo) * 0.07);
  let az0 = Math.floor((lo - pad) / 5) * 5;
  let az1 = Math.ceil((hi + pad) / 5) * 5;
  if (az1 - az0 < 60) {
    const c = (az0 + az1) / 2;
    az0 = Math.floor((c - 30) / 5) * 5;
    az1 = az0 + 60;
  }

  const hz: { az: number; el: number }[] = [];
  for (let a = az0; a <= az1 + 1e-9; a += horizon.stepDeg) hz.push({ az: a, el: horizonElevationAt(horizon, mod360(a)) });

  let vmin = Infinity;
  let vmax = -Infinity;
  const take = (v: number) => {
    vmin = Math.min(vmin, v);
    vmax = Math.max(vmax, v);
  };
  hz.forEach((p) => take(p.el));
  sun.el.forEach(take);
  if (earthIn) earth.el.forEach(take);
  vmin -= 0.8;
  vmax += 1.2;
  if (vmax - vmin < 4) {
    const c = (vmin + vmax) / 2;
    vmin = c - 2;
    vmax = c + 2;
  }
  const span = vmax - vmin;
  const elStep = span <= 7 ? 1 : span <= 14 ? 2 : 5;
  const el0 = Math.floor(vmin / elStep) * elStep;
  const el1 = Math.ceil(vmax / elStep) * elStep;

  const inner = { left: 40, right: width - 12, top: 16, bottom: height - 26 };
  const iw = inner.right - inner.left;
  const ih = inner.bottom - inner.top;
  const x = (a: number) => inner.left + ((a - az0) / (az1 - az0)) * iw;
  const y = (e: number) => inner.top + ((el1 - e) / (el1 - el0)) * ih;

  const hzPts = hz.map((p) => ({ x: x(p.az), y: y(p.el) }));
  const horizonD = pathOf(hzPts);
  const terrainD = `${pathOf([{ x: inner.left, y: inner.bottom }, ...hzPts, { x: inner.right, y: inner.bottom }])}Z`;
  const horizonYAt = (px: number) => {
    const a = az0 + ((px - inner.left) / iw) * (az1 - az0);
    return y(horizonElevationAt(horizon, mod360(a)));
  };

  // Grid
  const gy: Plate["grid"]["y"] = [];
  for (let e = el0; e <= el1 + 1e-9; e += elStep) {
    gy.push({ y: y(e), label: `${e < 0 ? "−" : ""}${Math.abs(e)}°`, zero: e === 0 });
  }
  const pxPerDeg = iw / (az1 - az0);
  const azStep = [5, 10, 15, 30, 45, 90].find((s) => s * pxPerDeg >= 56) ?? 90;
  let gx: Plate["grid"]["x"] = [];
  for (let a = Math.ceil(az0 / azStep) * azStep; a <= az1; a += azStep) {
    const m = mod360(a);
    gx.push({ x: x(a), label: m % 45 === 0 ? COMPASS[m / 45] : `${m}°`, compass: m % 45 === 0 });
  }
  // Compass points between numeric ticks, when there is room.
  for (let a = Math.ceil(az0 / 45) * 45; a <= az1; a += 45) {
    const px = x(a);
    if (!gx.some((g) => Math.abs(g.x - px) < 34)) gx.push({ x: px, label: COMPASS[mod360(a) / 45], compass: true });
  }
  gx = gx
    .filter((g) => g.x - textW(g.label) / 2 >= inner.left - 6 && g.x + textW(g.label) / 2 <= inner.right + 2)
    .sort((p, q) => p.x - q.x);

  // Tracks
  const sunPts = sun.az.map((a, h) => ({ x: x(a), y: y(sun.el[h]) }));
  const sunTicks = pickStep(meanStep(sunPts), [1, 2, 3, 6], 3.6);
  const sunTrack = track(sunPts, sun.margin, sunTicks, { minor: 3, six: 5.5, day: 8.5 });

  let earthTrack: TrackGeometry | null = null;
  let earthPts: Pt[] = [];
  if (earthIn) {
    earthPts = earth.az.map((a, h) => ({ x: x(a), y: y(earth.el[h]) }));
    const earthTicks = pickStep(meanStep(earthPts), [3, 6, 12, 24], 4.5);
    earthTrack = track(earthPts, earth.margin, earthTicks, { minor: 2.5, six: 3.5, day: 5.5 });
  }
  const earthOffView = earthIn
    ? null
    : { side: (eMin + eMax) / 2 > mid ? ("right" as const) : ("left" as const), azimuth: Math.round(mod360((eMin + eMax) / 2)) };

  // Labels, placed in priority order without overlaps.
  const placed: Box[] = [];
  const labels: PlateLabel[] = [];
  const within = (b: Box) =>
    b.x >= inner.left + 2 && b.x + b.w <= inner.right - 2 && b.y >= inner.top && b.y + b.h <= inner.bottom - 2;
  const haloAt = (l: { x: number; y: number }): PlateLabel["halo"] =>
    l.y - LABEL_PX / 2 > horizonYAt(l.x) ? "terrain" : "paper";
  const tryPlace = (cands: Omit<PlateLabel, "halo">[]) => {
    for (const c of cands) {
      const b = labelBox(c);
      if (within(b) && !placed.some((p) => overlaps(p, b))) {
        placed.push(b);
        labels.push({ ...c, halo: haloAt(c) });
        return true;
      }
    }
    return false;
  };
  // Obstacles: both paths, their end markers.
  const dot = (p: Pt, r: number) => placed.push({ x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r });
  sunPts.forEach((p) => dot(p, 3.5));
  dot(sunTrack.start, 6);
  dot(sunTrack.end, 7);
  if (earthTrack) {
    earthPts.forEach((p) => dot(p, 2.5));
    dot(earthTrack.start, 5);
    dot(earthTrack.end, 7);
  }

  // Contacts sit along the foot of the plate with a leader up to the crossing.
  const marks: ContactMark[] = [];
  const bandTop = inner.bottom - 34;
  const pending = contacts
    .map((c) => {
      // The hourly step that closes the bracket the crossing falls in.
      const k = Math.ceil((c.atMs - startMs) / HOUR_MS - 1e-9);
      const series = c.body === "sun" ? { pts: sunPts, m: sun.margin } : { pts: earthPts, m: earth.margin };
      if (c.body === "earth" && !earthIn) return null;
      if (k < 1 || k >= series.pts.length) return null;
      const at = lerp(series.pts[k - 1], series.pts[k], crossingT(series.m[k - 1], series.m[k]));
      const name = CONTACT_NAME[c.body][c.kind].toUpperCase();
      const time = `${fmtDay(c.atMs).toUpperCase()} ${fmtTime(c.atMs)}`;
      const w = Math.max(textW(name), textW(time));
      return { c, at, name, time, w, cx: Math.min(Math.max(at.x, inner.left + w / 2 + 4), inner.right - w / 2 - 4) };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a, b) => a.cx - b.cx);
  // Push apart horizontally, left to right, then back from the right edge.
  for (let i = 1; i < pending.length; i++) {
    const a = pending[i - 1];
    const b = pending[i];
    const min = a.cx + a.w / 2 + 10 + b.w / 2;
    if (b.cx < min) b.cx = min;
  }
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i];
    const max =
      i === pending.length - 1 ? inner.right - p.w / 2 - 4 : pending[i + 1].cx - pending[i + 1].w / 2 - 10 - p.w / 2;
    if (p.cx > max) p.cx = max;
  }
  for (const p of pending) {
    const above = p.at.y > bandTop - 6;
    const nameY = above ? p.at.y - 24 : inner.bottom - 19;
    const timeY = nameY + 13;
    const tone = p.c.body === "sun" ? "sun" : "earth";
    const nameL: PlateLabel = { x: p.cx, y: nameY, text: p.name, anchor: "middle", tone, weight: "bold", halo: "paper" };
    const timeL: PlateLabel = { x: p.cx, y: timeY, text: p.time, anchor: "middle", tone: "ink", weight: "regular", halo: "paper" };
    for (const l of [nameL, timeL]) {
      l.halo = haloAt(l);
      placed.push(labelBox(l));
    }
    dot(p.at, 6);
    const leaderEnd = above ? { x: p.cx, y: timeY + 4 } : { x: p.cx, y: nameY - LABEL_PX - 2 };
    if (!above) {
      placed.push({
        x: Math.min(p.at.x, p.cx) - 3,
        y: p.at.y + 5,
        w: Math.abs(p.cx - p.at.x) + 6,
        h: Math.max(0, leaderEnd.y - p.at.y - 5),
      });
    }
    marks.push({
      contact: p.c,
      at: p.at,
      leader: above ? "" : pathOf([{ x: p.at.x, y: p.at.y + 5 }, leaderEnd]),
      labels: [nameL, timeL],
    });
  }

  // Candidate spots around a point, nearest first.
  const around = (
    p: Pt,
    text: string,
    tone: PlateLabel["tone"],
    weight: PlateLabel["weight"],
    gap: number,
  ): Omit<PlateLabel, "halo">[] =>
    (
      [
        [0, -gap - 3, "middle"],
        [0, gap + 12, "middle"],
        [gap, -gap + 1, "start"],
        [-gap, -gap + 1, "end"],
        [gap, gap + 9, "start"],
        [-gap, gap + 9, "end"],
        [gap + 2, 4, "start"],
        [-gap - 2, 4, "end"],
        [0, -gap - 15, "middle"],
        [0, gap + 24, "middle"],
      ] as const
    ).map(([dx, dy, anchor]) => ({ x: p.x + dx, y: p.y + dy, text, anchor, tone, weight }));

  // Body names at their start points, the Sun's with the start date; skipped when
  // nothing fits (the legend names them too).
  const startDay = fmtDay(startMs).toUpperCase();
  if (!tryPlace(around(sunTrack.start, startDay, "sun", "regular", 9).map((c) => ({ ...c, lead: "SUN" })))) {
    tryPlace(around(sunTrack.start, startDay, sun.margin[0] > 0 ? "ink" : "umbra", "regular", 9));
  }
  if (earthTrack) tryPlace(around(earthTrack.start, "EARTH", "earth", "bold", 8));

  // Dates at 00:00 UTC along the Sun's path, set off along the path's normal so
  // they clear it at any slope; every other day when crowded.
  const pxPerDay = meanStep(sunPts) * 24;
  const dayEvery = pxPerDay >= textW("16 JUL") + 10 ? 1 : 2;
  const offNormal = (h: number, text: string, side: 1 | -1) => {
    const a = sunPts[Math.max(0, h - 1)];
    const b = sunPts[Math.min(sunPts.length - 1, h + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / len;
    let ny = (b.x - a.x) / len;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const d = (textW(text) / 2) * Math.abs(nx) + 7.5 * Math.abs(ny) + 6;
    const p = sunPts[h];
    return { x: p.x + nx * d * side, y: p.y + ny * d * side + 3.5 };
  };
  for (let h = 24 * dayEvery, n = 0; h <= hours; h += 24 * dayEvery, n++) {
    const text = fmtDay(startMs + h * HOUR_MS).toUpperCase();
    const tone = sun.margin[h] > 0 ? "ink" : "umbra";
    const up = offNormal(h, text, 1);
    const down = offNormal(h, text, -1);
    tryPlace([
      { ...up, text, anchor: "middle", tone, weight: "regular" },
      { ...down, text, anchor: "middle", tone, weight: "regular" },
      ...around(sunPts[h], text, tone, "regular", 9),
    ]);
  }

  return {
    width,
    height,
    inner,
    terrain: terrainD,
    horizon: horizonD,
    grid: { y: gy, x: gx },
    sun: sunTrack,
    earth: earthTrack,
    earthOffView,
    contacts: marks,
    labels,
    exaggeration: ih / (el1 - el0) / pxPerDeg,
  };
}

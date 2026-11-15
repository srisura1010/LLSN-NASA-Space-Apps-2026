"use client";

// Bulletin horizon plot: the site's LOLA terrain horizon as a panorama, with
// the Sun's and Earth's tracks over the mission window ticked by time, their
// rise and set contacts against the terrain, and both bodies at nowMs. With
// onScrub it is the bottom band of the Navigator: a time rail under the
// panorama, the circumstances at the chosen time, and the tracks themselves
// can be dragged (mouse and pen) to move the time.

import { Fragment, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { EARTH_RADIUS_DEG, SUN_RADIUS_DEG, missionScore, rangeOf, sampleAt, type SiteData } from "@/lib/sky";
import { horizonElevationAt } from "@/lib/terrain";
import { bodyAt, bodyOf, contactEvents, isUp, nextContact, type Body, type ContactKind } from "@/lib/contacts";
import {
  HOUR_MS,
  fmtAz,
  fmtDay,
  fmtDayHour,
  fmtDayTime,
  fmtDuration,
  fmtElapsed,
  fmtFull,
  fmtSigned,
  fmtSpan,
  fmtTime,
  pct,
} from "@/lib/format";
import { PlayMark, StateSwatch } from "../ui";
import { useElementWidth, useTypeMetrics } from "./plot/hooks";
import {
  measureText,
  placeLabels,
  type Box,
  type LabelLine,
  type LabelSpec,
  type PlacedLabel,
  type Region,
  type Tone,
} from "./plot/labels";
import {
  azOfX,
  azimuthTicks,
  elevationTicks,
  plotElevationRange,
  pxPerDegX,
  pxPerDegY,
  uToAz,
  xOfAz,
  xOfU,
  yOfEl,
  type Frame,
} from "./plot/scale";
import { buildTrack, polylineD, type Pt, type Track, type TrackMark } from "./plot/tracks";
import TimelineStrip from "./TimelineStrip";

type Props = {
  site: SiteData;
  siteName: string;
  nowMs: number;
  startMs: number;
  endMs: number;
  className?: string;
  /** Shared elevation domain [min, max] in degrees (see plotElevationRange) to compare plots on one scale. */
  elevationRange?: [number, number];
  /** Height of the plotting area in px. */
  plotHeight?: number;
  /** Figure number for the caption, e.g. "Fig. 2". */
  figure?: string;
  /** Moves the chosen time; adds the scrub rail and lets the tracks be dragged. */
  onScrub?: (ms: number) => void;
  playing?: boolean;
  onTogglePlay?: () => void;
};

const MIN_SVG_W = 640;
/** In the Navigator's band a column this wide still fits all 360° without scrolling. */
const MIN_SVG_W_RAIL = 480;
/** The rail's label gutter (3.25rem) and gap (0.5rem): the plot frame starts there too, so time and azimuth axes share a left edge. */
const RAIL_GUTTER_REM = 3.75;
/** How close (px) a press has to land to a track to grab it. */
const GRAB_PX = 18;
const TICK_MINOR = 3;
const TICK_MAJOR = 5.5;
const MARGIN_RIGHT = 12;
const MARGIN_TOP = 8;

const CONTACT_WORD: Record<ContactKind, string> = {
  sunrise: "Sunrise",
  sunset: "Sunset",
  earthrise: "Earthrise",
  earthset: "Earthset",
};

const crisp = (v: number) => Math.round(v) + 0.5;
const f1 = (v: number) => v.toFixed(1);

function marginBottom(remPx: number) {
  return Math.ceil(0.75 * remPx * 1.2 + 12);
}

/** Text fill by tone and by the ground the label sits on. */
function toneClass(tone: Tone, region: Region): string {
  if (region === "terrain") return tone === "earth" ? "fill-earth-soft" : "fill-paper";
  if (tone === "sun") return "fill-sun-ink";
  if (tone === "earth") return "fill-earth";
  return "fill-ink";
}

type LayoutInput = {
  site: SiteData;
  t0: number;
  t1: number;
  svgW: number;
  plotH: number;
  elMin: number;
  elMax: number;
  remPx: number;
  fontEpoch: number;
  /** Smallest left margin, so the frame lines up with the rail below. */
  minLeft: number;
};

function computeLayout({ site, t0, t1, svgW, plotH, elMin, elMax, remPx, fontEpoch, minLeft }: LayoutInput) {
  const fs = 0.75 * remPx;
  const fsAxis = 0.75 * remPx;
  const lh = Math.round(fs * 1.3);
  const measure = (text: string, px = fs, weight = 400, tracking = 0) =>
    measureText(text, px, weight, tracking, fontEpoch);

  const elTicks = elevationTicks(elMin, elMax);
  const elLabel = (v: number) => (v === 0 ? "0°" : fmtSigned(v, 0));
  const left = Math.max(minLeft, Math.ceil(Math.max(...elTicks.major.map((v) => measure(elLabel(v), fsAxis))) + 14));
  const frame: Frame = { left, top: MARGIN_TOP, width: svgW - left - MARGIN_RIGHT, height: plotH, elMin, elMax };
  const plotBottom = MARGIN_TOP + plotH;
  const plotRight = left + frame.width;
  const svgH = plotBottom + marginBottom(remPx);

  // Terrain silhouette, its edge, and the open sky above it (a clip for the discs).
  const { horizon } = site;
  const edge: Pt[] = [];
  for (let u = -180; u <= 180 + 1e-9; u += horizon.stepDeg) {
    const y = yOfEl(frame, horizonElevationAt(horizon, uToAz(u)));
    edge.push({ x: xOfU(frame, u), y: Math.min(plotBottom + 1, Math.max(MARGIN_TOP - 1, y)) });
  }
  const edgeD = polylineD(edge);
  const silhouetteD = `${edgeD}L${f1(plotRight)} ${plotBottom + 1}L${f1(left)} ${plotBottom + 1}Z`;
  const skyD = `${edgeD}L${f1(plotRight)} ${MARGIN_TOP - 80}L${f1(left)} ${MARGIN_TOP - 80}Z`;

  const hasWindow = t1 > t0;
  const contacts = hasWindow ? contactEvents(site, t0, t1) : [];
  const sun = buildTrack(site, "sun", t0, t1, contacts, frame);
  const earth = buildTrack(site, "earth", t0, t1, contacts, frame);
  const contactPts = contacts.map((c) => ({ ...c, x: xOfAz(frame, c.az), y: yOfEl(frame, c.el) }));

  // ---- Labels ----
  const horizonY = (x: number) => yOfEl(frame, horizonElevationAt(horizon, azOfX(frame, x)));
  const regionOf = (b: Box): Region => {
    let top = Infinity;
    let bottom = -Infinity;
    for (let x = b.x0; ; x += 3) {
      const y = horizonY(Math.min(x, b.x1));
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      if (x >= b.x1) break;
    }
    if (b.y1 <= top - 1) return "sky";
    if (b.y0 >= bottom + 1) return "terrain";
    return "mixed";
  };
  const line = (text: string, tone: Tone, strong = false): LabelLine =>
    strong
      ? { text: text.toUpperCase(), tone, strong, width: measure(text.toUpperCase(), fs, 600, 0.06) }
      : { text, tone, width: measure(text) };
  const around = (x: number, y: number, r: number) => {
    const d = r * 0.7;
    return [
      { x, y: y - r, dx: 0, dy: -1 },
      { x: x + d, y: y - d, dx: 0.7, dy: -0.7 },
      { x: x - d, y: y - d, dx: -0.7, dy: -0.7 },
      { x: x + r, y, dx: 1, dy: 0 },
      { x: x - r, y, dx: -1, dy: 0 },
      { x, y: y + r, dx: 0, dy: 1 },
      { x: x + d, y: y + d, dx: 0.7, dy: 0.7 },
      { x: x - d, y: y + d, dx: -0.7, dy: 0.7 },
    ];
  };
  const along = (m: TrackMark, gap: number) => [
    { x: m.x + m.nx * gap, y: m.y + m.ny * gap, dx: m.nx, dy: m.ny },
    { x: m.x - m.nx * gap, y: m.y - m.ny * gap, dx: -m.nx, dy: -m.ny },
  ];

  // Contacts and window ends may sit on any side; day labels keep to one side
  // of their track, whichever side fits more of them.
  const base: LabelSpec[] = [];
  // Contacts of one body that fall close together (a brief glint or dip on a
  // ridge) share one label: "SUNRISE, SUNSET / 7 Jun 12:49, 15:22".
  const groups: (typeof contactPts)[] = [];
  for (const c of contactPts) {
    const g = groups.find((grp) => {
      const last = grp[grp.length - 1];
      return bodyOf(last.kind) === bodyOf(c.kind) && c.ms - last.ms <= 12 * HOUR_MS && Math.hypot(c.x - last.x, c.y - last.y) < 28;
    });
    if (g) g.push(c);
    else groups.push([c]);
  }
  groups.forEach((g, i) => {
    const first = g[0];
    const sameDay = (a: number, b: number) => fmtDay(a) === fmtDay(b);
    const words =
      g.length <= 2 ? g.map((c) => CONTACT_WORD[c.kind]).join(", ") : `${g.length} ${bodyOf(first.kind) === "sun" ? "Sun" : "Earth"} contacts`;
    const times =
      g.length === 1
        ? fmtDayTime(first.ms)
        : g.length === 2
          ? `${fmtDayTime(first.ms)}, ${sameDay(first.ms, g[1].ms) ? fmtTime(g[1].ms) : fmtDayTime(g[1].ms)}`
          : `${fmtDayTime(first.ms)} to ${fmtDayTime(g[g.length - 1].ms)}`;
    const cx = g.reduce((a, c) => a + c.x, 0) / g.length;
    const cy = g.reduce((a, c) => a + c.y, 0) / g.length;
    base.push({
      id: `contact-${i}`,
      lines: [line(words, bodyOf(first.kind), true), line(times, "ink")],
      lineHeight: lh,
      priority: 100,
      anchors: [7, 16, 28, 42, 60, 80].flatMap((r) => around(cx, cy, r)),
      target: { x: cx, y: cy },
      required: true,
    });
  });
  for (const tr of [sun, earth]) {
    const tone: Tone = tr.body;
    if (tr.start) {
      base.push({
        id: `${tr.body}-start`,
        lines: [line(fmtDayHour(tr.start.ms), tone)],
        lineHeight: lh,
        priority: 80,
        anchors: [...along(tr.start, TICK_MAJOR + 4), ...around(tr.start.x, tr.start.y, TICK_MAJOR + 4)],
      });
    }
    if (tr.end) {
      const e = tr.end;
      base.push({
        id: `${tr.body}-end`,
        lines: [line(fmtDayHour(e.ms), tone)],
        lineHeight: lh,
        priority: 70,
        anchors: [{ x: e.x + e.tx * 10, y: e.y + e.ty * 10, dx: e.tx, dy: e.ty }, ...along(e, TICK_MAJOR + 4)],
      });
    }
  }
  const dayLabels = (tr: Track, side: 0 | 1): LabelSpec[] =>
    tr.ticks
      .filter((t) => t.major && Math.abs(t.ms - t0) >= HOUR_MS && Math.abs(t.ms - t1) >= HOUR_MS)
      .map((t) => ({
        id: `${tr.body}-${t.ms}`,
        lines: [line(fmtDay(t.ms), tr.body)],
        lineHeight: lh,
        priority: 50,
        anchors: [along(t, TICK_MAJOR + 3)[side]],
      }));

  const obstacles: Box[] = [];
  for (const v of [...sun.vertices, ...earth.vertices]) {
    obstacles.push({ x0: v.x - 2.5, y0: v.y - 2.5, x1: v.x + 2.5, y1: v.y + 2.5 });
  }
  for (const c of contactPts) obstacles.push({ x0: c.x - 4.5, y0: c.y - 4.5, x1: c.x + 4.5, y1: c.y + 4.5 });

  const placeOpts = {
    bounds: { x0: left + 2, y0: MARGIN_TOP + 1, x1: plotRight - 2, y1: plotBottom - 2 },
    obstacles,
    regionOf,
    pad: 4,
  };
  let labels: PlacedLabel[] = [];
  for (const sunSide of [0, 1] as const) {
    for (const earthSide of [0, 1] as const) {
      const placed = placeLabels([...base, ...dayLabels(sun, sunSide), ...dayLabels(earth, earthSide)], placeOpts);
      if (placed.length > labels.length) labels = placed;
    }
  }

  let leadersD = "";
  for (const lab of labels) {
    if (!lab.target) continue;
    const dx = lab.anchor.x - lab.target.x;
    const dy = lab.anchor.y - lab.target.y;
    const d = Math.hypot(dx, dy);
    if (d < 10) continue;
    const ux = dx / d;
    const uy = dy / d;
    leadersD += `M${f1(lab.target.x + ux * 5)} ${f1(lab.target.y + uy * 5)}L${f1(lab.anchor.x - ux * 1.5)} ${f1(lab.anchor.y - uy * 1.5)}`;
  }

  const tickD = (tr: Track, up: boolean, major: boolean) => {
    const len = major ? TICK_MAJOR : TICK_MINOR;
    let d = "";
    for (const t of tr.ticks) {
      if (t.up !== up || t.major !== major) continue;
      d += `M${f1(t.x - t.nx * len)} ${f1(t.y - t.ny * len)}L${f1(t.x + t.nx * len)} ${f1(t.y + t.ny * len)}`;
    }
    return d;
  };
  // Behind the terrain only the day ticks are drawn, so the dashes stay legible.
  const tickPaths = (tr: Track) => ({
    upMinor: tickD(tr, true, false),
    upMajor: tickD(tr, true, true),
    downMajor: tickD(tr, false, true),
  });

  // Hourly points on each track, for grabbing a track and dragging it through time.
  const grab: Record<Body, { x: number; y: number; ms: number }[]> = { sun: [], earth: [] };
  if (hasWindow) {
    for (const body of ["sun", "earth"] as const) {
      for (let t = Math.ceil(t0 / HOUR_MS) * HOUR_MS; t <= t1; t += HOUR_MS) {
        const p = bodyAt(site, body, t);
        grab[body].push({ x: xOfAz(frame, p.az), y: yOfEl(frame, p.el), ms: t });
      }
    }
  }

  return {
    fs,
    fsAxis,
    lh,
    frame,
    grab,
    svgW,
    svgH,
    plotBottom,
    plotRight,
    edgeD,
    silhouetteD,
    skyD,
    sun,
    earth,
    sunTicks: tickPaths(sun),
    earthTicks: tickPaths(earth),
    contacts: contactPts,
    labels,
    leadersD,
    elTicks,
    elLabel,
    azTicks: azimuthTicks(),
    exaggeration: pxPerDegY(frame) / pxPerDegX(frame),
    horizonYAt: horizonY,
    stats: hasWindow ? missionScore(site, t0, t1) : null,
  };
}

type Layout = ReturnType<typeof computeLayout>;

export default function HorizonPlot({
  site,
  siteName,
  nowMs,
  startMs,
  endMs,
  className,
  elevationRange,
  plotHeight,
  figure,
  onScrub,
  playing = false,
  onTogglePlay,
}: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerW = useElementWidth(scrollRef);
  const { remPx, fontEpoch } = useTypeMetrics();
  const rail = !!onScrub;

  const data = rangeOf(site.sky);
  const t0 = Math.max(startMs, data.startMs);
  const t1 = Math.min(endMs, data.endMs);
  const svgW =
    containerW === null ? null : Math.max(containerW, rail && containerW >= MIN_SVG_W_RAIL ? MIN_SVG_W_RAIL : MIN_SVG_W);
  const plotH = plotHeight ?? (svgW !== null && svgW < 900 ? 196 : 216);
  const overflow = svgW !== null && containerW !== null && svgW > containerW + 1;
  const minLeft = rail && !overflow ? Math.round(RAIL_GUTTER_REM * remPx) : 0;

  const rangeLo = elevationRange?.[0];
  const rangeHi = elevationRange?.[1];
  const [elMin, elMax] = useMemo<[number, number]>(
    () => (rangeLo !== undefined && rangeHi !== undefined ? [rangeLo, rangeHi] : plotElevationRange(site, t0, t1)),
    [rangeLo, rangeHi, site, t0, t1],
  );

  const layout = useMemo(
    () =>
      svgW === null ? null : computeLayout({ site, t0, t1, svgW, plotH, elMin, elMax, remPx, fontEpoch, minLeft }),
    [site, t0, t1, svgW, plotH, elMin, elMax, remPx, fontEpoch, minLeft],
  );

  // On narrow screens the panorama scrolls; start centred on north, where Earth is.
  const siteId = site.sky.siteId;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && overflow) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [overflow, siteId]);

  const now = sampleAt(site, nowMs);
  const windowText = t1 > t0 ? fmtSpan(t0, t1) : "No Sun and Earth tracks for this window";
  const readoutId = `${uid}-now`;
  // In the Navigator's band the window is in the masthead, so the caption carries the plot's notes.
  const note = rail && layout && t1 > t0 ? plotNote(layout) : windowText;

  return (
    <figure className={`m-0 min-w-0 ${className ?? ""}`}>
      <figcaption className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 ${rail ? "pb-1" : "pb-1.5"}`}>
        <span className="text-[0.95rem] font-semibold text-ink">
          {figure ? <span className="mr-2 text-[0.75rem] font-bold uppercase tracking-[0.1em]">{figure}</span> : null}
          Horizon from {siteName}
        </span>
        <span className={`text-ink-2 tabular-nums ${rail ? "text-[0.75rem]" : "text-[0.844rem]"}`}>{note}</span>
        {overflow ? <span className="basis-full text-[0.75rem] text-ink-2">Scroll sideways for all 360°</span> : null}
      </figcaption>

      <div className="relative">
        <div
          ref={scrollRef}
          className="overflow-x-auto overscroll-x-contain"
          tabIndex={overflow ? 0 : undefined}
          role={overflow ? "region" : undefined}
          aria-label={overflow ? `Horizon plot for ${siteName}, scrolls sideways` : undefined}
        >
          {layout ? (
            <PlotSvg
              layout={layout}
              uid={uid}
              site={site}
              siteName={siteName}
              nowMs={nowMs}
              windowText={windowText}
              onScrub={onScrub}
            />
          ) : (
            <div style={{ height: MARGIN_TOP + plotH + marginBottom(remPx) }} aria-hidden="true" />
          )}
        </div>
        {layout && overflow ? <StickyAxis layout={layout} /> : null}
      </div>

      {rail && onScrub ? (
        <>
          <div style={{ paddingRight: overflow ? 0 : MARGIN_RIGHT }}>
            <TimelineStrip
              site={site}
              siteName={siteName}
              startMs={startMs}
              endMs={endMs}
              nowMs={nowMs}
              onScrub={onScrub}
              compact
              readout={false}
              describedBy={readoutId}
              className="w-full"
            />
          </div>
          <NowReadout
            id={readoutId}
            site={site}
            now={now}
            startMs={startMs}
            playing={playing}
            onTogglePlay={onTogglePlay}
          />
          {layout ? <Legend layout={layout} compact /> : null}
        </>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-3 pt-2">
          {layout ? <Legend layout={layout} /> : null}
          <Circumstances site={site} now={now} />
        </div>
      )}
    </figure>
  );
}

/** Joins a short phrase with no-break spaces so it never splits across lines. */
const keep = (s: string) => s.replace(/ /g, "\u00a0");

/**
 * Local circumstances at the chosen time, in the bulletin's table manner:
 * where each body stands, the terrain under it, whether it is in view and
 * the next contact.
 */
function NowReadout({
  id,
  site,
  now,
  startMs,
  playing,
  onTogglePlay,
}: {
  id: string;
  site: SiteData;
  now: ReturnType<typeof sampleAt>;
  startMs: number;
  playing: boolean;
  onTogglePlay?: () => void;
}) {
  const dataEnd = rangeOf(site.sky).endMs;
  const rows = (["sun", "earth"] as const).map((body) => {
    const up = isUp(site, body, now.ms);
    const next = nextContact(site, body, now.ms);
    const sun = body === "sun";
    const word = sun ? (up ? "sunset" : "sunrise") : up ? "Earthset" : "Earthrise";
    const status = sun
      ? up
        ? now.sunFraction >= 1
          ? "Up"
          : `${Math.max(1, Math.round(now.sunFraction * 100))}% of disc up`
        : "Behind terrain"
      : up
        ? "In view"
        : "Behind terrain";
    return {
      body,
      name: sun ? "Sun" : "Earth",
      az: sun ? now.sunAz : now.earthAz,
      el: sun ? now.sunEl : now.earthEl,
      terrain: sun ? now.sunHorizon : now.earthHorizon,
      up,
      status,
      // The time and the "in …" span each hold together, so a narrow column breaks between them, never inside one.
      next: next
        ? `${word.charAt(0).toUpperCase()}${word.slice(1)} ${keep(fmtDayTime(next.ms))}, ${keep(`in ${fmtDuration((next.ms - now.ms) / HOUR_MS)}`)}`
        : `No ${word} before ${fmtDay(dataEnd)} ${new Date(dataEnd).getUTCFullYear()}`,
    };
  });
  return (
    <div id={id} className="mt-1.5 flex flex-wrap items-start gap-x-8 gap-y-1 text-[0.844rem] text-ink">
      <p className="flex items-center gap-2 tabular-nums">
        {onTogglePlay ? (
          <button
            type="button"
            onClick={onTogglePlay}
            aria-pressed={playing}
            className="inline-flex size-7 items-center justify-center border border-ink bg-paper text-ink transition-colors duration-150 hover:bg-paper-3 active:bg-umbra-soft"
          >
            <PlayMark playing={playing} />
            <span className="sr-only">{playing ? "Pause" : "Play the window"}</span>
          </button>
        ) : null}
        <span className="font-semibold">{fmtFull(now.ms)}</span>
        <span className="text-ink-2">{fmtElapsed(now.ms - startMs)}</span>
      </p>
      {/* Columns line up from sm; on a phone the status takes its own line under each body. */}
      <dl className="m-0 grid grid-cols-[repeat(4,auto)] items-baseline gap-x-3.5 gap-y-0.5 tabular-nums sm:grid-cols-[repeat(4,auto)_minmax(0,1fr)]">
        {rows.map((r) => (
          <Fragment key={r.body}>
            <dt className="inline-flex items-center gap-1.5 self-center font-semibold whitespace-nowrap">
              <StateSwatch body={r.body} up={r.up} />
              {r.name}
            </dt>
            <dd className="contents">
              <span className="text-right whitespace-nowrap">
                <span className="text-ink-2">az </span>
                {fmtAz(r.az)}
              </span>
              <span className="text-right whitespace-nowrap">
                <span className="text-ink-2">el </span>
                {fmtSigned(r.el, 1)}
              </span>
              <span className="text-right whitespace-nowrap">
                <span className="text-ink-2">terrain </span>
                {fmtSigned(r.terrain, 1)}
              </span>
              <span className="col-span-4 pb-0.5 sm:col-span-1 sm:pb-0">
                <span className={r.up ? "font-medium" : "font-semibold text-limit"}>{r.status}</span>
                <span className="text-ink-2"> · {r.next}</span>
              </span>
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

function PlotSvg({
  layout: L,
  uid,
  site,
  siteName,
  nowMs,
  windowText,
  onScrub,
}: {
  layout: Layout;
  uid: string;
  site: SiteData;
  siteName: string;
  nowMs: number;
  windowText: string;
  onScrub?: (ms: number) => void;
}) {
  const f = L.frame;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Body | null>(null);

  // Grab a track (mouse or pen; touch keeps scrolling the panorama) and drag it through time.
  const nearest = (clientX: number, clientY: number, only: Body | null) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return null;
    const x = clientX - r.left;
    const y = clientY - r.top;
    let best: { body: Body; ms: number; d: number } | null = null;
    for (const body of only ? [only] : (["sun", "earth"] as const)) {
      for (const p of L.grab[body]) {
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (!best || d < best.d) best = { body, ms: p.ms, d };
      }
    }
    return best;
  };
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!onScrub || e.pointerType === "touch" || e.button !== 0) return;
    const hit = nearest(e.clientX, e.clientY, null);
    if (!hit || hit.d > GRAB_PX * GRAB_PX) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor = "grabbing";
    setDrag(hit.body);
    onScrub(hit.ms);
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!onScrub || e.pointerType === "touch") return;
    if (drag) {
      const hit = nearest(e.clientX, e.clientY, drag);
      if (hit && hit.ms !== nowMs) onScrub(hit.ms);
      return;
    }
    const hit = nearest(e.clientX, e.clientY, null);
    e.currentTarget.style.cursor = hit && hit.d <= GRAB_PX * GRAB_PX ? "grab" : "";
  };
  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (drag) e.currentTarget.style.cursor = "grab";
    setDrag(null);
  };
  const plotClip = `${uid}-plot`;
  const skyClip = `${uid}-sky`;
  const ky = pxPerDegY(f);
  const now = sampleAt(site, nowMs);
  const sunX = xOfAz(f, now.sunAz);
  const sunY = yOfEl(f, now.sunEl);
  const earthX = xOfAz(f, now.earthAz);
  const earthY = yOfEl(f, now.earthEl);
  const rSun = Math.max(3, SUN_RADIUS_DEG * ky);
  const rEarth = Math.max(5, EARTH_RADIUS_DEG * ky);

  return (
    <svg
      ref={svgRef}
      width={L.svgW}
      height={L.svgH}
      viewBox={`0 0 ${L.svgW} ${L.svgH}`}
      role="img"
      aria-labelledby={`${uid}-title ${uid}-desc`}
      className="block select-none"
      onPointerDown={onScrub ? onDown : undefined}
      onPointerMove={onScrub ? onMove : undefined}
      onPointerUp={onScrub ? onUp : undefined}
      onPointerCancel={onScrub ? onUp : undefined}
    >
      <title id={`${uid}-title`}>{`Horizon plot for ${siteName}`}</title>
      <desc id={`${uid}-desc`}>{describe(L, site, nowMs, windowText)}</desc>
      <defs>
        <clipPath id={plotClip}>
          <rect x={f.left} y={f.top} width={f.width} height={f.height} />
        </clipPath>
        <clipPath id={skyClip}>
          <path d={L.skyD} />
        </clipPath>
      </defs>

      {/* Sky grid, hidden behind the terrain like the sky itself */}
      <g className="stroke-rule" strokeWidth={1} shapeRendering="crispEdges">
        <line x1={f.left} x2={L.plotRight} y1={crisp(f.top)} y2={crisp(f.top)} />
        {L.elTicks.major.map((v) => (
          <line key={v} x1={f.left} x2={L.plotRight} y1={crisp(yOfEl(f, v))} y2={crisp(yOfEl(f, v))} />
        ))}
        {L.azTicks.map((t) => (
          <line key={t.u} x1={crisp(xOfU(f, t.u))} x2={crisp(xOfU(f, t.u))} y1={f.top} y2={L.plotBottom} />
        ))}
      </g>
      <line
        x1={f.left}
        x2={L.plotRight}
        y1={crisp(yOfEl(f, 0))}
        y2={crisp(yOfEl(f, 0))}
        className="stroke-ink-3"
        strokeWidth={1}
        shapeRendering="crispEdges"
      />

      <g clipPath={`url(#${plotClip})`}>
        <path d={L.silhouetteD} className="fill-umbra" />
        <path d={L.edgeD} className="fill-none stroke-ink" strokeWidth={1} strokeLinejoin="round" />

        {/* Tracks behind the terrain: dashed */}
        {L.sun.runs
          .filter((r) => !r.up)
          .map((r, i) => (
            <path key={`sh${i}`} d={polylineD(r.points)} className="fill-none stroke-sun" strokeWidth={1.5} strokeDasharray="4 3" />
          ))}
        {L.earth.runs
          .filter((r) => !r.up)
          .map((r, i) => (
            <path key={`eh${i}`} d={polylineD(r.points)} className="fill-none stroke-earth-soft" strokeWidth={1.5} strokeDasharray="4 3" />
          ))}

        {/* Tracks in view: cased lines */}
        {L.sun.runs
          .filter((r) => r.up)
          .map((r, i) => (
            <g key={`su${i}`} className="fill-none" strokeLinejoin="round" strokeLinecap="round">
              <path d={polylineD(r.points)} className="stroke-sun-ink" strokeWidth={4} />
              <path d={polylineD(r.points)} className="stroke-sun" strokeWidth={2.25} />
            </g>
          ))}
        {L.earth.runs
          .filter((r) => r.up)
          .map((r, i) => (
            <g key={`eu${i}`} className="fill-none" strokeLinejoin="round" strokeLinecap="round">
              <path d={polylineD(r.points)} className="stroke-paper" strokeWidth={4} />
              <path d={polylineD(r.points)} className="stroke-earth" strokeWidth={2} />
            </g>
          ))}

        {/* Time ticks */}
        <g className="fill-none" strokeLinecap="butt">
          <path d={L.sunTicks.upMinor} className="stroke-sun-ink" strokeWidth={1} />
          <path d={L.sunTicks.upMajor} className="stroke-sun-ink" strokeWidth={1.75} />
          <path d={L.sunTicks.downMajor} className="stroke-sun" strokeWidth={1.75} />
          <path d={L.earthTicks.upMinor} className="stroke-earth" strokeWidth={1} />
          <path d={L.earthTicks.upMajor} className="stroke-earth" strokeWidth={1.75} />
          <path d={L.earthTicks.downMajor} className="stroke-earth-soft" strokeWidth={1.75} />
        </g>

        {/* Window start bar and end arrow */}
        {[L.sun, L.earth].map((tr) => (
          <TrackEnds key={tr.body} track={tr} />
        ))}

        {/* Rise and set contacts */}
        {L.contacts.map((c, i) => {
          const rise = c.kind === "sunrise" || c.kind === "earthrise";
          return (
            <circle
              key={i}
              cx={c.x}
              cy={c.y}
              r={3.5}
              className={rise ? "fill-paper stroke-ink" : "fill-paper stroke-limit"}
              strokeWidth={1.5}
            />
          );
        })}

        {/* Leaders from far-placed labels to their contacts */}
        <path d={L.leadersD} className="fill-none stroke-ink-2" strokeWidth={1} />

        {/* Labels */}
        {L.labels.map((lab) => {
          const x = lab.align === "start" ? lab.box.x0 : lab.align === "end" ? lab.box.x1 : (lab.box.x0 + lab.box.x1) / 2;
          return (
            <text key={lab.id} x={x} textAnchor={lab.align} fontSize={L.fs}>
              {lab.lines.map((ln, k) => (
                <tspan
                  key={k}
                  x={x}
                  y={lab.box.y0 + k * lab.lineHeight + L.fs * 0.92}
                  className={toneClass(ln.tone, lab.region)}
                  fontWeight={ln.strong ? 600 : 400}
                  letterSpacing={ln.strong ? "0.06em" : undefined}
                >
                  {ln.text}
                </tspan>
              ))}
            </text>
          );
        })}

        {/* Bodies now: the part behind terrain dashed, the part in view filled */}
        <g>
          <circle cx={earthX} cy={earthY} r={rEarth} className="fill-none stroke-earth-soft" strokeWidth={1.25} strokeDasharray="3 2" />
          <g clipPath={`url(#${skyClip})`}>
            <circle cx={earthX} cy={earthY} r={rEarth} className="fill-earth-soft stroke-earth" fillOpacity={0.6} strokeWidth={1.5} />
            <path
              d={`M${f1(earthX)} ${f1(earthY - rEarth)}V${f1(earthY + rEarth)}M${f1(earthX - rEarth)} ${f1(earthY)}H${f1(earthX + rEarth)}`}
              className="stroke-earth"
              strokeWidth={1}
            />
          </g>
          <Reticle x={sunX} y={sunY} r={rSun} onTerrain={sunY > L.horizonYAt(sunX) + 0.5} />
          <circle cx={sunX} cy={sunY} r={rSun} className="fill-umbra stroke-sun" strokeWidth={1.25} strokeDasharray="2 1.5" />
          <g clipPath={`url(#${skyClip})`}>
            <circle cx={sunX} cy={sunY} r={rSun + 1.5} className="fill-paper" />
            <circle cx={sunX} cy={sunY} r={rSun} className="fill-sun stroke-sun-ink" strokeWidth={1.25} />
            <circle cx={sunX} cy={sunY} r={Math.max(1, rSun * 0.27)} className="fill-sun-ink" />
          </g>
        </g>
      </g>

      {/* Axes */}
      <g className="stroke-ink" strokeWidth={1} shapeRendering="crispEdges">
        <line x1={crisp(f.left)} x2={crisp(f.left)} y1={f.top} y2={L.plotBottom} />
        <line x1={f.left} x2={L.plotRight} y1={crisp(L.plotBottom)} y2={crisp(L.plotBottom)} />
        {L.elTicks.major.map((v) => (
          <line key={v} x1={f.left - 5} x2={f.left} y1={crisp(yOfEl(f, v))} y2={crisp(yOfEl(f, v))} />
        ))}
        {L.elTicks.minor.map((v) => (
          <line key={v} x1={f.left - 3} x2={f.left} y1={crisp(yOfEl(f, v))} y2={crisp(yOfEl(f, v))} />
        ))}
        {L.azTicks.map((t) => (
          <line key={t.u} x1={crisp(xOfU(f, t.u))} x2={crisp(xOfU(f, t.u))} y1={L.plotBottom} y2={L.plotBottom + 5} />
        ))}
        {Array.from({ length: 36 }, (_, k) => -180 + k * 10)
          .filter((u) => u % 30 !== 0)
          .map((u) => (
            <line key={u} x1={crisp(xOfU(f, u))} x2={crisp(xOfU(f, u))} y1={L.plotBottom} y2={L.plotBottom + 3} />
          ))}
      </g>
      <g fontSize={L.fsAxis}>
        {L.elTicks.major.map((v) => (
          <text key={v} x={f.left - 8} y={yOfEl(f, v) + L.fsAxis * 0.35} textAnchor="end" className="fill-ink-2">
            {L.elLabel(v)}
          </text>
        ))}
        {L.azTicks.map((t) => (
          <text
            key={t.u}
            x={xOfU(f, t.u)}
            y={L.plotBottom + 8 + L.fsAxis * 0.85}
            textAnchor="middle"
            className={t.cardinal ? "fill-ink" : "fill-ink-2"}
            fontWeight={t.cardinal ? 600 : 400}
          >
            {t.label}
          </text>
        ))}
      </g>
    </svg>
  );
}

/** Start bar across the track and an arrowhead in the direction of travel at the end. */
function TrackEnds({ track }: { track: Track }) {
  const s = track.start;
  const e = track.end;
  if (!s || !e) return null;
  const sunUp = track.body === "sun" ? "stroke-sun-ink" : "stroke-earth";
  const sunDown = track.body === "sun" ? "stroke-sun" : "stroke-earth-soft";
  const L = 7;
  const ax = e.x - e.tx * 7;
  const ay = e.y - e.ty * 7;
  return (
    <g className="fill-none" strokeWidth={1.75} strokeLinecap="butt" strokeLinejoin="miter">
      <path
        d={`M${f1(s.x - s.nx * L)} ${f1(s.y - s.ny * L)}L${f1(s.x + s.nx * L)} ${f1(s.y + s.ny * L)}`}
        className={s.up ? sunUp : sunDown}
      />
      <path
        d={`M${f1(ax + e.nx * 4)} ${f1(ay + e.ny * 4)}L${f1(e.x)} ${f1(e.y)}L${f1(ax - e.nx * 4)} ${f1(ay - e.ny * 4)}`}
        className={e.up ? sunUp : sunDown}
      />
    </g>
  );
}

/** Four short marks around a small disc so its current position stays findable on a busy track. */
function Reticle({ x, y, r, onTerrain }: { x: number; y: number; r: number; onTerrain: boolean }) {
  const a = r + 3;
  const b = r + 8;
  return (
    <path
      d={`M${f1(x)} ${f1(y - a)}V${f1(y - b)}M${f1(x)} ${f1(y + a)}V${f1(y + b)}M${f1(x - a)} ${f1(y)}H${f1(x - b)}M${f1(x + a)} ${f1(y)}H${f1(x + b)}`}
      className={onTerrain ? "stroke-paper" : "stroke-ink"}
      strokeWidth={1.5}
    />
  );
}

/** Elevation labels pinned to the left edge while the panorama scrolls. */
function StickyAxis({ layout: L }: { layout: Layout }) {
  const f = L.frame;
  return (
    <svg
      width={f.left + 1}
      height={L.svgH}
      className="pointer-events-none absolute left-0 top-0 block"
      aria-hidden="true"
    >
      <rect x={0} y={0} width={f.left} height={L.svgH} className="fill-paper" />
      <g className="stroke-ink" strokeWidth={1} shapeRendering="crispEdges">
        <line x1={crisp(f.left)} x2={crisp(f.left)} y1={f.top} y2={L.plotBottom} />
        {L.elTicks.major.map((v) => (
          <line key={v} x1={f.left - 5} x2={f.left} y1={crisp(yOfEl(f, v))} y2={crisp(yOfEl(f, v))} />
        ))}
        {L.elTicks.minor.map((v) => (
          <line key={v} x1={f.left - 3} x2={f.left} y1={crisp(yOfEl(f, v))} y2={crisp(yOfEl(f, v))} />
        ))}
      </g>
      <g fontSize={L.fsAxis}>
        {L.elTicks.major.map((v) => (
          <text key={v} x={f.left - 8} y={yOfEl(f, v) + L.fsAxis * 0.35} textAnchor="end" className="fill-ink-2">
            {L.elLabel(v)}
          </text>
        ))}
      </g>
    </svg>
  );
}

/** "Ticks 6 h (Earth 24 h), heavy at 00h UTC · elevation ×5.0". */
function plotNote(L: Layout): string {
  const sunH = L.sun.tickHours;
  const earthH = L.earth.tickHours;
  const ticks = sunH === earthH ? `Ticks ${sunH} h` : `Ticks ${sunH} h (Earth ${earthH} h)`;
  const ex = L.exaggeration;
  return `${ticks}, heavy at 00h UTC · elevation ×${ex >= 10 ? Math.round(ex) : ex.toFixed(1)}`;
}

function Legend({ layout: L, compact = false }: { layout: Layout; compact?: boolean }) {
  const sunH = L.sun.tickHours;
  const earthH = L.earth.tickHours;
  const ticks = sunH === earthH ? `Ticks every ${sunH} h` : `Ticks every ${sunH} h (Earth ${earthH} h)`;
  const ex = L.exaggeration;
  const exText = ex >= 10 ? Math.round(ex) : ex.toFixed(1);
  const item = "flex items-center gap-2";
  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 text-[0.75rem] text-ink-2 ${compact ? "mt-1.5 border-t border-rule pt-1.5" : "max-w-[52rem] flex-1"}`}
    >
      <ul className={`m-0 flex list-none flex-wrap items-center p-0 ${compact ? "gap-x-4 gap-y-1" : "gap-x-5 gap-y-1.5"}`}>
        <li className={item}>
          <Swatch>
            <path d="M1 6H23" className="stroke-sun-ink" strokeWidth={4} />
            <path d="M1 6H23" className="stroke-sun" strokeWidth={2.25} />
            <path d="M12 1.5V10.5" className="stroke-sun-ink" strokeWidth={1.5} />
          </Swatch>
          Sun track
        </li>
        <li className={item}>
          <Swatch>
            <path d="M1 6H23" className="stroke-earth" strokeWidth={2} />
            <path d="M12 1.5V10.5" className="stroke-earth" strokeWidth={1.5} />
          </Swatch>
          Earth track
        </li>
        <li className={item}>
          <Swatch>
            <rect x={0} y={0} width={24} height={12} className="fill-umbra" />
            <path d="M1 6H23" className="stroke-sun" strokeWidth={1.5} strokeDasharray="4 3" />
          </Swatch>
          Behind terrain
        </li>
        <li className={item}>
          <Swatch>
            <path d="M0 12V7L6 4L11 7L16 2L24 6V12Z" className="fill-umbra" />
            <path d="M0 7L6 4L11 7L16 2L24 6" className="fill-none stroke-ink" strokeWidth={1} />
          </Swatch>
          {compact ? "Terrain horizon" : "Terrain horizon (LOLA)"}
        </li>
        <li className={item}>
          <Swatch>
            <circle cx={7} cy={6} r={3.5} className="fill-paper stroke-ink" strokeWidth={1.5} />
            <circle cx={17} cy={6} r={3.5} className="fill-paper stroke-limit" strokeWidth={1.5} />
          </Swatch>
          Rise, set
        </li>
        <li className={item}>
          <Swatch>
            <circle cx={6} cy={6} r={3.25} className="fill-sun stroke-sun-ink" strokeWidth={1.25} />
            <circle cx={6} cy={6} r={0.9} className="fill-sun-ink" />
            <circle cx={17} cy={6} r={5} className="fill-earth-soft stroke-earth" strokeWidth={1.25} />
            <path d="M17 1V11M12 6H22" className="stroke-earth" strokeWidth={1} />
          </Swatch>
          {compact ? "Now" : "Sun and Earth at the chosen time"}
        </li>
      </ul>
      {compact ? null : (
        <p className="m-0">
          {ticks}, heavy at 00h UTC. Elevation stretched {exText}×; discs to elevation scale. Azimuth from north; S faces
          the pole.
        </p>
      )}
    </div>
  );
}

function Swatch({ children }: { children: ReactNode }) {
  return (
    <svg width={24} height={12} viewBox="0 0 24 12" className="shrink-0" aria-hidden="true">
      {children}
    </svg>
  );
}

function Circumstances({ site, now }: { site: SiteData; now: ReturnType<typeof sampleAt> }) {
  const sunStatus =
    !isUp(site, "sun", now.ms)
      ? null
      : now.sunFraction >= 1
        ? "Full disc up"
        : `${Math.round(now.sunFraction * 100)}% of disc up`;
  const th = "px-1.5 py-0.5 text-right text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-ink-2";
  const td = "px-1.5 py-0.5 text-right tabular-nums";
  return (
    <table className="border-collapse text-[0.844rem] text-ink">
      <caption className="pb-1 text-left text-[0.844rem] text-ink-2">At {fmtFull(now.ms)}</caption>
      <thead>
        <tr className="border-b border-rule">
          <th scope="col" className={`${th} pl-0 text-left`}>
            <span className="sr-only">Body</span>
          </th>
          <th scope="col" className={th}>
            Azimuth
          </th>
          <th scope="col" className={th}>
            Elevation
          </th>
          <th scope="col" className={th}>
            Terrain
          </th>
          <th scope="col" className={`${th} pr-0 text-left`}>
            Status
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row" className="py-0.5 pr-1.5 text-left font-semibold">
            Sun
          </th>
          <td className={td}>{fmtAz(now.sunAz)}</td>
          <td className={td}>{fmtSigned(now.sunEl, 2)}</td>
          <td className={td}>{fmtSigned(now.sunHorizon, 2)}</td>
          <td className="whitespace-nowrap py-0.5 pl-1.5 pr-0 text-left">
            {sunStatus ?? <span className="text-limit">Behind terrain</span>}
          </td>
        </tr>
        <tr>
          <th scope="row" className="py-0.5 pr-1.5 text-left font-semibold">
            Earth
          </th>
          <td className={td}>{fmtAz(now.earthAz)}</td>
          <td className={td}>{fmtSigned(now.earthEl, 2)}</td>
          <td className={td}>{fmtSigned(now.earthHorizon, 2)}</td>
          <td className="whitespace-nowrap py-0.5 pl-1.5 pr-0 text-left">
            {isUp(site, "earth", now.ms) ? "In view" : <span className="text-limit">Behind terrain</span>}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function describe(L: Layout, site: SiteData, nowMs: number, windowText: string): string {
  const parts: string[] = [];
  parts.push(
    `Panorama of the LOLA terrain horizon, azimuth 0 to 360 degrees with north (away from the pole) in the centre and south (toward the pole) at both edges; elevation ${L.frame.elMin} to ${L.frame.elMax} degrees, stretched ${L.exaggeration.toFixed(1)} times.`,
  );
  if (L.stats) {
    const share = (v: number, what: string) =>
      v >= 0.999 ? `${what} for the whole window` : v <= 0.001 ? `behind the terrain for the whole window` : `${what} for ${pct(v)} of the window`;
    parts.push(`Window ${windowText}. Sun ${share(L.stats.sunlit, "above the terrain")}. Earth ${share(L.stats.earthVisible, "in view")}.`);
  }
  if (L.contacts.length) {
    parts.push(
      `Contacts: ${L.contacts
        .map((c) => `${CONTACT_WORD[c.kind]} ${fmtDayTime(c.ms)} UTC at azimuth ${fmtAz(c.az, 0)}`)
        .join("; ")}.`,
    );
  } else if (L.stats) {
    parts.push("No rise or set contacts in the window.");
  }
  const n = sampleAt(site, nowMs);
  parts.push(
    `At ${fmtFull(nowMs)}: Sun azimuth ${fmtAz(n.sunAz)}, elevation ${fmtSigned(n.sunEl, 2)} against terrain ${fmtSigned(n.sunHorizon, 2)}${isUp(site, "sun", nowMs) ? "" : ", behind the terrain"}; Earth azimuth ${fmtAz(n.earthAz)}, elevation ${fmtSigned(n.earthEl, 2)} against terrain ${fmtSigned(n.earthHorizon, 2)}${isUp(site, "earth", nowMs) ? ", in view" : ", behind the terrain"}.`,
  );
  return parts.join(" ");
}

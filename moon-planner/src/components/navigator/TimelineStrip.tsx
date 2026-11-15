"use client";

// Timeline strip: sunlight and Earth-contact bands over the mission window,
// with a scrub handle (pointer and keyboard) and countdowns to the next rise
// or set. Optional compact band pairs compare other sites or slipped starts.
// The compact form is the scrub rail under the horizon panorama (Fig. 2),
// which prints its own readout.

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { missionScore, rangeOf, type SiteData } from "@/lib/sky";
import { sites } from "@/lib/sites";
import { isUp, nextContact, visibilitySpans, type Body, type VisibilitySpan } from "@/lib/contacts";
import { DAY_MS, HOUR_MS, fmtDay, fmtDayTime, fmtDuration, fmtElapsed, fmtFull, fmtShift , pct } from "@/lib/format";
import { StateSwatch } from "../ui";
import { useElementWidth } from "./plot/hooks";

export type CompareSite = {
  name: string;
  site: SiteData;
  /** Shift this row's window by this much (e.g. a two-week slip); default 0. */
  offsetMs?: number;
};

type Props = {
  site: SiteData;
  /** Name for the first row when rows are compared; defaults to the region name for site.sky.siteId. */
  siteName?: string;
  startMs: number;
  endMs: number;
  nowMs: number;
  onScrub: (ms: number) => void;
  compareSites?: CompareSite[];
  /** Thin ruler and bands, for the rail under the horizon panorama. */
  compact?: boolean;
  /** Print the time and countdown readout under the bands (default true). */
  readout?: boolean;
  /** Element that describes the slider when the strip prints no readout. */
  describedBy?: string;
  className?: string;
};

function siteName(site: SiteData): string {
  return sites.find((s) => s.id === site.sky.siteId)?.name ?? site.sky.siteId;
}

type Row = {
  key: string;
  name: string;
  offsetMs: number;
  sun: VisibilitySpan[];
  earth: VisibilitySpan[];
  sunlit: number;
  earthVisible: number;
  longestDarkHours: number;
  /** Fraction of the window [from, to] with no ephemeris (outside the data). */
  noData: { from: number; to: number }[];
};

type RowData = Omit<Row, "key" | "name">;

// Rows depend only on the site data and the window, so they are cached per
// site object; scrubbing then only moves the playhead.
const rowCache = new WeakMap<SiteData, Map<string, RowData>>();

function rowData(site: SiteData, startMs: number, endMs: number, offsetMs: number): RowData {
  const key = `${startMs}|${endMs}|${offsetMs}`;
  let bySite = rowCache.get(site);
  if (!bySite) {
    bySite = new Map();
    rowCache.set(site, bySite);
  }
  const hit = bySite.get(key);
  if (hit) return hit;
  const data = rangeOf(site.sky);
  const a = Math.max(startMs + offsetMs, data.startMs);
  const b = Math.min(endMs + offsetMs, data.endMs);
  const span = endMs - startMs;
  const noData: Row["noData"] = [];
  if (a > startMs + offsetMs) noData.push({ from: 0, to: Math.min(1, (a - startMs - offsetMs) / span) });
  if (b < endMs + offsetMs) noData.push({ from: Math.max(0, (b - startMs - offsetMs) / span), to: 1 });
  const ok = b > a;
  const stats = ok ? missionScore(site, a, b) : null;
  const row: RowData = {
    offsetMs,
    sun: ok ? visibilitySpans(site, "sun", a, b) : [],
    earth: ok ? visibilitySpans(site, "earth", a, b) : [],
    sunlit: stats?.sunlit ?? 0,
    earthVisible: stats?.earthVisible ?? 0,
    longestDarkHours: stats?.longestDarkHours ?? 0,
    noData,
  };
  if (bySite.size > 24) bySite.clear();
  bySite.set(key, row);
  return row;
}

export default function TimelineStrip({
  site,
  siteName: mainName,
  startMs,
  endMs,
  nowMs,
  onScrub,
  compareSites,
  compact = false,
  readout = true,
  describedBy,
  className,
}: Props) {
  const uid = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const trackW = useElementWidth(trackRef) ?? 720;
  const [dragging, setDragging] = useState(false);

  const span = Math.max(endMs - startMs, HOUR_MS);
  const totalHours = Math.round(span / HOUR_MS);
  const clampMs = (ms: number) => Math.min(endMs, Math.max(startMs, ms));
  const frac = (ms: number) => (ms - startMs) / span;
  const pct = (f: number) => `${(Math.min(1, Math.max(0, f)) * 100).toFixed(3)}%`;

  const rows: Row[] = [
    { key: "main", name: mainName ?? siteName(site), ...rowData(site, startMs, endMs, 0) },
    ...(compareSites ?? []).map((c, i) => ({
      key: `cmp-${i}`,
      name: c.name,
      ...rowData(c.site, startMs, endMs, c.offsetMs ?? 0),
    })),
  ];

  // Ruler: a tick at each 00h UTC, labels thinned to fit, 6-hourly minor ticks when roomy.
  const ruler = useMemo(() => {
    const pxPerDay = (trackW * DAY_MS) / span;
    const every = [1, 2, 3, 7, 14].find((d) => d * pxPerDay >= 48) ?? 28;
    const days: { ms: number; label: string | null }[] = [];
    let k = 0;
    for (let t = Math.ceil(startMs / DAY_MS) * DAY_MS; t <= endMs; t += DAY_MS, k++) {
      const x = ((t - startMs) / span) * trackW;
      const fits = x + 40 <= trackW;
      days.push({ ms: t, label: k % every === 0 && fits ? fmtDay(t) : null });
    }
    const minor: number[] = [];
    if (pxPerDay >= 48) {
      for (let t = Math.ceil(startMs / (6 * HOUR_MS)) * 6 * HOUR_MS; t <= endMs; t += 6 * HOUR_MS) {
        if (t % DAY_MS !== 0) minor.push(t);
      }
    }
    return { days, minor };
  }, [startMs, endMs, span, trackW]);

  const shown = clampMs(nowMs);
  const sunUp = isUp(site, "sun", nowMs);
  const earthUp = isUp(site, "earth", nowMs);
  const sunNext = nextContact(site, "sun", nowMs);
  const earthNext = nextContact(site, "earth", nowMs);
  const dataEnd = rangeOf(site.sky).endMs;

  const countdown = (body: Body, up: boolean, next: typeof sunNext) => {
    const word = body === "sun" ? (up ? "Sunset" : "Sunrise") : up ? "Earthset" : "Earthrise";
    if (!next) return `No ${word.toLowerCase()} before ${fmtDay(dataEnd)} ${new Date(dataEnd).getUTCFullYear()}`;
    return `${word} in ${fmtDuration((next.ms - nowMs) / HOUR_MS)}`;
  };
  const sunText = countdown("sun", sunUp, sunNext);
  const earthText = countdown("earth", earthUp, earthNext);
  const valueText = `${fmtFull(nowMs)}. Sun ${sunUp ? "up" : "down"}, ${sunText.toLowerCase()}. Earth ${earthUp ? "in view" : "out of view"}, ${earthText.toLowerCase()}.`;

  // ---- Scrubbing ----
  const scrubTo = (ms: number) => {
    const t = clampMs(ms);
    if (t !== nowMs) onScrub(t);
  };
  const msAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return nowMs;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.round((startMs + f * span) / HOUR_MS) * HOUR_MS;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (e.button !== 0 || (r && e.clientX < r.left - 6)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    thumbRef.current?.focus({ preventScroll: true });
    scrubTo(msAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) scrubTo(msAt(e.clientX));
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? DAY_MS : HOUR_MS;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = shown + step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = shown - step;
        break;
      case "PageUp":
        next = shown + DAY_MS;
        break;
      case "PageDown":
        next = shown - DAY_MS;
        break;
      case "Home":
        next = startMs;
        break;
      case "End":
        next = endMs;
        break;
    }
    if (next === null) return;
    e.preventDefault();
    scrubTo(next);
  };

  const multi = rows.length > 1;
  // Position across the track column, which starts after the 3.25rem label gutter and a 0.5rem gap.
  const at = (f: number) => `calc(3.75rem + (100% - 3.75rem) * ${Math.min(1, Math.max(0, f)).toFixed(5)})`;

  return (
    <div className={`text-ink ${className ?? ""}`}>
      <div
        className={`relative touch-pan-y select-none ${dragging ? "cursor-grabbing" : "cursor-pointer"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <Line>
          <div ref={trackRef}>
            <Ruler days={ruler.days} minor={ruler.minor} frac={frac} pct={pct} compact={compact} />
          </div>
        </Line>
        {rows.map((row, i) => (
          <div key={row.key} className={i ? "mt-2" : ""}>
            {multi ? (
              <Line>
                <RowCaption row={row} main={i === 0} startMs={startMs} endMs={endMs} />
              </Line>
            ) : null}
            <Line label={i === 0 ? "Sun" : undefined} compact={compact}>
              <Band spans={row.sun} body="sun" offsetMs={row.offsetMs} frac={frac} pct={pct} noData={row.noData} tall={i === 0 && !compact} rail={i === 0 && compact} />
            </Line>
            <Line label={i === 0 ? "Earth" : undefined} compact={compact} className={i === 0 ? "mt-0.5" : "mt-px"}>
              <Band spans={row.earth} body="earth" offsetMs={row.offsetMs} frac={frac} pct={pct} noData={row.noData} tall={i === 0 && !compact} rail={i === 0 && compact} />
            </Line>
          </div>
        ))}

        {/* Playhead: a line through the bands under a square thumb on the ruler line */}
        <div
          className={`pointer-events-none absolute bottom-0 w-1 -translate-x-1/2 border-x border-paper bg-ink ${compact ? "top-5" : "top-6"}`}
          style={{ left: at(frac(shown)) }}
          aria-hidden="true"
        />
        <div
          ref={thumbRef}
          role="slider"
          tabIndex={0}
          aria-label="Mission time"
          aria-valuemin={0}
          aria-valuemax={totalHours}
          aria-valuenow={Math.round((shown - startMs) / HOUR_MS)}
          aria-valuetext={valueText}
          aria-describedby={readout ? `${uid}-readout` : describedBy}
          onKeyDown={onKeyDown}
          className={`absolute z-20 h-2.5 w-2.5 -translate-x-1/2 cursor-grab bg-ink before:absolute before:-inset-[0.4375rem] before:content-[''] active:cursor-grabbing ${
            compact ? "top-[0.6875rem]" : "top-[0.9375rem]"
          }`}
          style={{ left: at(frac(shown)) }}
        />
      </div>

      {/* Readout */}
      {readout ? (
      <div id={`${uid}-readout`} className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-body">
        <span className="font-semibold tabular-nums">
          {fmtFull(nowMs)}
          <span className="ml-2 font-normal text-ink-2">{fmtElapsed(nowMs - startMs)}</span>
        </span>
        <span className="inline-flex items-baseline gap-1.5">
          <StateSwatch body="sun" up={sunUp} className="shrink-0 self-center" />
          <span>
            {sunUp ? "Sunlit" : <span className="font-semibold text-limit">Dark</span>}
            <span className="text-ink-2">{" · "}</span>
            {sunText}
            {sunNext ? <span className="text-ink-2"> ({fmtDayTime(sunNext.ms)})</span> : null}
          </span>
        </span>
        <span className="inline-flex items-baseline gap-1.5">
          <StateSwatch body="earth" up={earthUp} className="shrink-0 self-center" />
          <span>
            {earthUp ? "Earth in view" : <span className="font-semibold text-limit">No Earth contact</span>}
            <span className="text-ink-2">{" · "}</span>
            {earthText}
            {earthNext ? <span className="text-ink-2"> ({fmtDayTime(earthNext.ms)})</span> : null}
          </span>
        </span>
      </div>
      ) : null}
    </div>
  );
}

/** One strip row: a right-aligned label in the gutter and the content across the track column. */
function Line({ label, compact, className, children }: { label?: string; compact?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={`flex gap-2 ${className ?? ""}`}>
      <div
        className={`w-[3.25rem] shrink-0 cursor-default text-right text-label font-semibold uppercase tracking-[0.06em] text-ink-2 ${
          compact ? "leading-3" : "leading-4"
        }`}
        aria-hidden="true"
      >
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Ruler({
  days,
  minor,
  frac,
  pct,
  compact,
}: {
  days: { ms: number; label: string | null }[];
  minor: number[];
  frac: (ms: number) => number;
  pct: (f: number) => string;
  compact?: boolean;
}) {
  return (
    <div className={`relative border-b border-ink ${compact ? "h-5" : "h-6"}`} aria-hidden="true">
      {minor.map((t) => (
        <span key={t} className="absolute bottom-0 h-1 w-px bg-ink-3" style={{ left: pct(frac(t)) }} />
      ))}
      {days.map((d) => (
        <span key={d.ms} className="absolute bottom-0 h-2 w-px bg-ink" style={{ left: pct(frac(d.ms)) }} />
      ))}
      {days.map((d) =>
        d.label ? (
          <span
            key={`l${d.ms}`}
            className="absolute top-0 whitespace-nowrap pl-1 text-label leading-4 text-ink-2 tabular-nums"
            style={{ left: pct(frac(d.ms)) }}
          >
            {d.label}
          </span>
        ) : null,
      )}
    </div>
  );
}

function Band({
  spans,
  body,
  offsetMs,
  frac,
  pct,
  noData,
  tall,
  rail,
  gap,
}: {
  spans: VisibilitySpan[];
  body: Body;
  offsetMs: number;
  frac: (ms: number) => number;
  pct: (f: number) => string;
  noData: { from: number; to: number }[];
  tall: boolean;
  /** The main row of the compact rail. */
  rail?: boolean;
  gap?: boolean;
}) {
  const on = body === "sun" ? "bg-sun" : "bg-earth";
  const off = body === "sun" ? "bg-umbra" : "bg-umbra-soft";
  return (
    <div
      className={`relative overflow-hidden bg-paper-2 ${tall ? "h-4" : rail ? "h-3" : "h-2.5"} ${gap ? (tall ? "mt-0.5" : "mt-px") : ""}`}
      aria-hidden="true"
    >
      {spans.map((s) => {
        const a = frac(s.startMs - offsetMs);
        const b = frac(s.endMs - offsetMs);
        return (
          <span
            key={s.startMs}
            className={`absolute inset-y-0 ${s.up ? on : off}`}
            style={{ left: pct(a), width: pct(b - a) }}
          />
        );
      })}
      {noData.map((n, i) => (
        <span
          key={`nd${i}`}
          className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,var(--color-rule)_0_1px,transparent_1px_5px)]"
          style={{ left: pct(n.from), width: pct(n.to - n.from) }}
        />
      ))}
    </div>
  );
}

function RowCaption({ row, main, startMs, endMs }: { row: Row; main: boolean; startMs: number; endMs: number }) {
  // Text sits on paper above the playhead line, so the line reads as passing behind it.
  const knock = "relative z-10 bg-paper";
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 pb-1 pt-0.5 text-label leading-4">
      <span className={`${knock} ${main ? "font-semibold" : "font-medium"} text-ink`}>{row.name}</span>
      {row.offsetMs ? (
        <span className={`${knock} text-ink-2 tabular-nums`}>
          {fmtShift(row.offsetMs)}: {fmtDay(startMs + row.offsetMs)} to {fmtDay(endMs + row.offsetMs)}
        </span>
      ) : null}
      <span className={`${knock} text-ink-2 tabular-nums`}>
        Sun {pct(row.sunlit)} · Earth {pct(row.earthVisible)}
        {row.longestDarkHours > 0 ? ` · longest dark ${fmtDuration(row.longestDarkHours)}` : ""}
      </span>
    </div>
  );
}

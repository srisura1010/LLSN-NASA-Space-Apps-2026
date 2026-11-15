"use client";

// Figure 1: the terrain horizon seen from the selected region, with the Sun's
// and Earth's paths for one 6.5-day stay, and the circumstances beside it.

import { useEffect, useMemo, useRef, useState } from "react";
import { windowStats } from "@/lib/sky";
import { useLanding } from "./LandingState";
import { Locator } from "./Locator";
import {
  CONTACT_NAME,
  HOUR_MS,
  STAY_HOURS,
  contactsIn,
  fmtDayTime,
  fmtLatLon,
  fmtSpell,
  pct,
  siteById,
  type Contact,
} from "./model";
import { buildPlate, type Plate, type PlateLabel, type TrackGeometry } from "./plate";

const TONE: Record<PlateLabel["tone"], string> = {
  ink: "fill-ink",
  "ink-2": "fill-ink-2",
  sun: "fill-sun-ink",
  earth: "fill-earth",
  umbra: "fill-umbra",
};
const HALO: Record<PlateLabel["halo"], string> = { paper: "stroke-paper", terrain: "stroke-paper-3" };

// Scroll tells the story: the photograph drifts as you leave it, the ground
// rises into the chart, the Sun and Earth trace across, and a stay fills in.
// With motion reduced, or without scroll timelines, everything stays visible.
const REVEAL_CSS = `
@keyframes landing-moon-drift{from{background-position:50% 50%}to{background-position:50% 72%}}
@keyframes horizon-rise{from{clip-path:inset(100% 0 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes trace-across{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes stay-trace{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@media (prefers-reduced-motion:no-preference){
  @supports (animation-timeline:scroll()){
    .landing-moon{animation:landing-moon-drift linear both;animation-timeline:scroll(root block);animation-range:0vh 85vh}
  }
  @supports (animation-timeline:view()){
    .horizon-rise{animation:horizon-rise cubic-bezier(0.16,1,0.3,1) both;animation-timeline:view();animation-duration:auto;animation-range:cover 32% cover 58%}
    .plate-reveal{animation:trace-across cubic-bezier(0.16,1,0.3,1) both;animation-timeline:view();animation-duration:auto;animation-range:cover 38% cover 64%}
    .stay-trace,.scroll-rule{transform-origin:left center;animation:stay-trace cubic-bezier(0.16,1,0.3,1) both;animation-timeline:view();animation-duration:auto;animation-range:cover 32% cover 55%}
    .scroll-draw{animation:trace-across cubic-bezier(0.16,1,0.3,1) both;animation-timeline:view();animation-duration:auto;animation-range:cover 32% cover 58%}
  }
  .hero-draw{animation:trace-across 720ms cubic-bezier(0.16,1,0.3,1) both}
  .hero-draw:nth-child(2){animation-delay:90ms}
  .hero-draw:nth-child(3){animation-delay:180ms}
}
`;

function plotHeight(w: number) {
  return w >= 900 ? 360 : w >= 600 ? 320 : 288;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function HorizonPlate() {
  const { data, dataSiteId, siteId, startMs, status, retry } = useLanding();
  const [plotRef, width] = useWidth<HTMLDivElement>();
  const endMs = startMs + STAY_HOURS * HOUR_MS;
  const shownSite = siteById(dataSiteId ?? siteId);
  const selected = siteById(siteId);

  const facts = useMemo(() => {
    if (!data) return null;
    return { stats: windowStats(data, startMs, endMs), contacts: contactsIn(data, startMs, endMs) };
  }, [data, startMs, endMs]);

  const height = plotHeight(width);
  const plate = useMemo<Plate | null>(() => {
    if (!data || !facts || width < 200) return null;
    return buildPlate(data, startMs, STAY_HOURS, facts.contacts, width, height);
  }, [data, facts, startMs, width, height]);

  const refreshing = status === "loading" && data !== null;

  return (
    <figure className="m-0 grid lg:grid-cols-[minmax(0,1fr)_19.5rem]">
      <style href="landing-scroll-v3" precedence="default">
        {REVEAL_CSS}
      </style>

      <div className="min-w-0">
        <div
          ref={plotRef}
          className="scroll-draw @container relative w-full overflow-hidden bg-paper"
          style={{ height: width ? height : undefined }}
          aria-busy={status === "loading"}
        >
          {!width && <div className="h-[288px] @[600px]:h-[320px] @[900px]:h-[360px]" />}
          {plate && shownSite && facts && (
            <PlateSvg
              plate={plate}
              key={`${dataSiteId}-${startMs}`}
              summary={summarize(shownSite.name, facts.stats.sunlit, facts.stats.earthVisible, facts.contacts)}
              dim={refreshing}
            />
          )}
          {!data && status === "loading" && width > 0 && (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[0.889rem] text-ink-2">
              Loading the 2027 Sun and Earth tracks for {selected?.name}
            </p>
          )}
          {status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-paper/90 px-6 text-center">
              <p className="text-[1rem] font-semibold text-ink">Could not load the tracks for {selected?.name}.</p>
              <p className="max-w-[46ch] text-[0.889rem] text-ink-2">
                The 2027 Sun, Earth and horizon files did not arrive. Check the connection and try again.
              </p>
              <button
                type="button"
                onClick={retry}
                className="h-10 border border-ink bg-paper px-4 text-[0.889rem] font-semibold text-ink transition-colors duration-150 hover:bg-paper-3"
              >
                Try again
              </button>
            </div>
          )}
          {refreshing && (
            <p className="absolute top-3 left-12 bg-paper px-2 py-1 text-[0.79rem] font-semibold tracking-[0.06em] text-ink uppercase">
              Loading {selected?.name}
            </p>
          )}
        </div>
        <Legend />
      </div>

      <Circumstances
        siteId={shownSite?.id ?? siteId}
        name={shownSite?.name ?? ""}
        coords={shownSite ? fmtLatLon(shownSite.lat, shownSite.lon) : ""}
        startMs={startMs}
        endMs={endMs}
        facts={facts}
      />

      <figcaption className="border-t border-ink px-4 py-3 text-[0.889rem] leading-[1.55] text-ink-2 sm:px-5 lg:col-span-2">
        <span className="font-semibold text-ink">Figure 1.</span> The view from 2 m above the center of{" "}
        {shownSite?.name ?? "the region"}. The filled shape is the ground. The paths are the Sun and Earth during the
        stay. Up is higher in the sky. Across is direction, from north, going clockwise.{" "}
        {plate && (
          <>
            Sun marks are every {plate.sun.tickHours === 1 ? "hour" : `${plate.sun.tickHours} hours`}
            {plate.earth ? `, Earth every ${plate.earth.tickHours} hours` : ""}. Dates are midnight UTC. The hills are
            drawn {plate.exaggeration.toFixed(1)}&times; taller so you can see them.
            {plate.earthOffView && " Earth is off this picture, so only its numbers are shown."}
          </>
        )}
      </figcaption>
    </figure>
  );
}

function summarize(name: string, sun: number, earth: number, contacts: Contact[]) {
  const events = contacts.map((c) => `${CONTACT_NAME[c.body][c.kind]} ${fmtDayTime(c.atMs)} UTC`).join(", ");
  return (
    `Horizon for ${name}. The Sun clears the hills for ${pct(sun)} of the stay, Earth for ${pct(earth)}.` +
    `${events ? ` ${events}.` : " Neither rises or sets during the stay."}`
  );
}

function PlateSvg({ plate, summary, dim }: { plate: Plate; summary: string; dim: boolean }) {
  const { inner, width, height } = plate;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={summary}
      className={`horizon-rise block transition-opacity duration-200 ${dim ? "opacity-50" : ""}`}
    >
      {/* Grid, drawn first so the terrain covers it below the horizon */}
      <g className="stroke-rule" strokeWidth={1} shapeRendering="crispEdges">
        {plate.grid.x.map((g) => (
          <line key={`gx${g.x}`} x1={g.x} x2={g.x} y1={inner.top} y2={inner.bottom} />
        ))}
        {plate.grid.y.map((g) => (
          <line
            key={`gy${g.y}`}
            x1={inner.left}
            x2={inner.right}
            y1={g.y}
            y2={g.y}
            className={g.zero ? "stroke-ink-3" : undefined}
            strokeDasharray={g.zero ? "4 3" : undefined}
          />
        ))}
      </g>

      <path d={plate.terrain} className="fill-paper-3" />
      <path d={plate.horizon} className="fill-none stroke-ink" strokeWidth={1.5} strokeLinejoin="round" />

      <g className="plate-reveal">
        {plate.earth && <Track track={plate.earth} body="earth" />}
        <Track track={plate.sun} body="sun" />

        {plate.contacts.map((m) => (
          <g key={`${m.contact.body}${m.contact.atMs}`}>
            {m.leader && (
              <path d={m.leader} className="fill-none stroke-ink-2" strokeWidth={1} strokeDasharray="1 2.5" />
            )}
            <circle cx={m.at.x} cy={m.at.y} r={4.5} className="fill-paper stroke-ink" strokeWidth={1.5} />
          </g>
        ))}

        {[...plate.contacts.flatMap((m) => m.labels), ...plate.labels].map((l, i) => (
          <text
            key={`${l.text}${i}`}
            x={l.x}
            y={l.y}
            textAnchor={l.anchor}
            className={`${HALO[l.halo]} text-[11px] tracking-[0.06em] [paint-order:stroke] [stroke-linejoin:round] ${l.weight === "bold" ? "font-bold" : "font-medium"} ${l.lead ? "fill-ink" : TONE[l.tone]}`}
            strokeWidth={3}
          >
            {l.lead && <tspan className={`font-bold ${TONE[l.tone]}`}>{l.lead} </tspan>}
            {l.text}
          </text>
        ))}

        {plate.earthOffView && (
          <OffView side={plate.earthOffView.side} azimuth={plate.earthOffView.azimuth} plate={plate} />
        )}
      </g>

      {/* Axes */}
      <line
        x1={inner.left}
        x2={inner.right}
        y1={inner.bottom}
        y2={inner.bottom}
        className="stroke-ink"
        strokeWidth={1}
        shapeRendering="crispEdges"
      />
      {plate.grid.y.map((g) => (
        <text
          key={`ly${g.y}`}
          x={inner.left - 7}
          y={g.y + 4}
          textAnchor="end"
          className="fill-ink-2 text-[11px] font-medium"
        >
          {g.label}
        </text>
      ))}
      {plate.grid.x.map((g) => (
        <text
          key={`lx${g.x}`}
          x={g.x}
          y={inner.bottom + 17}
          textAnchor="middle"
          className={`text-[11px] ${g.compass ? "fill-ink font-bold tracking-[0.06em]" : "fill-ink-2 font-medium"}`}
        >
          {g.label}
        </text>
      ))}
    </svg>
  );
}

function Track({ track, body }: { track: TrackGeometry; body: "sun" | "earth" }) {
  const sun = body === "sun";
  return (
    <g>
      {track.runs
        .filter((r) => !r.visible)
        .map((r, i) => (
          <path
            key={`h${i}`}
            d={r.d}
            className="fill-none stroke-umbra"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            strokeLinejoin="round"
          />
        ))}
      {track.runs
        .filter((r) => r.visible)
        .map((r, i) =>
          sun ? (
            <g key={`v${i}`}>
              <path d={r.d} className="fill-none stroke-sun-ink" strokeWidth={6} strokeLinejoin="round" />
              <path d={r.d} className="fill-none stroke-sun" strokeWidth={4} strokeLinejoin="round" />
            </g>
          ) : (
            <path key={`v${i}`} d={r.d} className="fill-none stroke-earth" strokeWidth={2.5} strokeLinejoin="round" />
          ),
        )}
      {track.ticks.map((t) => (
        <path
          key={`${t.size}${t.visible}`}
          d={t.d}
          className={`fill-none ${tickTone(sun, t.visible, t.size)}`}
          strokeWidth={t.size === "day" ? 1.5 : 1}
        />
      ))}
      {track.start.visible ? (
        <circle
          cx={track.start.x}
          cy={track.start.y}
          r={sun ? 5 : 4}
          className={sun ? "fill-sun stroke-sun-ink" : "fill-earth stroke-paper"}
          strokeWidth={1.5}
        />
      ) : (
        <circle cx={track.start.x} cy={track.start.y} r={3.5} className="fill-umbra" />
      )}
      <path
        d="M-7 -4.5 L1 0 L-7 4.5 Z"
        transform={`translate(${track.end.x} ${track.end.y}) rotate(${track.end.angle})`}
        className={track.end.visible ? (sun ? "fill-sun-ink" : "fill-earth") : "fill-umbra"}
      />
    </g>
  );
}

function tickTone(sun: boolean, visible: boolean, size: "minor" | "six" | "day") {
  if (!visible) return "stroke-umbra";
  if (!sun) return "stroke-earth";
  return size === "minor" ? "stroke-sun-ink" : "stroke-ink";
}

function OffView({ side, azimuth, plate }: { side: "left" | "right"; azimuth: number; plate: Plate }) {
  const { inner } = plate;
  const y = inner.top + 18;
  const right = side === "right";
  const x = right ? inner.right - 8 : inner.left + 8;
  const text = `EARTH, AZ ${azimuth}°`;
  return (
    <g>
      <text
        x={right ? x - 14 : x + 14}
        y={y + 4}
        textAnchor={right ? "end" : "start"}
        className="fill-earth stroke-paper text-[11px] font-bold tracking-[0.06em] [paint-order:stroke]"
        strokeWidth={3}
      >
        {text}
      </text>
      <path
        d={right ? `M${x - 10} ${y}h9m-3.5 -3.5 3.5 3.5 -3.5 3.5` : `M${x + 10} ${y}h-9m3.5 -3.5 -3.5 3.5 3.5 3.5`}
        className="fill-none stroke-earth"
        strokeWidth={1.5}
      />
    </g>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-rule px-4 py-2.5 text-[0.79rem] text-ink-2 sm:px-5">
      <li className="inline-flex items-center gap-2">
        <svg width="22" height="8" aria-hidden="true">
          <path d="M1 4h20" className="stroke-sun-ink" strokeWidth={6} />
          <path d="M1 4h20" className="stroke-sun" strokeWidth={4} />
        </svg>
        Sun clear of the hills
      </li>
      <li className="inline-flex items-center gap-2">
        <svg width="22" height="8" aria-hidden="true">
          <path d="M1 4h20" className="stroke-earth" strokeWidth={2.5} />
        </svg>
        Earth clear of the hills
      </li>
      <li className="inline-flex items-center gap-2">
        <svg width="22" height="8" aria-hidden="true">
          <path d="M1 4h20" className="stroke-umbra" strokeWidth={1.5} strokeDasharray="4 3" />
        </svg>
        Hidden by the hills
      </li>
      <li className="inline-flex items-center gap-2">
        <svg width="12" height="12" aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" className="fill-paper stroke-ink" strokeWidth={1.5} />
        </svg>
        Rise or set
      </li>
      <li className="inline-flex items-center gap-2">
        <svg width="22" height="10" aria-hidden="true">
          <rect x="1" y="4" width="20" height="6" className="fill-paper-3" />
          <path d="M1 4.25h20" className="stroke-ink" strokeWidth={1.5} />
        </svg>
        The ground
      </li>
    </ul>
  );
}

function Circumstances({
  siteId,
  name,
  coords,
  startMs,
  endMs,
  facts,
}: {
  siteId: string;
  name: string;
  coords: string;
  startMs: number;
  endMs: number;
  facts: { stats: ReturnType<typeof windowStats>; contacts: Contact[] } | null;
}) {
  const s = facts?.stats;
  const rows: [string, string, "sun" | "earth" | null][] = [
    ["Sunlight", s ? pct(s.sunlit) : "–", "sun"],
    ["Earth in view", s ? pct(s.earthVisible) : "–", "earth"],
    ["Longest dark stretch", s ? fmtSpell(s.longestDarkHours) : "–", null],
    ["Longest time without Earth", s ? fmtSpell(s.longestNoCommsHours) : "–", null],
  ];
  return (
    <div className="scroll-draw flex flex-col gap-5 border-t border-ink px-4 py-5 sm:grid sm:grid-cols-2 sm:gap-x-8 sm:px-5 lg:flex lg:border-t-0 lg:border-l">
      <div className="flex items-start justify-between gap-4 sm:col-span-2">
        <div>
          <h3 className="text-[1.266rem] leading-tight font-bold text-ink">{name || "\u00a0"}</h3>
          <p className="mt-1 text-[0.889rem] text-ink-2">{coords || "\u00a0"}</p>
          <p className="mt-3 text-[0.889rem] leading-snug">
            <span className="text-ink-2">Stay</span>
            <span className="block font-semibold text-ink tabular-nums">
              <span className="whitespace-nowrap">{fmtDayTime(startMs)}</span>{" "}
              <span className="font-normal text-ink-2">to</span>{" "}
              <span className="whitespace-nowrap">{fmtDayTime(endMs)}</span>
            </span>
          </p>
        </div>
        <Locator selectedId={siteId} />
      </div>

      <dl className="border-t border-ink" aria-live="polite">
        {rows.map(([k, v, swatch]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 border-b border-rule py-2">
            <dt className="inline-flex items-center gap-2 text-[0.889rem] text-ink-2">
              {swatch && (
                <span
                  aria-hidden="true"
                  className={`inline-block h-2 w-3.5 ${swatch === "sun" ? "border border-sun-ink bg-sun" : "bg-earth"}`}
                />
              )}
              {k}
            </dt>
            <dd className="text-[1.125rem] font-semibold text-ink tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <div>
        <h4 className="text-[0.79rem] font-semibold tracking-[0.08em] text-ink-2 uppercase">Rises and sets</h4>
        {facts && facts.contacts.length > 0 ? (
          <ol className="mt-2 border-t border-ink">
            {facts.contacts.map((c) => (
              <li
                key={`${c.body}${c.atMs}`}
                className="flex items-baseline justify-between gap-4 border-b border-rule py-1.5 text-[0.889rem]"
              >
                <span className={`font-semibold ${c.body === "sun" ? "text-sun-ink" : "text-earth"}`}>
                  {CONTACT_NAME[c.body][c.kind]}
                </span>
                <span className="text-ink tabular-nums">{fmtDayTime(c.atMs)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 border-t border-ink pt-2 text-[0.889rem] text-ink-2">
            {facts ? "Neither the Sun nor Earth rises or sets during this stay." : "\u00a0"}
          </p>
        )}
      </div>
    </div>
  );
}

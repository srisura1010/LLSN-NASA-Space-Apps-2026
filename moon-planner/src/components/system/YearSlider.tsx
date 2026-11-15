"use client";

// The year rail of the dock at the Moon and System levels ("All of 2027"): a
// hairline slider over the ephemeris span with month ticks, and the mission
// window shaded on it. Play and the time readout are the dock's.

import { DAY, HOUR, MONTHS, fmtFull } from "@/lib/format";

export default function YearRail({
  startMs,
  endMs,
  ms,
  windowMs,
  onScrub,
  describedBy,
}: {
  startMs: number;
  endMs: number;
  ms: number;
  windowMs?: { startMs: number; endMs: number };
  onScrub: (ms: number) => void;
  describedBy?: string;
}) {
  const pct = (t: number) => `${(Math.min(Math.max((t - startMs) / (endMs - startMs), 0), 1) * 100).toFixed(3)}%`;
  const year = new Date(startMs + DAY).getUTCFullYear();
  return (
    <div data-year-rail className="min-w-0">
      <div className="relative">
        {windowMs && (
          <span
            title="The mission window"
            className="pointer-events-none absolute top-[calc(50%-5px)] h-[10px] border-x border-ink bg-umbra-soft"
            style={{ left: pct(windowMs.startMs), width: `calc(${pct(windowMs.endMs)} - ${pct(windowMs.startMs)})` }}
          />
        )}
        <input
          type="range"
          className="system-range relative block w-full"
          min={startMs}
          max={endMs}
          step={HOUR}
          value={Math.round(Math.min(Math.max(ms, startMs), endMs))}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label={`Time in ${year}`}
          aria-valuetext={fmtFull(ms)}
          aria-describedby={describedBy}
        />
      </div>
      <div className="relative h-4" aria-hidden="true">
        {MONTHS.map((m, i) => (
          <span
            key={m}
            className="absolute top-0 border-l border-rule pl-1 text-[0.66rem] leading-4 font-medium tracking-[0.1em] text-ink-2 uppercase"
            style={{ left: pct(Date.UTC(year, i, 1)) }}
          >
            <span className={i % 2 ? "hidden sm:inline" : ""}>{m}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

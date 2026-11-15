"use client";

// The dock at the Moon and System levels: the same clock and Play as the site
// level's dock, with a rail that covers either the mission window (the site's
// Sun and Earth bands) or all of 2027 (the year rail). Scrubbing outside the
// window moves the levels' own time (the plan's systemMs).

import { useId } from "react";
import type { SiteData } from "@/lib/sky";
import { DATA_END_MS, DATA_START_MS } from "@/lib/mission";
import { isUp } from "@/lib/contacts";
import { fmtDayTime, fmtElapsed, fmtFull } from "@/lib/format";
import { PlayMark, Segmented, StateSwatch } from "../ui";
import TimelineStrip from "./TimelineStrip";
import YearRail from "../system/YearSlider";

export type ClockRange = "window" | "year";

export default function LevelClock({
  site,
  siteName,
  nowMs,
  startMs,
  endMs,
  range,
  onRange,
  playing,
  onTogglePlay,
  onScrub,
}: {
  site: SiteData | null;
  siteName: string;
  nowMs: number;
  startMs: number;
  endMs: number;
  range: ClockRange;
  onRange: (r: ClockRange) => void;
  playing: boolean;
  onTogglePlay: () => void;
  onScrub: (ms: number) => void;
}) {
  const readoutId = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-clock`;
  const inWindow = nowMs >= startMs && nowMs <= endMs;
  // A time outside the window (a year scrub, or a lift-off from the Launch mode) shows on the year rail.
  const shown: ClockRange = inWindow ? range : "year";
  const windowRail = shown === "window" && site;
  const playLabel = playing ? "Pause" : shown === "year" ? "Play through 2027" : "Play the window";
  return (
    <section aria-label="Time" data-dock className="relative shrink-0 border-t border-ink bg-paper px-4 pt-1.5 pb-2">
      {windowRail ? (
        <TimelineStrip
          site={site}
          siteName={siteName}
          startMs={startMs}
          endMs={endMs}
          nowMs={Math.min(Math.max(nowMs, startMs), endMs)}
          onScrub={onScrub}
          compact
          readout={false}
          describedBy={readoutId}
          className="w-full"
        />
      ) : (
        <YearRail startMs={DATA_START_MS} endMs={DATA_END_MS} ms={nowMs} windowMs={{ startMs, endMs }} onScrub={onScrub} describedBy={readoutId} />
      )}
      <div id={readoutId} className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-ink tabular-nums">
        <span className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-pressed={playing}
            title={playLabel}
            data-play
            className="inline-flex size-7 items-center justify-center border border-ink bg-paper text-ink max-md:size-11 transition-colors duration-150 hover:bg-paper-3 active:bg-umbra-soft"
          >
            <PlayMark playing={playing} />
            <span className="sr-only">{playLabel}</span>
          </button>
          <span className="font-semibold whitespace-nowrap" title={fmtFull(nowMs)} data-clock>
            {fmtDayTime(nowMs)} UTC
          </span>
          <span className="whitespace-nowrap text-ink-2">{inWindow ? fmtElapsed(nowMs - startMs) : "outside the mission window"}</span>
        </span>
        {site && inWindow ? (
          <span className="flex min-w-0 items-center gap-3 whitespace-nowrap" title={`At ${siteName}`}>
            <span className="hidden text-ink-2 2xl:inline">At {siteName}</span>
            {(["sun", "earth"] as const).map((b) => {
              const up = isUp(site, b, nowMs);
              return (
                <span key={b} className="inline-flex items-center gap-1.5">
                  <StateSwatch body={b} up={up} />
                  <span className={up ? "font-medium" : "font-semibold text-limit"}>
                    {b === "sun" ? (up ? "Sun up" : "Sun behind terrain") : up ? "Earth in view" : "Earth behind terrain"}
                  </span>
                </span>
              );
            })}
          </span>
        ) : null}
        <Segmented
          label="Time rail covers"
          value={shown}
          onChange={onRange}
          className="ml-auto [&_button]:h-7 [&_button]:px-2.5 max-md:[&_button]:h-11"
          options={[
            { id: "window", label: "Window" },
            { id: "year", label: "All 2027" },
          ]}
        />
      </div>
    </section>
  );
}

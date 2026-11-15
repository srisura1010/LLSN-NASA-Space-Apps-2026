"use client";

// The year rail shared by the System and Moon levels: a play button, a
// hairline slider over the ephemeris span with month ticks, and the mission
// window shaded on it.

import { useEffect, useRef } from "react";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Playback covers this much time per millisecond: six days each second. */
const PLAY_RATE = (6 * DAY) / 1000;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtUtc(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** While playing, advances the caller's clock from wherever it is now and wraps at the end of the span. */
export function useYearPlayback(playing: boolean, span: { startMs: number; endMs: number } | null, ms: number, onScrub?: (ms: number) => void) {
  const clock = useRef(ms);
  useEffect(() => {
    clock.current = ms;
  }, [ms]);
  const startMs = span?.startMs;
  const endMs = span?.endMs;
  useEffect(() => {
    if (!playing || startMs == null || endMs == null || !onScrub) return;
    let raf = 0;
    let last = performance.now();
    let t = clock.current;
    const tick = (now: number) => {
      t += Math.min(now - last, 100) * PLAY_RATE;
      last = now;
      if (t > endMs) t = startMs;
      onScrub(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, startMs, endMs, onScrub]);
}

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true" fill="currentColor">
      {playing ? <path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" /> : <path d="M4 2.5 13 8l-9 5.5z" />}
    </svg>
  );
}

export default function YearSlider({
  startMs,
  endMs,
  ms,
  windowMs,
  playing,
  onPlay,
  onScrub,
}: {
  startMs: number;
  endMs: number;
  ms: number;
  windowMs?: { startMs: number; endMs: number };
  playing: boolean;
  onPlay: () => void;
  onScrub: (ms: number) => void;
}) {
  const pct = (t: number) => `${(Math.min(Math.max((t - startMs) / (endMs - startMs), 0), 1) * 100).toFixed(3)}%`;
  const year = new Date(startMs + DAY).getUTCFullYear();
  return (
    <div className="flex items-start gap-3 border-t border-ink bg-paper-2 px-4 pt-3 pb-2">
      <button
        type="button"
        onClick={onPlay}
        aria-label={playing ? "Pause" : `Play through ${year}`}
        className="grid size-9 shrink-0 place-items-center border border-ink text-ink transition-colors duration-150 hover:bg-paper-3"
      >
        <PlayIcon playing={playing} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="relative">
          {windowMs && (
            <span
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
            value={Math.round(ms)}
            onChange={(e) => onScrub(Number(e.target.value))}
            aria-label={`Time in ${year}`}
            aria-valuetext={fmtUtc(ms)}
          />
        </div>
        <div className="relative mt-0.5 h-4" aria-hidden="true">
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
        {windowMs && <p className="mt-1 text-[0.75rem] text-ink-2">The shaded span is the mission window set in the Navigator.</p>}
      </div>
    </div>
  );
}

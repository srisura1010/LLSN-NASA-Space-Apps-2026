"use client";

import { memo, useId, useState, type ReactNode } from "react";
import type { MissionScore } from "@/lib/sky";
import { fmtDuration } from "./plot/format";
import { isCustomSiteSupported } from "@/lib/customSite";
import {
  AlertMark,
  SelectField,
  fieldControl,
  fieldLabel,
  pct,
  primaryButton,
  smallButton,
  spell,
} from "./SiteBulletin";

export type RankedRow = {
  id: string;
  name: string;
  custom?: boolean;
  score: MissionScore;
  /** Shared rank for ties (1, 2, 3, 3, 5). */
  rank: number;
  /** Rank in the planned window before the last slip or search, when there is one. */
  prevRank: number | null;
};

export const GAP_LIMITS = [12, 24, 48, 72, 96, 168];

const COLS = "grid grid-cols-[1.25rem_minmax(0,1fr)_2.5rem_2.75rem_3.75rem] gap-x-2";

type Props = {
  rows: RankedRow[];
  /** True until the nine regions have loaded. */
  loading: boolean;
  /** Rows still computing (the custom site). */
  pending: { id: string; name: string }[];
  failed: { id: string; name: string; message: string }[];
  onRetry: (id: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  limitHours: number;
  onLimitChange: (hours: number) => void;
  windowLabel: string;
  /** Change note shown above the table after a slip or search. */
  note?: ReactNode;
  className?: string;
};

function RankShift({ rank, prevRank }: { rank: number; prevRank: number | null }) {
  if (prevRank === null || prevRank === rank) return null;
  const up = rank < prevRank;
  const by = Math.abs(prevRank - rank);
  return (
    <span className="mt-0.5 flex items-center gap-0.5 text-[0.75rem] font-medium text-ink-2">
      <svg viewBox="0 0 8 8" aria-hidden="true" className="size-2">
        <path d={up ? "M4 1.25 7.25 6.5H.75Z" : "M4 6.75.75 1.5h6.5Z"} className="fill-ink-2" />
      </svg>
      <span aria-hidden="true">{by}</span>
      <span className="sr-only">
        , {up ? "up" : "down"} from rank {prevRank} in the plan
      </span>
    </span>
  );
}

function ShareBar({ sun, earth }: { sun: number; earth: number }) {
  return (
    <span aria-hidden="true" className="mt-1.5 flex w-full max-w-[9.5rem] flex-col gap-px">
      <span className="block h-[3px] bg-umbra-soft">
        <span className="block h-full bg-sun" style={{ width: `${Math.round(sun * 1000) / 10}%` }} />
      </span>
      <span className="block h-[3px] bg-umbra-soft">
        <span className="block h-full bg-earth" style={{ width: `${Math.round(earth * 1000) / 10}%` }} />
      </span>
    </span>
  );
}

function Flagged({ flagged, value, note }: { flagged: boolean; value: string; note: string }) {
  if (!flagged) return <>{value}</>;
  return (
    <span className="inline-flex items-center justify-end gap-1 font-semibold text-limit">
      <AlertMark className="size-3" />
      {value}
      <span className="sr-only">, {note}</span>
    </span>
  );
}

function SkeletonRows() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className={`${COLS} items-center border-b border-rule px-4 py-3`}>
          <span className="h-3.5 w-3 bg-paper-3 motion-safe:animate-pulse" />
          <span className="flex flex-col gap-1.5">
            <span className="h-3.5 bg-paper-3 motion-safe:animate-pulse" style={{ width: `${55 + ((i * 37) % 35)}%` }} />
            <span className="h-[7px] w-24 bg-paper-3 motion-safe:animate-pulse" />
          </span>
          <span className="ml-auto h-3.5 w-7 bg-paper-3 motion-safe:animate-pulse" />
          <span className="ml-auto h-3.5 w-7 bg-paper-3 motion-safe:animate-pulse" />
          <span className="ml-auto h-3.5 w-10 bg-paper-3 motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function RegionTable({
  rows,
  loading,
  pending,
  failed,
  onRetry,
  selectedId,
  onSelect,
  limitHours,
  onLimitChange,
  windowLabel,
  note,
  className = "",
}: Props) {
  const id = useId();
  const limitText = `longer than the ${fmtDuration(limitHours)} gap limit`;
  const anyFlagged = rows.some(
    (r) => r.score.longestDarkHours > limitHours || r.score.longestNoCommsHours > limitHours,
  );

  return (
    <section aria-labelledby={`${id}-title`} className={className}>
      <header className="px-4 pt-4 pb-3">
        <h2 id={`${id}-title`} className="text-[1.068rem] font-semibold leading-tight text-ink">
          Regions ranked for this window
        </h2>
        <p className="mt-1 text-[0.844rem] text-ink-2 tabular-nums">{windowLabel}</p>
      </header>

      {note && <div className="px-4 pb-3">{note}</div>}

      <div
        aria-hidden="true"
        className={`${COLS} items-end border-b border-ink px-4 pb-1.5 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-ink-2`}
      >
        <span>#</span>
        <span>Region</span>
        <span className="text-right">Sun</span>
        <span className="text-right">Earth</span>
        <span className="text-right leading-tight">Longest dark</span>
      </div>

      {loading ? (
        <>
          <p role="status" className="sr-only">
            Loading Sun and Earth tracks for the nine regions
          </p>
          <SkeletonRows />
        </>
      ) : (
        <ol aria-label="Regions, best first. Select one to plot it.">
          {rows.map((r) => {
            const selected = r.id === selectedId;
            const darkOver = r.score.longestDarkHours > limitHours;
            const commsOver = r.score.longestNoCommsHours > limitHours;
            return (
              <li key={r.id} className="border-b border-rule">
                <button
                  type="button"
                  onClick={() => onSelect(r.id)}
                  aria-current={selected ? "true" : undefined}
                  className={`${COLS} w-full items-start px-4 py-2 text-left transition-colors duration-150 focus-visible:outline-offset-[-2px] ${
                    selected
                      ? "bg-paper shadow-[inset_0_0_0_1px_var(--color-ink)]"
                      : "hover:bg-paper active:bg-paper-3"
                  }`}
                >
                  <span className="flex flex-col text-[0.95rem] font-semibold tabular-nums text-ink">
                    <span>
                      <span className="sr-only">Rank </span>
                      {r.rank}
                    </span>
                    <RankShift rank={r.rank} prevRank={r.prevRank} />
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[0.95rem] leading-snug text-ink ${selected ? "font-semibold" : "font-medium"}`}>
                      <span className="sr-only">, </span>
                      {r.name}
                      {r.custom && (
                        <span className="ml-1.5 border border-ink-2 px-1 align-[0.1em] text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-ink-2">
                          <span className="sr-only">, </span>
                          Custom
                        </span>
                      )}
                    </span>
                    <ShareBar sun={r.score.sunlit} earth={r.score.earthVisible} />
                  </span>
                  <span className="text-right text-[0.844rem] font-medium tabular-nums text-ink">
                    <span className="sr-only">, Sun up </span>
                    {pct(r.score.sunlit)}
                  </span>
                  <span className="text-right text-[0.844rem] font-medium tabular-nums text-ink">
                    <span className="sr-only">, Earth in view </span>
                    <Flagged
                      flagged={commsOver}
                      value={pct(r.score.earthVisible)}
                      note={`comms gap of ${spell(r.score.longestNoCommsHours)}, ${limitText}`}
                    />
                  </span>
                  <span className="text-right text-[0.844rem] font-medium tabular-nums whitespace-nowrap text-ink">
                    <span className="sr-only">, longest dark </span>
                    <Flagged flagged={darkOver} value={spell(r.score.longestDarkHours)} note={limitText} />
                  </span>
                </button>
              </li>
            );
          })}
          {pending.map((p) => (
            <li key={p.id} className="border-b border-rule" aria-busy="true">
              <div className={`${COLS} items-center px-4 py-2.5`}>
                <span className="h-3.5 w-3 bg-paper-3 motion-safe:animate-pulse" aria-hidden="true" />
                <span className="min-w-0 text-[0.95rem] font-medium text-ink">
                  {p.name}
                  <span className="mt-0.5 block text-[0.75rem] font-normal text-ink-2">
                    Computing horizon and tracks for this window
                  </span>
                </span>
                <span className="ml-auto h-3.5 w-7 bg-paper-3 motion-safe:animate-pulse" aria-hidden="true" />
                <span className="ml-auto h-3.5 w-7 bg-paper-3 motion-safe:animate-pulse" aria-hidden="true" />
                <span className="ml-auto h-3.5 w-10 bg-paper-3 motion-safe:animate-pulse" aria-hidden="true" />
              </div>
            </li>
          ))}
        </ol>
      )}

      {failed.length > 0 && (
        <div role="alert" className="border-b border-rule px-4 py-3">
          {failed.map((f) => (
            <p key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1 text-[0.844rem] text-ink">
              <span>
                {f.name} did not load ({f.message}). It is left out of the ranking.
              </span>
              <button type="button" onClick={() => onRetry(f.id)} className={smallButton}>
                Try again
              </button>
            </p>
          ))}
        </div>
      )}

      <div className="space-y-2.5 px-4 py-3 text-[0.844rem] text-ink-2">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span aria-hidden="true" className="flex w-5 flex-col gap-px">
            <span className="block h-[3px] bg-sun" />
            <span className="block h-[3px] bg-earth" />
          </span>
          Bars: share of the window with the Sun up, then with Earth in view.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <label htmlFor={`${id}-limit`} className="flex items-center gap-2">
            Flag gaps longer than
            <SelectField
              id={`${id}-limit`}
              value={limitHours}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              wrapClassName="w-[5.5rem]"
              className="text-[0.844rem] tabular-nums"
            >
              {GAP_LIMITS.map((h) => (
                <option key={h} value={h}>
                  {fmtDuration(h)}
                </option>
              ))}
            </SelectField>
          </label>
          <span className="flex items-center gap-1.5">
            <AlertMark className="size-3" />
            {anyFlagged ? "Dark spell or comms gap over the limit" : "No region goes over the limit"}
          </span>
        </div>
      </div>
    </section>
  );
}

export default memo(RegionTable);

// ---------- Custom site ----------

export type CustomSiteState = {
  lat: number;
  lon: number;
  status: "loading" | "ready" | "error";
  message?: string;
} | null;

type CustomFormProps = {
  state: CustomSiteState;
  onSubmit: (lat: number, lon: number) => void;
  onRemove: () => void;
  className?: string;
};

/** Accepts "-85.5", "−85.5", "85.5 S", "85.5° S"; returns null when it is not a number. */
function parseAngle(text: string, negative: "S" | "W"): number | null {
  const t = text.trim().replace("−", "-").replace(",", ".").replace(/°/g, "").toUpperCase();
  const m = /^([+-]?\d+(?:\.\d+)?)\s*([NSEW])?$/.exec(t);
  if (!m) return null;
  let v = Number(m[1]);
  if (m[2] === negative) v = -Math.abs(v);
  return v;
}

type Problem = { field: "lat" | "lon"; message: string };

function validate(latText: string, lonText: string): { lat: number; lon: number } | Problem {
  if (latText.trim() === "") return { field: "lat", message: "Enter a latitude, for example −85.5 (south is negative)." };
  const lat = parseAngle(latText, "S");
  if (lat === null)
    return { field: "lat", message: "Latitude must be a number of degrees, for example −85.5 or 85.5 S." };
  if (lat > 0)
    return { field: "lat", message: "The terrain covers the south pole only. Use a negative latitude between −80 and −90." };
  if (lat < -90) return { field: "lat", message: "Latitude stops at −90, the pole. Enter a value between −80 and −90." };
  if (lat > -80)
    return {
      field: "lat",
      message: `${lat.toFixed(2)}° is outside the terrain, which ends at 80° S. Enter a latitude between −80 and −90.`,
    };
  if (lonText.trim() === "") return { field: "lon", message: "Enter a longitude, for example 30 (east positive) or 45 W." };
  const lon = parseAngle(lonText, "W");
  if (lon === null) return { field: "lon", message: "Longitude must be a number of degrees, for example 30 or 45 W." };
  if (lon < -180 || lon > 360)
    return { field: "lon", message: "Longitude runs from −180 to 180 degrees east. Enter a value in that range." };
  const lonNorm = lon > 180 ? lon - 360 : lon;
  const supported = isCustomSiteSupported(lat, lonNorm);
  if (!supported.ok)
    return {
      field: "lat",
      message: supported.reason ?? "That point is outside the terrain data. Pick a point between 80° S and the pole.",
    };
  return { lat, lon: lonNorm };
}

export function CustomSiteForm({ state, onSubmit, onRemove, className = "" }: CustomFormProps) {
  const id = useId();
  const [latText, setLatText] = useState(() => (state ? String(state.lat) : ""));
  const [lonText, setLonText] = useState(() => (state ? String(state.lon) : ""));
  const [problem, setProblem] = useState<Problem | null>(null);
  const busy = state?.status === "loading";

  function submit() {
    const r = validate(latText, lonText);
    if ("message" in r) {
      setProblem(r);
      return;
    }
    setProblem(null);
    onSubmit(r.lat, r.lon);
  }

  const errorId = `${id}-error`;
  return (
    <section aria-labelledby={`${id}-title`} className={`px-4 py-4 ${className}`}>
      <h3 id={`${id}-title`} className="text-[0.95rem] font-semibold text-ink">
        Add a custom site
      </h3>
      <p className="mt-1 max-w-[42ch] text-[0.844rem] leading-snug text-ink-2">
        Any point from 80&deg; S to the pole. Its horizon comes from the LOLA heightmap and its Sun and Earth tracks from
        JPL Horizons, so it takes a few seconds.
      </p>
      <form
        noValidate
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <label htmlFor={`${id}-lat`} className={fieldLabel}>
            Latitude
          </label>
          <input
            id={`${id}-lat`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. −85.5"
            value={latText}
            onChange={(e) => setLatText(e.target.value)}
            aria-invalid={problem?.field === "lat" || undefined}
            aria-describedby={problem?.field === "lat" ? errorId : undefined}
            className={`${fieldControl} mt-1 w-[6.5rem] tabular-nums placeholder:text-ink-2`}
          />
        </div>
        <div>
          <label htmlFor={`${id}-lon`} className={fieldLabel}>
            Longitude, east
          </label>
          <input
            id={`${id}-lon`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. 31.2"
            value={lonText}
            onChange={(e) => setLonText(e.target.value)}
            aria-invalid={problem?.field === "lon" || undefined}
            aria-describedby={problem?.field === "lon" ? errorId : undefined}
            className={`${fieldControl} mt-1 w-[6.5rem] tabular-nums placeholder:text-ink-2`}
          />
        </div>
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? "Computing" : state?.status === "error" ? "Try again" : state ? "Replace site" : "Add site"}
        </button>
        {state && !busy && (
          <button type="button" onClick={onRemove} className={smallButton}>
            Remove
          </button>
        )}
      </form>
      <div aria-live="polite">
        {problem && (
          <p id={errorId} className="mt-2 max-w-[44ch] text-[0.844rem] font-medium leading-snug text-ink">
            {problem.message}
          </p>
        )}
        {!problem && busy && (
          <p className="mt-2 text-[0.844rem] text-ink-2">
            Computing the terrain horizon and fetching Sun and Earth tracks for {state.lat.toFixed(2)}, {state.lon.toFixed(2)}.
          </p>
        )}
        {!problem && state?.status === "error" && (
          <p className="mt-2 max-w-[44ch] text-[0.844rem] font-medium leading-snug text-ink">
            {state.message ?? "The custom site could not be computed. Check the connection and try again."}
          </p>
        )}
      </div>
    </section>
  );
}

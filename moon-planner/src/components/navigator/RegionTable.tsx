"use client";

import { memo, useId, useState } from "react";
import type { MissionScore } from "@/lib/sky";
import { fmtDuration } from "@/lib/format";
import { validateSitePoint } from "@/lib/customSite";
import { parseCoordinate } from "@/lib/anySite";
import { pct, fmtSpell } from "@/lib/format";
import { AlertMark, SelectField, fieldControl, fieldLabel, buttonClass } from "../ui";

export type RankedRow = {
  id: string;
  name: string;
  custom?: boolean;
  /** A custom site's terrain source when it is not the polar LOLA grids, shown after "Custom". */
  tag?: string;
  score: MissionScore;
  /** Shared rank for ties (1, 2, 3, 3, 5). */
  rank: number;
  /** Rank in the planned window before the last slip or search, when there is one. */
  prevRank: number | null;
};

export { GAP_LIMITS } from "@/lib/mission";
import { GAP_LIMITS } from "@/lib/mission";

/** Rank, region (name, then Sun, Earth and longest dark on a second line), score with its bar, gap warning. */
const COLS = "grid grid-cols-[1.25rem_minmax(0,1fr)_3rem_1rem] gap-x-2";

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

/** The score out of 1, with a bar of the same length under it. */
function ScoreCell({ score }: { score: number }) {
  const w = Math.max(0, Math.min(1, score));
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="text-[0.95rem] font-semibold tabular-nums text-ink">
        <span className="sr-only">, score </span>
        {score.toFixed(2)}
      </span>
      <span aria-hidden="true" className="block h-[4px] w-full bg-umbra-soft">
        <span className="block h-full bg-ink" style={{ width: `${Math.round(w * 1000) / 10}%` }} />
      </span>
    </span>
  );
}

/** A drawn warning triangle for a dark spell or comms gap over the limit, named for screen readers and on hover. */
function GapWarning({ text }: { text: string | null }) {
  if (!text) return <span aria-hidden="true" />;
  return (
    <span role="img" aria-label={text} title={text} className="mt-[0.2rem] flex justify-center">
      <AlertMark className="size-3.5" />
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
          <span className="ml-auto h-3.5 w-8 bg-paper-3 motion-safe:animate-pulse" />
          <span />
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
      </header>

      <div
        aria-hidden="true"
        className={`${COLS} items-end border-b border-ink px-4 pb-1.5 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-ink-2`}
      >
        <span>#</span>
        <span>Region</span>
        <span className="text-right">Score</span>
        <span />
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
            const warning =
              darkOver || commsOver
                ? [
                    darkOver ? `Dark spell of ${fmtSpell(r.score.longestDarkHours)}` : null,
                    commsOver ? `comms gap of ${fmtSpell(r.score.longestNoCommsHours)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" and ")
                    .replace(/^c/, "C") + `, ${limitText}`
                : null;
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
                    <span className={`block text-[0.95rem] leading-snug text-balance text-ink ${selected ? "font-semibold" : "font-medium"}`}>
                      <span className="sr-only">, </span>
                      {r.name}
                      {r.custom && (
                        <span className="ml-1.5 border border-ink-2 px-1 align-[0.1em] text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-ink-2">
                          <span className="sr-only">, </span>
                          Custom
                        </span>
                      )}
                      {r.tag && <span className="block text-[0.75rem] font-normal text-ink-2">Terrain: {r.tag}</span>}
                    </span>
                    <span className="mt-0.5 block text-[0.75rem] leading-snug text-ink-2 tabular-nums">
                      <span className="sr-only">, </span>
                      <span>Sun {pct(r.score.sunlit)}</span>
                      <span aria-hidden="true"> · </span>
                      <span className={commsOver ? "font-semibold text-ink" : ""}>
                        <span className="sr-only">, </span>Earth {pct(r.score.earthVisible)}
                      </span>
                      <span aria-hidden="true"> · </span>
                      <span className={`whitespace-nowrap ${darkOver ? "font-semibold text-ink" : ""}`}>
                        <span className="sr-only">, </span>dark {fmtSpell(r.score.longestDarkHours)}
                      </span>
                    </span>
                  </span>
                  <ScoreCell score={r.score.score} />
                  <GapWarning text={warning} />
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
                <span className="ml-auto h-3.5 w-8 bg-paper-3 motion-safe:animate-pulse" aria-hidden="true" />
                <span aria-hidden="true" />
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
              <button type="button" onClick={() => onRetry(f.id)} className={buttonClass.secondary}>
                Try again
              </button>
            </p>
          ))}
        </div>
      )}

      <div className="space-y-2.5 px-4 py-3 text-[0.844rem] text-ink-2">
        <p>Score, 0 to 1: mean Sun power 45%, Earth in view 30%, a short longest dark spell 25%.</p>
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

type Problem = { field: "lat" | "lon"; message: string };

/** Reads the two boxes ("-85.5", "85.5 S", "31.2", "45 W") and applies the site-level rule (validateSitePoint). */
function validate(latText: string, lonText: string): { lat: number; lon: number } | Problem {
  const a = parseCoordinate(latText, "lat");
  if (!a.ok) return { field: "lat", message: a.message };
  const b = parseCoordinate(lonText, "lon");
  if (!b.ok) return { field: "lon", message: b.message };
  const v = validateSitePoint(a.value, b.value);
  return v.ok ? { lat: v.lat, lon: v.lon } : { field: v.field, message: v.reason };
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
        Any point on the Moon up to 0.1&deg; from either pole; it takes a few seconds. From 80&deg; S to the south
        pole the horizon comes from the LOLA 80 m and 640 m grids and the tracks from JPL Horizons. Elsewhere the
        terrain is fetched from NASA Moon Trek on a coarser 240 m or 300 m grid, so times near a grazing Sun are
        approximate.
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
            placeholder="e.g. 85.5 S"
            value={latText}
            onChange={(e) => setLatText(e.target.value)}
            aria-invalid={problem?.field === "lat" || undefined}
            aria-describedby={problem?.field === "lat" ? errorId : undefined}
            className={`${fieldControl} mt-1 w-[6.5rem] tabular-nums placeholder:text-ink-2`}
          />
        </div>
        <div>
          <label htmlFor={`${id}-lon`} className={fieldLabel}>
            Longitude
          </label>
          <input
            id={`${id}-lon`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. 31.2 E"
            value={lonText}
            onChange={(e) => setLonText(e.target.value)}
            aria-invalid={problem?.field === "lon" || undefined}
            aria-describedby={problem?.field === "lon" ? errorId : undefined}
            className={`${fieldControl} mt-1 w-[6.5rem] tabular-nums placeholder:text-ink-2`}
          />
        </div>
        <button type="submit" disabled={busy} className={buttonClass.primary}>
          {busy ? "Computing" : state?.status === "error" ? "Try again" : state ? "Replace site" : "Add site"}
        </button>
        {state && !busy && (
          <button type="button" onClick={onRemove} className={buttonClass.secondary}>
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
            {state.lat > -80 ? "Fetching the terrain from NASA Moon Trek and tracing the horizon for" : "Computing the terrain horizon and fetching Sun and Earth tracks for"}{" "}
            {state.lat.toFixed(2)}, {state.lon.toFixed(2)}.
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

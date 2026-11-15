"use client";

// The "At this point" section of the Moon level: Sun and Earth over the
// mission window at any point picked on the globe or typed in, measured
// against a smooth horizon (src/lib/anySite.ts).

import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { SMOOTH_LABEL, parseCoordinate, type SmoothSiteData } from "@/lib/anySite";
import { isCustomSiteSupported } from "@/lib/customSite";
import { sampleAt, windowStats } from "@/lib/sky";
import { fmtLength, fmtSpan } from "../navigator/MissionControls";
import { fieldControl, fieldLabel, pct, primaryButton, smallButton, spell } from "../navigator/SiteBulletin";
import TimelineStrip from "../navigator/TimelineStrip";
import { isUpAt, nextContact } from "../navigator/plot/contacts";
import { fmtDayTime, fmtSigned } from "../navigator/plot/format";

export type PickedPoint = { lat: number; lon: number };
export type QuickPick = { id: string; name: string; lat: number; lon: number };

const HOUR = 3_600_000;
const H3 = "border-b border-ink pb-1.5 text-[0.75rem] font-semibold tracking-[0.08em] text-ink uppercase";
const GROUP = "pt-3 pb-1 text-left text-[0.75rem] font-semibold tracking-[0.06em] text-ink-2 uppercase";

const fmtLat = (v: number) => `${Math.abs(v).toFixed(2)}° ${v < 0 ? "S" : "N"}`;
const fmtLon = (v: number) => `${Math.abs(v).toFixed(2)}° ${v < 0 ? "W" : "E"}`;
/** The text put back in the entry boxes for a point: a number and a letter, as the form reads them. */
const boxLat = (v: number) => `${Number(Math.abs(v).toFixed(4))} ${v < 0 ? "S" : "N"}`;
const boxLon = (v: number) => `${Number(Math.abs(v).toFixed(4))} ${v < 0 ? "W" : "E"}`;

function Row({ label, name, value, note }: { label: string; name: string; value: ReactNode; note?: ReactNode }) {
  return (
    <tr className="border-b border-rule align-baseline">
      <th scope="row" className="py-1.5 pr-3 text-left text-[0.844rem] font-normal whitespace-nowrap text-ink-2">
        {label}
      </th>
      <td data-pt={name} className="py-1.5 text-right text-[0.95rem] font-semibold whitespace-nowrap text-ink tabular-nums">
        {value}
        {note && <span className="block text-[0.8rem] font-normal whitespace-normal text-ink-2">{note}</span>}
      </td>
    </tr>
  );
}

function EntryForm({ point, onSet }: { point: PickedPoint | null; onSet: (lat: number, lon: number) => void }) {
  const id = useId();
  const [lat, setLat] = useState(point ? boxLat(point.lat) : "");
  const [lon, setLon] = useState(point ? boxLon(point.lon) : "");
  const [errors, setErrors] = useState<{ lat?: string; lon?: string }>({});
  function submit(e: FormEvent) {
    e.preventDefault();
    const a = parseCoordinate(lat, "lat");
    const b = parseCoordinate(lon, "lon");
    setErrors({ lat: a.ok ? undefined : a.message, lon: b.ok ? undefined : b.message });
    if (a.ok && b.ok) onSet(a.value, b.value);
  }
  return (
    <form onSubmit={submit} noValidate className="mt-3">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-lat`} className={fieldLabel}>
            Latitude
          </label>
          <input
            id={`${id}-lat`}
            name="point-lat"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.67 N"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            aria-invalid={errors.lat ? true : undefined}
            aria-describedby={errors.lat ? `${id}-lat-err` : undefined}
            className={`${fieldControl} mt-1 w-full tabular-nums placeholder:text-ink-3`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-lon`} className={fieldLabel}>
            Longitude
          </label>
          <input
            id={`${id}-lon`}
            name="point-lon"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="23.47 E"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            aria-invalid={errors.lon ? true : undefined}
            aria-describedby={errors.lon ? `${id}-lon-err` : undefined}
            className={`${fieldControl} mt-1 w-full tabular-nums placeholder:text-ink-3`}
          />
        </div>
        <button type="submit" className={primaryButton}>
          Set point
        </button>
      </div>
      {(errors.lat || errors.lon) && (
        <div role="alert" className="mt-2 space-y-1 text-[0.844rem] leading-snug font-medium text-limit">
          {errors.lat && <p id={`${id}-lat-err`}>{errors.lat}</p>}
          {errors.lon && <p id={`${id}-lon-err`}>{errors.lon}</p>}
        </div>
      )}
      <p className="mt-1.5 text-[0.8rem] leading-snug text-ink-2">Degrees with N, S, E or W, or signed: south and west are negative.</p>
    </form>
  );
}

export default function PointPanel({
  point,
  site,
  nowMs,
  windowMs,
  onScrub,
  onSet,
  onClear,
  onTerrain,
  onCompare,
  quickPicks,
  className = "",
}: {
  point: PickedPoint | null;
  /** The smooth-horizon tracks for the point; null while the ephemeris loads. */
  site: SmoothSiteData | null;
  nowMs: number;
  windowMs?: { startMs: number; endMs: number };
  onScrub?: (ms: number) => void;
  /** A point typed in or chosen from the quick picks. */
  onSet: (lat: number, lon: number) => void;
  onClear: () => void;
  onTerrain?: (lat: number, lon: number) => void;
  onCompare?: () => void;
  quickPicks: QuickPick[];
  className?: string;
}) {
  const stats = useMemo(() => (site && windowMs ? windowStats(site, windowMs.startMs, windowMs.endMs) : null), [site, windowMs]);
  const now = useMemo(() => {
    if (!site) return null;
    const s = sampleAt(site, nowMs);
    const sunUp = isUpAt(site, "sun", nowMs);
    const earthUp = isUpAt(site, "earth", nowMs);
    return { s, sunUp, earthUp, sunNext: nextContact(site, "sun", nowMs), earthNext: nextContact(site, "earth", nowMs) };
  }, [site, nowMs]);
  // South of 80° S the site level uses the polar LOLA grids; anywhere else it fetches terrain from NASA Moon Trek.
  const polar = !!point && point.lat <= -80;
  const terrain = point ? (polar ? isCustomSiteSupported(point.lat, point.lon) : { ok: true, reason: undefined }) : null;
  const year = site ? new Date(site.sky.startMs).getUTCFullYear() : 2027;

  return (
    <div className={className}>
      <h3 className={H3}>At this point</h3>
      {!point && (
        <p className="mt-2 text-[0.844rem] leading-snug text-ink-2">
          Read the Sun and Earth anywhere on the Moon for the mission window. Turn on Pick a point and click the globe,
          shift-click it at any time, or type the coordinates.
        </p>
      )}

      {point && (
        <>
          <table className="w-full border-collapse">
            <tbody>
              <Row label="Position" name="position" value={`${fmtLat(point.lat)}, ${fmtLon(point.lon)}`} />
              {stats && windowMs && (
                <>
                  <tr>
                    <th colSpan={2} scope="colgroup" className={GROUP}>
                      Window: {fmtSpan(windowMs.startMs, windowMs.endMs)}, {fmtLength((windowMs.endMs - windowMs.startMs) / HOUR)}
                    </th>
                  </tr>
                  <Row label="Sun up" name="sun-up" value={pct(stats.sunlit)} />
                  <Row label="Earth in view" name="earth-up" value={pct(stats.earthVisible)} />
                  <Row label="Longest dark" name="dark" value={spell(stats.longestDarkHours)} />
                  <Row label="Longest without Earth" name="no-earth" value={spell(stats.longestNoCommsHours)} />
                </>
              )}
              {now && (
                <>
                  <tr>
                    <th colSpan={2} scope="colgroup" className={GROUP}>
                      At the time shown
                    </th>
                  </tr>
                  <Row label="Sun elevation" name="sun-el" value={fmtSigned(now.s.sunEl, 2)} note={now.sunUp ? "up" : "below the horizon"} />
                  <Row
                    label={now.sunUp ? "Next sunset" : "Next sunrise"}
                    name="sun-next"
                    value={now.sunNext ? `${fmtDayTime(now.sunNext.ms)} UTC` : `None in ${year}`}
                  />
                  <Row label="Earth elevation" name="earth-el" value={fmtSigned(now.s.earthEl, 2)} note={now.earthUp ? "in view" : "below the horizon"} />
                  <Row
                    label={now.earthUp ? "Next Earthset" : "Next Earthrise"}
                    name="earth-next"
                    value={now.earthNext ? `${fmtDayTime(now.earthNext.ms)} UTC` : `None in ${year}`}
                    note={now.earthNext ? undefined : now.earthUp ? "Earth stays in view from here" : "Earth is never in view from here"}
                  />
                </>
              )}
            </tbody>
          </table>
          {!site && (
            <p role="status" className="mt-2 text-[0.844rem] text-ink-2">
              Computing the Sun and Earth for this point
            </p>
          )}

          {site && windowMs && (
            <TimelineStrip
              site={site}
              siteName={`${fmtLat(point.lat)}, ${fmtLon(point.lon)}`}
              startMs={windowMs.startMs}
              endMs={windowMs.endMs}
              nowMs={nowMs}
              onScrub={onScrub ?? (() => undefined)}
              compact
              readout={false}
              className="mt-3 w-full"
            />
          )}

          <div data-pt="caveat" className="mt-3 border border-ink px-2.5 py-2">
            <p className="text-[0.844rem] leading-snug font-semibold text-ink">{SMOOTH_LABEL}</p>
            <p className="mt-1 text-[0.8rem] leading-snug text-ink-2">
              The horizon is a smooth sphere seen from a 2 m mast, the same mast as the nine regions. Near the poles,
              where the Sun and Earth graze the horizon, terrain changes these numbers a great deal.
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {terrain?.ok && onTerrain && (
              <button type="button" onClick={() => onTerrain(point.lat, point.lon)} className={primaryButton}>
                {polar ? "Use LOLA terrain" : "Open site level"}
              </button>
            )}
            {onCompare && (
              <button type="button" onClick={onCompare} disabled={!site} className={smallButton}>
                Add to Compare
              </button>
            )}
            <button type="button" onClick={onClear} className={smallButton}>
              Clear point
            </button>
          </div>
          <p data-pt="site-level" className="mt-2 text-[0.8rem] leading-snug text-ink-2">
            {!terrain?.ok
              ? `The site level is not available for this point. ${terrain?.reason ?? ""}`
              : polar
                ? "Use LOLA terrain opens this point at the site level, measured against the real horizon."
                : "Open site level fetches the LOLA terrain around this point from NASA Moon Trek (a 240 m or 300 m grid, 123 km each way, 4 to 8 MB) and measures the Sun and Earth against its horizon. The grid smooths the sharpest rims, so times near a grazing Sun are approximate."}
          </p>
        </>
      )}

      <EntryForm key={point ? `${point.lat},${point.lon}` : "none"} point={point} onSet={onSet} />

      <p className="mt-3 text-[0.75rem] font-semibold tracking-[0.06em] text-ink-2 uppercase">Try an earlier landing</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {quickPicks.map((q) => {
          const on = !!point && Math.abs(point.lat - q.lat) < 1e-4 && Math.abs(point.lon - q.lon) < 1e-4;
          return (
            <li key={q.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSet(q.lat, q.lon)}
                className={`h-7 border border-ink px-2 text-[0.8rem] whitespace-nowrap transition-colors duration-150 ${
                  on ? "bg-ink font-semibold text-paper" : "font-medium text-ink hover:bg-paper-3"
                }`}
              >
                {q.name}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-[0.8rem] leading-snug text-ink-2">
        At low latitudes day and night each last about two weeks; from the far side Earth is never in view.
      </p>
    </div>
  );
}

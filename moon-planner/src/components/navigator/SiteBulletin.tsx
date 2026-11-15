"use client";

import { memo, useMemo, type ReactNode } from "react";
import { contactsInWindow, isUp } from "@/lib/contacts";
import { DAY_MS, HOUR_MS, fmtDayTime, fmtDeg, fmtDuration, fmtLatLon, fmtSigned, fmtSpell, pct, pct1, pts } from "@/lib/format";
import { moonTrekUrl } from "@/lib/moontrek";
import { bestStart, covers, sampleAt, type MissionScore, type SiteData } from "@/lib/sky";
import { compareWithNasa } from "@/lib/validation";
import { EarthMark, ExternalMark, Panel, Row, SunMark, AlertMark, buttonClass } from "../ui";

export type ContactKind = "sunrise" | "sunset" | "earthrise" | "earthset";

export const CONTACT_LABEL: Record<ContactKind, string> = {
  sunrise: "Sunrise",
  sunset: "Sunset",
  earthrise: "Earthrise",
  earthset: "Earthset",
};

/** Plain description of the sky at one moment, for the opening and closing contacts. */
export function skyState(site: SiteData, ms: number): string {
  const s = sampleAt(site, ms);
  const sun = !isUp(site, "sun", ms) ? "Sun hidden" : s.sunFraction >= 1 ? "Sun up" : `Sun ${pct(s.sunFraction)} up`;
  return `${sun}, Earth ${isUp(site, "earth", ms) ? "in view" : "hidden"}`;
}

// ---------- The bulletin ----------

const LOOKAHEAD_DAYS = 14;

type Props = {
  name: string;
  lat: number;
  lon: number;
  custom?: boolean;
  /** How a custom site's terrain horizon was made (customHorizonMethod). */
  methodNote?: string;
  /** Replaces the line under a custom site's name (its terrain source, when not the polar LOLA grids). */
  customNote?: string;
  status: "loading" | "ready" | "error";
  error?: string;
  site: SiteData | null;
  /** Stats for the current window. */
  score: MissionScore | null;
  rank: number | null;
  total: number;
  /** Stats for the planned window before the last slip or search, if any. */
  before: MissionScore | null;
  startMs: number;
  endMs: number;
  durationHours: number;
  limitHours: number;
  onUseStart: (startMs: number) => void;
  onShowAbout: () => void;
  onRetry: () => void;
  className?: string;
};

function ContactRow({
  name,
  mark,
  at,
  detail,
  strong,
  last,
}: {
  name: string;
  mark?: ReactNode;
  at: number;
  detail: string;
  strong?: boolean;
  last?: boolean;
}) {
  return (
    <tr className={last ? "" : "border-b border-rule"}>
      <th scope="row" className="py-1.5 pr-3 text-left align-top font-normal">
        <span className={`flex items-center gap-1.5 text-ink ${strong ? "font-semibold" : "font-medium"}`}>
          {mark}
          {name}
        </span>
        <span className="mt-0.5 block text-[0.75rem] text-ink-2">{detail}</span>
      </th>
      <td className="py-1.5 text-right align-top whitespace-nowrap text-ink">{fmtDayTime(at)}</td>
    </tr>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true" className="space-y-5 px-5 py-4">
      <div className="h-6 w-3/4 bg-paper-3 motion-safe:animate-pulse" />
      <div className="h-4 w-1/2 bg-paper-3 motion-safe:animate-pulse" />
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex justify-between border-b border-rule pb-2">
          <div className="h-4 w-28 bg-paper-3 motion-safe:animate-pulse" />
          <div className="h-4 w-12 bg-paper-3 motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function SiteBulletin({
  name,
  lat,
  lon,
  custom,
  customNote,
  methodNote,
  status,
  error,
  site,
  score,
  rank,
  total,
  before,
  startMs,
  endMs,
  durationHours,
  limitHours,
  onUseStart,
  onShowAbout,
  onRetry,
  className = "",
}: Props) {
  const contacts = useMemo(() => (site ? contactsInWindow(site, startMs, endMs) : []), [site, startMs, endMs]);

  const better = useMemo(() => {
    if (!site || !score) return null;
    const to = startMs + LOOKAHEAD_DAYS * DAY_MS;
    if (!covers(site, startMs, to + durationHours * HOUR_MS)) return null;
    const best = bestStart(site, startMs, to, durationHours, 1);
    return best && best.startMs !== startMs && best.score > score.score + 1e-9 ? best : null;
  }, [site, score, startMs, durationHours]);

  const nasa = useMemo(() => (site && !custom ? compareWithNasa(site) : null), [site, custom]);

  const darkOver = score ? score.longestDarkHours > limitHours : false;
  const commsOver = score ? score.longestNoCommsHours > limitHours : false;
  const limitText = `longer than the ${fmtDuration(limitHours)} gap limit`;

  return (
    <div className={`flex flex-col bg-paper ${className}`}>
      <header className="px-5 pt-4 pb-3.5">
        <h2 id="bulletin-title" className="text-[1.2rem] font-semibold leading-tight text-ink text-balance">
          {name}
        </h2>
        <p className="mt-1 text-[0.844rem] text-ink-2">
          {custom ? (customNote ?? "Custom site, tracks fetched live from JPL Horizons") : fmtLatLon(lat, lon)}
        </p>
        <a
          href={moonTrekUrl(lat, lon)}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 inline-flex items-center gap-1 text-[0.844rem] font-medium text-earth underline decoration-1 underline-offset-[3px] hover:text-ink"
        >
          Open in Moon Trek
          <ExternalMark className="size-3" />
          <span className="sr-only"> (opens NASA Moon Trek in a new tab)</span>
        </a>
        {score && rank !== null && (
          <p className="mt-2 text-[0.95rem] text-ink">
            Rank <strong className="font-semibold">{rank}</strong> of {total}, score{" "}
            <strong className="font-semibold tabular-nums">{score.score.toFixed(2)}</strong>
          </p>
        )}
      </header>

      {status === "loading" && (
        <>
          <p className="sr-only" role="status">
            Loading the bulletin for {name}
          </p>
          <Skeleton />
        </>
      )}

      {status === "error" && (
        <div role="alert" className="border-t border-rule px-5 py-4 text-[0.95rem] text-ink">
          <p>
            {custom && error
              ? error
              : `The Sun and Earth tracks for ${name} did not load${error ? ` (${error})` : ""}. Check the connection and try again.`}
          </p>
          <button type="button" onClick={onRetry} className={`${buttonClass.secondary} mt-3`}>
            Try again
          </button>
        </div>
      )}

      {status === "ready" && site && score && (
        <>
          <Panel title="Circumstances">
            <table className="w-full tabular-nums">
              <caption className="sr-only">Sunlight and Earth visibility for {name} over the mission window</caption>
              <tbody>
                <Row dense label="Sun up" mark={<SunMark className="size-3.5" />} value={pct(score.sunlit)} was={before ? pct(before.sunlit) : undefined} />
                <Row dense label="Mean disc power" value={pct(score.sunPower)} was={before ? pct(before.sunPower) : undefined} />
                <Row dense label="Earth in view" mark={<EarthMark className="size-3.5" />} value={pct(score.earthVisible)} was={before ? pct(before.earthVisible) : undefined} />
                <Row dense label="Sun and Earth" value={pct(score.both)} was={before ? pct(before.both) : undefined} />
                <Row
                  label="Longest dark"
                  value={fmtSpell(score.longestDarkHours)}
                  was={before ? fmtSpell(before.longestDarkHours) : undefined}
                  flagged={darkOver}
                  flagNote={limitText}
                />
                <Row
                  label="Longest without comms"
                  value={fmtSpell(score.longestNoCommsHours)}
                  was={before ? fmtSpell(before.longestNoCommsHours) : undefined}
                  flagged={commsOver}
                  flagNote={limitText}
                />
                <Row
                  label="Mean Sun clearance"
                  value={score.sunlit > 0 ? fmtDeg(score.meanSunClearance) : "Never up"}
                />
                <Row dense label="Peak Sun clearance" value={fmtSigned(score.maxSunClearance)} />
              </tbody>
            </table>
            {(darkOver || commsOver) && (
              <p className="mt-2 flex items-start gap-1.5 text-[0.75rem] text-ink-2">
                <AlertMark className="mt-px size-3" />
                <span>Red marks a gap {limitText}. Change the limit under the region table.</span>
              </p>
            )}
          </Panel>

          <Panel title="Contacts" note="Times in UTC">
            <table className="w-full tabular-nums">
              <caption className="sr-only">Sunrise, sunset, Earthrise and Earthset inside the window</caption>
              <tbody className="text-[0.844rem]">
                <ContactRow name="Window opens" at={startMs} detail={skyState(site, startMs)} strong />
                {contacts.length === 0 && (
                  <tr className="border-b border-rule">
                    <td colSpan={2} className="py-2 leading-snug text-ink-2">
                      No sunrise, sunset, Earthrise or Earthset inside this window, so the sky at the start holds to the
                      end.
                    </td>
                  </tr>
                )}
                {contacts.map((c) => (
                  <ContactRow
                    key={`${c.kind}-${c.ms}`}
                    name={CONTACT_LABEL[c.kind]}
                    mark={c.kind.startsWith("sun") ? <SunMark className="size-3.5" /> : <EarthMark className="size-3.5" />}
                    at={c.ms}
                    detail={`azimuth ${fmtDeg(c.az)}`}
                  />
                ))}
                <ContactRow name="Window closes" at={endMs} detail={skyState(site, endMs)} strong last />
              </tbody>
            </table>
          </Panel>

          <Panel title="Why it ranks here">
            <p className="text-[0.844rem] leading-relaxed text-pretty text-ink-2">
              Score is 45% mean Sun power, 30% time with Earth in view and 25% for keeping the longest dark spell short.
              Equal scores go to the higher peak Sun clearance, then to more time with Earth in view.
            </p>
            <ul className="mt-2 space-y-1 text-[0.95rem] text-ink">
              {score.reasons.map((r) => (
                <li key={r} className="flex gap-2">
                  <span aria-hidden="true" className="mt-[0.6em] h-px w-2.5 shrink-0 bg-ink" />
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </li>
              ))}
            </ul>
            {better ? (
              <div className="mt-3 border border-rule bg-paper-2 px-3 py-2.5">
                <p className="text-[0.844rem] leading-snug text-ink">
                  Starting <strong className="font-semibold">{fmtDayTime(better.startMs)} UTC</strong> instead scores{" "}
                  {better.score.toFixed(2)}: Sun up {pct(better.sunlit)}, Earth {pct(better.earthVisible)}, longest dark{" "}
                  {fmtSpell(better.longestDarkHours)}. It is the best start in the next {LOOKAHEAD_DAYS} days.
                </p>
                <button type="button" onClick={() => onUseStart(better.startMs)} className={`${buttonClass.secondary} mt-2`}>
                  Move start to {fmtDayTime(better.startMs)}
                </button>
              </div>
            ) : (
              <p className="mt-3 text-[0.844rem] text-pretty text-ink-2">
                No later start in the next {LOOKAHEAD_DAYS} days scores higher here.
              </p>
            )}
          </Panel>

          <Panel title="Checked against NASA">
            {nasa?.nasa && nasa.diffPts ? (
              <>
                <table className="w-full tabular-nums text-[0.844rem]">
                  <caption className="sr-only">
                    Share of 2027 with the Sun and Earth visible, against NASA&apos;s LOLA average for this region
                  </caption>
                  <thead>
                    <tr className="border-b border-ink text-[0.75rem] uppercase tracking-[0.06em] text-ink-2">
                      <th scope="col" className="pb-1 text-left font-semibold">
                        <span className="sr-only">Source</span>
                      </th>
                      <th scope="col" className="pb-1 text-right font-semibold">Sun</th>
                      <th scope="col" className="pb-1 text-right font-semibold">Earth</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-rule">
                      <th scope="row" className="py-1.5 text-left font-normal text-ink-2">This model, 2027</th>
                      <td className="py-1.5 text-right text-ink">{pct1(nasa.ours.sunlit)}</td>
                      <td className="py-1.5 text-right text-ink">{pct1(nasa.ours.earth)}</td>
                    </tr>
                    <tr className="border-b border-rule">
                      <th scope="row" className="py-1.5 text-left font-normal text-ink-2">NASA LOLA average</th>
                      <td className="py-1.5 text-right text-ink">{pct1(nasa.nasa.sunlit)}</td>
                      <td className="py-1.5 text-right text-ink">{pct1(nasa.nasa.earth)}</td>
                    </tr>
                    <tr>
                      <th scope="row" className="py-1.5 text-left font-normal text-ink-2">Difference, points</th>
                      <td className="py-1.5 text-right font-semibold text-ink">{pts(nasa.diffPts.sunlit)}</td>
                      <td className="py-1.5 text-right font-semibold text-ink">{pts(nasa.diffPts.earth)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-2 text-[0.75rem] leading-snug text-pretty text-ink-2">
                  NASA values: Mazarico et al. 2011, PGDA product 69, long-term averages. Ours cover 2027 only.
                </p>
              </>
            ) : (
              <>
                {methodNote && <p className="mb-2 text-[0.844rem] leading-snug text-ink">{methodNote}</p>}
                <p className="text-[0.844rem] leading-snug text-ink-2">
                  NASA&apos;s maps give no reference value for a custom point. The nine regions are checked in About
                  &amp; data.
                </p>
              </>
            )}
            <button type="button" onClick={onShowAbout} className={`${buttonClass.link} mt-2`}>
              How the numbers are made and checked
            </button>
          </Panel>
        </>
      )}
    </div>
  );
}

export default memo(SiteBulletin);

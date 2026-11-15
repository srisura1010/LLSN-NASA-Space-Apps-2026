"use client";

import { memo, useMemo, type ReactNode } from "react";
import { contactsInWindow, isUp } from "@/lib/contacts";
import { DAY_MS, HOUR_MS, fmtDayTime, fmtDeg, fmtDuration, fmtLatLon, fmtSigned, fmtSpell, pct, pct1, pts } from "@/lib/format";
import { moonTrekUrl } from "@/lib/moontrek";
import { SCORE_WEIGHTS, bestStart, covers, sampleAt, type MissionScore, type SiteData } from "@/lib/sky";
import { compareWithNasa } from "@/lib/validation";
import { ChevronMark, EarthMark, ExternalMark, Panel, Row, SunMark, AlertMark, buttonClass } from "../ui";

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

// ---------- The verdict ----------

const WORDS = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const WHOLE = 1 - 1e-9;

/**
 * One plain sentence on how the site does in this window, from its stats alone: the rank, then the facts that
 * decide it (all three for the best site; the weakest part and any gap over the limit otherwise).
 */
export function verdict(score: MissionScore, rank: number, total: number, limitHours: number): string {
  const lead = rank === 1 ? `Best of ${WORDS[total] ?? total} for this window` : `Ranked ${rank} of ${total}`;
  const limit = fmtDuration(limitHours);
  const sun = score.sunlit >= WHOLE ? "Sun up the whole stay" : score.sunlit <= 0 ? "the Sun never clears the terrain" : `Sun up ${pct(score.sunlit)} of the stay`;
  const earth =
    score.earthVisible >= WHOLE ? "Earth in view the whole stay" : score.earthVisible <= 0 ? "Earth never in view" : `Earth in view ${pct(score.earthVisible)} of it`;
  const darkOver = score.longestDarkHours > limitHours;
  const commsOver = score.longestNoCommsHours > limitHours;
  const dark =
    score.longestDarkHours <= 0
      ? "no dark spell"
      : darkOver
        ? `the longest dark spell is ${fmtDuration(score.longestDarkHours)}, over your ${limit} limit`
        : `the longest dark spell is ${fmtDuration(score.longestDarkHours)}`;
  const comms = `Earth is out of view for up to ${fmtDuration(score.longestNoCommsHours)}, over your ${limit} limit`;
  if (rank === 1) {
    const facts = [sun, earth, dark];
    if (commsOver && !darkOver) facts.push(comms);
    return `${lead}: ${cap(facts.join(", "))}.`;
  }
  // The part of the score that falls furthest short of its weight decides what the sentence leads with.
  const short = [
    { key: "power", share: score.parts.power / SCORE_WEIGHTS.power },
    { key: "earth", share: score.parts.earth / SCORE_WEIGHTS.earth },
    { key: "dark", share: score.parts.dark / SCORE_WEIGHTS.dark },
  ].sort((a, b) => a.share - b.share)[0].key;
  const weak = short === "power" ? sun : short === "earth" ? earth : dark;
  // Gaps over the limit are always named; both at once share one clause.
  const both = darkOver && commsOver;
  const extra = both
    ? [`dark spells run to ${fmtDuration(score.longestDarkHours)} and Earth drops out of view for up to ${fmtDuration(score.longestNoCommsHours)}, both over your ${limit} limit`]
    : [darkOver && short !== "dark" ? dark : null, commsOver ? comms : null].filter(Boolean);
  const lead2 = both && short === "dark" ? (score.sunlit >= WHOLE ? earth : sun) : weak;
  return `${lead}: ${cap(lead2)}${extra.length ? `; ${extra.join("; ")}` : ""}.`;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The three weighted parts of the score as bars, each out of its weight. */
function WhyBars({ score }: { score: MissionScore }) {
  const rows = [
    { key: "power", label: "Sun power", weight: SCORE_WEIGHTS.power, value: score.parts.power, fill: "bg-sun" },
    { key: "earth", label: "Earth in view", weight: SCORE_WEIGHTS.earth, value: score.parts.earth, fill: "bg-earth" },
    { key: "dark", label: "Short longest dark", weight: SCORE_WEIGHTS.dark, value: score.parts.dark, fill: "bg-umbra" },
  ];
  return (
    <table data-why className="w-full tabular-nums">
      <caption className="sr-only">The three parts of the score, each out of its weight</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} data-part={r.key}>
            <th scope="row" className="w-[8.5rem] py-1 pr-2 text-left text-small font-normal whitespace-nowrap text-ink-2">
              {r.label} <span className="text-ink-3">{Math.round(r.weight * 100)}%</span>
            </th>
            <td className="py-1">
              <span aria-hidden="true" className="relative block h-2.5 border border-ink bg-paper">
                <span className={`absolute inset-y-0 left-0 ${r.fill}`} style={{ width: `${Math.min(100, (r.value / r.weight) * 100).toFixed(1)}%` }} />
              </span>
            </td>
            <td className="w-[5.5rem] py-1 pl-2 text-right text-small whitespace-nowrap text-ink">
              {r.value.toFixed(2)} <span className="text-ink-2">of {r.weight.toFixed(2)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A row label with a one-line plain gloss under it. */
function Glossed({ label, gloss }: { label: string; gloss: string }) {
  return (
    <span className="flex flex-col">
      <span>{label}</span>
      <span className="text-label leading-tight text-ink-3">{gloss}</span>
    </span>
  );
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
      <th scope="row" className={`${strong ? "py-1" : "py-0.5"} pr-3 text-left align-top font-normal`}>
        {/* The window's ends carry a sentence of state on a second line; a rise or set fits its bearing on one. */}
        <span className={`flex items-baseline gap-1.5 text-ink ${strong ? "font-semibold" : "font-medium"}`}>
          {mark ? <span className="self-center">{mark}</span> : null}
          {name}
          {!strong && <span className="text-label font-normal text-ink-2">{detail.replace("azimuth", "az")}</span>}
        </span>
        {strong && <span className="block text-label leading-tight text-ink-2">{detail}</span>}
      </th>
      <td className={`${strong ? "py-1" : "py-0.5"} text-right align-top whitespace-nowrap text-ink`}>{fmtDayTime(at)}</td>
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
      <header className="px-5 pt-4 pb-3">
        <h2 id="bulletin-title" className="text-title font-semibold leading-tight text-ink text-balance">
          {name}
        </h2>
        {score && rank !== null && status === "ready" && (
          <p data-verdict className="mt-1.5 text-lead leading-snug font-semibold text-pretty text-ink">
            {verdict(score, rank, total, limitHours)}
          </p>
        )}
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-small text-ink-2">
          <span>{custom ? (customNote ?? "Custom site, tracks fetched live from JPL Horizons") : fmtLatLon(lat, lon)}</span>
          <a
            href={moonTrekUrl(lat, lon)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-earth underline decoration-1 underline-offset-[3px] hover:text-ink"
          >
            Open in Moon Trek
            <ExternalMark className="size-3" />
            <span className="sr-only"> (opens NASA Moon Trek in a new tab)</span>
          </a>
        </p>
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
        <div role="alert" className="border-t border-rule px-5 py-4 text-lead text-ink">
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
          <Panel title="Why it ranks here" note={<span className="tabular-nums">score {score.score.toFixed(2)} of 1</span>}>
            <WhyBars score={score} />
            <p className="mt-1 text-label leading-snug text-ink-2">
              Equal scores go to the higher peak Sun clearance, then to more time with Earth in view.
            </p>
            {better ? (
              <div className="mt-2 border border-rule bg-paper-2 px-3 py-2">
                <p className="text-small leading-snug text-ink">
                  Starting <strong className="font-semibold">{fmtDayTime(better.startMs)} UTC</strong> instead scores{" "}
                  {better.score.toFixed(2)}: Sun up {pct(better.sunlit)}, Earth {pct(better.earthVisible)}, longest dark{" "}
                  {fmtSpell(better.longestDarkHours)}. It is the best start in the next {LOOKAHEAD_DAYS} days.
                </p>
                <button type="button" onClick={() => onUseStart(better.startMs)} className={`${buttonClass.secondary} mt-2`}>
                  Move start to {fmtDayTime(better.startMs)}
                </button>
              </div>
            ) : (
              <p className="mt-1 text-label text-pretty text-ink-2">No later start in the next {LOOKAHEAD_DAYS} days scores higher here.</p>
            )}
          </Panel>

          <Panel title="Over this window">
            <table className="w-full tabular-nums">
              <caption className="sr-only">Sunlight and Earth visibility for {name} over the mission window</caption>
              <tbody>
                <Row dense label="Sun up" mark={<SunMark className="size-3.5" />} value={pct(score.sunlit)} was={before ? pct(before.sunlit) : undefined} />
                <Row dense label={<Glossed label="Mean disc power" gloss="how much of the Sun’s disc clears the terrain, on average" />} value={pct(score.sunPower)} was={before ? pct(before.sunPower) : undefined} />
                <Row dense label="Earth in view" mark={<EarthMark className="size-3.5" />} value={pct(score.earthVisible)} was={before ? pct(before.earthVisible) : undefined} />
                <Row dense label="Sun and Earth" value={pct(score.both)} was={before ? pct(before.both) : undefined} />
                <Row
                  dense
                  label="Longest dark"
                  value={fmtSpell(score.longestDarkHours)}
                  was={before ? fmtSpell(before.longestDarkHours) : undefined}
                  flagged={darkOver}
                  flagNote={limitText}
                />
                <Row
                  dense
                  label="Longest without comms"
                  value={fmtSpell(score.longestNoCommsHours)}
                  was={before ? fmtSpell(before.longestNoCommsHours) : undefined}
                  flagged={commsOver}
                  flagNote={limitText}
                />
                <Row
                  dense
                  label={<Glossed label="Mean Sun clearance" gloss="how far the Sun sits above the terrain" />}
                  value={score.sunlit > 0 ? fmtDeg(score.meanSunClearance) : "Never up"}
                />
                <Row dense label="Peak Sun clearance" value={fmtSigned(score.maxSunClearance)} />
              </tbody>
            </table>
            {(darkOver || commsOver) && (
              <p className="mt-2 flex items-start gap-1.5 text-label text-ink-2">
                <AlertMark className="mt-px size-3" />
                <span>Red marks a gap {limitText}. Change the limit under the region table.</span>
              </p>
            )}
          </Panel>

          <Panel title="Rises and sets" note="Times in UTC">
            <table className="w-full tabular-nums">
              <caption className="sr-only">Sunrise, sunset, Earthrise and Earthset inside the window</caption>
              <tbody className="text-body">
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

          {/* A disclosure, closed at first, so the bulletin's answers fit the inspector without a scroll. */}
          <details data-nasa-check className="group/nasa border-t border-rule px-5 pt-3 pb-3 open:pb-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-label font-semibold tracking-[0.08em] text-ink uppercase marker:hidden [&::-webkit-details-marker]:hidden">
              <span>Checked against NASA</span>
              <ChevronMark className="size-3.5 text-ink-2 transition-transform duration-150 group-open/nasa:rotate-180 motion-reduce:transition-none" />
            </summary>
            <div className="mt-2">
            {nasa?.nasa && nasa.diffPts ? (
              <>
                <table className="w-full tabular-nums text-body">
                  <caption className="sr-only">
                    Share of 2027 with the Sun and Earth visible, against NASA&apos;s LOLA average for this region
                  </caption>
                  <thead>
                    <tr className="border-b border-ink text-label uppercase tracking-[0.06em] text-ink-2">
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
                <p className="mt-2 text-label leading-snug text-pretty text-ink-2">
                  NASA values: Mazarico et al. 2011, PGDA product 69, long-term averages. Ours cover 2027 only.
                </p>
              </>
            ) : (
              <>
                {methodNote && <p className="mb-2 text-body leading-snug text-ink">{methodNote}</p>}
                <p className="text-body leading-snug text-ink-2">
                  NASA&apos;s maps give no reference value for a custom point. The nine regions are checked in About
                  &amp; data.
                </p>
              </>
            )}
            <button type="button" onClick={onShowAbout} className={`${buttonClass.link} mt-2`}>
              How the numbers are made and checked
            </button>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

export default memo(SiteBulletin);

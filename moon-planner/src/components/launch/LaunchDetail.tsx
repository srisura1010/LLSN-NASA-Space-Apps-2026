"use client";

// The expanded detail of one launch site: every opportunity across the search
// span on a UTC axis, the site's allowed headings, and the mission timeline.

import type { LaunchSite } from "@/lib/launchSites";
import { formatAzimuthRanges, type LaunchOpportunity } from "@/lib/launchWindow";
import { orbitLine, type LandingConditions } from "@/lib/launchLanding";
import { fmtDuration, fmtSpell, pct } from "@/lib/format";
import type { SiteData } from "@/lib/sky";
import { usePlan, usePlanStore } from "@/state/plan";
import { AlertMark, Button, ExternalMark } from "../ui";
import { LandingMarks, StayStrip, orbitLabel } from "./landingMarks";
import {
  DAY_MS,
  HOUR_MS,
  Status,
  capsLabel,
  fmtClock,
  fmtDate,
  fmtDateTime,
  fmtDeg,
  fmtMinutes,
  fmtOffset,
  fmtWindowSpan,
  plainReason,
} from "./launchFormat";

const SWEEPS = [
  { key: "towards-moon", label: "Heading towards the Moon's arrival point" },
  { key: "towards-antipode", label: "Heading towards the opposite point of the sky" },
] as const;

const sameOpp = (a: LaunchOpportunity, b: LaunchOpportunity | null) => b !== null && a.sweep === b.sweep && a.launchMs === b.launchMs;

// ---------- Opportunity timeline ----------

function OpportunityAxis({ list, chosen }: { list: LaunchOpportunity[]; chosen: LaunchOpportunity | null }) {
  const times = list.flatMap((o) => [o.launchMs, o.windowOpenMs ?? o.launchMs, o.windowCloseMs ?? o.launchMs]);
  const t0 = Math.floor((Math.min(...times) - HOUR_MS) / (6 * HOUR_MS)) * 6 * HOUR_MS;
  const t1 = Math.ceil((Math.max(...times) + HOUR_MS) / (6 * HOUR_MS)) * 6 * HOUR_MS;
  const frac = (ms: number) => (ms - t0) / (t1 - t0);
  const x = (ms: number) => `${(((ms - t0) / (t1 - t0)) * 100).toFixed(3)}%`;
  const ticks: number[] = [];
  for (let t = t0; t <= t1; t += 6 * HOUR_MS) ticks.push(t);

  return (
    <div aria-hidden="true" className="select-none">
      {SWEEPS.map((s) => (
        <div key={s.key} className="mt-2 first:mt-0">
          <p className="text-label text-ink-2">{s.label}</p>
          <div className="relative mt-1 h-7 border-b border-ink">
            {ticks.map((t) => (
              <span
                key={t}
                className={`absolute bottom-0 w-px ${t % DAY_MS === 0 ? "top-0 bg-rule" : "h-1.5 bg-ink-2"}`}
                style={{ left: x(t) }}
              />
            ))}
            {list
              .filter((o) => o.sweep === s.key)
              .map((o) => {
                const on = sameOpp(o, chosen);
                if (o.windowOpenMs === null || o.windowCloseMs === null) {
                  return (
                    <span key={o.launchMs} className="absolute inset-y-0" style={{ left: x(o.launchMs) }}>
                      <span className={`absolute bottom-0 block h-4 w-[3px] -translate-x-1/2 bg-umbra ${on ? "outline-2 outline-offset-1 outline-ink" : ""}`} />
                      <span className={`absolute bottom-0.5 ${frac(o.launchMs) > 0.7 ? "right-1.5" : "left-1.5"} text-label leading-none font-medium whitespace-nowrap text-umbra tabular-nums`}>
                        needs {o.azimuthDeg.toFixed(0)}°
                      </span>
                    </span>
                  );
                }
                return (
                  <span key={o.launchMs}>
                    <span
                      className={`absolute bottom-0 block h-4 border border-earth ${o.rating === "good" ? "bg-earth" : "bg-earth-soft"} ${
                        on ? "outline-2 outline-offset-1 outline-ink" : ""
                      }`}
                      style={{ left: x(o.windowOpenMs), width: `calc(${x(o.windowCloseMs)} - ${x(o.windowOpenMs)})`, minWidth: 3 }}
                    />
                    <span
                      className={`absolute bottom-0 block h-4 w-0.5 -translate-x-1/2 ${o.rating === "good" ? "bg-paper" : "bg-earth"}`}
                      style={{ left: x(o.launchMs) }}
                    />
                    {on && (
                      <svg viewBox="0 0 10 6" className="absolute bottom-[1.3rem] h-1.5 w-2.5 -translate-x-1/2" style={{ left: x(o.launchMs) }}>
                        <path d="M0 0h10L5 6Z" className="fill-ink" />
                      </svg>
                    )}
                  </span>
                );
              })}
          </div>
        </div>
      ))}
      <div className="relative h-5">
        {ticks
          .filter((t) => t % DAY_MS === 0 && frac(t) < 0.88)
          .map((t) => (
            <span key={t} className="absolute top-1 text-label text-ink-2 tabular-nums whitespace-nowrap" style={{ left: x(t) }}>
              {fmtDate(t)}
            </span>
          ))}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="block h-2.5 w-4 border border-earth bg-earth" />
          Window, usable
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="block h-2.5 w-4 border border-earth bg-earth-soft" />
          Window, at a cost
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="block h-2.5 w-[3px] bg-umbra" />
          Blocked, nearest miss
        </span>
        <span>Inner line: best lift-off. Ticks every 6 h, UTC.</span>
      </p>
    </div>
  );
}

// ---------- Allowed headings ----------

function AzimuthDial({ site, azimuthDeg, blocked }: { site: LaunchSite; azimuthDeg: number | null; blocked: boolean }) {
  const R = 30;
  const pt = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(40 + r * Math.sin(a)).toFixed(2)} ${(40 - r * Math.cos(a)).toFixed(2)}`;
  };
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" className="size-24 shrink-0">
      {site.azimuths.map((r) =>
        r.max - r.min >= 360 ? (
          <circle key={r.min} cx="40" cy="40" r={R} className="fill-earth-soft stroke-earth" strokeWidth="1" />
        ) : (
          <path
            key={r.min}
            d={`M40 40 L${pt(r.min, R)} A${R} ${R} 0 ${r.max - r.min > 180 ? 1 : 0} 1 ${pt(r.max, R)} Z`}
            className="fill-earth-soft stroke-earth"
            strokeWidth="1"
          />
        ),
      )}
      <circle cx="40" cy="40" r={R} fill="none" className="stroke-ink" strokeWidth="1" />
      {[0, 90, 180, 270].map((d) => (
        <path key={d} d={`M${pt(d, R)} L${pt(d, R + 3)}`} className="stroke-ink" strokeWidth="1" />
      ))}
      <text x="40" y="5.5" textAnchor="middle" className="fill-ink text-[7px] font-semibold">
        N
      </text>
      <text x="77.5" y="42.5" textAnchor="middle" className="fill-ink text-[7px] font-semibold">
        E
      </text>
      {azimuthDeg !== null && (
        <>
          <path d={`M40 40 L${pt(azimuthDeg, R - 1)}`} className={blocked ? "stroke-umbra" : "stroke-ink"} strokeWidth="2" strokeDasharray={blocked ? "3 2" : undefined} />
          <circle cx="40" cy="40" r="2" className="fill-ink" />
        </>
      )}
    </svg>
  );
}

// ---------- Mission timeline ----------

function MissionSteps({ o, transitDays, orbitHours, siteName }: { o: LaunchOpportunity; transitDays: number; orbitHours: number; siteName: string }) {
  const lat = `${Math.abs(o.tliLat).toFixed(0)}° ${o.tliLat >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(o.tliLon).toFixed(0)}° ${o.tliLon >= 0 ? "E" : "W"}`;
  const steps = [
    { label: "Lift-off", value: fmtDateTime(o.launchMs, false), note: `Heading ${fmtDeg(o.azimuthDeg)}` },
    { label: "Parking orbit", value: fmtMinutes(o.coastMin), note: "Climb, then coast in low orbit at 185 km" },
    { label: "Burn for the Moon", value: fmtDateTime(o.tliMs, false), note: `Engine burn over ${lat}, ${lon}` },
    { label: "Transfer", value: `${transitDays} days`, note: "Coasting, engines off" },
    { label: "Arrive at the Moon", value: fmtDateTime(o.arrivalMs, false), note: "Brake into lunar orbit" },
    { label: "In lunar orbit", value: orbitLabel(orbitHours), note: orbitHours > 0 ? "Check out, then descend" : "Straight down, no time in orbit" },
    {
      label: `Landing at ${siteName}`,
      value: fmtDateTime(o.arrivalMs + orbitHours * HOUR_MS, false),
      note: `${fmtOffset(o.arrivalOffsetHours)} against the planned landing`,
    },
  ];
  return (
    <ol className="grid grid-cols-1 @3xl:grid-cols-4 @3xl:gap-y-4 @6xl:grid-cols-7">
      {steps.map((s, i) => (
        <li
          key={s.label}
          className="relative border-l border-ink pb-3 pl-4 last:pb-0 @3xl:border-t @3xl:border-l-0 @3xl:pt-3 @3xl:pr-3 @3xl:pb-0 @3xl:pl-0"
        >
          <span
            className={`absolute top-1 -left-[4.5px] block size-2 border border-ink @3xl:-top-[4.5px] @3xl:left-0 ${
              i === 0 || i === steps.length - 1 ? "bg-ink" : "bg-paper"
            }`}
          />
          <span className={`block ${capsLabel}`}>{s.label}</span>
          <span className="block text-lead font-semibold text-ink tabular-nums">{s.value}</span>
          <span className="block text-body text-ink-2 tabular-nums">{s.note}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------- Landing ----------

function LandingBlock({
  c,
  site,
  siteName,
  landingLat,
  windowHours,
}: {
  c: LandingConditions | null;
  site: SiteData | null;
  siteName: string;
  landingLat?: number;
  windowHours: number;
}) {
  const gap = usePlan((s) => s.gap);
  const orbit = landingLat !== undefined && Number.isFinite(landingLat) ? orbitLine(siteName, landingLat) : null;
  const rows = c
    ? [
        { label: "Sun up", value: pct(c.stay.sunlit), loss: false },
        { label: "Earth in view", value: pct(c.stay.earthVisible), loss: false },
        { label: "Longest dark", value: fmtSpell(c.stay.longestDarkHours), loss: c.stay.longestDarkHours > gap },
        { label: "Longest without Earth", value: fmtSpell(c.stay.longestNoCommsHours), loss: c.stay.longestNoCommsHours > gap },
      ]
    : [];
  return (
    <div className="mt-6 border-t border-rule pt-4">
      <h4 className="text-lead font-semibold text-ink">Landing at {siteName}</h4>
      {!site ? (
        <p className="mt-1 text-body text-ink-2">The Sun and Earth tracks for {siteName} are not loaded yet.</p>
      ) : !c ? (
        <p className="mt-1 text-body text-ink-2">The stay after this landing runs past the 2027 data, so conditions at {siteName} are not worked out.</p>
      ) : (
        <div className="mt-2 grid gap-x-8 gap-y-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="min-w-0">
            <p className="text-lead text-ink tabular-nums">
              <span className="font-semibold">{fmtDateTime(c.landingMs)} UTC</span>
              <LandingMarks c={c} className="ml-3 align-[-0.1em]" />
            </p>
            <p className="mt-1 max-w-[65ch] text-body text-pretty text-ink-2">{c.reason}</p>
            <table className="mt-3 w-full max-w-sm text-body tabular-nums">
              <caption className={`text-left ${capsLabel}`}>The {fmtDuration(windowHours)} stay from landing</caption>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-b border-rule">
                    <th scope="row" className="py-1 pr-3 text-left font-normal text-ink-2">
                      {r.label}
                    </th>
                    <td className={`py-1 text-right font-semibold ${r.loss ? "text-limit" : "text-ink"}`}>
                      {r.loss && <AlertMark className="mr-1 inline size-3 align-[-0.1em]" />}
                      {r.value}
                      {r.loss && <span className="sr-only"> (longer than the {fmtDuration(gap)} gap limit)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="min-w-0">
            <p className={capsLabel}>Sun and Earth over the stay, UTC</p>
            <div className="mt-2">
              <StayStrip site={site} startMs={c.landingMs} endMs={c.stayEndMs} />
            </div>
          </div>
        </div>
      )}
      {orbit && (
        <p className="mt-3 max-w-[75ch] text-body text-pretty text-ink-2 tabular-nums">
          {orbit.text}
          {orbit.pass && ` ${orbit.pass}`}
        </p>
      )}
    </div>
  );
}

// ---------- Detail ----------

type Props = {
  site: LaunchSite;
  list: LaunchOpportunity[];
  chosen: LaunchOpportunity | null;
  transitDays: number;
  orbitHours: number;
  windowHours: number;
  plannedLandingMs: number;
  siteName: string;
  landingLat?: number;
  landingSite: SiteData | null;
  landingFor: (o: LaunchOpportunity) => LandingConditions | null;
  onChoose: (o: LaunchOpportunity) => void;
  headingId: string;
};

export default function LaunchDetail({
  site,
  list,
  chosen,
  transitDays,
  orbitHours,
  windowHours,
  siteName,
  landingLat,
  landingSite,
  landingFor,
  onChoose,
  headingId,
}: Props) {
  const store = usePlanStore();
  // The System level opens in its Earth framing over this launch site, with the clock at lift-off.
  const showOnEarth = () =>
    store.setState({ view: "system", systemFraming: "earth", launchSiteId: site.id, ...(chosen ? { systemMs: chosen.launchMs, playing: false } : {}) });
  const url = site.azimuthUrl ?? site.sourceUrl;
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = "source";
  }
  return (
    <div role="region" aria-labelledby={headingId} className="border-t border-rule bg-paper px-4 pt-4 pb-5">
      <div className="grid gap-x-8 gap-y-6 @5xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h4 className="text-lead font-semibold text-ink">
            Every opportunity within a day of the nominal departure
          </h4>
          {list.length === 0 ? (
            <p className="mt-2 text-body text-ink-2">No launch opportunity falls inside the search span for this transfer time.</p>
          ) : (
            <>
              <div className="mt-3">
                <OpportunityAxis list={list} chosen={chosen} />
              </div>
              <ul aria-label={`Opportunities from ${site.name}. Choose one to plan with.`} className="mt-3 border-t border-ink">
                {list.map((o) => {
                  const on = sameOpp(o, chosen);
                  const span = fmtWindowSpan(o);
                  const land = landingFor(o);
                  return (
                    <li key={`${o.sweep}-${o.launchMs}`} className="border-b border-rule">
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChoose(o)}
                        className={`grid w-full grid-cols-[0.875rem_minmax(0,1fr)] items-baseline gap-x-2 px-1.5 py-1.5 text-left text-body tabular-nums transition-colors duration-150 focus-visible:outline-offset-[-2px] @2xl:grid-cols-[0.875rem_8rem_minmax(0,1fr)_minmax(0,1fr)_auto] ${
                          on ? "bg-paper-3" : "hover:bg-paper-2 active:bg-paper-3"
                        }`}
                      >
                        <span aria-hidden="true" className={`block size-2.5 self-center border border-ink ${on ? "bg-ink" : "bg-paper"}`} />
                        <span className={`text-ink ${on ? "font-semibold" : "font-medium"}`}>{fmtDateTime(o.launchMs, false)}</span>
                        <span className="col-start-2 text-ink-2 @2xl:col-start-auto">
                          {span ? `Window ${span}, ${fmtMinutes(o.windowMinutes)}` : `No window: ${plainReason(o, site)}`}
                        </span>
                        <span className="col-start-2 text-ink-2 @2xl:col-start-auto">
                          {fmtDeg(o.azimuthDeg)} heading, {fmtDeg(o.inclinationDeg)} orbit, lands {fmtOffset(o.arrivalOffsetHours)}
                          {land && (
                            <>
                              {" · "}
                              <LandingMarks c={land} className="align-[-0.1em]" />
                              {" · "}Sun up {pct(land.stay.sunlit)} of stay
                            </>
                          )}
                        </span>
                        <Status rating={o.rating} className="col-start-2 @2xl:col-start-auto @2xl:justify-self-end" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="min-w-0">
          <h4 className="text-lead font-semibold text-ink">Allowed launch directions</h4>
          <div className="mt-3 flex items-start gap-4">
            <AzimuthDial site={site} azimuthDeg={chosen?.azimuthDeg ?? null} blocked={chosen?.rating === "blocked"} />
            <div className="min-w-0 text-body text-ink-2">
              <p className="text-lead font-semibold text-ink tabular-nums">
                {formatAzimuthRanges(site)}{" "}
                <span className="ml-1 border border-ink-2 px-1 align-[0.1em] text-label font-semibold uppercase tracking-[0.06em] text-ink-2">
                  {site.azimuthSource === "published" ? "Published" : "Approximate"}
                </span>
              </p>
              <p className="mt-1 text-pretty">{site.azimuthNote}</p>
              {url && (
                <p className="mt-1.5">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-earth underline decoration-1 underline-offset-[3px] hover:text-ink"
                  >
                    {site.azimuthUrl ? "Source" : "Site operator"}: {host}
                    <ExternalMark className="size-3" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </p>
              )}
              <p className="mt-1.5 tabular-nums">
                Site at {Math.abs(site.lat).toFixed(2)}° {site.lat >= 0 ? "N" : "S"}, {Math.abs(site.lon).toFixed(2)}° {site.lon >= 0 ? "E" : "W"}. The line on
                the dial is the heading of the chosen lift-off.
              </p>
            </div>
          </div>
        </div>
      </div>

      {chosen && (
        <div className="mt-6">
          <h4 className="text-lead font-semibold text-ink">
            Mission timeline for the {fmtClock(chosen.launchMs)} UTC lift-off on {fmtDate(chosen.launchMs)}
          </h4>
          {chosen.rating !== "good" && <p className="mt-1 max-w-[70ch] text-body text-pretty text-ink-2">{plainReason(chosen, site)}</p>}
          <div className="mt-4 pl-1 @3xl:pl-0">
            <MissionSteps o={chosen} transitDays={transitDays} orbitHours={orbitHours} siteName={siteName} />
          </div>
          <LandingBlock c={landingFor(chosen)} site={landingSite} siteName={siteName} landingLat={landingLat} windowHours={windowHours} />
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button variant="primary" onClick={showOnEarth}>
              Show this launch on Earth
            </Button>
            <p className="min-w-0 flex-1 basis-64 text-body text-pretty text-ink-2">
              Opens the System level with {site.name} marked on Earth and the path to the Moon drawn for this lift-off.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

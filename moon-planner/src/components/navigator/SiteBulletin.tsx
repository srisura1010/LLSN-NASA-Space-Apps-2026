"use client";

import { memo, useMemo, type ReactNode, type SelectHTMLAttributes } from "react";
import { bestStart, rangeOf, sampleAt, type MissionScore, type SiteData } from "@/lib/sky";
import { moonTrekUrl } from "@/lib/moontrek";
import { formatLatLon } from "@/lib/sites";
import { compareWithNasa } from "@/lib/validation";
import { contactEvents } from "./plot/contacts";
import { fmtDuration } from "./plot/format";

// ---------- Shared number formats ----------

/** Share (0..1) as a whole percentage that never rounds a partial value to 0 or 100. */
export function pct(v: number): string {
  if (!Number.isFinite(v)) return "n/a";
  if (v <= 0) return "0%";
  if (v >= 1) return "100%";
  const r = Math.round(v * 100);
  if (r === 0) return "<1%";
  if (r === 100) return ">99%";
  return `${r}%`;
}

/** Share (0..1) as a percentage with one decimal. */
export function pct1(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** Signed percentage points with a true minus sign. */
export function pts(v: number): string {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return "0.0";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}`;
}

export function degrees(v: number, signed = false): string {
  const r = Math.round(v * 10) / 10;
  const sign = r < 0 ? "−" : signed && r > 0 ? "+" : "";
  return `${sign}${Math.abs(r).toFixed(1)}°`;
}

/** Duration of a dark or no-comms spell, or "None". */
export function spell(hours: number): string {
  return hours > 0 ? fmtDuration(hours) : "None";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "4 Jun 15:42" in UTC. */
export function dayClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hh}:${mm}`;
}

// ---------- Shared control styles ----------

export const smallButton =
  "inline-flex h-8 items-center gap-1.5 border border-ink bg-paper px-3 text-[0.844rem] font-medium text-ink transition-colors duration-150 hover:bg-paper-3 active:bg-umbra-soft disabled:cursor-not-allowed disabled:border-rule disabled:text-ink-3 disabled:hover:bg-paper";

export const primaryButton =
  "inline-flex h-8 items-center gap-1.5 border border-ink bg-ink px-3 text-[0.844rem] font-semibold text-paper transition-colors duration-150 hover:bg-umbra active:bg-ink-2 disabled:cursor-not-allowed disabled:border-rule disabled:bg-paper-3 disabled:text-ink-3";

export const linkButton =
  "text-left text-[0.844rem] font-medium text-earth underline decoration-1 underline-offset-[3px] hover:text-ink";

export const fieldLabel = "block text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-ink-2";

export const fieldControl =
  "h-8 rounded-none border border-rule bg-paper px-2 text-[0.95rem] text-ink caret-earth transition-colors duration-150 hover:border-ink-2 aria-invalid:border-ink aria-invalid:shadow-[inset_0_0_0_1px_var(--color-ink)] disabled:cursor-not-allowed disabled:text-ink-3";

/**
 * A native select in the bulletin style: square, hairline border and a drawn
 * chevron instead of the browser's. Layout classes (width, joins) go on the
 * wrapper through wrapClassName; the select fills it.
 */
export function SelectField({
  wrapClassName = "",
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { wrapClassName?: string }) {
  return (
    <span className={`relative inline-flex ${wrapClassName}`}>
      <select
        {...rest}
        className={`${fieldControl} peer w-full cursor-pointer appearance-none pr-7 [color-scheme:light] ${className}`}
      >
        {children}
      </select>
      <ChevronMark className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-2 peer-hover:text-ink peer-disabled:text-ink-3" />
    </span>
  );
}

// ---------- Drawn marks (16 px grid, 1.5 px strokes) ----------

type MarkProps = { className?: string };

export function SunMark({ className = "size-4" }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`shrink-0 ${className}`}>
      <circle cx="8" cy="8" r="5.25" className="fill-sun stroke-sun-ink" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="1.4" className="fill-sun-ink" />
    </svg>
  );
}

export function EarthMark({ className = "size-4" }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`shrink-0 ${className}`}>
      <circle cx="8" cy="8" r="5.25" className="fill-earth-soft stroke-earth" strokeWidth="1.5" />
      <path d="M8 2.75v10.5M2.75 8h10.5" className="stroke-earth" strokeWidth="1.5" />
    </svg>
  );
}

export function AlertMark({ className = "size-3.5" }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className={`shrink-0 ${className}`}>
      <path d="M8 2.25 14.25 13.5H1.75Z" className="stroke-limit" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6.5v3.25" className="stroke-limit" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="0.9" className="fill-limit" />
    </svg>
  );
}

export function ArrowMark({ className = "size-3.5" }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className={`inline-block shrink-0 align-[-0.15em] ${className}`}>
      <path d="M2.5 8h10.5M9.25 4.25 13 8l-3.75 3.75" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function ChevronMark({ className = "size-3.5" }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className={`shrink-0 ${className}`}>
      <path d="M4 6.25 8 10.25l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

export function ExternalMark({ className = "size-3.5" }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className={`shrink-0 ${className}`}>
      <path d="M9.5 2.75h3.75V6.5M13.25 2.75 7.5 8.5M11.75 9.5v3.75h-9v-9H6.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// ---------- Contacts ----------

export type ContactKind = "sunrise" | "sunset" | "earthrise" | "earthset";
export type Contact = { kind: ContactKind; atMs: number; az: number };

export const CONTACT_LABEL: Record<ContactKind, string> = {
  sunrise: "Sunrise",
  sunset: "Sunset",
  earthrise: "Earthrise",
  earthset: "Earthset",
};

/**
 * Sunrise/sunset (any of the Sun's disc clears the terrain, or the last of it
 * drops behind) and Earthrise/Earthset inside the window, to the minute. Uses
 * the same solver as the horizon plot and timeline, so the times agree.
 */
export function contactsFor(site: SiteData, startMs: number, endMs: number): Contact[] {
  return contactEvents(site, startMs, endMs).map((e) => ({
    kind: e.kind,
    atMs: Math.min(endMs, Math.round(e.ms / 60_000) * 60_000),
    az: e.az,
  }));
}

/** Plain description of the sky at one moment, for the opening and closing contacts. */
export function skyState(site: SiteData, ms: number): string {
  const s = sampleAt(site, ms);
  const sun = s.sunFraction >= 1 ? "Sun up" : s.sunFraction > 0 ? `Sun ${pct(s.sunFraction)} up` : "Sun hidden";
  return `${sun}, Earth ${s.earthUp ? "in view" : "hidden"}`;
}

/** True when the site's tracks cover [startMs, endMs]. */
export function covers(site: SiteData, startMs: number, endMs: number): boolean {
  const r = rangeOf(site.sky);
  return startMs >= r.startMs && endMs <= r.endMs;
}

// ---------- The bulletin ----------

const DAY_MS = 86_400_000;
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

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="border-t border-rule px-5 pt-3.5 pb-4">
      <h3 className="flex items-baseline justify-between gap-3 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-ink">
        {title}
        {note && <span className="text-[0.75rem] font-normal normal-case tracking-normal text-ink-2">{note}</span>}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Row({
  label,
  mark,
  value,
  was,
  flagged,
  flagNote,
}: {
  label: string;
  mark?: ReactNode;
  value: string;
  was?: string;
  flagged?: boolean;
  flagNote?: string;
}) {
  return (
    <tr className="border-b border-rule last:border-b-0">
      <th scope="row" className="py-1.5 pr-3 text-left align-baseline text-[0.844rem] font-normal text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          {mark}
          {label}
        </span>
      </th>
      <td className="py-1.5 text-right align-baseline whitespace-nowrap">
        {was !== undefined && was !== value && (
          <span className="mr-2 text-[0.75rem] text-ink-2">
            <span className="sr-only">was </span>
            {was}
            <ArrowMark className="ml-1 size-3" />
          </span>
        )}
        <span
          className={`inline-flex items-center gap-1 text-[0.95rem] font-medium ${flagged ? "font-semibold text-limit" : "text-ink"}`}
        >
          {flagged && <AlertMark />}
          {value}
          {flagged && flagNote && <span className="sr-only">, {flagNote}</span>}
        </span>
      </td>
    </tr>
  );
}

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
      <td className="py-1.5 text-right align-top whitespace-nowrap text-ink">{dayClock(at)}</td>
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
  const contacts = useMemo(() => (site ? contactsFor(site, startMs, endMs) : []), [site, startMs, endMs]);

  const better = useMemo(() => {
    if (!site || !score) return null;
    const to = startMs + LOOKAHEAD_DAYS * DAY_MS;
    if (!covers(site, startMs, to + durationHours * 3_600_000)) return null;
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
          {custom ? (customNote ?? "Custom site, tracks fetched live from JPL Horizons") : formatLatLon(lat, lon)}
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
        <p className="mt-0.5 text-[0.844rem] text-ink-2 tabular-nums">
          Window {dayClock(startMs)} to {dayClock(endMs)} UTC
        </p>
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
          <button type="button" onClick={onRetry} className={`${smallButton} mt-3`}>
            Try again
          </button>
        </div>
      )}

      {status === "ready" && site && score && (
        <>
          <Section title="Circumstances">
            <table className="w-full tabular-nums">
              <caption className="sr-only">Sunlight and Earth visibility for {name} over the mission window</caption>
              <tbody>
                <Row label="Sun up" mark={<SunMark className="size-3.5" />} value={pct(score.sunlit)} was={before ? pct(before.sunlit) : undefined} />
                <Row label="Mean disc power" value={pct(score.sunPower)} was={before ? pct(before.sunPower) : undefined} />
                <Row label="Earth in view" mark={<EarthMark className="size-3.5" />} value={pct(score.earthVisible)} was={before ? pct(before.earthVisible) : undefined} />
                <Row label="Sun and Earth" value={pct(score.both)} was={before ? pct(before.both) : undefined} />
                <Row
                  label="Longest dark"
                  value={spell(score.longestDarkHours)}
                  was={before ? spell(before.longestDarkHours) : undefined}
                  flagged={darkOver}
                  flagNote={limitText}
                />
                <Row
                  label="Longest without comms"
                  value={spell(score.longestNoCommsHours)}
                  was={before ? spell(before.longestNoCommsHours) : undefined}
                  flagged={commsOver}
                  flagNote={limitText}
                />
                <Row
                  label="Mean Sun clearance"
                  value={score.sunlit > 0 ? degrees(score.meanSunClearance) : "Never up"}
                />
                <Row label="Peak Sun clearance" value={degrees(score.maxSunClearance, true)} />
              </tbody>
            </table>
            {(darkOver || commsOver) && (
              <p className="mt-2 flex items-start gap-1.5 text-[0.75rem] text-ink-2">
                <AlertMark className="mt-px size-3" />
                <span>Red marks a gap {limitText}. Change the limit under the region table.</span>
              </p>
            )}
          </Section>

          <Section title="Contacts" note="Times in UTC">
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
                    key={`${c.kind}-${c.atMs}`}
                    name={CONTACT_LABEL[c.kind]}
                    mark={c.kind.startsWith("sun") ? <SunMark className="size-3.5" /> : <EarthMark className="size-3.5" />}
                    at={c.atMs}
                    detail={`azimuth ${degrees(c.az)}`}
                  />
                ))}
                <ContactRow name="Window closes" at={endMs} detail={skyState(site, endMs)} strong last />
              </tbody>
            </table>
          </Section>

          <Section title="Why it ranks here">
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
                  Starting <strong className="font-semibold">{dayClock(better.startMs)} UTC</strong> instead scores{" "}
                  {better.score.toFixed(2)}: Sun up {pct(better.sunlit)}, Earth {pct(better.earthVisible)}, longest dark{" "}
                  {spell(better.longestDarkHours)}. It is the best start in the next {LOOKAHEAD_DAYS} days.
                </p>
                <button type="button" onClick={() => onUseStart(better.startMs)} className={`${smallButton} mt-2`}>
                  Move start to {dayClock(better.startMs)}
                </button>
              </div>
            ) : (
              <p className="mt-3 text-[0.844rem] text-pretty text-ink-2">
                No later start in the next {LOOKAHEAD_DAYS} days scores higher here.
              </p>
            )}
          </Section>

          <Section title="Checked against NASA">
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
            <button type="button" onClick={onShowAbout} className={`${linkButton} mt-2`}>
              How the numbers are made and checked
            </button>
          </Section>
        </>
      )}
    </div>
  );
}

export default memo(SiteBulletin);

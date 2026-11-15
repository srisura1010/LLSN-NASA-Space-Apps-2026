"use client";

// "What it answers": the three planning questions, each answered live for the
// region and start date chosen in the plate above.

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { windowStats, type SiteData } from "@/lib/sky";
import { ArrowRight } from "./icons";
import { useLanding } from "./LandingState";
import {
  HOUR_MS,
  STAY_HOURS,
  contactsIn,
  fmtDate,
  fmtDay,
  fmtDayTime,
  fmtSpell,
  hourlyFlags,
  navigatorHref,
  pct,
  siteById,
  slipStart,
  toRuns,
} from "./model";

function stay(site: SiteData, startMs: number) {
  const endMs = startMs + STAY_HOURS * HOUR_MS;
  return {
    stats: windowStats(site, startMs, endMs),
    flags: hourlyFlags(site, startMs, STAY_HOURS),
    contacts: contactsIn(site, startMs, endMs),
  };
}

export function Answers() {
  const { data, dataSiteId, siteId, startMs } = useLanding();
  const site = siteById(dataSiteId ?? siteId);
  const slip = slipStart(startMs);
  const planned = useMemo(() => (data ? stay(data, startMs) : null), [data, startMs]);
  const slipped = useMemo(() => (data ? stay(data, slip.ms) : null), [data, slip.ms]);
  const earthEvents = planned?.contacts.filter((c) => c.body === "earth") ?? [];
  const slipWord = slip.later ? "later" : "earlier";

  return (
    <div>
      <p className="scroll-draw max-w-[62ch] text-[1.125rem] leading-[1.55] text-ink-2">
        These update as you change the region or the day. Right now they are for{" "}
        <span className="font-semibold text-ink">{site?.name}</span>, starting{" "}
        <span className="font-semibold whitespace-nowrap text-ink">{fmtDate(startMs)}</span>.
      </p>

      <div className="scroll-rule mt-8 h-px w-full bg-ink" />
      <div>
        <Row
          question="Is there sunlight for power?"
          detail="How much of the stay the Sun clears the hills, and the longest stretch of dark."
          value={planned ? pct(planned.stats.sunlit) : "–"}
          notes={planned ? ["of the stay in sunlight", `Longest dark stretch ${fmtSpell(planned.stats.longestDarkHours)}`] : []}
        />
        <Row
          question="Can you call Earth?"
          detail="How much of the stay Earth clears the hills, and the longest time with no direct radio link."
          value={planned ? pct(planned.stats.earthVisible) : "–"}
          notes={
            planned
              ? [
                  "of the stay with Earth in view",
                  `Longest time without Earth ${fmtSpell(planned.stats.longestNoCommsHours)}`,
                  ...earthEvents
                    .slice(0, 2)
                    .map((e) => `${e.kind === "rise" ? "Earthrise" : "Earthset"} ${fmtDayTime(e.atMs)} UTC`),
                ]
              : []
          }
        />

        <section className="scroll-draw grid gap-x-8 gap-y-5 border-b border-rule py-6 md:grid-cols-[minmax(0,1fr)_13rem]">
          <div>
            <h3 className="text-[1.266rem] leading-snug font-bold text-ink">What if you wait two weeks?</h3>
            <p className="mt-2 max-w-[60ch] text-[1rem] leading-[1.6] text-ink-2">
              Same place, two weeks {slipWord}. The Sun walks around the sky about once a month, so it ends up behind
              different hills.
            </p>
          </div>
          <div className="md:col-span-2">
            <SlipStrips
              rows={[
                { label: "As chosen", ms: startMs, s: planned },
                { label: `Two weeks ${slipWord}`, ms: slip.ms, s: slipped },
              ]}
            />
            {planned && slipped && site && (
              <p className="mt-5 flex flex-col gap-3 text-[1rem] leading-[1.6] text-ink sm:flex-row sm:items-baseline sm:justify-between">
                <span>
                  Sunlight goes from <strong className="font-semibold">{pct(planned.stats.sunlit)}</strong> to{" "}
                  <strong className="font-semibold">{pct(slipped.stats.sunlit)}</strong>. Time with Earth in view goes
                  from <strong className="font-semibold">{pct(planned.stats.earthVisible)}</strong> to{" "}
                  <strong className="font-semibold">{pct(slipped.stats.earthVisible)}</strong>.
                </span>
                <Link
                  href={navigatorHref(site.id, slip.ms)}
                  className="inline-flex shrink-0 items-center gap-2 font-semibold text-ink underline decoration-rule decoration-1 underline-offset-[5px] transition-colors duration-150 hover:decoration-ink"
                >
                  Open the {fmtDay(slip.ms)} window
                  <ArrowRight />
                </Link>
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Row({ question, detail, value, notes }: { question: string; detail: string; value: string; notes: string[] }) {
  return (
    <section className="scroll-draw grid gap-x-8 gap-y-3 border-b border-rule py-6 md:grid-cols-[minmax(0,1fr)_13rem]">
      <div>
        <h3 className="text-[1.266rem] leading-snug font-bold text-ink">{question}</h3>
        <p className="mt-2 max-w-[60ch] text-[1rem] leading-[1.6] text-ink-2">{detail}</p>
      </div>
      <p className="md:text-right">
        <span className="block text-[1.602rem] leading-none font-bold text-ink tabular-nums">{value}</span>
        {notes.map((n, i) => (
          <span key={i} className={`block text-[0.889rem] leading-snug ${i ? "text-ink" : "mt-1.5 text-ink-2"}`}>
            {n}
          </span>
        ))}
      </p>
    </section>
  );
}

type StayFacts = ReturnType<typeof stay> | null;

function SlipStrips({ rows }: { rows: { label: string; ms: number; s: StayFacts }[] }) {
  return (
    <div className="grid gap-5">
      {rows.map((r) => (
        <div key={r.label} className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-5">
          <p className="text-[0.889rem] leading-snug">
            <span className="block font-semibold text-ink">{r.label}</span>
            <span className="block text-ink-2">from {fmtDay(r.ms)}</span>
          </p>
          <div className="grid gap-1.5">
            <StripRow name="Sun" flags={r.s?.flags.sun} value={r.s ? pct(r.s.stats.sunlit) : "–"} kind="sun" />
            <StripRow
              name="Earth"
              flags={r.s?.flags.earth}
              value={r.s ? pct(r.s.stats.earthVisible) : "–"}
              kind="earth"
            />
          </div>
        </div>
      ))}
      <div className="grid sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-5">
        <span className="hidden sm:block" />
        <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_3rem] gap-3">
          <span />
          <HourAxis />
          <span />
        </div>
      </div>
    </div>
  );
}

function StripRow({
  name,
  flags,
  value,
  kind,
}: {
  name: string;
  flags: boolean[] | undefined;
  value: string;
  kind: "sun" | "earth";
}) {
  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_3rem] items-center gap-3">
      <span className="text-[0.79rem] font-semibold tracking-[0.08em] text-ink-2 uppercase">{name}</span>
      <Strip flags={flags} kind={kind} />
      <span className="text-right text-[1rem] font-semibold text-ink tabular-nums">{value}</span>
    </div>
  );
}

// Hidden spans: solid umbra for shadow, hatched umbra for lost line of sight to Earth.
const HATCH = "repeating-linear-gradient(135deg, #3d5466 0 1.5px, transparent 1.5px 5px)";

function Strip({ flags, kind }: { flags: boolean[] | undefined; kind: "sun" | "earth" }): ReactNode {
  const runs = flags ? toRuns(flags) : [];
  const n = flags?.length ?? 1;
  return (
    <div className="stay-trace relative h-4 border border-ink bg-paper" aria-hidden="true">
      {runs.map((r) => (
        <span
          key={r.from}
          className={`absolute inset-y-0 ${r.on ? (kind === "sun" ? "bg-sun" : "bg-earth") : kind === "sun" ? "bg-umbra" : ""}`}
          style={{
            left: `${(r.from / n) * 100}%`,
            width: `${((r.to - r.from) / n) * 100}%`,
            backgroundImage: !r.on && kind === "earth" ? HATCH : undefined,
          }}
        />
      ))}
      {[24, 48, 72, 96, 120, 144].map((h) => (
        <span
          key={h}
          className="absolute inset-y-0 w-px bg-paper/70 mix-blend-normal"
          style={{ left: `${(h / STAY_HOURS) * 100}%` }}
        />
      ))}
    </div>
  );
}

function HourAxis() {
  const marks = [0, 24, 48, 72, 96, 120, 144];
  return (
    <div aria-hidden="true">
      <div className="relative h-6 border-t border-ink">
        {marks.map((h) => (
          <span key={h} className="absolute top-0" style={{ left: `${(h / STAY_HOURS) * 100}%` }}>
            <span className="block h-1.5 w-px bg-ink" />
            <span className="block -translate-x-1/2 text-[0.79rem] leading-4 text-ink-2 tabular-nums">{h}</span>
          </span>
        ))}
      </div>
      <p className="text-[0.79rem] text-ink-2">Hours from the start</p>
    </div>
  );
}

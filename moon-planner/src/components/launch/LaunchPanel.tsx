"use client";

// "Launch from Earth": when to lift off, and from where, to reach the chosen
// landing site at the start of its landing window. A geometric estimate from
// src/lib/launchWindow.ts, labelled as one.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { GROUP_LABEL, launchSites, type LaunchSite, type SiteGroup } from "@/lib/launchSites";
import {
  bestOpportunity,
  DEFAULT_TRANSIT_DAYS,
  formatAzimuthRanges,
  LAUNCH_METHOD,
  launchOpportunities,
  TRANSIT_DAY_OPTIONS,
  type LaunchOpportunity,
  type Rating,
} from "@/lib/launchWindow";
import { loadSystem, systemEndMs, type SystemData } from "@/lib/system";
import { AlertMark, ChevronMark, SelectField, fieldLabel, buttonClass } from "../ui";
import LaunchDetail from "./LaunchDetail";
import { DAY_MS, Status, capsLabel, fmtDate, fmtDateTime, fmtDeg, fmtMinutes, fmtOffset, fmtWindowSpan, plainReason } from "./launchFormat";

export type LaunchPick = { launchSiteId: string; launchMs: number; arrivalMs: number };

export type LaunchPanelProps = {
  /** Start of the landing window, ms UTC: the arrival the launch aims for. */
  arrivalMs: number;
  /** Length of the landing window, hours (shown in the window chip, not here). */
  windowHours: number;
  siteName: string;
  /** Controlled selection; leave undefined to let the panel keep its own. */
  selectedLaunchSiteId?: string | null;
  onSelectLaunchSite?: (id: string) => void;
  /** Called whenever the chosen lift-off changes (site, opportunity, transfer time or arrival); null when there is none. */
  onPickOpportunity?: (o: LaunchPick | null) => void;
  /** A lift-off chosen earlier (from the URL), selected again when its site's list contains it. */
  initialPick?: LaunchPick | null;
  /** Controlled transfer time in days; leave undefined to let the panel keep its own. */
  transitDays?: number;
  onTransitDaysChange?: (days: number) => void;
  className?: string;
};

type GroupFilter = "all" | SiteGroup;
const GROUP_OPTIONS: { value: GroupFilter; label: string }[] = [
  { value: "all", label: "All sites" },
  { value: "us", label: GROUP_LABEL.us },
  { value: "nasa-partner", label: GROUP_LABEL["nasa-partner"] },
  { value: "us-partner", label: GROUP_LABEL["us-partner"] },
];

const SLIPS = [
  { label: "As planned", ms: 0 },
  { label: "+1 day", ms: DAY_MS },
  { label: "+1 week", ms: 7 * DAY_MS },
  { label: "+2 weeks", ms: 14 * DAY_MS },
];

const RATING_ORDER: Record<Rating, number> = { good: 0, costly: 1, blocked: 2 };

type SiteResult = { site: LaunchSite; list: LaunchOpportunity[]; best: LaunchOpportunity | null };

/** The search reads the Moon up to about two days either side of the arrival. */
const inData = (system: SystemData, arrivalMs: number) => arrivalMs - 2 * DAY_MS >= system.startMs && arrivalMs + 2 * DAY_MS <= systemEndMs(system);

const solveCache = new WeakMap<SystemData, Map<string, SiteResult[] | null>>();

/** Every launch site's opportunities for one arrival; cached per ephemeris, arrival and transfer time. */
function solve(system: SystemData, arrivalMs: number, transitDays: number): SiteResult[] | null {
  let bySystem = solveCache.get(system);
  if (!bySystem) solveCache.set(system, (bySystem = new Map()));
  const key = `${arrivalMs}|${transitDays}`;
  if (bySystem.has(key)) return bySystem.get(key)!;
  if (bySystem.size > 64) bySystem.clear();
  const out = !inData(system, arrivalMs)
    ? null
    : launchSites.map((site) => {
        const list = launchOpportunities(site, arrivalMs, { system, transitDays });
        return { site, list, best: bestOpportunity(list) };
      });
  bySystem.set(key, out);
  return out;
}

const rank = (a: SiteResult, b: SiteResult) => {
  if (!a.best || !b.best) return Number(!a.best) - Number(!b.best);
  return RATING_ORDER[a.best.rating] - RATING_ORDER[b.best.rating] || Math.abs(a.best.arrivalOffsetHours) - Math.abs(b.best.arrivalOffsetHours);
};

const usable = (r: SiteResult) => r.best !== null && r.best.rating !== "blocked";

const TABLE_COLS =
  "@6xl:grid-cols-[1.25rem_minmax(0,1.7fr)_8.25rem_11.75rem_4rem_4.75rem_5rem_5.5rem_minmax(0,1.2fr)] @6xl:gap-x-3";
const SLIP_COLS = "@4xl:grid-cols-[7.5rem_9.5rem_8rem_4.5rem_5rem_minmax(0,1fr)_minmax(0,1.1fr)] @4xl:gap-x-3";

/** A value with a label that shows in the stacked layout and is read out in the table layout. */
function Cell({ label, children, wide, className = "" }: { label: string; children: React.ReactNode; wide: string; className?: string }) {
  return (
    <span className={`block min-w-0 ${className}`}>
      <span className={`block ${capsLabel} ${wide}`}>{label}</span>
      {children}
    </span>
  );
}

function shortReason(o: LaunchOpportunity, site: LaunchSite): string | null {
  if (o.rating === "good") return null;
  if (o.rating === "blocked") return plainReason(o, site);
  return Math.abs(site.lat) > 52
    ? `Latitude ${Math.abs(site.lat).toFixed(0)}° forces a ${o.inclinationDeg.toFixed(0)}° orbit.`
    : `Allowed headings point off due east: a ${o.inclinationDeg.toFixed(0)}° orbit.`;
}

/** How the time of day of a lift-off moved against the plan: "52 min later", "same time". */
function clockShift(planMs: number, ms: number): string {
  const d = ((((ms - planMs) % DAY_MS) + DAY_MS + DAY_MS / 2) % DAY_MS) - DAY_MS / 2;
  const min = Math.round(d / 60_000);
  if (min === 0) return "same time of day";
  return `${fmtMinutes(Math.abs(min))} ${min > 0 ? "later" : "earlier"}`;
}

function SkeletonRows() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-rule px-4 py-3.5">
          <span className="h-3.5 w-3 bg-paper-3 motion-safe:animate-pulse" />
          <span className="h-3.5 bg-paper-3 motion-safe:animate-pulse" style={{ width: `${22 + ((i * 37) % 16)}%` }} />
          <span className="ml-auto h-3.5 w-24 bg-paper-3 motion-safe:animate-pulse" />
          <span className="hidden h-3.5 w-28 bg-paper-3 motion-safe:animate-pulse @2xl:block" />
          <span className="hidden h-3.5 w-20 bg-paper-3 motion-safe:animate-pulse @4xl:block" />
        </div>
      ))}
    </div>
  );
}

function Notice({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mx-4 my-4 flex flex-wrap items-center gap-x-4 gap-y-2 border border-ink px-3 py-2.5 text-[0.95rem] text-ink">
      <p className="min-w-0 flex-1 basis-64 text-pretty">{children}</p>
      {action}
    </div>
  );
}

export default function LaunchPanel({
  arrivalMs,
  siteName,
  selectedLaunchSiteId,
  onSelectLaunchSite,
  onPickOpportunity,
  initialPick = null,
  transitDays: transitProp,
  onTransitDaysChange,
  className = "",
}: LaunchPanelProps) {
  const id = useId();
  const [system, setSystem] = useState<SystemData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [ownTransit, setOwnTransit] = useState(DEFAULT_TRANSIT_DAYS);
  const transitDays = transitProp ?? ownTransit;
  const setTransitDays = (d: number) => {
    setOwnTransit(d);
    onTransitDaysChange?.(d);
  };
  const [group, setGroup] = useState<GroupFilter>("all");
  const [usableOnly, setUsableOnly] = useState(false);
  const [ownSelected, setOwnSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [picked, setPicked] = useState<{ siteId: string; sweep?: string; launchMs: number } | null>(() =>
    initialPick ? { siteId: initialPick.launchSiteId, launchMs: initialPick.launchMs } : null,
  );

  useEffect(() => {
    let live = true;
    loadSystem().then(
      (d) => live && setSystem(d),
      (e: unknown) => live && setError(e instanceof Error ? e.message : "The ephemeris file did not load."),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const selectedId = selectedLaunchSiteId !== undefined ? selectedLaunchSiteId : ownSelected;

  const results = useMemo(() => (system ? solve(system, arrivalMs, transitDays) : null), [system, arrivalMs, transitDays]);
  const slips = useMemo(
    () => (system ? SLIPS.map((s) => ({ ...s, arrivalMs: arrivalMs + s.ms, results: s.ms === 0 ? results : solve(system, arrivalMs + s.ms, transitDays) })) : []),
    [system, arrivalMs, transitDays, results],
  );

  const inGroup = (r: SiteResult) => group === "all" || r.site.group === group;
  const listed = (results ?? []).filter(inGroup).sort(rank);
  const rows = usableOnly ? listed.filter(usable) : listed;
  const usableCount = listed.filter(usable).length;

  const selected = results?.find((r) => r.site.id === selectedId) ?? null;
  const chosen = useMemo(() => {
    if (!selected) return null;
    const hit = picked && picked.siteId === selected.site.id ? selected.list.find((o) => (picked.sweep === undefined || o.sweep === picked.sweep) && Math.abs(o.launchMs - picked.launchMs) < 60_000) : null;
    return hit ?? selected.best;
  }, [selected, picked]);

  // Report the chosen lift-off upwards whenever it changes, however it changed.
  const onPickRef = useRef(onPickOpportunity);
  useEffect(() => {
    onPickRef.current = onPickOpportunity;
  }, [onPickOpportunity]);
  const lastKey = useRef("none");
  useEffect(() => {
    const key = chosen ? `${chosen.siteId}|${chosen.launchMs}|${chosen.arrivalMs}` : "none";
    if (key === lastKey.current) return;
    lastKey.current = key;
    onPickRef.current?.(chosen ? { launchSiteId: chosen.siteId, launchMs: chosen.launchMs, arrivalMs: chosen.arrivalMs } : null);
  }, [chosen]);

  // Bring a row's detail into view when the user opens it (not on first load).
  const revealRef = useRef<string | null>(null);
  const openId = selectedId !== null && !collapsed ? selectedId : null;
  useEffect(() => {
    const want = revealRef.current;
    if (!want || want !== openId) return;
    revealRef.current = null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`${id}-item-${want}`)?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [openId, id]);

  const select = (siteId: string) => {
    revealRef.current = siteId === selectedId && !collapsed ? null : siteId;
    if (siteId === selectedId) {
      setCollapsed((c) => !c);
      return;
    }
    setCollapsed(false);
    setPicked(null);
    setOwnSelected(siteId);
    onSelectLaunchSite?.(siteId);
  };

  // Slip analysis follows the selected site, or the top-ranked one.
  const focus = selected ?? listed[0] ?? null;
  const planBest = focus?.best ?? null;
  const slipRows = slips.map((s) => {
    const all = s.results?.filter(inGroup) ?? null;
    return {
      ...s,
      best: (focus && s.results?.find((r) => r.site.id === focus.site.id)?.best) ?? null,
      usable: all ? all.filter(usable).length : null,
      good: all ? all.filter((r) => r.best?.rating === "good").length : null,
      total: all?.length ?? 0,
    };
  });
  const slipLoss = slipRows.slice(1).find((s) => s.best?.rating === "blocked");
  const slipCost = slipRows.slice(1).find((s) => s.best?.rating === "costly" && planBest?.rating === "good");

  const loading = !system && !error;
  const outside = system !== null && results === null;

  return (
    <section aria-labelledby={`${id}-title`} className={`@container bg-paper-2 text-ink ${className}`}>
      <header className="px-4 pt-5 pb-4">
        <h2 id={`${id}-title`} className="text-[1.352rem] leading-tight font-semibold text-ink">
          Launch from Earth
        </h2>
        <p className="mt-1.5 max-w-[75ch] text-[0.95rem] text-pretty text-ink-2 tabular-nums">
          When to lift off, and from where, to reach <span className="font-semibold text-ink">{siteName}</span> at the start of the
          mission window set in the window chip above, with the whole window on the surface to follow.
        </p>
        <p className="mt-1.5 max-w-[75ch] text-[0.844rem] text-pretty text-ink-2">
          In the table, <span className="font-semibold text-ink">azimuth</span> is the compass direction of launch (90° is due east),{" "}
          <span className="font-semibold text-ink">inclination</span> is the tilt of the orbit against the equator, and{" "}
          <span className="font-semibold text-ink">rotation gain</span> is the speed the rocket gets for free from Earth&rsquo;s spin. Select a site for its
          details.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-t border-rule px-4 py-3">
        <div>
          <label htmlFor={`${id}-transit`} className={fieldLabel}>
            Transfer time
          </label>
          <SelectField
            id={`${id}-transit`}
            value={transitDays}
            onChange={(e) => setTransitDays(Number(e.target.value))}
            wrapClassName="mt-1 w-[7rem]"
            className="tabular-nums"
          >
            {TRANSIT_DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </SelectField>
        </div>
        <div>
          <label htmlFor={`${id}-group`} className={fieldLabel}>
            Launch sites
          </label>
          <SelectField id={`${id}-group`} value={group} onChange={(e) => setGroup(e.target.value as GroupFilter)} wrapClassName="mt-1 w-[15.5rem] max-w-full">
            {GROUP_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </SelectField>
        </div>
        <label className="inline-flex h-8 cursor-pointer items-center gap-2 text-[0.95rem] text-ink">
          <input type="checkbox" checked={usableOnly} onChange={(e) => setUsableOnly(e.target.checked)} className="peer sr-only" />
          <span className="grid size-4 place-items-center border border-ink bg-paper outline-offset-2 outline-earth peer-checked:bg-ink peer-focus-visible:outline-2">
            <svg viewBox="0 0 12 12" aria-hidden="true" fill="none" className="size-3">
              <path d="M2 6.25 4.75 9 10 3.25" className="stroke-paper" strokeWidth="1.75" />
            </svg>
          </span>
          Usable only
        </label>
        {results && (
          <p role="status" className="ml-auto pb-1 text-[0.844rem] text-ink-2 tabular-nums">
            <span className="font-semibold text-ink">
              {usableCount} of {listed.length}
            </span>{" "}
            listed sites can launch for this arrival
          </p>
        )}
      </div>

      {/* ---------- Ranked table ---------- */}
      <div
        aria-hidden="true"
        className={`hidden items-end border-y border-ink bg-paper-2 px-4 py-1.5 @6xl:grid ${TABLE_COLS} ${capsLabel}`}
      >
        <span>#</span>
        <span>Launch site</span>
        <span>Lift-off, UTC</span>
        <span>Window, UTC</span>
        <span className="text-right">Azimuth</span>
        <span className="text-right">Inclination</span>
        <span className="text-right leading-tight">Rotation gain</span>
        <span className="text-right">Arrival</span>
        <span>Status</span>
      </div>
      <div className="border-t border-ink @6xl:border-t-0">
        {error ? (
          <Notice
            action={
              <button
                type="button"
                className={buttonClass.secondary}
                onClick={() => {
                  setError(null);
                  setAttempt((a) => a + 1);
                }}
              >
                Try again
              </button>
            }
          >
            <span role="alert">The Moon&rsquo;s 2027 positions did not load, so no launch times can be worked out. {error}</span>
          </Notice>
        ) : loading ? (
          <>
            <p role="status" className="sr-only">
              Loading the 2027 ephemeris
            </p>
            <SkeletonRows />
          </>
        ) : outside && system ? (
          <Notice>
            This landing window starts too close to the edge of the 2027 ephemeris. Launch times can be worked out for arrivals from{" "}
            {fmtDate(system.startMs + 2 * DAY_MS, true)} to {fmtDate(systemEndMs(system) - 2 * DAY_MS, true)}.
          </Notice>
        ) : (
          <>
            {usableCount === 0 && listed.length > 0 && (
              <Notice>
                <span className="inline-flex items-start gap-2">
                  <AlertMark className="mt-1 size-3.5" />
                  <span>
                    No listed site can launch directly onto a path that reaches the Moon for this arrival. Try another transfer time, or widen the list of
                    sites.
                  </span>
                </span>
              </Notice>
            )}
            {rows.length === 0 && listed.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-4 text-[0.95rem] text-ink-2">
                <span>All {listed.length} listed sites are blocked, and blocked sites are hidden.</span>
                <button type="button" className={buttonClass.secondary} onClick={() => setUsableOnly(false)}>
                  Show blocked sites
                </button>
              </div>
            )}
            <ol aria-label="Launch sites, usable first, then by how close the arrival is to the one asked for. Select one for its details.">
              {rows.map((r, i) => {
                const o = r.best;
                const on = r.site.id === selectedId;
                const open = on && !collapsed;
                const span = o ? fmtWindowSpan(o) : null;
                const reason = o ? shortReason(o, r.site) : null;
                return (
                  <li key={r.site.id} id={`${id}-item-${r.site.id}`} className="scroll-my-2 border-b border-rule">
                    <button
                      type="button"
                      id={`${id}-row-${r.site.id}`}
                      onClick={() => select(r.site.id)}
                      aria-expanded={open}
                      aria-current={on ? "true" : undefined}
                      className={`relative grid w-full grid-cols-2 items-start gap-x-4 gap-y-2 py-3 pr-11 pl-4 text-left text-[0.95rem] tabular-nums transition-colors duration-150 focus-visible:outline-offset-[-2px] @xl:grid-cols-3 @3xl:grid-cols-5 @6xl:gap-y-0 @6xl:pr-4 ${TABLE_COLS} ${
                        on ? "bg-paper shadow-[inset_0_0_0_1px_var(--color-ink)]" : "hover:bg-paper active:bg-paper-3"
                      }`}
                    >
                      <span className="hidden font-semibold text-ink @6xl:block">
                        <span className="sr-only">Rank </span>
                        {i + 1}
                      </span>
                      <span className="col-span-full min-w-0 @6xl:col-span-1">
                        <span className={`block leading-snug text-balance text-ink ${on ? "font-semibold" : "font-medium"}`}>{r.site.name}</span>
                        <span className="block text-[0.844rem] text-ink-2">
                          {r.site.country} · {r.site.operator}
                        </span>
                      </span>
                      {o ? (
                        <>
                          <Cell label="Lift-off, UTC" wide="@6xl:sr-only" className="col-span-full @xl:col-span-1">
                            <span className="font-semibold text-ink">{fmtDateTime(o.launchMs, false)}</span>
                          </Cell>
                          <Cell label="Window, UTC" wide="@6xl:sr-only">
                            {span ? (
                              <>
                                <span className="block text-ink">{span}</span>
                                <span className="block text-[0.844rem] text-ink-2">{fmtMinutes(o.windowMinutes)}</span>
                              </>
                            ) : (
                              <span className="text-ink-2">No window</span>
                            )}
                          </Cell>
                          <Cell label="Azimuth" wide="@6xl:sr-only" className="@6xl:text-right">
                            {fmtDeg(o.azimuthDeg)}
                          </Cell>
                          <Cell label="Inclination" wide="@6xl:sr-only" className="@6xl:text-right">
                            {fmtDeg(o.inclinationDeg)}
                          </Cell>
                          <Cell label="Rotation gain" wide="@6xl:sr-only" className="@6xl:text-right">
                            {Math.round(o.rotationBoostMs)} m/s
                          </Cell>
                          <Cell label="Arrival" wide="@6xl:sr-only" className="@6xl:text-right">
                            {fmtOffset(o.arrivalOffsetHours)}
                          </Cell>
                          <span className="col-span-full min-w-0 @6xl:col-span-1 @6xl:pr-7">
                            <Status rating={o.rating} />
                            {reason && <span className="block text-[0.844rem] text-pretty text-ink-2">{reason}</span>}
                          </span>
                        </>
                      ) : (
                        <span className="col-span-full text-ink-2 @6xl:col-[3/-1]">No opportunity inside the search span.</span>
                      )}
                      <ChevronMark className={`absolute top-3.5 right-4 size-4 text-ink-2 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
                    </button>
                    {open && (
                      <LaunchDetail
                        site={r.site}
                        list={r.list}
                        chosen={chosen}
                        transitDays={transitDays}
                        headingId={`${id}-row-${r.site.id}`}
                        onChoose={(c) => setPicked({ siteId: r.site.id, sweep: c.sweep, launchMs: c.launchMs })}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      {/* ---------- Slip analysis ---------- */}
      {results && focus && planBest && (
        <section aria-labelledby={`${id}-slip`} className="px-4 pt-7 pb-2">
          <h3 id={`${id}-slip`} className="text-[1.068rem] leading-tight font-semibold text-ink">
            If the landing slips
          </h3>
          <p className="mt-1 max-w-[75ch] text-[0.95rem] text-pretty text-ink-2">
            The same search, run again for a later arrival, from <span className="font-semibold text-ink">{focus.site.name}</span>
            {selected ? "" : " (the top-ranked site; select another to follow it)"}.{" "}
            {slipLoss ? (
              <span className="font-semibold text-limit">
                A slip of {slipLoss.label.slice(1)} leaves this site blocked.
              </span>
            ) : slipCost ? (
              <span className="font-semibold text-ink">A slip of {slipCost.label.slice(1)} keeps the site usable, but at a cost.</span>
            ) : (
              <span className="font-semibold text-ink">
                {planBest.rating === "blocked" ? "The site is blocked as planned." : "The site stays usable through all three slips."}
              </span>
            )}
          </p>
          <div aria-hidden="true" className={`mt-3 hidden items-end border-b border-ink pb-1.5 @4xl:grid ${SLIP_COLS} ${capsLabel}`}>
            <span>Landing starts</span>
            <span>Lift-off, UTC</span>
            <span>Time of day</span>
            <span className="text-right">Azimuth</span>
            <span className="text-right">Inclination</span>
            <span>Status</span>
            <span>Listed sites usable</span>
          </div>
          <ul className="mt-3 border-t border-ink @4xl:mt-0 @4xl:border-t-0">
            {slipRows.map((s) => (
              <li key={s.label} className={`grid grid-cols-2 items-start gap-x-4 gap-y-2 border-b border-rule py-2.5 text-[0.95rem] tabular-nums @xl:grid-cols-3 @4xl:gap-y-0 ${SLIP_COLS}`}>
                <span className="col-span-full @4xl:col-span-1">
                  <span className="font-semibold text-ink">{s.label}</span>
                  <span className="ml-2 text-[0.844rem] text-ink-2 @4xl:ml-0 @4xl:block">{fmtDate(s.arrivalMs)}</span>
                </span>
                {s.results === null ? (
                  <span className="col-span-full text-ink-2 @4xl:col-[2/-1]">Outside the 2027 ephemeris, so not worked out.</span>
                ) : !s.best ? (
                  <span className="col-span-full text-ink-2 @4xl:col-[2/-1]">No opportunity inside the search span.</span>
                ) : (
                  <>
                    <Cell label="Lift-off, UTC" wide="@4xl:sr-only">
                      <span className="font-semibold text-ink">{fmtDateTime(s.best.launchMs, false)}</span>
                    </Cell>
                    <Cell label="Time of day" wide="@4xl:sr-only">
                      <span className="text-ink-2">{s.ms === 0 ? "Plan" : clockShift(planBest.launchMs, s.best.launchMs)}</span>
                    </Cell>
                    <Cell label="Azimuth" wide="@4xl:sr-only" className="@4xl:text-right">
                      {fmtDeg(s.best.azimuthDeg)}
                    </Cell>
                    <Cell label="Inclination" wide="@4xl:sr-only" className="@4xl:text-right">
                      {fmtDeg(s.best.inclinationDeg)}
                    </Cell>
                    <span className="min-w-0">
                      <Status rating={s.best.rating} />
                    </span>
                    <Cell label="Listed sites usable" wide="@4xl:sr-only" className="col-span-full @xl:col-span-1">
                      <span className="font-semibold text-ink">
                        {s.usable} of {s.total}
                      </span>
                      <span className="text-[0.844rem] text-ink-2"> ({s.good} without a cost)</span>
                    </Cell>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.844rem] text-ink-2 tabular-nums">
            Allowed launch directions (azimuths) at {focus.site.name}: {formatAzimuthRanges(focus.site)} ({focus.site.azimuthSource}).
          </p>
        </section>
      )}

      {/* ---------- Honest labelling ---------- */}
      <aside aria-labelledby={`${id}-method`} className="mx-4 mt-6 mb-6 border border-ink bg-paper px-4 py-3.5">
        <h3 id={`${id}-method`} className="text-[0.95rem] font-semibold text-ink">
          Estimate, not a trajectory design
        </h3>
        <p className="mt-1 max-w-[80ch] text-[0.844rem] text-pretty text-ink-2">
          Simplified geometry: the spacecraft leaves in the flat plane that holds Earth&rsquo;s centre, the launch site at lift-off and the Moon at arrival.
          A launch window is the time the compass direction it needs (the azimuth) stays inside the directions the site allows. Checked against Apollo 11,
          the estimate comes within about 20 minutes and 2°. The Moon&rsquo;s gravity, the energy of the departure burn, braking into lunar orbit, mid-flight
          turns (doglegs), weather and range scheduling are left out. Direction limits marked approximate are estimated from geography or commonly quoted
          figures; they are not range-safety data.
        </p>
        <details className="group mt-2">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[0.844rem] font-medium text-earth underline decoration-1 underline-offset-[3px] hover:text-ink [&::-webkit-details-marker]:hidden">
            Full method and what it leaves out
            <ChevronMark className="size-3.5 transition-transform duration-150 group-open:rotate-180" />
          </summary>
          <div className="mt-2 max-w-[80ch] space-y-2 text-[0.844rem] text-pretty text-ink-2">
            {LAUNCH_METHOD.split("\n").map((p) => (
              <p key={p.slice(0, 24)}>{p}</p>
            ))}
          </div>
        </details>
      </aside>
    </section>
  );
}

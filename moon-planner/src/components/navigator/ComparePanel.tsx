"use client";

import { useId, useMemo, type ReactNode } from "react";
import { compareScores, rankSites, scoreWindow, windowStats, type MissionScore, type SiteData } from "@/lib/sky";
import { fmtDuration } from "./plot/format";
import TimelineStrip from "./TimelineStrip";
import { DATA_END_MS, DAY, HOUR, fmtLength, fmtSpan, fmtWhen } from "./MissionControls";
import { AlertMark, EarthMark, SunMark, contactsFor, covers, pct, spell } from "./SiteBulletin";

export type CompareOption = {
  id: string;
  name: string;
  custom?: boolean;
  /** Measured against a smooth horizon (a point picked at the Moon level): shown beside the regions, never ranked or scored. */
  noTerrain?: boolean;
  site: SiteData | null;
};

type Props = {
  options: CompareOption[];
  picked: string[];
  onPickedChange: (ids: string[]) => void;
  /** Every site with data, for ranking each slipped start. */
  rankable: Map<string, SiteData>;
  /** Current window: tied rank and stats per site id. */
  ranks: Map<string, number>;
  scores: Map<string, MissionScore>;
  total: number;
  loading: boolean;
  startMs: number;
  durationHours: number;
  nowMs: number;
  onScrub: (ms: number) => void;
  limitHours: number;
  note?: ReactNode;
};

const MAX_PICKS = 3;
const SLIPS = [0, 7, 14];

/**
 * Ranks in rankSites order (1, 2, 3, 3, 5). Two regions share a rank only
 * when compareScores finds nothing between them: the same score, the same
 * peak Sun clearance and the same Earth time.
 */
export function tiedRanks(scores: MissionScore[]): Map<string, number> {
  const out = new Map<string, number>();
  scores.forEach((s, i) => {
    const prev = scores[i - 1];
    out.set(s.siteId, prev && compareScores(prev, s) === 0 ? out.get(prev.siteId)! : i + 1);
  });
  return out;
}

type Measure = {
  label: string;
  mark?: ReactNode;
  value: (s: MissionScore, id: string) => number;
  show: (s: MissionScore, id: string) => string;
  /** Rank and score: a point with no terrain has neither. */
  rankedOnly?: string;
  better: "high" | "low";
  flag?: (s: MissionScore) => boolean;
};

function NoTerrainTag({ className = "" }: { className?: string }) {
  return <span className={`text-[0.75rem] font-semibold tracking-[0.06em] whitespace-nowrap text-ink-2 uppercase ${className}`}>No terrain</span>;
}

const th = "py-2 pr-4 text-left align-bottom text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-ink-2";
const tdNum = "py-2 pl-4 text-right align-baseline tabular-nums whitespace-nowrap";

export default function ComparePanel({
  options,
  picked,
  onPickedChange,
  rankable,
  ranks,
  scores,
  total,
  loading,
  startMs,
  durationHours,
  nowMs,
  onScrub,
  limitHours,
  note,
}: Props) {
  const id = useId();
  const endMs = startMs + durationHours * HOUR;
  const chosen = picked
    .map((p) => options.find((o) => o.id === p))
    .filter((o): o is CompareOption => !!o && !!o.site && (!!o.noTerrain || scores.has(o.id)));
  const anyNoTerrain = chosen.some((o) => o.noTerrain);
  /** Stats for a column: from the ranking, or for a no-terrain point computed here and kept out of it. */
  const statsOf = (o: CompareOption, s = startMs, ranked: Map<string, MissionScore> | null = scores): MissionScore | undefined =>
    o.noTerrain ? (covers(o.site!, s, s + durationHours * HOUR) ? scoreWindow(o.id, windowStats(o.site!, s, s + durationHours * HOUR)) : undefined) : ranked?.get(o.id);

  // A few hundred hourly steps per site: cheap enough to recount on each render.
  const contactCounts = new Map(chosen.map((o) => [o.id, contactsFor(o.site!, startMs, endMs).length]));
  const pointName = chosen.find((o) => o.noTerrain)?.name;

  const slips = useMemo(
    () =>
      SLIPS.map((days) => {
        const s = startMs + days * DAY;
        const e = s + durationHours * HOUR;
        if (e > DATA_END_MS) return { days, startMs: s, scores: null, ranks: null, count: 0 };
        const usable = new Map([...rankable].filter(([, d]) => covers(d, s, e)));
        const ranked = rankSites(usable, s, durationHours);
        return {
          days,
          startMs: s,
          scores: new Map(ranked.map((r) => [r.siteId, r])),
          ranks: tiedRanks(ranked),
          count: ranked.length,
        };
      }),
    [rankable, startMs, durationHours],
  );

  const measures: Measure[] = [
    { label: "Rank", value: (_, i) => ranks.get(i) ?? Infinity, show: (_, i) => `${ranks.get(i)} of ${total}`, better: "low", rankedOnly: "Not ranked" },
    { label: "Score", value: (s) => s.score, show: (s) => s.score.toFixed(2), better: "high", rankedOnly: "Not scored" },
    { label: "Sun up", mark: <SunMark className="size-3.5" />, value: (s) => s.sunlit, show: (s) => pct(s.sunlit), better: "high" },
    { label: "Mean disc power", value: (s) => s.sunPower, show: (s) => pct(s.sunPower), better: "high" },
    {
      label: "Earth in view",
      mark: <EarthMark className="size-3.5" />,
      value: (s) => s.earthVisible,
      show: (s) => pct(s.earthVisible),
      better: "high",
    },
    { label: "Sun and Earth together", value: (s) => s.both, show: (s) => pct(s.both), better: "high" },
    {
      label: "Longest dark",
      value: (s) => s.longestDarkHours,
      show: (s) => spell(s.longestDarkHours),
      better: "low",
      flag: (s) => s.longestDarkHours > limitHours,
    },
    {
      label: "Longest without comms",
      value: (s) => s.longestNoCommsHours,
      show: (s) => spell(s.longestNoCommsHours),
      better: "low",
      flag: (s) => s.longestNoCommsHours > limitHours,
    },
    {
      label: "Rises and sets in window",
      value: (_, i) => contactCounts.get(i) ?? 0,
      show: (_, i) => String(contactCounts.get(i) ?? 0),
      better: "low",
    },
  ];

  function toggle(optionId: string) {
    if (picked.includes(optionId)) onPickedChange(picked.filter((p) => p !== optionId));
    else if (picked.length < MAX_PICKS) onPickedChange([...picked, optionId]);
  }

  const limitText = `longer than the ${fmtDuration(limitHours)} gap limit`;

  return (
    <div className="mx-auto w-full max-w-[80rem] px-4 py-5 xl:px-8 xl:py-6">
      <header>
        <h2 className="text-[1.2rem] font-semibold leading-tight text-ink">Compare regions</h2>
        <p className="mt-1 text-[0.95rem] text-ink-2 tabular-nums">
          Every region over the same window: {fmtSpan(startMs, endMs)}, {fmtLength(durationHours)}.
        </p>
      </header>

      {note && <div className="mt-4 max-w-[34rem]">{note}</div>}

      <fieldset className="mt-5">
        <legend className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-ink">
          Pick two or three <span className="font-normal normal-case tracking-normal text-ink-2">({picked.length} of {MAX_PICKS})</span>
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {options.map((o) => {
            const on = picked.includes(o.id);
            const full = !on && picked.length >= MAX_PICKS;
            const unavailable = !o.site;
            return (
              <label
                key={o.id}
                className={`inline-flex h-8 cursor-pointer items-center gap-2 border px-2.5 text-[0.844rem] transition-colors duration-150 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-earth ${
                  on ? "border-ink bg-paper-3 font-semibold text-ink" : "border-rule bg-paper text-ink hover:border-ink-2"
                } ${full || unavailable ? "cursor-not-allowed text-ink-3 hover:border-rule" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={full || unavailable}
                  onChange={() => toggle(o.id)}
                  className="size-3.5 accent-ink focus-visible:outline-none"
                />
                {o.name}
                {o.custom && <span className="text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-ink-2">Custom</span>}
                {o.noTerrain && <NoTerrainTag />}
              </label>
            );
          })}
        </div>
      </fieldset>

      {loading ? (
        <div aria-hidden="true" className="mt-6 space-y-2">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="h-5 w-full max-w-[48rem] bg-paper-3 motion-safe:animate-pulse" />
          ))}
        </div>
      ) : chosen.length < 2 ? (
        <div className="mt-6 max-w-[56ch] border-t border-ink pt-4">
          <p className="text-[0.95rem] text-ink">
            {chosen.length === 0
              ? "Pick at least two regions above to put them side by side."
              : `${chosen[0].name} is picked. Add one or two more regions to compare them.`}
          </p>
          <p className="mt-1 text-[0.844rem] text-ink-2">
            Each region is measured over the same mission window from the bar at the top, so changing the start or length
            updates every column.
          </p>
        </div>
      ) : (
        <>
          <section aria-labelledby={`${id}-stats`} className="mt-6">
            <h3 id={`${id}-stats`} className="sr-only">
              Side by side
            </h3>
            <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Side-by-side table, scrolls sideways">
              <table className="w-full tabular-nums" style={{ minWidth: `${10 + chosen.length * 6}rem` }}>
                <caption className="sr-only">Sunlight and Earth visibility over the same window, best value in bold</caption>
                <thead>
                  <tr className="border-b border-ink">
                    <th scope="col" className={th}>
                      <span className="sr-only">Measure</span>
                    </th>
                    {chosen.map((o) => (
                      <th key={o.id} scope="col" className="py-2 pl-4 text-right align-bottom text-[0.95rem] font-semibold text-ink">
                        {o.name}
                        {o.noTerrain && <NoTerrainTag className="block" />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {measures.map((m) => {
                    const vals = chosen.map((o) => m.value(statsOf(o)!, o.id));
                    // Best is judged among the regions with terrain only.
                    const rankedVals = vals.filter((_, i) => !chosen[i].noTerrain);
                    const bestVal = m.better === "high" ? Math.max(...rankedVals) : Math.min(...rankedVals);
                    const allSame = rankedVals.every((v) => Math.abs(v - rankedVals[0]) < 1e-9);
                    return (
                      <tr key={m.label} className="border-b border-rule">
                        <th scope="row" className="py-2 pr-4 text-left text-[0.844rem] font-normal text-ink-2">
                          <span className="inline-flex items-center gap-1.5">
                            {m.mark}
                            {m.label}
                          </span>
                        </th>
                        {chosen.map((o, i) => {
                          const s = statsOf(o)!;
                          if (o.noTerrain && m.rankedOnly)
                            return (
                              <td key={o.id} className={`${tdNum} text-[0.844rem] text-ink-2`}>
                                {m.rankedOnly}
                              </td>
                            );
                          const best = !o.noTerrain && !allSame && Math.abs(vals[i] - bestVal) < 1e-9;
                          const flagged = m.flag?.(s) ?? false;
                          return (
                            <td
                              key={o.id}
                              className={`${tdNum} text-[0.95rem] ${flagged ? "font-semibold text-limit" : best ? "font-semibold text-ink" : "text-ink"}`}
                            >
                              <span className="inline-flex items-center justify-end gap-1">
                                {flagged && <AlertMark className="size-3" />}
                                {m.show(s, o.id)}
                              </span>
                              {best && <span className="sr-only"> (best)</span>}
                              {flagged && <span className="sr-only">, {limitText}</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 max-w-[80ch] text-[0.75rem] text-ink-2">
              Bold marks the best value in each row. Red marks a gap {limitText}.
              {anyNoTerrain &&
                " A column marked No terrain is a point picked at the Moon level, measured against a smooth horizon: hills and crater rims are not included, so it is not ranked or scored and never takes the bold. Read its numbers beside the regions, not against them."}
            </p>
          </section>

          <section aria-labelledby={`${id}-time`} className="mt-7">
            <h3 id={`${id}-time`} className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-ink">
              Over the window
            </h3>
            <p className="mt-1 text-[0.844rem] text-ink-2">
              One time axis for every region. Drag along the strip, or use the arrow keys on it, to move the time marker.
              {pointName && ` The bands for ${pointName} are for a smooth horizon with no terrain.`}
            </p>
            <TimelineStrip
              site={chosen[0].site!}
              siteName={chosen[0].name}
              startMs={startMs}
              endMs={endMs}
              nowMs={nowMs}
              onScrub={onScrub}
              compareSites={chosen.slice(1).map((o) => ({ name: o.name, site: o.site! }))}
              className="mt-3 w-full"
            />
          </section>

          <section aria-labelledby={`${id}-slip`} className="mt-8">
            <h3 id={`${id}-slip`} className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-ink">
              If the start slips
            </h3>
            <p className="mt-1 max-w-[70ch] text-[0.844rem] text-ink-2">
              The same {fmtLength(durationHours)} mission starting as planned, one week later and two weeks later. Rank is
              among every site at that start.
            </p>
            <p className="mt-2 text-[0.75rem] text-ink-2 md:hidden">Swipe the table sideways for the later starts.</p>
            <div className="relative mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Slip table, scrolls sideways">
              <table className="w-full min-w-[46rem] tabular-nums">
                <caption className="sr-only">Rank, Sun, Earth and longest dark for each start</caption>
                <thead>
                  <tr>
                    <th scope="col" rowSpan={2} className={`${th} border-b border-ink`}>
                      Region
                    </th>
                    {slips.map((s) => (
                      <th
                        key={s.days}
                        scope="colgroup"
                        colSpan={4}
                        className="border-l border-rule px-3 pb-1 text-left text-[0.844rem] font-semibold text-ink"
                      >
                        {s.days === 0 ? "As planned" : `+${s.days / 7} ${s.days === 7 ? "week" : "weeks"}`}
                        <span className="block text-[0.75rem] font-normal text-ink-2">{fmtWhen(s.startMs)} UTC</span>
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-ink">
                    {slips.map((s) =>
                      ["Rank", "Sun", "Earth", "Dark"].map((h, k) => (
                        <th
                          key={`${s.days}-${h}`}
                          scope="col"
                          className={`${th} text-right ${k === 0 ? "border-l border-rule pl-3" : ""}`}
                        >
                          {h}
                        </th>
                      )),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {chosen.map((o) => (
                    <tr key={o.id} className="border-b border-rule">
                      <th scope="row" className="py-2 pr-4 text-left text-[0.95rem] font-medium text-ink">
                        {o.name}
                        {o.noTerrain && <NoTerrainTag className="ml-2" />}
                      </th>
                      {slips.map((s) => {
                        const sc = s.scores ? statsOf(o, s.startMs, s.scores) : undefined;
                        if (!sc)
                          return (
                            <td key={s.days} colSpan={4} className="border-l border-rule py-2 pl-3 text-[0.844rem] text-ink-2">
                              {s.scores ? "No tracks for this start" : "Past the end of the 2027 tracks"}
                            </td>
                          );
                        const over = sc.longestDarkHours > limitHours;
                        return [
                          <td key={`${s.days}-r`} className={`${tdNum} border-l border-rule pl-3 text-[0.95rem] font-semibold text-ink`}>
                            {o.noTerrain ? (
                              <span className="text-[0.844rem] font-normal text-ink-2">Not ranked</span>
                            ) : (
                              <>
                                {s.ranks?.get(o.id)}
                                <span className="text-[0.75rem] font-normal text-ink-2"> of {s.count}</span>
                              </>
                            )}
                          </td>,
                          <td key={`${s.days}-s`} className={`${tdNum} text-[0.95rem] text-ink`}>
                            {pct(sc.sunlit)}
                          </td>,
                          <td key={`${s.days}-e`} className={`${tdNum} text-[0.95rem] text-ink`}>
                            {pct(sc.earthVisible)}
                          </td>,
                          <td
                            key={`${s.days}-d`}
                            className={`${tdNum} text-[0.95rem] ${over ? "font-semibold text-limit" : "text-ink"}`}
                          >
                            <span className="inline-flex items-center justify-end gap-1">
                              {over && <AlertMark className="size-3" />}
                              {spell(sc.longestDarkHours)}
                            </span>
                            {over && <span className="sr-only">, {limitText}</span>}
                          </td>,
                        ];
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-5 space-y-5">
              {chosen.map((o) => (
                <TimelineStrip
                  key={o.id}
                  site={o.site!}
                  siteName={o.name}
                  startMs={startMs}
                  endMs={endMs}
                  nowMs={nowMs}
                  onScrub={onScrub}
                  compareSites={SLIPS.filter((d) => d > 0 && endMs + d * DAY <= DATA_END_MS).map((d) => ({
                    name: o.name,
                    site: o.site!,
                    offsetMs: d * DAY,
                  }))}
                  className="w-full"
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

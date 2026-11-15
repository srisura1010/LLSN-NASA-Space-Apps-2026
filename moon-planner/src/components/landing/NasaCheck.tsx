"use client";

// Year-2027 sunlight share from the app's own files, side by side with NASA's
// long-term LOLA illumination at the same region centres. Loads when the table
// comes near the viewport.

import { useEffect, useRef, useState } from "react";
import { loadSite, windowStats } from "@/lib/sky";
import { siteById } from "./model";

// Mazarico et al. 2011 average illumination (PGDA product 69), sampled at the region centres.
const NASA = [
  { id: "cabeus-b", nasa: 0.384 },
  { id: "nobile-2", nasa: 0.416 },
  { id: "slater", nasa: 0.03 },
];

// Every hour of 2027, 00:00 1 Jan to 23:00 31 Dec UTC.
const YEAR_START = Date.UTC(2027, 0, 1);
const YEAR_LAST_HOUR = Date.UTC(2027, 11, 31, 23);

const head = "py-2.5 text-[0.79rem] font-semibold tracking-[0.08em] text-ink-2 uppercase";

export function NasaCheck() {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [ours, setOurs] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState<Record<string, true>>({});

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    for (const r of NASA) {
      if (ours[r.id] !== undefined || failed[r.id]) continue;
      loadSite(r.id).then(
        (d) => setOurs((p) => ({ ...p, [r.id]: windowStats(d, YEAR_START, YEAR_LAST_HOUR).sunlit })),
        () => setFailed((p) => ({ ...p, [r.id]: true })),
      );
    }
  }, [near, ours, failed]);

  return (
    <div ref={ref} className="overflow-x-auto">
      <table className="w-full min-w-[20rem] border-collapse text-left">
        <caption className="caption-top pb-3 text-left text-[0.889rem] leading-snug text-ink-2">
          Share of hours with any of the Sun above the terrain horizon. This model: every hour of 2027. NASA: the
          long-term LOLA average at the same point.
        </caption>
        <thead>
          <tr className="border-y border-ink">
            <th scope="col" className={`${head} pr-4`}>
              Region
            </th>
            <th scope="col" className={`${head} pr-4 text-right`}>
              This model
            </th>
            <th scope="col" className={`${head} pr-4 text-right`}>
              NASA
            </th>
            <th scope="col" className={`${head} text-right`}>
              Difference
            </th>
          </tr>
        </thead>
        <tbody>
          {NASA.map((r) => {
            const v = ours[r.id];
            const d = v === undefined ? null : (v - r.nasa) * 100;
            return (
              <tr key={r.id} className="border-b border-rule">
                <th scope="row" className="py-3 pr-4 text-[1rem] font-semibold text-ink">
                  {siteById(r.id)?.name}
                </th>
                <td className="py-3 pr-4 text-right text-[1rem] text-ink tabular-nums">
                  {v !== undefined ? `${(v * 100).toFixed(1)}%` : failed[r.id] ? "not loaded" : "…"}
                </td>
                <td className="py-3 pr-4 text-right text-[1rem] text-ink tabular-nums">{(r.nasa * 100).toFixed(1)}%</td>
                <td className="py-3 text-right text-[1rem] font-semibold text-ink tabular-nums">
                  {d === null ? "" : `${d < 0 ? "−" : "+"}${Math.abs(d).toFixed(1)} pts`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

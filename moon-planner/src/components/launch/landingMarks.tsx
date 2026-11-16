// Marks and the stay timeline for the landing site, shared by the launch table,
// the slip table and the detail.

import { visibilitySpans, type Body } from "@/lib/contacts";
import { DAY_MS, HOUR_MS, fmtDay, fmtDuration, pct } from "@/lib/format";
import type { LandingConditions } from "@/lib/launchLanding";
import type { SiteData } from "@/lib/sky";
import { StateSwatch } from "../ui";

export const ORBIT_OPTIONS = [
  { hours: 0, label: "None" },
  { hours: 12, label: "12 h" },
  { hours: 24, label: "1 day" },
  { hours: 48, label: "2 days" },
  { hours: 72, label: "3 days" },
];

export const orbitLabel = (h: number) => ORBIT_OPTIONS.find((o) => o.hours === h)?.label ?? fmtDuration(h);

/** Two state squares (Sun, Earth) with their text alternatives. */
export function LandingMarks({ c, className = "" }: { c: LandingConditions; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-body text-ink ${className}`}>
      <span className="inline-flex items-center gap-1">
        <StateSwatch body="sun" up={c.sunUp} />
        Sun<span className="sr-only">{c.sunUp ? " up" : " down"}</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <StateSwatch body="earth" up={c.earthUp} />
        Earth<span className="sr-only">{c.earthUp ? " in view" : " not in view"}</span>
      </span>
    </span>
  );
}

/** Marks plus "Sun up NN% of stay". */
export function LandingCell({ c }: { c: LandingConditions }) {
  return (
    <>
      <LandingMarks c={c} className="block" />
      <span className="block text-body text-ink-2">Sun up {pct(c.stay.sunlit)} of stay</span>
    </>
  );
}

function Band({ spans, body, frac }: { spans: ReturnType<typeof visibilitySpans>; body: Body; frac: (ms: number) => number }) {
  const on = body === "sun" ? "bg-sun" : "bg-earth";
  const off = body === "sun" ? "bg-umbra" : "bg-umbra-soft";
  return (
    <div className="relative h-3.5 bg-paper-3">
      {spans.map((s) => (
        <span
          key={s.startMs}
          className={`absolute inset-y-0 block ${s.up ? on : off}`}
          style={{ left: `${(frac(s.startMs) * 100).toFixed(3)}%`, width: `${((frac(s.endMs) - frac(s.startMs)) * 100).toFixed(3)}%` }}
        />
      ))}
    </div>
  );
}

/** Two bands, Sun and Earth, over the stay from the actual landing. */
export function StayStrip({ site, startMs, endMs }: { site: SiteData; startMs: number; endMs: number }) {
  const frac = (ms: number) => (ms - startMs) / (endMs - startMs);
  const sun = visibilitySpans(site, "sun", startMs, endMs);
  const earth = visibilitySpans(site, "earth", startMs, endMs);
  const days: number[] = [];
  for (let t = Math.ceil(startMs / DAY_MS) * DAY_MS; t < endMs; t += DAY_MS) days.push(t);
  const label = (spans: typeof sun, up: string, down: string) =>
    spans.map((s) => `${s.up ? up : down} ${fmtDuration((s.endMs - s.startMs) / HOUR_MS)}`).join(", ");
  return (
    <div className="select-none">
      <p className="sr-only">
        Sun: {label(sun, "up", "down")}. Earth: {label(earth, "in view", "out of view")}.
      </p>
      <div aria-hidden="true" className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
        <span className="text-label text-ink-2">Sun</span>
        <Band spans={sun} body="sun" frac={frac} />
        <span className="text-label text-ink-2">Earth</span>
        <Band spans={earth} body="earth" frac={frac} />
        <span />
        <div className="relative h-4">
          {days.map((t) => (
            <span key={t} className="absolute top-0 h-full border-l border-rule pl-1 text-label whitespace-nowrap text-ink-2 tabular-nums" style={{ left: `${(frac(t) * 100).toFixed(3)}%` }}>
              {frac(t) < 0.9 ? fmtDay(t) : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Small formatters and marks shared by the Launch from Earth view.

import type { LaunchSite } from "@/lib/launchSites";
import { azimuthGapDeg, COSTLY_INCLINATION_DEG, type LaunchOpportunity, type Rating } from "@/lib/launchWindow";
import { AlertMark } from "../ui";

export { DAY_MS, HOUR_MS } from "@/lib/format";
import { DAY_MS, fmtDay, fmtMinutes } from "@/lib/format";
export { fmtMinutes };

const two = (n: number) => String(n).padStart(2, "0");

/** "10 Nov" */
export const fmtDate = (ms: number, withYear = false) => fmtDay(ms, withYear);

/** "21:57" */
export function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** "10 Nov 2027, 21:57" (UTC; the caller says so). */
export const fmtDateTime = (ms: number, withYear = true) => `${fmtDate(ms, withYear)}, ${fmtClock(ms)}`;

const utcDay = (ms: number) => Math.floor(ms / DAY_MS);

/** "14:58–03:25 next day"; null when blocked. */
export function fmtWindowSpan(o: LaunchOpportunity): string | null {
  if (o.windowOpenMs === null || o.windowCloseMs === null) return null;
  const days = utcDay(o.windowCloseMs) - utcDay(o.windowOpenMs);
  return `${fmtClock(o.windowOpenMs)}–${fmtClock(o.windowCloseMs)}${days > 0 ? " next day" : ""}`;
}

/** "22.1 h early", "3.4 h late", "on time" against the arrival asked for. */
export function fmtOffset(hours: number): string {
  if (Math.abs(hours) < 0.05) return "on time";
  return `${Math.abs(hours).toFixed(1)} h ${hours < 0 ? "early" : "late"}`;
}

export { fmtDeg } from "@/lib/format";

export const STATUS_LABEL: Record<Rating, string> = { good: "Usable", costly: "Usable at a cost", blocked: "Blocked" };

/** The reason for a costly or blocked rating in a short plain sentence; null when usable. */
export function plainReason(o: LaunchOpportunity, site: LaunchSite): string | null {
  if (o.rating === "blocked") {
    const gap = azimuthGapDeg(o.azimuthDeg, site.azimuths);
    return `Needs a heading of ${o.azimuthDeg.toFixed(0)}°, ${Math.max(1, Math.round(gap))}° outside what the site allows.`;
  }
  if (o.rating === "costly") {
    const gain = `keeps ${Math.round(o.rotationBoostMs)} of 465 m/s from Earth's spin`;
    return Math.abs(site.lat) > COSTLY_INCLINATION_DEG
      ? `Latitude ${Math.abs(site.lat).toFixed(0)}° forces a ${o.inclinationDeg.toFixed(0)}° orbit; ${gain}.`
      : `Allowed headings point away from due east, giving a ${o.inclinationDeg.toFixed(0)}° orbit; ${gain}.`;
  }
  return null;
}

/** Status with a drawn mark: filled cobalt square, half square, or the red alert triangle. */
export function Status({ rating, className = "" }: { rating: Rating; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[0.844rem] font-semibold whitespace-nowrap ${
        rating === "blocked" ? "text-limit" : "text-ink"
      } ${className}`}
    >
      {rating === "blocked" ? (
        <AlertMark className="size-3.5" />
      ) : (
        <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 shrink-0">
          <rect x="0.75" y="0.75" width="10.5" height="10.5" className="fill-paper stroke-earth" strokeWidth="1.5" />
          <rect x="0.75" y="0.75" width={rating === "good" ? 10.5 : 5.25} height="10.5" className="fill-earth" />
        </svg>
      )}
      {STATUS_LABEL[rating]}
    </span>
  );
}

export { capsLabel } from "../ui";

// The mission window's limits and defaults. The precomputed Horizons tracks
// run hourly through 2027, so every window has to fit inside that year.

import { DAY_MS, HOUR_MS } from "./format";

export const DATA_START_MS = Date.UTC(2027, 0, 1);
export const DATA_END_MS = Date.UTC(2028, 0, 1);
/** The tracks' one year; the start control picks a day and month in it. */
export const DATA_YEAR = 2027;

/**
 * 14 Nov 2027, 00:00 UTC: near the south pole's high Sun (subsolar point
 * about 1.5° S), so the nine regions spread from 0% to 100% Sun with no two
 * scores closer than 0.04. A June start leaves seven regions dark all window.
 */
export const DEFAULT_START_MS = Date.UTC(2027, 10, 14);
export const DEFAULT_HOURS = 156; // 6.5 days
export const MIN_HOURS = 1;
export const MAX_HOURS = 60 * 24;

/** Default limit (hours) above which a dark spell or comms gap is flagged. */
export const DEFAULT_GAP = 48;
export const GAP_LIMITS = [12, 24, 48, 72, 96, 168];

/** The schedule steps every slip analysis uses: as planned, +1 day, +1 week, +2 weeks. */
export const SLIP_STEPS: { label: string; ms: number }[] = [
  { label: "As planned", ms: 0 },
  { label: "+1 day", ms: DAY_MS },
  { label: "+1 week", ms: 7 * DAY_MS },
  { label: "+2 weeks", ms: 14 * DAY_MS },
];

/** Latest start for a window of `hours` that still ends inside the tracks. */
export function latestStart(hours: number): number {
  return Math.floor((DATA_END_MS - hours * HOUR_MS) / HOUR_MS) * HOUR_MS;
}

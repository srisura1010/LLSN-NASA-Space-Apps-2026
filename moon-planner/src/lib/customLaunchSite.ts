// A launch site on Earth typed in by the user, for the Launch mode. Kept in
// localStorage (one per viewer) and turned into an ordinary LaunchSite, so the
// launch-window estimate treats it like any listed site. Its allowed launch
// directions are the user's choice, not range-safety data.

import type { AzimuthRange, LaunchSite } from "./launchSites";

export const CUSTOM_LAUNCH_ID = "custom-launch";
export const CUSTOM_LAUNCH_KEY = "llsn.launch.customSite";
export const CUSTOM_LAUNCH_DEFAULT_NAME = "Custom launch site";
/** Local north, and so a heading, is undefined at the poles. */
export const CUSTOM_LAUNCH_MAX_LAT = 89.9;

export type LaunchDirections = "any" | "east" | "range";

/** What is stored: the form's values, already checked. */
export type CustomLaunchSpec = {
  name: string;
  lat: number;
  lon: number;
  directions: LaunchDirections;
  /** Degrees clockwise from north, for "range"; from > to wraps through north. */
  from?: number;
  to?: number;
};

export const DIRECTION_OPTIONS: { value: LaunchDirections; label: string }[] = [
  { value: "any", label: "Any direction (0–360°)" },
  { value: "east", label: "Eastward over open sea (45–135°)" },
  { value: "range", label: "Custom range" },
];

export function azimuthsFor(spec: CustomLaunchSpec): AzimuthRange[] {
  if (spec.directions === "east") return [{ min: 45, max: 135 }];
  if (spec.directions === "range" && spec.from !== undefined && spec.to !== undefined) {
    const from = spec.from % 360;
    const to = spec.to === 360 ? 360 : spec.to % 360;
    if (from < to) return [{ min: from, max: to }];
    if (to === 0) return [{ min: from, max: 360 }];
    return [
      { min: from, max: 360 },
      { min: 0, max: to },
    ];
  }
  return [{ min: 0, max: 360 }];
}

/** A stored value read back from localStorage, or null when it is not a usable site. */
export function readSpec(v: unknown): CustomLaunchSpec | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<CustomLaunchSpec>;
  if (typeof s.lat !== "number" || typeof s.lon !== "number" || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return null;
  if (Math.abs(s.lat) > CUSTOM_LAUNCH_MAX_LAT || s.lon < -180 || s.lon > 180) return null;
  const directions: LaunchDirections = s.directions === "east" || s.directions === "range" ? s.directions : "any";
  const okDeg = (d: unknown) => typeof d === "number" && d >= 0 && d <= 360;
  if (directions === "range" && (!okDeg(s.from) || !okDeg(s.to) || s.from === s.to)) return null;
  const name = typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 60) : CUSTOM_LAUNCH_DEFAULT_NAME;
  return { name, lat: s.lat, lon: s.lon, directions, from: s.from, to: s.to };
}

export function customLaunchSite(spec: CustomLaunchSpec): LaunchSite {
  return {
    id: CUSTOM_LAUNCH_ID,
    name: spec.name,
    operator: "Entered by you",
    country: "Custom",
    // The group only picks the mark's style on the Earth view; the Launch mode files it under "Custom".
    group: "us-partner",
    lat: spec.lat,
    lon: spec.lon,
    azimuths: azimuthsFor(spec),
    azimuthSource: "approximate",
    azimuthNote: "Entered by you; not range-safety data.",
    sourceUrl: "",
  };
}

export const isCustomLaunch = (s: { id: string }) => s.id === CUSTOM_LAUNCH_ID;

export type DegResult = { ok: true; value: number } | { ok: false; message: string };

/** A heading typed in degrees clockwise from north, 0 to 360. */
export function parseHeading(text: string, which: "From" | "To"): DegResult {
  const raw = text.trim().replace(/°$/, "").trim();
  if (!raw)
    return {
      ok: false,
      message: `${which} is empty. Type a heading in degrees clockwise from north, for example 90 for due east.`,
    };
  const v = Number(raw.replace(",", "."));
  if (!Number.isFinite(v))
    return {
      ok: false,
      message: `${which} "${text.trim()}" is not a number of degrees. Type a heading such as 45 or 135.`,
    };
  if (v < 0 || v > 360)
    return {
      ok: false,
      message: `${which} must be between 0 and 360 degrees (0 is north, 90 is east). For a range through north, use for example 330 to 20.`,
    };
  return { ok: true, value: v };
}

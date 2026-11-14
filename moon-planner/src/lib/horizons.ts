// Server-side client for the JPL Horizons API.
// Docs: https://ssd-api.jpl.nasa.gov/doc/horizons.html
//
// NOTE: Elevation is relative to a smooth-sphere horizon (the plane
// perpendicular to the local zenith on a 1737.4 km sphere). It ignores
// terrain; compare against a LOLA horizon mask for real visibility.

const HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api";

const TARGET_IDS = { sun: "10", earth: "399" } as const;

export type SkyTarget = keyof typeof TARGET_IDS;

export type SkyPoint = { time: string; az: number; el: number };

export type SkyTrackParams = {
  target: SkyTarget;
  lat: number; // degrees
  lon: number; // east longitude, degrees
  altKm?: number;
  start: string; // e.g. "2027-01-01"
  stop: string;
  step?: string; // e.g. "1 h"
};

export async function getSkyTrack({
  target,
  lat,
  lon,
  altKm = 0,
  start,
  stop,
  step = "1 h",
}: SkyTrackParams): Promise<SkyPoint[]> {
  const params: Record<string, string> = {
    COMMAND: TARGET_IDS[target],
    OBJ_DATA: "NO",
    MAKE_EPHEM: "YES",
    EPHEM_TYPE: "OBSERVER",
    CENTER: "coord@301", // custom site on the Moon
    COORD_TYPE: "GEODETIC",
    SITE_COORD: `${lon},${lat},${altKm}`,
    START_TIME: start,
    STOP_TIME: stop,
    STEP_SIZE: step,
    QUANTITIES: "4", // apparent azimuth & elevation
    CSV_FORMAT: "YES",
  };

  // Horizons wants each value in single quotes. encodeURIComponent gives
  // %20 for spaces (URLSearchParams would give "+").
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(`'${value}'`)}`)
    .join("&");

  const res = await fetch(`${HORIZONS_URL}?format=json&${query}`);
  if (!res.ok) {
    throw new Error(`Horizons HTTP ${res.status}: ${await res.text()}`);
  }

  // Horizons can return 200 even when the request failed.
  const data: { result?: string; error?: string } = await res.json();
  if (data.error) {
    throw new Error(`Horizons error: ${data.error}`);
  }

  return parseResult(data.result ?? "");
}

// Rows between $$SOE and $$EOE look like:
//   " 2027-Jan-01 00:00,*, , 263.107140,     0.953942,"
// The middle columns are Sun/interferer flags (often blank), so after
// dropping empty columns azimuth and elevation are always the last two.
function parseResult(result: string): SkyPoint[] {
  const soe = result.indexOf("$$SOE");
  const eoe = result.indexOf("$$EOE");
  if (soe === -1 || eoe === -1) {
    throw new Error(`Horizons returned no ephemeris:\n${result.trim()}`);
  }

  return result
    .slice(soe + "$$SOE".length, eoe)
    .split("\n")
    .map((line) =>
      line
        .split(",")
        .map((col) => col.trim())
        .filter(Boolean),
    )
    .filter((cols) => cols.length >= 3)
    .map((cols) => ({
      time: cols[0],
      az: Number(cols[cols.length - 2]),
      el: Number(cols[cols.length - 1]),
    }));
}

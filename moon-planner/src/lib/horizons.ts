// Server-side client for the JPL Horizons API, with a file + memory cache.
// Docs: https://ssd-api.jpl.nasa.gov/doc/horizons.html
//
// NOTE: Elevation is relative to a smooth-sphere horizon (the plane
// perpendicular to the local zenith on a 1737.4 km sphere). It ignores
// terrain; compare against a LOLA horizon mask for real visibility.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api";

const TARGET_IDS = { sun: "10", earth: "399" } as const;

export type SkyTarget = keyof typeof TARGET_IDS;

export type SkyPoint = { time: string; az: number; el: number };

export type SkyTrackParams = {
  target: SkyTarget;
  lat: number; // degrees
  lon: number; // east longitude, degrees
  altKm?: number;
  start: string; // e.g. "2027-01-01" or "2027-01-01 06:00" (UT)
  stop: string;
  step?: string; // e.g. "1 h", "30 m", "1 d"
};

// ---------- Cache ----------
//
// Files live in data/horizons-cache/<key>.json as { meta, points } and are
// committed to git so teammates and the deployed demo don't need JPL.
//
// Lookup order:
//   1. HIT exact:    a file with exactly these params
//   2. HIT covering: a file for the same site/target whose range covers the
//                    request and whose step divides the requested step
//                    (points are sliced and, if needed, downsampled)
//   3. MISS:         call JPL and save the result

export const CACHE_DIR = path.join(process.cwd(), "data", "horizons-cache");

type CacheMeta = Required<SkyTrackParams>;
type CacheFile = { meta: CacheMeta; points: SkyPoint[] };
type LoadedPoints = { points: SkyPoint[]; times: number[] }; // times in ms UTC

const index = new Map<string, CacheMeta>(); // key -> metadata, for every file
const badFiles = new Set<string>(); // unreadable / old-format files, skipped
const loaded = new Map<string, LoadedPoints>(); // key -> points, loaded lazily
let indexReady: Promise<void> | undefined;

function normalize(p: SkyTrackParams): CacheMeta {
  const round4 = (n: number) => Number(n.toFixed(4));
  return {
    target: p.target,
    lat: round4(p.lat),
    lon: round4(p.lon),
    altKm: p.altKm ?? 0,
    start: p.start,
    stop: p.stop,
    step: p.step ?? "1 h",
  };
}

export function cacheKey(params: SkyTrackParams): string {
  const m = normalize(params);
  const latR = m.lat.toFixed(4);
  const lonR = m.lon.toFixed(4);
  const raw = [m.target, latR, lonR, m.altKm, m.start, m.stop, m.step].join("|");
  const hash = createHash("sha1").update(raw).digest("hex").slice(0, 10);
  // Readable prefix for browsing the folder; the hash makes it unique.
  return `${m.target}_${latR}_${lonR}_${hash}`;
}

function cacheFile(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`);
}

function withTimes(points: SkyPoint[]): LoadedPoints {
  return { points, times: points.map((p) => parseTime(p.time)) };
}

// Read metadata for any cache files not yet in the index. Cheap after the
// first call: it only lists the folder and reads files it hasn't seen.
async function refreshIndex(): Promise<void> {
  let names: string[];
  try {
    names = await readdir(CACHE_DIR);
  } catch {
    return; // no cache folder yet
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const key = name.slice(0, -".json".length);
    if (index.has(key) || badFiles.has(key)) continue;
    try {
      const file: CacheFile = JSON.parse(await readFile(cacheFile(key), "utf8"));
      if (!file.meta || !Array.isArray(file.points)) {
        throw new Error("no metadata (old format? re-run precompute)");
      }
      index.set(key, file.meta);
    } catch (err) {
      badFiles.add(key);
      console.warn(`[horizons] skipping cache file ${name}:`, err instanceof Error ? err.message : err);
    }
  }
}

// Returns null (and forgets the file) if it was deleted or broken after indexing.
async function loadPoints(key: string): Promise<LoadedPoints | null> {
  let entry = loaded.get(key);
  if (!entry) {
    try {
      const file: CacheFile = JSON.parse(await readFile(cacheFile(key), "utf8"));
      entry = withTimes(file.points);
      loaded.set(key, entry);
    } catch {
      index.delete(key);
      return null;
    }
  }
  return entry;
}

// Find a cached file that covers the request and return just the requested
// points. Returns null if nothing covers it exactly (e.g. the requested start
// isn't on the cached time grid).
async function findCovering(
  req: CacheMeta,
): Promise<{ key: string; points: SkyPoint[] } | null> {
  const reqStart = parseTime(req.start);
  const reqStop = parseTime(req.stop);
  const reqStep = parseStepMs(req.step);
  if (Number.isNaN(reqStart + reqStop + reqStep) || reqStop < reqStart) return null;
  const expected = Math.floor((reqStop - reqStart) / reqStep) + 1;

  for (const [key, m] of index) {
    if (m.target !== req.target || m.lat !== req.lat || m.lon !== req.lon || m.altKm !== req.altKm) {
      continue;
    }
    const start = parseTime(m.start);
    const stop = parseTime(m.stop);
    const step = parseStepMs(m.step);
    if (Number.isNaN(start + stop + step)) continue;
    if (start > reqStart || stop < reqStop || reqStep % step !== 0) continue;

    const entry = await loadPoints(key);
    if (!entry) continue;
    const { points, times } = entry;
    const out = points.filter(
      (_, i) => times[i] >= reqStart && times[i] <= reqStop && (times[i] - reqStart) % reqStep === 0,
    );
    // Same points Horizons would return: start, start+step, ... up to stop.
    if (out.length === expected) return { key, points: out };
  }
  return null;
}

async function lookup(key: string, req: CacheMeta): Promise<SkyPoint[] | null> {
  const exact = index.has(key) ? await loadPoints(key) : null;
  if (exact) {
    console.log(`[horizons] HIT exact ${key}`);
    return exact.points;
  }
  const covering = await findCovering(req);
  if (covering) {
    console.log(
      `[horizons] HIT covering ${key} <- ${covering.key} (${covering.points.length} points)`,
    );
    return covering.points;
  }
  return null;
}

export async function writeCache(params: SkyTrackParams, points: SkyPoint[]): Promise<void> {
  const meta = normalize(params);
  const key = cacheKey(meta);
  index.set(key, meta);
  badFiles.delete(key);
  loaded.set(key, withTimes(points));
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const file: CacheFile = { meta, points };
    await writeFile(cacheFile(key), JSON.stringify(file));
  } catch (err) {
    // e.g. read-only filesystem on a serverless host: keep serving.
    console.warn(`[horizons] could not write cache ${key}:`, err);
  }
}

/** Cached lookup: exact file -> covering file -> live Horizons call. */
export async function getSkyTrack(params: SkyTrackParams): Promise<SkyPoint[]> {
  const req = normalize(params);
  const key = cacheKey(req);

  indexReady ??= refreshIndex();
  await indexReady;
  let points = await lookup(key, req);
  if (points) return points;

  // Pick up files written since the index was built (e.g. by precompute).
  await refreshIndex();
  points = await lookup(key, req);
  if (points) return points;

  console.log(`[horizons] MISS ${key}, calling JPL`);
  points = await fetchSkyTrack(req); // throws on error, so errors are never cached
  await writeCache(req, points);
  return points;
}

// ---------- Time helpers ----------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Parse a UT time to ms. Accepts request-style "2027-01-10", "2027-01-10 06:00"
 * / "2027-01-10T06:00" and Horizons-style "2027-Jan-10 06:00". NaN otherwise.
 */
export function parseTime(s: string): number {
  const m = /^(\d{4})-(\d{2}|[A-Za-z]{3})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?$/.exec(
    s.trim(),
  );
  if (!m) return NaN;
  const month = /^\d+$/.test(m[2]) ? Number(m[2]) - 1 : MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return NaN;
  return Date.UTC(
    Number(m[1]),
    month,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    0,
    Math.round(Number(m[6] ?? 0) * 1000),
  );
}

/** Parse a Horizons step like "1 h", "30 m", "2 d" to ms. NaN otherwise. */
export function parseStepMs(step: string): number {
  const m = /^(\d+)\s*([a-z]+)$/i.exec(step.trim());
  if (!m) return NaN;
  const unit = m[2].toLowerCase();
  const unitMs = /^(m|mins?|minutes?)$/.test(unit)
    ? 60_000
    : /^(h|hrs?|hours?)$/.test(unit)
      ? 3_600_000
      : /^(d|days?)$/.test(unit)
        ? 86_400_000
        : NaN;
  return Number(m[1]) * unitMs || NaN;
}

// ---------- Live Horizons call (uncached) ----------

export async function fetchSkyTrack({
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

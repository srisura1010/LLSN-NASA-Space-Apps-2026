// Fetch Sun and Earth sky tracks for every site and save them to
// data/horizons-cache/ so the app works without live JPL calls.
//
// Usage:
//   npm run precompute                                  # all of 2027 (to 2028-01-01 00:00), 1 h
//
// Stop is an instant, not a whole day: "2027-01-31" means Jan 31 00:00 UT.
//   npm run precompute -- 2027-01-01 2027-01-07         # custom range
//   npm run precompute -- 2027-01-01 2027-01-07 "30 m"  # custom range + step
//   npm run precompute -- --site=test-pole              # one site only
//
// The API route serves any request whose range falls inside a cached file
// (and whose step is a multiple of the cached step) from that file.

import { sites } from "../src/lib/sites";
import {
  cacheKey,
  fetchSkyTrack,
  writeCache,
  type SkyPoint,
  type SkyTarget,
  type SkyTrackParams,
} from "../src/lib/horizons";

const args = process.argv.slice(2);
const siteFilter = args.find((a) => a.startsWith("--site="))?.slice("--site=".length);
const [start = "2027-01-01", stop = "2028-01-01", step = "1 h"] = args.filter(
  (a) => !a.startsWith("--"),
);
const selectedSites = siteFilter ? sites.filter((s) => s.id === siteFilter) : sites;

const TARGETS: SkyTarget[] = ["sun", "earth"];
const DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Split [start, stop] (YYYY-MM-DD) into calendar-month chunks that share
// their boundary instants, e.g. Jan 15..Feb 1, Feb 1..Mar 1, Mar 1..Mar 10.
function monthlyChunks(start: string, stop: string): [string, string][] {
  const end = new Date(`${stop}T00:00:00Z`);
  const chunks: [string, string][] = [];
  let cur = new Date(`${start}T00:00:00Z`);
  while (cur < end) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const chunkEnd = next < end ? next : end;
    chunks.push([cur.toISOString().slice(0, 10), chunkEnd.toISOString().slice(0, 10)]);
    cur = chunkEnd;
  }
  return chunks;
}

async function fetchChunked(params: SkyTrackParams): Promise<SkyPoint[]> {
  const chunks = monthlyChunks(params.start, params.stop);
  const merged: SkyPoint[] = [];
  for (const [i, [chunkStart, chunkStop]] of chunks.entries()) {
    if (i > 0) await sleep(DELAY_MS);
    const points = await fetchSkyTrack({ ...params, start: chunkStart, stop: chunkStop });
    // Chunks share their boundary instant; drop the duplicate.
    const skip = merged.length && points[0]?.time === merged.at(-1)!.time ? 1 : 0;
    merged.push(...points.slice(skip));
    console.log(`    ${chunkStart} .. ${chunkStop}: ${points.length} points`);
  }
  return merged;
}

async function main() {
  if (!selectedSites.length) {
    console.error(`No site with id "${siteFilter}". Known: ${sites.map((s) => s.id).join(", ")}`);
    process.exit(1);
  }
  console.log(`Precomputing ${selectedSites.length} site(s), ${start} .. ${stop}, step ${step}`);
  let first = true;
  let failures = 0;

  for (const site of selectedSites) {
    for (const target of TARGETS) {
      const params: SkyTrackParams = {
        target,
        lat: site.lat,
        lon: site.lon,
        altKm: site.altKm ?? 0,
        start,
        stop,
        step,
      };
      if (!first) await sleep(DELAY_MS);
      first = false;

      console.log(`- ${site.id} / ${target} -> ${cacheKey(params)}.json`);
      try {
        const points = await fetchChunked(params);
        await writeCache(params, points);
        console.log(`  saved ${points.length} points`);
      } catch (err) {
        failures++;
        console.error(`  FAILED: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  if (failures) {
    console.error(`${failures} request(s) failed`);
    process.exit(1);
  }
}

main();

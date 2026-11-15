// Pack each site's cached Horizons tracks into one small static file for the
// browser: public/data/sky/<siteId>.json. Run after npm run precompute.
//
// Usage: npm run build-sky

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { sites } from "../src/lib/sites";
import { parseTime } from "../src/lib/horizons";

const CACHE_DIR = path.join(process.cwd(), "data", "horizons-cache");
const OUT_DIR = path.join(process.cwd(), "public", "data", "sky");

type CacheFile = {
  meta: { target: "sun" | "earth"; lat: number; lon: number; start: string; stop: string; step: string };
  points: { time: string; az: number; el: number }[];
};

const round = (v: number) => Math.round(v * 1000) / 1000;

async function main() {
  const files = await readdir(CACHE_DIR);
  const caches: CacheFile[] = [];
  for (const f of files) {
    if (f.endsWith(".json")) caches.push(JSON.parse(await readFile(path.join(CACHE_DIR, f), "utf8")));
  }
  await mkdir(OUT_DIR, { recursive: true });

  for (const site of sites) {
    const pick = (target: "sun" | "earth") =>
      caches
        .filter((c) => c.meta.target === target && Math.abs(c.meta.lat - site.lat) < 1e-6 && Math.abs(c.meta.lon - site.lon) < 1e-6)
        .sort((a, b) => b.points.length - a.points.length)[0];
    const sun = pick("sun");
    const earth = pick("earth");
    if (!sun || !earth) {
      console.error(`- ${site.id}: missing cache (run npm run precompute)`);
      process.exitCode = 1;
      continue;
    }
    const n = Math.min(sun.points.length, earth.points.length);
    const t0 = parseTime(sun.points[0].time);
    const step = parseTime(sun.points[1].time) - t0;
    if (parseTime(earth.points[0].time) !== t0) throw new Error(`${site.id}: Sun and Earth tracks start at different times`);

    const out = {
      siteId: site.id,
      source: "JPL Horizons API, observer on the Moon (coord@301), apparent airless az/el",
      startMs: t0,
      stepMs: step,
      count: n,
      sunAz: sun.points.slice(0, n).map((p) => round(p.az)),
      sunEl: sun.points.slice(0, n).map((p) => round(p.el)),
      earthAz: earth.points.slice(0, n).map((p) => round(p.az)),
      earthEl: earth.points.slice(0, n).map((p) => round(p.el)),
    };
    const file = path.join(OUT_DIR, `${site.id}.json`);
    await writeFile(file, JSON.stringify(out));
    console.log(`- ${site.id}: ${n} hourly points -> ${path.relative(process.cwd(), file)}`);
  }
}

main();

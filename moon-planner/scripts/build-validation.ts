// Check the model against NASA's published LOLA illumination maps at the nine
// region centres and write public/data/validation.json. The landing page
// imports that file at build time, so its table ships as numbers in the HTML
// with no fetch in the browser.
//
// For each region it counts, over every hourly sample of the packed 2027
// tracks, the share with any part of the Sun's disc above the terrain horizon
// and the share with any part of Earth's disc above it: the same windowStats
// and rangeOf the Navigator uses, so both pages print the same values. NASA's
// values are the long-term averages in src/lib/validation.ts.
//
// Usage: npm run build-validation   (after npm run build-sky)

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sites } from "../src/lib/sites";
import { rangeOf, windowStats, type SiteData, type SkyData } from "../src/lib/sky";
import type { HorizonProfile } from "../src/lib/terrain";
import { NASA_REFERENCE, NASA_REFERENCE_SOURCE, compareWithNasa } from "../src/lib/validation";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const OUT_FILE = path.join(DATA_DIR, "validation.json");

/** Round to one decimal, the precision the tables print. */
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Agreement thresholds tried in turn, in percentage points. The summary names
 * the tightest one that holds at two thirds of the regions or more.
 */
const THRESHOLDS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 20, 30, 50, 100];

type Body = "sun" | "earth";

type Cell = {
  /** This model, per cent of hourly samples, one decimal. */
  model: number;
  /** NASA's long-term average at the region centre, per cent, one decimal. */
  nasa: number;
  /** Model minus NASA, percentage points, one decimal. */
  diff: number;
};

type Region = { id: string; name: string; sun: Cell; earth: Cell };

type BodySummary = {
  /** Mean of |model − NASA| over the regions, percentage points (from unrounded shares). */
  meanAbsDiff: number;
  /** Tightest threshold that two thirds of the regions or more fall within, and how many do. */
  within: { pts: number; regions: number };
  /** Regions outside that threshold, largest gap first. */
  outside: { id: string; name: string; diff: number }[];
  /** The largest gap of all. */
  largest: { id: string; name: string; diff: number };
};

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

function summarize(regions: Region[], rawDiffs: number[], body: Body): BodySummary {
  const need = Math.ceil((regions.length * 2) / 3);
  const shown = regions.map((r) => r[body].diff);
  let within = { pts: THRESHOLDS[THRESHOLDS.length - 1], regions: regions.length };
  for (const t of THRESHOLDS) {
    // Counted on the printed values, so a reader can check the claim against the table.
    const n = shown.filter((d) => Math.abs(d) <= t + 1e-9).length;
    if (n >= need) {
      within = { pts: t, regions: n };
      break;
    }
  }
  const byGap = regions
    .map((r) => ({ id: r.id, name: r.name, diff: r[body].diff }))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return {
    meanAbsDiff: r2(rawDiffs.reduce((sum, d) => sum + Math.abs(d), 0) / rawDiffs.length),
    within,
    outside: byGap.filter((r) => Math.abs(r.diff) > within.pts + 1e-9),
    largest: byGap[0],
  };
}

async function main() {
  const regions: Region[] = [];
  const raw: Record<Body, number[]> = { sun: [], earth: [] };
  let span: { startMs: number; endMs: number; stepMs: number; samples: number } | null = null;

  for (const s of sites) {
    const nasa = NASA_REFERENCE[s.id];
    if (!nasa) throw new Error(`${s.id}: no NASA reference value in src/lib/validation.ts`);
    const sky = await readJson<SkyData>(path.join(DATA_DIR, "sky", `${s.id}.json`));
    const horizon = await readJson<HorizonProfile>(path.join(DATA_DIR, "horizon", `${s.id}.json`));
    const site: SiteData = { sky, horizon };

    const { startMs, endMs } = rangeOf(sky);
    const stats = windowStats(site, startMs, endMs);
    const samples = Math.round((endMs - startMs) / sky.stepMs) + 1;
    if (!span) span = { startMs, endMs, stepMs: sky.stepMs, samples };
    else if (span.startMs !== startMs || span.endMs !== endMs || span.stepMs !== sky.stepMs) {
      throw new Error(`${s.id}: tracks cover a different span from the other regions; rerun npm run build-sky`);
    }

    // The Navigator's About table calls compareWithNasa; stop if the two ever disagree.
    const check = compareWithNasa(site);
    if (check.ours.sunlit !== stats.sunlit || check.ours.earth !== stats.earthVisible) {
      throw new Error(`${s.id}: shares differ from compareWithNasa in src/lib/validation.ts`);
    }

    const cell = (share: number, ref: number): Cell => {
      const c = { model: r1(share * 100), nasa: r1(ref * 100), diff: r1((share - ref) * 100) };
      if (r1(c.model - c.nasa) !== c.diff) {
        console.warn(`- ${s.id}: printed ${c.model} − ${c.nasa} does not round to ${c.diff}`);
      }
      return c;
    };
    regions.push({
      id: s.id,
      name: s.name,
      sun: cell(stats.sunlit, nasa.sunlit),
      earth: cell(stats.earthVisible, nasa.earth),
    });
    raw.sun.push((stats.sunlit - nasa.sunlit) * 100);
    raw.earth.push((stats.earthVisible - nasa.earth) * 100);
  }
  if (!span) throw new Error("No regions in src/lib/sites.ts");

  const out = {
    generatedBy: "scripts/build-validation.ts",
    source: NASA_REFERENCE_SOURCE,
    model: {
      ...span,
      rule: "Share of hourly samples with any part of the disc above the terrain horizon seen from 2 m above the region centre",
    },
    regions,
    summary: { sun: summarize(regions, raw.sun, "sun"), earth: summarize(regions, raw.earth, "earth") },
  };
  await writeFile(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);

  for (const r of regions) {
    const f = (c: Cell) => `${c.model.toFixed(1)} vs ${c.nasa.toFixed(1)} (${c.diff > 0 ? "+" : ""}${c.diff.toFixed(1)})`;
    console.log(`- ${r.id.padEnd(15)} Sun ${f(r.sun).padEnd(22)} Earth ${f(r.earth)}`);
  }
  for (const body of ["sun", "earth"] as const) {
    const m = out.summary[body];
    console.log(
      `${body}: mean |diff| ${m.meanAbsDiff.toFixed(2)} pts, within ${m.within.pts} pts at ${m.within.regions} of ${regions.length}, ` +
        `largest ${m.largest.name} ${m.largest.diff > 0 ? "+" : ""}${m.largest.diff.toFixed(1)}`,
    );
  }
  console.log(`-> ${path.relative(process.cwd(), OUT_FILE)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

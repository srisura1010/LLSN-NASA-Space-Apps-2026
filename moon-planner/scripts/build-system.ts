// Heliocentric state of Earth and the Moon through 2027 from JPL Horizons,
// packed into one static file for the System view: public/data/system/2027.json.
//
// Usage: npm run build-system

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const API = "https://ssd.jpl.nasa.gov/api/horizons.api";
const OUT = path.join(process.cwd(), "public", "data", "system", "2027.json");
const YEAR = 2027;
const STEP_HOURS = 1;
const HOUR = 3_600_000;
/** Horizons vector tables are stamped in TDB. In 2027 TDB - UTC = 32.184 s + 37 leap seconds. */
const TDB_MINUS_UTC_MS = 69_184;
const GAP_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type Row = { jd: number; x: number; y: number; z: number };

async function request(command: string, startMs: number, stopMs: number): Promise<Row[] | "rejected"> {
  const params: Record<string, string> = {
    format: "text",
    COMMAND: `'${command}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@10'",
    REF_PLANE: "'ECLIPTIC'",
    OUT_UNITS: "'KM-S'",
    VEC_TABLE: "'1'",
    CSV_FORMAT: "'YES'",
    START_TIME: `'${day(startMs)}'`,
    STOP_TIME: `'${day(stopMs)}'`,
    STEP_SIZE: `'${STEP_HOURS} h'`,
  };
  const url = `${API}?${Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Horizons HTTP ${res.status} for ${command}`);
  const text = await res.text();
  const a = text.indexOf("$$SOE");
  const b = text.indexOf("$$EOE");
  if (a < 0 || b < 0) {
    if (/exceed|too many|limit/i.test(text)) return "rejected";
    throw new Error(`Horizons returned no table for ${command}:\n${text.slice(0, 600)}`);
  }
  const rows: Row[] = [];
  for (const line of text.slice(a + 5, b).split("\n")) {
    const c = line.split(",").map((s) => s.trim());
    if (c.length < 5 || !c[0]) continue;
    const row = { jd: Number(c[0]), x: Number(c[2]), y: Number(c[3]), z: Number(c[4]) };
    if (![row.jd, row.x, row.y, row.z].every(Number.isFinite)) throw new Error(`Unreadable row: ${line}`);
    rows.push(row);
  }
  return rows;
}

async function fetchBody(command: string, startMs: number, stopMs: number): Promise<Row[]> {
  let rows = await request(command, startMs, stopMs);
  await sleep(GAP_MS);
  if (rows !== "rejected") return rows;
  // Too large for one request: go month by month, dropping each month's repeated first row.
  const out: Row[] = [];
  for (let m = 0; m < 12; m++) {
    rows = await request(command, Date.UTC(YEAR, m, 1), Date.UTC(YEAR, m + 1, 1));
    await sleep(GAP_MS);
    if (rows === "rejected") throw new Error(`Horizons rejected month ${m + 1} for ${command}`);
    out.push(...(m === 0 ? rows : rows.slice(1)));
  }
  return out;
}

async function main() {
  const startMs = Date.UTC(YEAR, 0, 1);
  const stopMs = Date.UTC(YEAR + 1, 0, 1);
  const expected = (stopMs - startMs) / (STEP_HOURS * HOUR) + 1;

  const earth = await fetchBody("399", startMs, stopMs);
  const moon = await fetchBody("301", startMs, stopMs);
  for (const [name, rows] of [["Earth", earth], ["Moon", moon]] as const) {
    if (rows.length !== expected) throw new Error(`${name}: ${rows.length} rows, expected ${expected}`);
  }
  // JD 2461406.5 is 2027-01-01 00:00; check the table starts where we asked.
  if (Math.abs(earth[0].jd - 2461406.5) > 1e-6 || Math.abs(moon[0].jd - earth[0].jd) > 1e-9) {
    throw new Error(`Unexpected first epoch: ${earth[0].jd}`);
  }

  const flat = (rows: Row[]) => rows.flatMap((r) => [Math.round(r.x), Math.round(r.y), Math.round(r.z)]);
  const out = {
    source:
      "NASA/JPL Horizons API (ssd.jpl.nasa.gov/api/horizons.api), vector tables for Earth (399) and the Moon (301) from the Sun's centre (500@10). Epochs are TDB; startMs is the matching UTC instant.",
    frame: "ecliptic J2000, heliocentric, km",
    startMs: startMs - TDB_MINUS_UTC_MS,
    stepMs: STEP_HOURS * HOUR,
    count: earth.length,
    earth: flat(earth),
    moon: flat(moon),
  };
  await mkdir(path.dirname(OUT), { recursive: true });
  const json = JSON.stringify(out);
  await writeFile(OUT, json);

  let emMin = Infinity, emMax = -Infinity, seMin = Infinity, seMax = -Infinity;
  for (let i = 0; i < earth.length; i++) {
    const e = earth[i], m = moon[i];
    const em = Math.hypot(m.x - e.x, m.y - e.y, m.z - e.z);
    const se = Math.hypot(e.x, e.y, e.z) / 149_597_870.7;
    emMin = Math.min(emMin, em); emMax = Math.max(emMax, em);
    seMin = Math.min(seMin, se); seMax = Math.max(seMax, se);
  }
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${earth.length} samples, ${(json.length / 1024).toFixed(0)} kB`);
  console.log(`Earth-Moon ${emMin.toFixed(0)} to ${emMax.toFixed(0)} km; Sun-Earth ${seMin.toFixed(5)} to ${seMax.toFixed(5)} AU`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

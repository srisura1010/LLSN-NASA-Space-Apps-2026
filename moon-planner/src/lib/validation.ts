// Checks the model against NASA's published LOLA illumination maps:
// Mazarico et al. (2011), average solar illumination and Earth visibility,
// NASA GSFC PGDA product 69 (release 201608, 120 m maps), read at the centre
// pixel of each region. Those maps average many years of geometry; ours
// covers 2027 only, so differences of a few points are expected.

import { rangeOf, windowStats, type SiteData } from "./sky";

export const NASA_REFERENCE_SOURCE = {
  authors: "Mazarico et al. (2011)",
  title: "Illumination conditions of the lunar polar regions using LOLA topography",
  journal: "Icarus 211",
  product: "PGDA product 69, release 201608, 120 m maps, centre pixel",
  url: "https://pgda.gsfc.nasa.gov/products/69",
} as const;

/** Long-term shares of time (0..1) with the Sun and Earth visible, per region. */
export const NASA_REFERENCE: Record<string, { sunlit: number; earth: number }> = {
  "cabeus-b": { sunlit: 0.384, earth: 0.441 },
  haworth: { sunlit: 0.103, earth: 0.439 },
  malapert: { sunlit: 0.381, earth: 0.529 },
  "mouton-plateau": { sunlit: 0.262, earth: 0.664 },
  mouton: { sunlit: 0.188, earth: 0.366 },
  "nobile-1": { sunlit: 0.3, earth: 0.37 },
  "nobile-2": { sunlit: 0.416, earth: 0.688 },
  "de-gerlache-2": { sunlit: 0.371, earth: 0.548 },
  slater: { sunlit: 0.03, earth: 0.414 },
};

export type NasaComparison = {
  siteId: string;
  /** Span the shares were computed over (the whole track, 2027 for the nine regions). */
  startMs: number;
  endMs: number;
  hours: number;
  /** Our shares of hours (0..1): any of the Sun's disc above terrain, any of Earth's disc above terrain. */
  ours: { sunlit: number; earth: number };
  /** NASA's long-term average, or null when no reference exists (custom points). */
  nasa: { sunlit: number; earth: number } | null;
  /** Ours minus NASA, in percentage points. */
  diffPts: { sunlit: number; earth: number } | null;
};

const memo = new WeakMap<SiteData, NasaComparison>();

export function compareWithNasa(site: SiteData): NasaComparison {
  const cached = memo.get(site);
  if (cached) return cached;

  const { startMs, endMs } = rangeOf(site.sky);
  const stats = windowStats(site, startMs, endMs);
  const siteId = site.sky.siteId;
  const nasa = NASA_REFERENCE[siteId] ?? null;
  const ours = { sunlit: stats.sunlit, earth: stats.earthVisible };
  const result: NasaComparison = {
    siteId,
    startMs,
    endMs,
    hours: stats.hours,
    ours,
    nasa,
    diffPts: nasa
      ? { sunlit: (ours.sunlit - nasa.sunlit) * 100, earth: (ours.earth - nasa.earth) * 100 }
      : null,
  };
  memo.set(site, result);
  return result;
}

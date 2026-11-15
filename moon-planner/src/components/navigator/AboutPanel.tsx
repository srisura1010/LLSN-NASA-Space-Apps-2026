"use client";

import { memo, type ReactNode } from "react";
import type { SiteData } from "@/lib/sky";
import { NASA_REFERENCE_SOURCE, compareWithNasa } from "@/lib/validation";
import { EarthMark, ExternalMark, SunMark, pct1, pts } from "./SiteBulletin";

type Entry = { id: string; name: string; site: SiteData | null };

type Props = {
  entries: Entry[];
  loading: boolean;
};

const SECTIONS = [
  ["about-regions", "The nine regions"],
  ["about-method", "How the numbers are made"],
  ["about-ranking", "How regions are ranked"],
  ["about-limits", "Limits"],
  ["about-moon", "Moon level"],
  ["about-system", "System level"],
  ["about-check", "Checked against NASA"],
  ["about-credits", "NASA data and credits"],
  ["about-ai", "How AI was used"],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6 border-t border-rule pt-5 mt-9 first:mt-0">
      <h3 id={`${id}-h`} className="text-[1.068rem] font-semibold leading-snug text-ink text-balance">
        {title}
      </h3>
      <div className="mt-2.5 space-y-3 text-[0.95rem] leading-[1.6] text-ink">{children}</div>
    </section>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-baseline gap-1 font-medium text-earth underline decoration-1 underline-offset-[3px] hover:text-ink"
    >
      {children}
      <ExternalMark className="size-3 self-center" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

const CREDITS: { name: string; use: string; who: string; href: string; link: string }[] = [
  {
    name: "JPL Horizons",
    use: "Apparent azimuth and elevation of the Sun and Earth for an observer on the lunar surface at each site, hourly through 2027, and live for custom sites.",
    who: "NASA Jet Propulsion Laboratory, Solar System Dynamics",
    href: "https://ssd.jpl.nasa.gov/horizons/",
    link: "ssd.jpl.nasa.gov/horizons",
  },
  {
    name: "JPL Horizons vector tables",
    use: "Heliocentric positions of Earth and the Moon (ecliptic J2000, hourly through 2027) behind the System tab's diagram, distances, Moon phase and light time.",
    who: "NASA Jet Propulsion Laboratory, Solar System Dynamics",
    href: "https://ssd-api.jpl.nasa.gov/doc/horizons.html",
    link: "ssd-api.jpl.nasa.gov/doc/horizons.html",
  },
  {
    name: "LRO LOLA south pole elevation model (LDEM_80S_80MPP)",
    use: "The terrain every horizon is traced over, and the relief of the 3D terrain plate.",
    who: "NASA GSFC Planetary Geodesy Data Archive, product 90",
    href: "https://pgda.gsfc.nasa.gov/products/90",
    link: "pgda.gsfc.nasa.gov/products/90",
  },
  {
    name: "LOLA average illumination and Earth visibility maps",
    use: "The reference values in the check above (Mazarico et al. 2011).",
    who: "NASA GSFC Planetary Geodesy Data Archive, product 69",
    href: "https://pgda.gsfc.nasa.gov/products/69",
    link: "pgda.gsfc.nasa.gov/products/69",
  },
  {
    name: "Artemis III candidate landing regions",
    use: "The nine region outlines and their centre points. McClernan, M.T., 2024, U.S. Geological Survey data release, doi:10.5066/P1MEQ6UK.",
    who: "U.S. Geological Survey",
    href: "https://doi.org/10.5066/P1MEQ6UK",
    link: "doi.org/10.5066/P1MEQ6UK",
  },
  {
    name: "NASA Moon Trek",
    use: "The Open in Moon Trek link for each site, and the LRO LOLA 30 m south pole DEM that gives custom sites their nearby terrain.",
    who: "NASA Solar System Treks Project",
    href: "https://trek.nasa.gov/moon/",
    link: "trek.nasa.gov/moon",
  },
  {
    name: "LROC QuickMap",
    use: "A reference for looking at the same terrain and lighting in LRO camera images.",
    who: "Arizona State University and NASA, Lunar Reconnaissance Orbiter Camera",
    href: "https://quickmap.lroc.asu.edu/",
    link: "quickmap.lroc.asu.edu",
  },
  {
    name: "CGI Moon Kit",
    use: "Moon colour texture from the LROC wide-angle camera mosaic.",
    who: "NASA Scientific Visualization Studio",
    href: "https://svs.gsfc.nasa.gov/4720",
    link: "svs.gsfc.nasa.gov/4720",
  },
];

function ValidationTable({ entries, loading }: Props) {
  const rows = entries
    .filter((e) => e.site)
    .map((e) => ({ ...e, check: compareWithNasa(e.site!) }))
    .filter((r) => r.check.nasa && r.check.diffPts);
  const meanAbs = (pick: (d: { sunlit: number; earth: number }) => number) =>
    rows.length ? rows.reduce((sum, r) => sum + Math.abs(pick(r.check.diffPts!)), 0) / rows.length : 0;
  const largest = (pick: (d: { sunlit: number; earth: number }) => number) =>
    rows.reduce((a, b) => (Math.abs(pick(b.check.diffPts!)) > Math.abs(pick(a.check.diffPts!)) ? b : a));

  if (loading) {
    return (
      <div aria-hidden="true" className="space-y-2">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="h-5 bg-paper-3 motion-safe:animate-pulse" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="text-ink-2">The region tracks did not load, so there is nothing to check yet. Reload the page to try again.</p>;
  }

  const worstSun = largest((d) => d.sunlit);
  const worstEarth = largest((d) => d.earth);
  const th = "pb-1.5 text-right text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-ink-2";
  const td = "py-1.5 text-right tabular-nums";
  return (
    <>
      <div className="relative -mx-4 overflow-x-auto px-4" tabIndex={0} role="region" aria-label="Check against NASA, scrolls sideways">
        <table className="w-full min-w-[36rem] text-[0.844rem]">
          <caption className="sr-only">
            Share of hours with the Sun and Earth visible: this model over 2027 against NASA&apos;s LOLA long-term average
          </caption>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="border-b border-ink pb-1.5 text-left align-bottom text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-ink-2">
                Region
              </th>
              <th scope="colgroup" colSpan={3} className="border-l border-rule pb-1 pl-3 text-left text-[0.844rem] font-semibold text-ink">
                <span className="inline-flex items-center gap-1.5">
                  <SunMark className="size-3.5" />
                  Sun visible
                </span>
              </th>
              <th scope="colgroup" colSpan={3} className="border-l border-rule pb-1 pl-3 text-left text-[0.844rem] font-semibold text-ink">
                <span className="inline-flex items-center gap-1.5">
                  <EarthMark className="size-3.5" />
                  Earth visible
                </span>
              </th>
            </tr>
            <tr className="border-b border-ink">
              <th scope="col" className={`${th} border-l border-rule pl-3`}>2027</th>
              <th scope="col" className={th}>NASA</th>
              <th scope="col" className={`${th} pr-3`}>Points</th>
              <th scope="col" className={`${th} border-l border-rule pl-3`}>2027</th>
              <th scope="col" className={th}>NASA</th>
              <th scope="col" className={th}>Points</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-rule">
                <th scope="row" className="py-1.5 pr-3 text-left font-medium text-ink">{r.name}</th>
                <td className={`${td} border-l border-rule pl-3 text-ink`}>{pct1(r.check.ours.sunlit)}</td>
                <td className={`${td} text-ink-2`}>{pct1(r.check.nasa!.sunlit)}</td>
                <td className={`${td} pr-3 font-semibold text-ink`}>{pts(r.check.diffPts!.sunlit)}</td>
                <td className={`${td} border-l border-rule pl-3 text-ink`}>{pct1(r.check.ours.earth)}</td>
                <td className={`${td} text-ink-2`}>{pct1(r.check.nasa!.earth)}</td>
                <td className={`${td} font-semibold text-ink`}>{pts(r.check.diffPts!.earth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Points are this model minus NASA. Across the {rows.length} regions the typical gap, ignoring sign, is{" "}
        {meanAbs((d) => d.sunlit).toFixed(1)} points for the Sun and {meanAbs((d) => d.earth).toFixed(1)} points for Earth.
        The largest are {worstSun.name} for the Sun, {pts(worstSun.check.diffPts!.sunlit)}, and {worstEarth.name} for
        Earth, {pts(worstEarth.check.diffPts!.earth)}.
      </p>
    </>
  );
}

function AboutPanel({ entries, loading }: Props) {
  return (
    <div className="mx-auto w-full max-w-[72rem] px-4 py-6 xl:grid xl:grid-cols-[13rem_minmax(0,1fr)] xl:gap-12 xl:px-8 xl:py-8">
      <nav aria-label="On this page" className="hidden xl:block">
        <ol className="sticky top-0 space-y-1.5 border-l border-rule pl-3 text-[0.844rem]">
          {SECTIONS.map(([href, label]) => (
            <li key={href}>
              <a href={`#${href}`} className="text-ink-2 underline-offset-[3px] hover:text-ink hover:underline">
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="max-w-[68ch]">
        <h2 className="text-[1.52rem] font-semibold leading-tight text-ink text-balance">About the Navigator and its data</h2>
        <p className="mt-3 text-[1.068rem] leading-[1.55] text-ink">
          The Navigator answers one planning question for the lunar south pole: over a mission window, when does a
          landing region see the Sun above its real terrain horizon, for power, and when does it see Earth, for direct
          radio contact? It ranks the regions on that answer and shows what a slip, or the next region over, changes.
        </p>

        <div className="mt-9">
          <Section id="about-regions" title="The nine regions">
            <p>
              These are the nine regions NASA named for Artemis III in October 2024, drawn from the U.S. Geological
              Survey outlines (McClernan 2024). NASA now describes Artemis III as a test flight in Earth orbit, so the
              regions appear here as a well-studied set of south pole candidates, not as the landing sites of any
              scheduled mission.
            </p>
            <p>Each region is measured at its centre point. You can add any other point from 80&deg; S to the pole as a custom site.</p>
          </Section>

          <Section id="about-method" title="How the numbers are made">
            <ol className="list-decimal space-y-2.5 pl-5 marker:font-semibold marker:text-ink-2">
              <li>
                <strong className="font-semibold">Sun and Earth positions.</strong> JPL Horizons gives the apparent
                azimuth and elevation of the Sun and of Earth for an observer standing on the lunar surface at the site,
                every hour through 2027. The Moon&apos;s libration and the Sun&apos;s small seasonal swing come with it.
              </li>
              <li>
                <strong className="font-semibold">Terrain horizon.</strong> From the LOLA south pole elevation model
                (LDEM_80S_80MPP), the highest terrain angle is traced every 0.5&deg; of azimuth from a 2 m mast at the
                site: the full 80 m grid within about 5 km, a 320 m grid beyond, out to the edge of the model, with the
                Moon&apos;s curvature included.
              </li>
              <li>
                <strong className="font-semibold">Sunlight.</strong> The Sun is a disc 0.53&deg; across, and the part of
                it above the terrain is counted, so a Sun half behind a ridge gives half power. Sun up means any of the
                disc is visible; mean disc power averages the visible part over the window.
              </li>
              <li>
                <strong className="font-semibold">Earth.</strong> Seen from the Moon, Earth is about 1.9&deg; across. It
                counts as in view, and direct-to-Earth radio as possible, when any part of its disc clears the terrain.
              </li>
              <li>
                <strong className="font-semibold">Windows and contacts.</strong> Every hour of the mission window is
                counted, and dark spells and spells without Earth are measured end to end. Sunrise, sunset, Earthrise and
                Earthset are interpolated between the hourly steps to the minute.
              </li>
            </ol>
          </Section>

          <Section id="about-ranking" title="How regions are ranked">
            <p>
              Each region gets a score from 0 to 1 for the window: 45% from mean Sun power, 30% from the share of time
              Earth is in view and 25% from keeping the longest dark spell short (a region dark for the whole window gets
              nothing from that part). Equal scores share a rank.
            </p>
            <p>
              The gap limit under the region table marks dark spells and comms gaps longer than the limit in red. It
              flags risk without changing the score.
            </p>
          </Section>

          <Section id="about-limits" title="Limits">
            <ul className="list-disc space-y-2 pl-5 marker:text-ink-2">
              <li>Horizons stop at 80&deg; S, where the elevation model ends; terrain further north is not included.</li>
              <li>Beyond about 5 km the 320 m grid smooths distant ridges and peaks.</li>
              <li>Sampling is hourly, so a spell shorter than an hour can be missed and shares count whole hours.</li>
              <li>
                One point stands for each region. Light changes a lot across a region; the centre is a reference, not
                the best spot in it.
              </li>
              <li>
                The precomputed tracks cover 2027. Custom sites fetch Horizons tracks live for the window in use, with a
                horizon from the 640 m heightmap and, when NASA Moon Trek is reachable, 80 m terrain within 5 km.
              </li>
            </ul>
          </Section>

          <Section id="about-moon" title="Moon level">
            <p>
              The Moon tab shows the whole Moon as a globe, between the System level and the site-level terrain plate.
              The globe is turned with the IAU/WGCCRE rotation model for the Moon (pole direction and prime meridian
              with its thirteen periodic terms; Archinal and colleagues, 2018) and lit from the Sun&apos;s direction in
              the same JPL Horizons vectors the System tab uses, so the terminator, the sub-solar point and the
              sub-Earth point (the libration) are computed for the time shown. Sun and Earth elevations from this
              model, over a smooth sphere, agree with the Horizons observer tracks at the nine region centres to
              within 0.01° at every hour of 2027. The surface is the colour and elevation maps of the NASA Scientific
              Visualization Studio CGI Moon Kit, made from Lunar Reconnaissance Orbiter camera and LOLA data, printed
              in grey with exaggerated relief shading and no cast shadows. Zoomed in, sharper surface detail is loaded
              for the area in view from NASA Moon Trek map tiles (the LROC wide-angle camera global mosaic, and its
              south polar mosaic south of 67.5° S); the Detail tiles switch turns this off for offline use. Earlier landing sites are marked for
              context at the coordinates published by NASA&apos;s Space Science Data Coordinated Archive (NSSDCA) and
              the mission teams.
            </p>
          </Section>

          <Section id="about-point" title="Any point on the Moon">
            <p>
              At the Moon level you can pick any point on the globe, or type its latitude and longitude, and read Sun
              and Earth visibility there for the mission window. The directions are computed in the browser from the
              same JPL Horizons vectors and IAU rotation model, measured from the surface point so Earth&apos;s
              parallax is included; azimuth and elevation agree with the Horizons observer tracks at the nine region
              centres to within 0.01°. The limit is the horizon: it is that of a smooth sphere of radius 1,737.4 km
              seen from a 2 m mast, 0.087° below level, so hills and crater rims are not included. That matters
              little at low latitudes, where the Sun and Earth climb high, and a great deal near the poles, where
              they graze the horizon. For a point between 80° S and 89.9° S, Use LOLA terrain reopens it at the site
              level with a terrain horizon. In Compare, a picked point is marked No terrain and is not ranked.
            </p>
          </Section>

          <Section id="about-system" title="System level">
            <p>
              The System tab steps back from the surface to the geometry that causes everything else: where Earth is on
              its orbit, where the Moon is around Earth, and which way the sunlight falls. It draws heliocentric
              positions of Earth and the Moon from JPL Horizons vector tables, hourly through 2027 in the ecliptic J2000
              frame, and shares the Navigator&apos;s clock. Distances, the Moon&apos;s illuminated fraction and light
              time are computed from those vectors. The default drawing enlarges the bodies and stretches the Earth to
              Moon distance so all three are visible, and says so; the true scale option keeps real ratios.
            </p>
          </Section>

          <Section id="about-check" title="Checked against NASA">
            <p>
              Mazarico and colleagues at NASA Goddard mapped how often each point near the poles sees the Sun and Earth,
              using LOLA topography: {NASA_REFERENCE_SOURCE.authors}, &ldquo;{NASA_REFERENCE_SOURCE.title}&rdquo;,{" "}
              {NASA_REFERENCE_SOURCE.journal}. The table sets their value at each region centre, read from{" "}
              {NASA_REFERENCE_SOURCE.product}, beside this model&apos;s count over 2027. NASA&apos;s maps are long-term
              averages over many years while ours is one year, so differences of a few points are expected.
            </p>
            <ValidationTable entries={entries} loading={loading} />
          </Section>

          <Section id="about-credits" title="NASA data and credits">
            <ul className="divide-y divide-rule border-t border-rule">
              {CREDITS.map((c) => (
                <li key={c.name} className="py-3">
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-ink-2">{c.who}</p>
                  <p className="mt-1">{c.use}</p>
                  <p className="mt-1 text-[0.844rem]">
                    <Ext href={c.href}>{c.link}</Ext>
                  </p>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="about-ai" title="How AI was used">
            <p>
              The team used Claude, an AI assistant (Super Intelligence, in the Space Apps rules), to help write and
              review code and research notes. All data comes from the NASA and USGS sources listed above, and every number
              on screen is computed from them.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

export default memo(AboutPanel);

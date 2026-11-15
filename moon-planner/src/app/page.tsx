import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Answers } from "@/components/landing/Answers";
import { HorizonPlate } from "@/components/landing/HorizonPlate";
import { LandingProvider } from "@/components/landing/LandingState";
import { MoonSky } from "@/components/landing/MoonSky";
import { NasaCheck } from "@/components/landing/NasaCheck";
import { StartForm } from "@/components/landing/StartForm";

export const metadata: Metadata = {
  title: "Lunar Landing Site Navigator",
  description:
    "Pick one of the nine south-pole regions NASA named for Artemis III in October 2024 and a start date in 2027: see when the Sun clears the real terrain horizon for power and when Earth is in view for direct-to-Earth comms.",
};

const wrap = "mx-auto w-full max-w-[84rem] px-4 sm:px-8 lg:px-12";
const textLink =
  "font-semibold text-ink underline decoration-rule decoration-1 underline-offset-[4px] transition-colors duration-150 hover:decoration-ink";

export default function Home() {
  return (
    <LandingProvider>
      <div className="relative isolate">
        <MoonSky />
        <header
          className={`${wrap} relative z-10 grid min-h-[max(28rem,calc(70svh-2.75rem))] content-center gap-8 py-10 lg:py-12 xl:grid-cols-12 xl:gap-x-10`}
        >
          <div className="xl:col-span-8">
            <h1 className="text-[2.281rem] leading-[1.04] font-extrabold tracking-[-0.025em] text-[#f3f0e8] sm:text-[2.887rem] lg:text-[3.247rem] xl:text-[3.653rem]">
              <span className="block">Pick a region,</span>
              <span className="block">get your landing window.</span>
            </h1>
            <p className="mt-5 max-w-[58ch] text-[1.125rem] leading-[1.55] text-[#c9c3b6]">
              For the nine south-pole regions NASA named for Artemis III in October 2024: when the Sun clears the real
              terrain horizon for power, and when Earth is in view for direct-to-Earth radio, hour by hour through 2027.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link
                href="/tool"
                data-cta="primary"
                className="inline-flex h-11 items-center justify-center bg-[#f3f0e8] px-5 text-[1rem] font-semibold text-ink transition-colors duration-150 select-none hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#f3f0e8]"
              >
                Open the Navigator
              </Link>
              <a
                href="#example"
                data-cta="secondary"
                className="inline-flex h-11 items-center text-[1rem] font-semibold text-[#f3f0e8] underline decoration-white/40 decoration-1 underline-offset-[5px] transition-colors duration-150 hover:decoration-[#f3f0e8] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#f3f0e8]"
              >
                See an example
              </a>
            </div>
          </div>
          <dl className="hidden self-end border-t border-white/30 bg-[#08090c]/90 px-4 xl:col-span-4 xl:block">
            {[
              ["Ephemeris", "JPL Horizons, hourly"],
              ["Terrain", "LOLA, 80 m near each site"],
              ["Coverage", "1 Jan 2027 to 1 Jan 2028, UTC"],
              ["Regions", "Nine, from USGS outlines"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-6 border-b border-white/20 py-2">
                <dt className="text-[0.79rem] font-semibold tracking-[0.08em] text-[#c9c3b6] uppercase">{k}</dt>
                <dd className="text-right text-[0.889rem] text-[#f3f0e8]">{v}</dd>
              </div>
            ))}
          </dl>
        </header>
      </div>

      <div className="relative border-t border-ink bg-paper">
      <section
        id="example"
        aria-labelledby="plate-title"
        className={`${wrap} scroll-mt-4 pt-8 pb-16 lg:pt-10 lg:pb-24`}
      >
        <h2 id="plate-title" className="sr-only">
          Landing window for the chosen region and start date
        </h2>
        <div className="border border-ink bg-paper">
          <StartForm idPrefix="plate" />
          <HorizonPlate />
        </div>
      </section>

      <Section id="answers" title="What it answers">
        <Answers />
      </Section>

      <Section id="method" title="How it knows">
        <p className="max-w-[62ch] text-[1.125rem] leading-[1.55] text-ink-2">
          Through 2027 the Sun never climbs more than about 8° above the horizontal at these regions, and Earth never
          more than about 11°, so a distant ridge decides whether a lander has power and a direct line to Earth. Every
          figure here is measured against that real terrain horizon, not a smooth sphere.
        </p>
        <dl className="mt-8 border-t border-ink">
          <Term name="Sun and Earth">
            JPL Horizons gives the position of the Sun and of Earth in the sky for an observer at each region&rsquo;s
            centre, every hour from 1 Jan 2027 to 1 Jan 2028.
          </Term>
          <Term name="Terrain">
            The horizon around each centre is traced every 0.5° of azimuth across the LOLA south-pole elevation model
            (LDEM_80S_80MPP), at 80 m resolution within about 5 km of the site and 320 m beyond, from 2 m above the
            ground.
          </Term>
          <Term name="Up or down">
            The Sun or Earth counts as up when any part of its disc clears that horizon. The Sun&rsquo;s disc is about
            0.53° across; Earth&rsquo;s is about 1.9°.
          </Term>
        </dl>

        <h3 className="mt-12 text-[1.266rem] leading-snug font-bold text-ink">Checked against NASA</h3>
        <NasaCheck />

        <h3 className="mt-12 text-[1.266rem] leading-snug font-bold text-ink">Limits</h3>
        <p className="mt-2 max-w-[62ch] text-[1rem] leading-[1.6] text-ink-2">
          The tracks cover 2027 at hourly steps; rise and set times are interpolated between them to the minute, the
          same way the Navigator gives them. Each horizon is computed at
          a region&rsquo;s centre; a region spans about 20 km, and elsewhere in it the horizon differs. The terrain
          model reaches 80° S.
        </p>
      </Section>

      <section aria-labelledby="close-title" className={wrap}>
        <div className="border-t-[3px] border-double border-ink pt-10 pb-14 lg:pt-14 lg:pb-20">
          <div className="grid gap-6 lg:grid-cols-12 lg:gap-x-10">
            <div className="lg:col-span-8">
              <h2
                id="close-title"
                className="text-[2.027rem] leading-[1.08] font-extrabold tracking-[-0.02em] text-ink lg:text-[2.566rem]"
              >
                Start with a region and a date.
              </h2>
              <p className="mt-4 max-w-[58ch] text-[1.125rem] leading-[1.55] text-ink-2">
                The Navigator ranks all nine regions for that start and shows why, with the Sun and Earth over the
                real terrain.
              </p>
              <p className="mt-4 max-w-[62ch] text-[1rem] leading-[1.6] text-ink-2">
                <span className="font-semibold text-ink">Uses.</span> Mission planning: rank the regions for a start
                date, then test a slip or the next region over. Teaching: why the south pole is hard. Review: every
                figure names its source and method.
              </p>
            </div>
          </div>
          <div className="mt-8">
            <StartForm idPrefix="close" framed />
          </div>
        </div>

        <footer className="border-t border-ink py-6 text-[0.889rem] leading-[1.6] text-ink-2">
          <p className="max-w-[90ch]">
            <span className="font-semibold text-ink">Data.</span> Sun and Earth positions:{" "}
            <a className={textLink} href="https://ssd.jpl.nasa.gov/horizons/">
              JPL Horizons
            </a>{" "}
            (NASA/JPL-Caltech). Terrain:{" "}
            <a className={textLink} href="https://pgda.gsfc.nasa.gov/products/90">
              LOLA LDEM_80S_80MPP
            </a>
            ; illumination reference:{" "}
            <a className={textLink} href="https://pgda.gsfc.nasa.gov/products/69">
              Mazarico and others, 2011
            </a>
            , both from NASA GSFC&rsquo;s Planetary Geodesy Data Archive. Region outlines: USGS, McClernan 2024,{" "}
            <a className={textLink} href="https://doi.org/10.5066/P1MEQ6UK">
              doi:10.5066/P1MEQ6UK
            </a>
            . Moon imagery:{" "}
            <a className={textLink} href="https://svs.gsfc.nasa.gov/4720">
              NASA SVS CGI Moon Kit
            </a>{" "}
            (LRO LROC and LOLA). Earth imagery: NASA Blue Marble.
          </p>
          <p className="mt-2">
            Built for the NASA Space Apps Challenge 2026. Not a NASA product. How the team used Super Intelligence (AI)
            tools is set out in the Navigator under{" "}
            <Link className={textLink} href="/tool?view=about#about-ai">
              About &amp; data
            </Link>
            .
          </p>
        </footer>
      </section>
      </div>
    </LandingProvider>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className={wrap}>
      <div className="grid gap-6 border-t border-ink pt-8 pb-16 lg:grid-cols-12 lg:gap-x-10 lg:pt-10 lg:pb-24">
        <h2
          id={`${id}-title`}
          className="text-[1.602rem] leading-tight font-bold tracking-[-0.01em] text-ink lg:sticky lg:top-8 lg:col-span-4 lg:self-start lg:text-[2.027rem]"
        >
          {title}
        </h2>
        <div className="min-w-0 lg:col-span-8">{children}</div>
      </div>
    </section>
  );
}

function Term({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
      <dt className="text-[1rem] font-bold text-ink">{name}</dt>
      <dd className="max-w-[62ch] text-[1rem] leading-[1.6] text-ink-2">{children}</dd>
    </div>
  );
}

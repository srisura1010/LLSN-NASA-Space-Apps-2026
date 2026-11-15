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
    "Pick a south-pole region and a date in 2027. See when the Sun is up for power, and when Earth is in view for a radio link.",
};

const wrap = "mx-auto w-full max-w-[84rem] px-4 sm:px-8 lg:px-12";
const textLink =
  "font-semibold text-ink underline decoration-rule decoration-1 underline-offset-[4px] transition-colors duration-150 hover:decoration-ink";

export default function Home() {
  return (
    <LandingProvider>
      <div className="relative isolate">
        <MoonSky />
        <header className={`${wrap} relative z-10 grid min-h-[calc(100svh-2.75rem)] content-center py-16`}>
          <div className="max-w-[40rem]">
            <h1 className="hero-draw text-[2.281rem] leading-[1.04] font-extrabold tracking-[-0.025em] text-balance text-[#f3f0e8] sm:text-[2.887rem] lg:text-[3.247rem] xl:text-[3.653rem]">
              Pick a place. See when you can land.
            </h1>
            <p className="hero-draw mt-5 max-w-[36rem] text-[1.125rem] leading-[1.55] text-[#f3f0e8]/80">
              Nine spots near the Moon’s south pole. Choose one and a day in 2027. You’ll see when the Sun is up for
              power, and when Earth is in view for a radio call.
            </p>
            <div className="hero-draw mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <a
                href="#start"
                className="inline-flex h-11 items-center border border-[#f3f0e8] px-5 text-[1rem] font-semibold text-[#f3f0e8] transition-colors duration-150 hover:bg-[#f3f0e8] hover:text-ink"
              >
                Choose a region
              </a>
              <Link
                href="/tool"
                className="inline-flex h-11 items-center text-[1rem] font-semibold text-[#f3f0e8] underline decoration-white/40 decoration-1 underline-offset-[5px] transition-colors duration-150 hover:decoration-[#f3f0e8]"
              >
                Open the Navigator
              </Link>
            </div>
          </div>
        </header>
      </div>

      <div className="relative bg-paper">
      <section id="start" aria-labelledby="plate-title" className={`${wrap} pt-14 pb-16 lg:pt-20 lg:pb-24`}>
        <div className="scroll-rule mb-8 h-px w-full bg-ink" />
        <h2
          id="plate-title"
          className="scroll-draw max-w-[22rem] text-[2.027rem] leading-[1.08] font-extrabold tracking-[-0.02em] text-balance text-ink sm:max-w-none"
        >
          Choose a region and a day.
        </h2>
        <p className="scroll-draw mt-3 mb-8 max-w-[42rem] text-[1.125rem] leading-[1.55] text-ink-2">
          The drawing shows the hills around that spot, and where the Sun and Earth travel during a 6.5-day stay.
        </p>
        <div className="border border-ink bg-paper">
          <StartForm idPrefix="plate" />
          <HorizonPlate />
        </div>
      </section>

      <Section id="answers" title="Three questions">
        <Answers />
      </Section>

      <Section id="method" title="Why the hills matter">
        <p className="scroll-draw max-w-[62ch] text-[1.125rem] leading-[1.55] text-ink-2">
          At these spots the Sun never climbs more than about 8° all year, and Earth stays under about 11°. A ridge a
          few kilometers away can block both. Every number here uses that real horizon, not a smooth ball.
        </p>
        <dl className="mt-8 border-t border-ink">
          <Term name="Sun and Earth">
            JPL Horizons gives their place in the sky at the center of each region, every hour of 2027.
          </Term>
          <Term name="The ground">
            The horizon is traced all the way around that center on NASA’s LOLA height map, from 2 meters up. Close in,
            the map is 80 meters per pixel. Farther out, it is coarser.
          </Term>
          <Term name="In view">
            The Sun or Earth counts as up when any part of it clears the hills. The Sun is about half a degree across.
            Earth is about 2°.
          </Term>
        </dl>

        <h3 className="scroll-draw mt-12 text-[1.266rem] leading-snug font-bold text-ink">Checked against NASA</h3>
        <NasaCheck />

        <h3 className="scroll-draw mt-12 text-[1.266rem] leading-snug font-bold text-ink">What it leaves out</h3>
        <p className="scroll-draw mt-2 max-w-[62ch] text-[1rem] leading-[1.6] text-ink-2">
          This covers 2027, one hour at a time. Rise and set times are filled in to the minute. Each horizon is for the
          center of a region about 20 km across, so the edge can look different. The height map stops at 80° south.
        </p>
      </Section>

      <section aria-labelledby="close-title" className={wrap}>
        <div className="scroll-rule w-full border-t-[3px] border-double border-ink" />
        <div className="pt-10 pb-14 lg:pt-14 lg:pb-20">
          <div className="grid gap-6 lg:grid-cols-12 lg:gap-x-10">
            <div className="lg:col-span-8">
              <h2
                id="close-title"
                className="scroll-draw text-[2.027rem] leading-[1.08] font-extrabold tracking-[-0.02em] text-ink lg:text-[2.566rem]"
              >
                Try another day, or the next region over.
              </h2>
              <p className="scroll-draw mt-4 max-w-[40rem] text-[1.125rem] leading-[1.55] text-ink-2">
                The tool lines up all nine for that start and shows why one works better than another.
              </p>
            </div>
          </div>
          <div className="mt-8">
            <StartForm idPrefix="close" framed />
          </div>
        </div>

        <footer className="border-t border-ink py-6 text-[0.889rem] leading-[1.6] text-ink-2">
          <p className="max-w-[90ch]">
            <span className="font-semibold text-ink">Sources.</span> Sun and Earth positions:{" "}
            <a className={textLink} href="https://ssd.jpl.nasa.gov/horizons/">
              JPL Horizons
            </a>{" "}
            (NASA/JPL-Caltech). The ground:{" "}
            <a className={textLink} href="https://pgda.gsfc.nasa.gov/products/90">
              LOLA LDEM_80S_80MPP
            </a>
            . The check against NASA:{" "}
            <a className={textLink} href="https://pgda.gsfc.nasa.gov/products/69">
              Mazarico and others, 2011
            </a>
            . Region outlines: USGS, McClernan 2024,{" "}
            <a className={textLink} href="https://doi.org/10.5066/P1MEQ6UK">
              doi:10.5066/P1MEQ6UK
            </a>
            . Moon pictures in the tool:{" "}
            <a className={textLink} href="https://svs.gsfc.nasa.gov/4720">
              NASA SVS CGI Moon Kit
            </a>
            . Earth pictures: NASA Blue Marble.
          </p>
          <p className="mt-2">
            Built for the NASA Space Apps Challenge 2026. Not a NASA product. How the team used AI is written up in the
            tool, under{" "}
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
      <div className="scroll-rule h-px w-full bg-ink" />
      <div className="grid gap-6 pt-8 pb-16 lg:grid-cols-12 lg:gap-x-10 lg:pt-10 lg:pb-24">
        <h2
          id={`${id}-title`}
          className="scroll-draw text-[1.602rem] leading-tight font-bold tracking-[-0.01em] text-ink lg:sticky lg:top-8 lg:col-span-4 lg:self-start lg:text-[2.027rem]"
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
    <div className="scroll-draw grid gap-1 border-b border-rule py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
      <dt className="text-[1rem] font-bold text-ink">{name}</dt>
      <dd className="max-w-[62ch] text-[1rem] leading-[1.6] text-ink-2">{children}</dd>
    </div>
  );
}

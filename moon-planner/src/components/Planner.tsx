"use client";

import { useState } from "react";
import BottomBar from "./BottomBar";
import MoonScene from "./MoonScene";
import Sidebar from "./Sidebar";
import { earthDirection, elevationDeg, latLonToVector, sunDirection } from "@/lib/moonMath";
import { SITES } from "@/lib/sites";

export default function Planner() {
  const [selectedId, setSelectedId] = useState("haworth");
  const [startDate, setStartDate] = useState("2026-11-14"); // fixed default avoids a server/client clock mismatch
  const [hourOffset, setHourOffset] = useState(0);

  const currentTime = new Date(Date.parse(startDate) + hourOffset * 3_600_000);
  const sunDir = sunDirection(currentTime);
  const earthDir = earthDirection();

  const site = SITES.find((s) => s.id === selectedId);
  const siteVec = site ? latLonToVector(site.lat, site.lon) : null;
  const sunElevation = siteVec ? elevationDeg(siteVec, sunDir) : null;
  const earthElevation = siteVec ? elevationDeg(siteVec, earthDir) : null;

  return (
    <div className="flex h-screen flex-col text-zinc-100">
      <header className="flex items-center gap-6 border-b border-white/10 px-4 py-2">
        <span className="font-semibold">Lunar Landing Site Navigator</span>
        <span className="ml-auto text-xs text-zinc-500">Sun and Earth positions are approximate</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar sites={SITES} selectedId={selectedId} onSelect={setSelectedId} />
        <main className="relative flex-1">
          <MoonScene
            sites={SITES}
            selectedId={selectedId}
            onSelect={setSelectedId}
            sunDir={sunDir}
            earthDir={earthDir}
          />
          {site && (
            <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-3 py-2 text-xs">
              <div className="font-semibold">{site.name}</div>
              <div className="text-zinc-400">Drag to orbit, scroll to zoom, click a dot to select</div>
            </div>
          )}
        </main>
      </div>

      <BottomBar
        startDate={startDate}
        onStartDateChange={setStartDate}
        hourOffset={hourOffset}
        onHourOffsetChange={setHourOffset}
        currentTime={currentTime}
        sunElevation={sunElevation}
        earthElevation={earthElevation}
      />
    </div>
  );
}

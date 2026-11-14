// Left sidebar: pick a landing site. Sites without coordinates yet are greyed out.

import { hasCoords, type Site } from "@/lib/sites";

type Props = {
  sites: Site[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export default function Sidebar({ sites, selectedId, onSelect }: Props) {
  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-r border-white/10 bg-zinc-950 p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Landing sites
      </h2>
      <ul className="space-y-1">
        {sites.map((site) => {
          const ready = hasCoords(site);
          const selected = site.id === selectedId;
          return (
            <li key={site.id}>
              <button
                disabled={!ready}
                onClick={() => onSelect(site.id)}
                className={`w-full rounded px-3 py-2 text-left text-sm ${
                  selected ? "bg-amber-400/20 text-amber-200" : "hover:bg-white/5"
                } disabled:cursor-not-allowed disabled:text-zinc-600`}
              >
                {site.name}
                <span className="block text-xs text-zinc-500">
                  {ready ? `${site.lat}°, ${site.lon}°` : "coordinates to add"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Placeholder for the doc's "sliders": min solar power, max slope, mission length. */}
      <h2 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Mission filters
      </h2>
      <p className="text-xs text-zinc-500">Min. sunlight, max. slope, mission length (to do)</p>
    </aside>
  );
}

import { formatLatLon, type Site } from "@/lib/sites";

type Props = {
  sites: Site[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export default function Sidebar({ sites, selectedId, onSelect }: Props) {
  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-r border-white/10 p-4">
      <h2 className="mb-2 text-xs font-medium text-zinc-400">Candidate regions</h2>
      <ul className="space-y-1">
        {sites.map((site) => (
          <li key={site.id}>
            <button
              onClick={() => onSelect(site.id)}
              className={`w-full rounded px-3 py-2 text-left text-sm ${
                site.id === selectedId ? "bg-white/10 text-white" : "text-zinc-300 hover:bg-white/5"
              }`}
            >
              {site.name}
              <span className="block font-mono text-xs text-zinc-500">
                {formatLatLon(site.lat, site.lon)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

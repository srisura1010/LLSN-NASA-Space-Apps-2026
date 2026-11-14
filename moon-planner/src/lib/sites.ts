// Candidate landing regions from the challenge (NASA's nine Artemis III regions).
// lat/lon are region centres in degrees (south is negative, east is positive).
// Only Haworth is filled in so far; copy the rest from docs/research
// (USGS-verified centres) on the ryan/research branch.

export type Site = {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
};

export const SITES: Site[] = [
  { id: "cabeus-b", name: "Peak near Cabeus B", lat: null, lon: null },
  { id: "haworth", name: "Haworth", lat: -86.7639, lon: -22.777 },
  { id: "malapert", name: "Malapert Massif", lat: null, lon: null },
  { id: "mouton-plateau", name: "Mons Mouton Plateau", lat: null, lon: null },
  { id: "mouton", name: "Mons Mouton", lat: null, lon: null },
  { id: "nobile-1", name: "Nobile Rim 1", lat: null, lon: null },
  { id: "nobile-2", name: "Nobile Rim 2", lat: null, lon: null },
  { id: "de-gerlache-2", name: "de Gerlache Rim 2", lat: null, lon: null },
  { id: "slater", name: "Slater Plain", lat: null, lon: null },
];

export function hasCoords(site: Site): site is Site & { lat: number; lon: number } {
  return site.lat !== null && site.lon !== null;
}

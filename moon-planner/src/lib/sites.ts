// The nine Artemis III candidate regions. Centres are computed from the USGS
// region outlines (McClernan 2024, doi:10.5066/P1MEQ6UK); planetocentric,
// east-positive longitude.

export type Site = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

export const SITES: Site[] = [
  { id: "cabeus-b", name: "Peak near Cabeus B", lat: -83.6375, lon: -68.7495 },
  { id: "haworth", name: "Haworth", lat: -86.7639, lon: -22.777 },
  { id: "malapert", name: "Malapert Massif", lat: -85.9948, lon: -0.2358 },
  { id: "mouton-plateau", name: "Mons Mouton Plateau", lat: -84.3347, lon: 30.5923 },
  { id: "mouton", name: "Mons Mouton", lat: -85.4266, lon: 31.7428 },
  { id: "nobile-1", name: "Nobile Rim 1", lat: -85.4364, lon: 37.347 },
  { id: "nobile-2", name: "Nobile Rim 2", lat: -83.9541, lon: 58.8215 },
  { id: "de-gerlache-2", name: "de Gerlache Rim 2", lat: -88.23, lon: -64.6284 },
  { id: "slater", name: "Slater Plain", lat: -87.1637, lon: 125.5377 },
];

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat < 0 ? "S" : "N";
  const ew = lon < 0 ? "W" : "E";
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

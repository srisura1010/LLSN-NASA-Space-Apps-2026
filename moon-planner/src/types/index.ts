// Shared TypeScript types.

// TODO: flesh out as we add real site data.
export type LandingSite = {
  id: string;
  name: string;
  lat: number; // degrees (negative = south)
  lon: number; // east longitude, degrees
  altKm?: number;
};

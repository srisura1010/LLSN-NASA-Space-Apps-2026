import type { LandingSite } from "@/types";

// TODO: replace these test sites with real candidate south pole landing sites.
export const sites: LandingSite[] = [
  { id: "test-pole", name: "Test site A", lat: -89.5, lon: 0 },
  { id: "test-45e", name: "Test site B", lat: -88.0, lon: 45 },
];

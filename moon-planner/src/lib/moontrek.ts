// Deep links into NASA Moon Trek's south polar view. Moon Trek's south polar
// projection (IAU2000:30120) is the same polar stereographic frame as the
// LOLA DEM used here, so latLonToXY gives Moon Trek's x/y in metres.

import { latLonToXY } from "./terrain";

const MOON_TREK = "https://trek.nasa.gov/moon/";
const SOUTH_POLAR_CRS = "urn%3Aogc%3Adef%3Acrs%3AIAU2000%3A%3A30120";
/** LOLA colour shaded relief of the south pole (30 m/px), shown at 60% opacity. */
const SOUTH_POLE_RELIEF = "LRO_LOLA_ClrShade_SPole75_30mp_v04%2Ctrue%2C0.6";

export function moonTrekUrl(lat: number, lon: number, zoom = 7): string {
  const { x, y } = latLonToXY(lat, lon);
  return (
    `${MOON_TREK}#v=0.1&x=${Math.round(x)}&y=${Math.round(y)}&z=${zoom}` +
    `&p=${SOUTH_POLAR_CRS}&l=${SOUTH_POLE_RELIEF}`
  );
}

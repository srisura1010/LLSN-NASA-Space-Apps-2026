// Sun-Earth-Moon geometry for the System view, from the packed JPL Horizons
// vectors in public/data/system/2027.json (see scripts/build-system.ts).

export const AU_KM = 149_597_870.7;
export const C_KM_S = 299_792.458;
export const SUN_RADIUS_KM = 695_700;
export const EARTH_RADIUS_KM = 6_371;
export const MOON_RADIUS_KM = 1_737.4;

export type Vec3 = [number, number, number];

export type SystemData = {
  source: string;
  frame: string;
  startMs: number;
  stepMs: number;
  count: number;
  /** Heliocentric ecliptic x, y, z in km, three values per sample. */
  earth: number[];
  moon: number[];
};

export type SystemState = {
  ms: number;
  /** Heliocentric ecliptic J2000, km. */
  earth: Vec3;
  moon: Vec3;
  earthMoonKm: number;
  sunEarthKm: number;
  sunEarthAu: number;
  sunMoonKm: number;
  /** Sun-Moon-Earth angle in degrees: 0 at full Moon, 180 at new Moon. */
  phaseAngleDeg: number;
  /** Fraction of the Moon's disc lit as seen from Earth's centre, 0 to 1. */
  illuminated: number;
  /** Moon's ecliptic longitude minus the Sun's as seen from Earth, 0 to 360 degrees. Below 180 the Moon is waxing. */
  elongationDeg: number;
  waxing: boolean;
  phaseName: string;
  /** One-way light time in seconds. */
  lightTimeEarthMoonS: number;
  lightTimeSunEarthS: number;
};

let cache: Promise<SystemData> | null = null;

export function loadSystem(): Promise<SystemData> {
  if (!cache) {
    cache = fetch("/data/system/2027.json")
      .then((r) => {
        if (!r.ok) throw new Error(`The ephemeris file did not load (HTTP ${r.status}).`);
        return r.json() as Promise<SystemData>;
      })
      .then((d) => {
        if (!d.count || d.earth.length !== d.count * 3 || d.moon.length !== d.count * 3) {
          throw new Error("The ephemeris file is incomplete.");
        }
        return d;
      })
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}

export const systemEndMs = (d: SystemData) => d.startMs + (d.count - 1) * d.stepMs;

function lerp3(a: number[], pos: number, count: number): Vec3 {
  const p = Math.min(Math.max(pos, 0), count - 1);
  const i = Math.min(Math.floor(p), count - 2);
  const f = p - i;
  const k = i * 3;
  return [a[k] + (a[k + 3] - a[k]) * f, a[k + 1] + (a[k + 4] - a[k + 1]) * f, a[k + 2] + (a[k + 5] - a[k + 2]) * f];
}

/** Earth and Moon positions at a time, linearly interpolated between hourly samples (error below about 10 km). */
export function positionsAt(d: SystemData, ms: number): { earth: Vec3; moon: Vec3 } {
  const pos = (ms - d.startMs) / d.stepMs;
  return { earth: lerp3(d.earth, pos, d.count), moon: lerp3(d.moon, pos, d.count) };
}

const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const DEG = 180 / Math.PI;

export function phaseName(illuminated: number, waxing: boolean): string {
  if (illuminated < 0.02) return "New Moon";
  if (illuminated > 0.98) return "Full Moon";
  if (Math.abs(illuminated - 0.5) < 0.03) return waxing ? "First quarter" : "Last quarter";
  if (illuminated < 0.5) return waxing ? "Waxing crescent" : "Waning crescent";
  return waxing ? "Waxing gibbous" : "Waning gibbous";
}

export function stateAt(d: SystemData, ms: number): SystemState {
  const { earth, moon } = positionsAt(d, ms);
  const em = sub(moon, earth);
  const earthMoonKm = len(em);
  const sunEarthKm = len(earth);
  const sunMoonKm = len(moon);
  // Angle at the Moon between the directions to the Sun (-moon) and to Earth (-em).
  const cosPhase = (moon[0] * em[0] + moon[1] * em[1] + moon[2] * em[2]) / (sunMoonKm * earthMoonKm);
  const phaseAngleDeg = Math.acos(Math.min(1, Math.max(-1, cosPhase))) * DEG;
  const illuminated = (1 + cosPhase) / 2;
  const lonMoon = Math.atan2(em[1], em[0]);
  const lonSun = Math.atan2(-earth[1], -earth[0]);
  const elongationDeg = ((((lonMoon - lonSun) * DEG) % 360) + 360) % 360;
  const waxing = elongationDeg < 180;
  return {
    ms,
    earth,
    moon,
    earthMoonKm,
    sunEarthKm,
    sunEarthAu: sunEarthKm / AU_KM,
    sunMoonKm,
    phaseAngleDeg,
    illuminated,
    elongationDeg,
    waxing,
    phaseName: phaseName(illuminated, waxing),
    lightTimeEarthMoonS: earthMoonKm / C_KM_S,
    lightTimeSunEarthS: sunEarthKm / C_KM_S,
  };
}

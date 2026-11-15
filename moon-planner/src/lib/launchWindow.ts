// Launch opportunities from Earth for a chosen lunar arrival time: a
// simplified geometric estimate. Pure functions, safe in the browser.
// The method and everything it leaves out are in LAUNCH_METHOD below.

import { type AzimuthRange, type LaunchSite, launchSites } from "./launchSites";
import { eclipticToEquatorial } from "./moonFrame";
import { positionsAt, type SystemData, type Vec3 } from "./system";

export const LAUNCH_METHOD = [
  "Estimate only: simplified geometry, not a trajectory design.",
  "Model: the spacecraft leaves Earth in a plane that contains Earth's centre, the launch site at lift-off and the Moon's position at arrival. As Earth turns, the heading that puts the rocket in that plane sweeps round; a launch window is the time during which that heading stays inside the site's allowed launch azimuths. Each day has two sweeps, one heading towards the Moon's arrival direction and one towards the opposite point of the sky.",
  "Timing: lift-off, a climb of about 12 minutes to a 185 km parking orbit, a coast of one to two and a half hours to the injection point, then a two-body transfer of the chosen length (3 days by default). The arrival time of each opportunity follows from its lift-off time, so it can differ from the requested arrival by some hours.",
  "Earth's rotation uses the Earth Rotation Angle (IAU 2000) with UTC taken as UT1 against the J2000 equator of the ephemeris; precession since 2000 in declination (about 0.15 degrees) and nutation are ignored. The Moon's position is the 2027 JPL Horizons table used elsewhere in the Navigator. Site latitude is used as geocentric.",
  "The orbit inclination follows from cos i = cos(latitude) x sin(azimuth), with the azimuth corrected for the ground's eastward speed. Expect about 2 degrees in azimuth and 20 minutes in time against a real mission (Apollo 11 check: see DATA_SOURCES.md).",
  "Figures of merit are proxies: the eastward rotation speed gained (465 m/s x cos latitude x sin azimuth), the inclination, and the angle between the transfer plane and the Moon's orbit plane. Inclinations above 52 degrees are marked costly; that threshold is a choice, not a physical limit.",
  "Not modelled: the Moon's gravity on the way, departure energy (C3) against date and distance, lunar orbit insertion and the orbit plane at the Moon, westward (retrograde) launches, doglegs, the climb profile of any real rocket, lighting at the landing site beyond what the Navigator already shows, tracking coverage, weather and range scheduling.",
  "Allowed azimuths marked approximate are reasoned from geography, not taken from a range safety document.",
].join("\n");

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const J2000_MS = Date.UTC(2000, 0, 1, 12);

export const MU_EARTH = 398_600.4418; // km^3/s^2
export const EARTH_EQUATORIAL_RADIUS_KM = 6_378.137;
/** Eastward speed of the ground at the equator, m/s. */
export const EQUATOR_SPEED_MS = 465.1;
/** Inclination above which an opportunity is marked "costly" (a chosen threshold). */
export const COSTLY_INCLINATION_DEG = 52;

const mod360 = (d: number) => ((d % 360) + 360) % 360;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const unit = (v: Vec3): Vec3 => {
  const l = len(v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const mix = (a: Vec3, ka: number, b: Vec3, kb: number): Vec3 => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];

// ---------------------------------------------------------------- Earth orientation

const daysSinceJ2000 = (ms: number) => (ms - J2000_MS) / DAY_MS;

/** Earth Rotation Angle in degrees (IAU 2000), UTC taken as UT1. This is what the model uses. */
export function earthRotationAngleDeg(ms: number): number {
  const du = daysSinceJ2000(ms);
  // The whole days are dropped from the second term before multiplying to keep precision.
  return mod360(360 * (0.779057273264 + 0.00273781191135448 * du + (du % 1)));
}

/** Greenwich mean sidereal time in degrees, IAU 1982 (Meeus 12.4), UTC taken as UT1. For reference and checks. */
export function gmstDeg(ms: number): number {
  const d = daysSinceJ2000(ms);
  const t = d / 36525;
  return mod360(280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38_710_000);
}

/** Unit vectors at a ground site in the equatorial J2000 frame: up (the site's direction), east and north. */
export function siteFrame(latDeg: number, lonDeg: number, ms: number): { up: Vec3; east: Vec3; north: Vec3 } {
  const a = (earthRotationAngleDeg(ms) + lonDeg) * RAD;
  const p = latDeg * RAD;
  const [ca, sa, cp, sp] = [Math.cos(a), Math.sin(a), Math.cos(p), Math.sin(p)];
  return { up: [cp * ca, cp * sa, sp], east: [-sa, ca, 0], north: [-sp * ca, -sp * sa, cp] };
}

// ---------------------------------------------------------------- Moon

export type MoonPosition = { raDeg: number; decDeg: number; distanceKm: number; km: Vec3 };

/** Right ascension, declination and distance of a geocentric equatorial vector in km. */
export function toRaDec(km: Vec3): MoonPosition {
  const r = len(km);
  return { raDeg: mod360(Math.atan2(km[1], km[0]) * DEG), decDeg: Math.asin(km[2] / r) * DEG, distanceKm: r, km };
}

/** The Moon from Earth's centre in the equatorial J2000 frame, km. */
export function moonEquatorialKm(system: SystemData, ms: number): Vec3 {
  const { earth, moon } = positionsAt(system, ms);
  return eclipticToEquatorial([moon[0] - earth[0], moon[1] - earth[1], moon[2] - earth[2]]);
}

export const moonGeocentric = (system: SystemData, ms: number): MoonPosition => toRaDec(moonEquatorialKm(system, ms));

// ---------------------------------------------------------------- transfer

/**
 * True anomaly in degrees at which a two-body transfer from a perigee at
 * `perigeeKm` reaches `distanceKm` after `seconds`. Shorter transfers arrive
 * earlier on a larger ellipse. Limited to 180 (a Hohmann transfer) when the
 * time asked for is longer than that, and to the parabola when shorter.
 */
export function transferSweepDeg(perigeeKm: number, distanceKm: number, seconds: number): number {
  const at = (a: number) => {
    const e = 1 - perigeeKm / a;
    const ecc = Math.acos(Math.min(1, Math.max(-1, (1 - distanceKm / a) / e)));
    const nu = Math.acos(Math.min(1, Math.max(-1, ((a * (1 - e * e)) / distanceKm - 1) / e)));
    return { t: Math.sqrt((a * a * a) / MU_EARTH) * (ecc - e * Math.sin(ecc)), nu: nu * DEG };
  };
  let lo = (perigeeKm + distanceKm) / 2;
  let hi = 1e9;
  if (seconds >= at(lo).t) return 180;
  if (seconds <= at(hi).t) return at(hi).nu;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid).t > seconds) lo = mid;
    else hi = mid;
  }
  return at(lo).nu;
}

// ---------------------------------------------------------------- launch geometry

export type LaunchOptions = {
  /** The 2027 ephemeris (loadSystem). Needed unless `moonKmAt` is given. */
  system?: SystemData;
  /** Overrides the Moon: geocentric equatorial J2000 position in km at a time. */
  moonKmAt?: (ms: number) => Vec3;
  /** Injection to arrival, days. Default 3. */
  transitDays?: number;
  /** Candidates are listed for lift-off within this many days of the nominal departure. Default 1. */
  spanDays?: number;
  /** Shortest time from lift-off to injection, minutes. Default 60; the longest is one orbit more. */
  minCoastMin?: number;
  /** Parking orbit altitude, km. Default 185. */
  parkingAltitudeKm?: number;
  /** Lift-off to orbit: minutes and the angle travelled downrange in degrees. Defaults 12 and 24. */
  ascentMin?: number;
  ascentArcDeg?: number;
};

export const TRANSIT_DAY_OPTIONS = [2.5, 3, 3.5, 4, 4.5, 5];
export const DEFAULT_TRANSIT_DAYS = 3;

export type Rating = "good" | "costly" | "blocked";

export type LaunchOpportunity = {
  siteId: string;
  siteName: string;
  /** Which of the two daily sweeps: heading towards the Moon's arrival direction, or towards the opposite point. */
  sweep: "towards-moon" | "towards-antipode";
  /** Best lift-off of the window (lowest inclination inside the allowed azimuths), or the nearest miss when blocked. */
  launchMs: number;
  /** Ground-relative launch azimuth at `launchMs`, degrees clockwise from north. */
  azimuthDeg: number;
  /** Parking and transfer orbit inclination to Earth's equator, degrees. */
  inclinationDeg: number;
  azimuthAllowed: boolean;
  /** Window during which the required azimuth stays inside the allowed range; null when blocked. */
  windowOpenMs: number | null;
  windowCloseMs: number | null;
  azimuthOpenDeg: number | null;
  azimuthCloseDeg: number | null;
  windowMinutes: number;
  rating: Rating;
  /** Why the opportunity is blocked or costly; null when good. */
  reason: string | null;
  /** True when the plane is reached directly from the pad, with no dogleg. */
  planeChangeFree: boolean;
  /** Proxy: eastward ground speed carried into orbit, m/s (negative when heading west of north). */
  rotationBoostMs: number;
  /** Angle between the transfer plane and the Moon's orbit plane, degrees; null without a moving Moon. */
  moonPlaneAngleDeg: number | null;
  /** Lift-off to injection, minutes. */
  coastMin: number;
  tliMs: number;
  /** Ground point under the injection, degrees (east positive). */
  tliLat: number;
  tliLon: number;
  /** Arrival that follows from this lift-off, and its difference from the arrival asked for. */
  arrivalMs: number;
  arrivalOffsetHours: number;
  moonRaDeg: number;
  moonDecDeg: number;
};

type Resolved = Required<Omit<LaunchOptions, "system" | "moonKmAt">> & { moonKmAt: (ms: number) => Vec3 };

function resolve(opts: LaunchOptions): Resolved {
  const system = opts.system;
  const moonKmAt = opts.moonKmAt ?? (system ? (ms: number) => moonEquatorialKm(system, ms) : null);
  if (!moonKmAt) throw new Error("launchWindow needs the ephemeris (opts.system) or opts.moonKmAt.");
  return {
    moonKmAt,
    transitDays: opts.transitDays ?? DEFAULT_TRANSIT_DAYS,
    spanDays: opts.spanDays ?? 1,
    minCoastMin: opts.minCoastMin ?? 60,
    parkingAltitudeKm: opts.parkingAltitudeKm ?? 185,
    ascentMin: opts.ascentMin ?? 12,
    ascentArcDeg: opts.ascentArcDeg ?? 24,
  };
}

/** Lift-off to arrival used to pick the Moon's position before the coast is known, ms. */
const nominalFlightMs = (o: Resolved) => (o.minCoastMin + 45) * 60_000 + o.transitDays * DAY_MS;

export function inAzimuthRanges(azimuthDeg: number, ranges: AzimuthRange[]): boolean {
  const a = mod360(azimuthDeg);
  return ranges.some((r) => (a >= r.min && a <= r.max) || (a === 0 && r.max === 360));
}

/** Smallest angle in degrees from an azimuth to the allowed ranges (0 inside). */
export function azimuthGapDeg(azimuthDeg: number, ranges: AzimuthRange[]): number {
  if (inAzimuthRanges(azimuthDeg, ranges)) return 0;
  const a = mod360(azimuthDeg);
  const sep = (x: number) => Math.abs(((a - x + 540) % 360) - 180);
  return Math.min(...ranges.flatMap((r) => [sep(r.min), sep(r.max)]));
}

type Geometry = {
  ms: number;
  /** +1 heading towards the Moon's arrival direction, -1 towards the opposite point. */
  side: 1 | -1;
  inertialAzimuthDeg: number;
  azimuthDeg: number;
  inclinationDeg: number;
  moon: Vec3;
  up: Vec3;
  heading: Vec3;
};

/** The plane through the site at `ms` and the Moon's arrival direction, flown eastward. */
function geometryAt(site: LaunchSite, ms: number, o: Resolved): Geometry {
  const moon = unit(o.moonKmAt(ms + nominalFlightMs(o)));
  const f = siteFrame(site.lat, site.lon, ms);
  const e = dot(moon, f.east);
  const n = dot(moon, f.north);
  const side: 1 | -1 = e >= 0 ? 1 : -1;
  const inertial = Math.atan2(side * e, side * n);
  const heading = mix(f.north, Math.cos(inertial), f.east, Math.sin(inertial));
  const cosLat = Math.cos(site.lat * RAD);
  const v = Math.sqrt(MU_EARTH / (EARTH_EQUATORIAL_RADIUS_KM + o.parkingAltitudeKm));
  // Ground-relative heading: take the ground's eastward speed off the orbital velocity.
  const azimuth = Math.atan2(v * Math.sin(inertial) - (EQUATOR_SPEED_MS / 1000) * cosLat, v * Math.cos(inertial));
  return {
    ms,
    side,
    inertialAzimuthDeg: mod360(inertial * DEG),
    azimuthDeg: mod360(azimuth * DEG),
    inclinationDeg: Math.acos(Math.min(1, Math.max(-1, cosLat * Math.sin(inertial)))) * DEG,
    moon,
    up: f.up,
    heading,
  };
}

/** The azimuth and inclination a lift-off at `ms` needs to reach the Moon's arrival position, whatever the site allows. */
export function requiredAzimuth(site: LaunchSite, ms: number, opts: LaunchOptions): { azimuthDeg: number; inclinationDeg: number; allowed: boolean } {
  const g = geometryAt(site, ms, resolve(opts));
  return { azimuthDeg: g.azimuthDeg, inclinationDeg: g.inclinationDeg, allowed: inAzimuthRanges(g.azimuthDeg, site.azimuths) };
}

const describeRanges = (ranges: AzimuthRange[]) => {
  // Two ranges that meet at north read better as one signed range.
  if (ranges.length === 2 && ranges[0].max === 360 && ranges[1].min === 0) return `${ranges[0].min}°–${ranges[1].max}° through north`;
  return ranges.map((r) => `${r.min}°–${r.max}°`).join(" and ");
};

/** "35°–120°", or "349.5°–91.5° through north" for a range that crosses north. */
export const formatAzimuthRanges = (site: LaunchSite): string => describeRanges(site.azimuths);

function finish(site: LaunchSite, g: Geometry, arrivalMs: number, o: Resolved, window: { open: Geometry; close: Geometry } | null): LaunchOpportunity {
  const rParkKm = EARTH_EQUATORIAL_RADIUS_KM + o.parkingAltitudeKm;
  const moonKm = o.moonKmAt(g.ms + nominalFlightMs(o));
  // Angles in the orbit plane, measured from the site in the direction of flight.
  const moonAngle = mod360(Math.atan2(dot(g.moon, g.heading), dot(g.moon, g.up)) * DEG);
  const tliAngle = mod360(moonAngle - transferSweepDeg(rParkKm, len(moonKm), o.transitDays * 86_400));
  const periodMin = (2 * Math.PI * Math.sqrt((rParkKm * rParkKm * rParkKm) / MU_EARTH)) / 60;
  let coastMin = o.ascentMin + (mod360(tliAngle - o.ascentArcDeg) / 360) * periodMin;
  while (coastMin < o.minCoastMin) coastMin += periodMin;
  const tliMs = g.ms + coastMin * 60_000;
  const tliDir = mix(g.up, Math.cos(tliAngle * RAD), g.heading, Math.sin(tliAngle * RAD));
  const tliLon = ((Math.atan2(tliDir[1], tliDir[0]) * DEG - earthRotationAngleDeg(tliMs) + 540) % 360) - 180;
  const arrival = tliMs + o.transitDays * DAY_MS;

  // The Moon's orbit normal from its motion over two hours; null for a fixed Moon.
  const m0 = o.moonKmAt(g.ms + nominalFlightMs(o) - HOUR_MS);
  const m1 = o.moonKmAt(g.ms + nominalFlightMs(o) + HOUR_MS);
  const moonNormal = cross(m0, m1);
  const moonPlaneAngleDeg =
    len(moonNormal) > 1 ? Math.acos(Math.min(1, Math.max(-1, dot(unit(moonNormal), unit(cross(g.up, g.heading)))))) * DEG : null;

  const allowed = window !== null;
  const boost = EQUATOR_SPEED_MS * Math.cos(site.lat * RAD) * Math.sin(g.azimuthDeg * RAD);
  const costly = g.inclinationDeg > COSTLY_INCLINATION_DEG;
  let reason: string | null = null;
  if (!allowed) {
    reason = `azimuth ${g.azimuthDeg.toFixed(0)}° is outside the ${describeRanges(site.azimuths)} range (a dogleg of at least ${azimuthGapDeg(g.azimuthDeg, site.azimuths).toFixed(0)}° would be needed)`;
  } else if (costly) {
    const cause =
      Math.abs(site.lat) > COSTLY_INCLINATION_DEG
        ? `site latitude ${Math.abs(site.lat).toFixed(0)}° sets the lowest inclination a direct launch can reach`
        : `the allowed azimuths (${describeRanges(site.azimuths)}) point well away from due east`;
    reason = `inclination ${g.inclinationDeg.toFixed(0)}°: ${cause}; rotation gain ${boost.toFixed(0)} of ${EQUATOR_SPEED_MS.toFixed(0)} m/s`;
    if (moonPlaneAngleDeg !== null) reason += ` and the transfer plane is ${moonPlaneAngleDeg.toFixed(0)}° from the Moon's orbit plane`;
  }
  const md = toRaDec(moonKm);
  return {
    siteId: site.id,
    siteName: site.name,
    sweep: g.side === 1 ? "towards-moon" : "towards-antipode",
    launchMs: g.ms,
    azimuthDeg: g.azimuthDeg,
    inclinationDeg: g.inclinationDeg,
    azimuthAllowed: allowed,
    windowOpenMs: window?.open.ms ?? null,
    windowCloseMs: window?.close.ms ?? null,
    azimuthOpenDeg: window?.open.azimuthDeg ?? null,
    azimuthCloseDeg: window?.close.azimuthDeg ?? null,
    windowMinutes: window ? (window.close.ms - window.open.ms) / 60_000 : 0,
    rating: !allowed ? "blocked" : costly ? "costly" : "good",
    reason,
    planeChangeFree: allowed,
    rotationBoostMs: boost,
    moonPlaneAngleDeg,
    coastMin,
    tliMs,
    tliLat: Math.asin(tliDir[2]) * DEG,
    tliLon,
    arrivalMs: arrival,
    arrivalOffsetHours: (arrival - arrivalMs) / HOUR_MS,
    moonRaDeg: md.raDeg,
    moonDecDeg: md.decDeg,
  };
}

const RATING_ORDER: Record<Rating, number> = { good: 0, costly: 1, blocked: 2 };

/** Usable first, then by lift-off time. */
export function compareOpportunities(a: LaunchOpportunity, b: LaunchOpportunity): number {
  return RATING_ORDER[a.rating] - RATING_ORDER[b.rating] || a.launchMs - b.launchMs;
}

const STEP_MS = 2 * 60_000;

/**
 * Launch opportunities from one site that reach the Moon near `arrivalMs`:
 * the two daily sweeps within `spanDays` of the nominal departure, in time
 * order. A sweep with no allowed azimuth is returned once, as blocked, at
 * its nearest miss.
 */
export function launchOpportunities(site: LaunchSite, arrivalMs: number, opts: LaunchOptions): LaunchOpportunity[] {
  const o = resolve(opts);
  const centre = arrivalMs - nominalFlightMs(o);
  const from = centre - o.spanDays * DAY_MS;
  const to = centre + o.spanDays * DAY_MS;
  const allowedAt = (g: Geometry) => inAzimuthRanges(g.azimuthDeg, site.azimuths);
  // Time at which `test` flips between two samples that differ.
  const edge = (a: Geometry, b: Geometry, test: (g: Geometry) => boolean): [Geometry, Geometry] => {
    let [lo, hi] = [a, b];
    const want = test(a);
    for (let i = 0; i < 18; i++) {
      const mid = geometryAt(site, (lo.ms + hi.ms) / 2, o);
      if (test(mid) === want) lo = mid;
      else hi = mid;
    }
    return [lo, hi];
  };

  const out: LaunchOpportunity[] = [];
  const closeSweep = (samples: Geometry[]) => {
    if (samples.length < 2) return;
    let found = false;
    let start: Geometry | null = null;
    let best: Geometry | null = null;
    const emit = (open: Geometry, close: Geometry, pick: Geometry) => {
      found = true;
      for (const c of [open, close]) if (c.inclinationDeg < pick.inclinationDeg) pick = c;
      if (pick.ms >= from && pick.ms <= to) out.push(finish(site, pick, arrivalMs, o, { open, close }));
    };
    for (let i = 0; i < samples.length; i++) {
      const g = samples[i];
      const ok = allowedAt(g);
      if (ok && !start) {
        start = i > 0 ? edge(samples[i - 1], g, allowedAt)[1] : g;
        best = g;
      }
      if (ok && best && g.inclinationDeg < best.inclinationDeg) best = g;
      if (start && best && (!ok || i === samples.length - 1)) {
        emit(start, ok ? g : edge(samples[i - 1], g, allowedAt)[0], best);
        start = best = null;
      }
    }
    if (found) return;
    const miss = samples.reduce((a, b) => (azimuthGapDeg(b.azimuthDeg, site.azimuths) < azimuthGapDeg(a.azimuthDeg, site.azimuths) ? b : a));
    if (miss.ms >= from && miss.ms <= to) out.push(finish(site, miss, arrivalMs, o, null));
  };

  // Scan past both ends so that sweeps cut by the span are still whole.
  let sweep: Geometry[] = [];
  for (let ms = from - 0.75 * DAY_MS; ms <= to + 0.75 * DAY_MS; ms += STEP_MS) {
    const g = geometryAt(site, ms, o);
    const prev = sweep[sweep.length - 1];
    if (prev && prev.side !== g.side) {
      const [lo, hi] = edge(prev, g, (x) => x.side === prev.side);
      sweep.push(lo);
      closeSweep(sweep);
      sweep = [hi];
    }
    sweep.push(g);
  }
  // The first and last sweeps of the scan are partial; they lie outside the span, so they are dropped.
  return out.sort((a, b) => a.launchMs - b.launchMs);
}

/** Every site's opportunities in one list: usable first, then by lift-off time. */
export function launchWindowsForAll(arrivalMs: number, opts: LaunchOptions, sites: LaunchSite[] = launchSites): LaunchOpportunity[] {
  return sites.flatMap((s) => launchOpportunities(s, arrivalMs, opts)).sort(compareOpportunities);
}

/** The opportunity to show first for a site: best rating, then the arrival nearest the one asked for. */
export function bestOpportunity(list: LaunchOpportunity[]): LaunchOpportunity | null {
  return (
    [...list].sort(
      (a, b) => RATING_ORDER[a.rating] - RATING_ORDER[b.rating] || Math.abs(a.arrivalOffsetHours) - Math.abs(b.arrivalOffsetHours),
    )[0] ?? null
  );
}

// ---------------------------------------------------------------- formatting

const p2 = (n: number) => String(n).padStart(2, "0");

/** "2027-11-10 21:04 UTC" */
export function formatLaunchUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
}

/** "21:04–23:51 UTC (2 h 47 min)", or "no window" when blocked. */
export function formatWindow(o: LaunchOpportunity): string {
  if (o.windowOpenMs === null || o.windowCloseMs === null) return "no window";
  const t = (ms: number) => formatLaunchUtc(ms).slice(11, 16);
  const m = Math.round(o.windowMinutes);
  const length = m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  return `${t(o.windowOpenMs)}–${t(o.windowCloseMs)} UTC (${length})`;
}

export const RATING_LABEL: Record<Rating, string> = { good: "Usable", costly: "Usable at a cost", blocked: "Not usable" };

/** One line for lists and logs. */
export function formatOpportunity(o: LaunchOpportunity): string {
  const head = `${o.siteName}: ${formatLaunchUtc(o.launchMs)}, azimuth ${o.azimuthDeg.toFixed(1)}°, inclination ${o.inclinationDeg.toFixed(1)}°`;
  return `${head}, ${RATING_LABEL[o.rating].toLowerCase()}, ${formatWindow(o)}${o.reason ? `; ${o.reason}` : ""}`;
}

// What zooming in past the limit opens at the Moon level. The camera always looks at the Moon's centre, so the place
// at the centre of the view is the point under the camera. The hint over the globe, the zoom gate and the
// "Down to site level" button all read the same rule from here.

import { isCustomSiteSupported } from "@/lib/customSite";
import { bodyToLatLon, type LatLon } from "@/lib/moonFrame";
import type { Vec3 } from "@/lib/system";

/** South of this latitude the view is closing on the polar plate, and the selected region is what opens. */
export const REGION_GATE_LAT = -70;
/** A picked point this close to the view centre (great-circle degrees) is what opens, rather than the centre itself. */
const POINT_SNAP_DEG = 3;

const RAD = Math.PI / 180;
const round2 = (v: number) => Math.round(v * 100) / 100 || 0;

export type SiteTarget =
  /** The picked point, opened as a site. */
  | { kind: "point"; lat: number; lon: number }
  /** The selected one of the nine regions. */
  | { kind: "region" }
  /** The view centre, which becomes the picked point and opens as a site. */
  | { kind: "centre"; lat: number; lon: number };

/** The selenographic point under a camera at `dir` (scene axes, any length) looking at the Moon's centre, to 0.01°. */
export function centreOf(dir: Vec3): LatLon {
  // Scene axes back to body-fixed: the inverse of toScene.
  const ll = bodyToLatLon([dir[0], -dir[2], dir[1]]);
  return { lat: round2(ll.lat), lon: round2(ll.lon) };
}

/** The place at the centre of the Moon level's view as last drawn, for the step button outside the canvas. */
export const viewCentre: { current: LatLon | null } = { current: null };

function separationDeg(a: LatLon, b: LatLon) {
  const c = Math.sin(a.lat * RAD) * Math.sin(b.lat * RAD) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((a.lon - b.lon) * RAD);
  return Math.acos(Math.min(1, Math.max(-1, c))) / RAD;
}

export function siteTarget(centre: LatLon, point: LatLon | null): SiteTarget {
  // South of 80° S a point needs the polar LOLA grids to cover it; anywhere else its terrain is fetched.
  if (point && separationDeg(centre, point) <= POINT_SNAP_DEG && (point.lat > -80 || isCustomSiteSupported(point.lat, point.lon).ok)) {
    return { kind: "point", lat: point.lat, lon: point.lon };
  }
  if (centre.lat <= REGION_GATE_LAT) return { kind: "region" };
  return { kind: "centre", lat: centre.lat, lon: centre.lon };
}

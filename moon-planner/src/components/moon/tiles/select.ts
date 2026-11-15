// Which tiles a view needs: a walk down each scheme's quadtree that stops at
// the first level whose texels are no larger than a screen pixel, and skips
// what is behind the limb or outside the view. Pure arithmetic, no WebGL.

import { tileKey, type TileId, type TileScheme, type V3 } from "./schemes";

export type TileView = {
  /** Camera position in the globe's own frame, in globe radii. */
  eye: V3;
  /** Column-major 4 by 4 matrix from the globe's frame to clip space. */
  clip: ArrayLike<number>;
  /** Vertical field of view, radians. */
  fovY: number;
  /** Height of the drawing in device pixels. */
  heightPx: number;
};

export type SelectOptions = {
  /** Largest size of one texel on screen, in pixels, before the next level is asked for. */
  maxError?: number;
  /** Most tiles one view may ask for; past it the error allowed is raised until the view fits. */
  maxTiles?: number;
  /** Detail starts once the globe's disc is this many view heights across. */
  activeDiameter?: number;
};

export type Selected = { tile: TileId; key: string; /** Distance from the view centre, in half view widths; nearest loads first. */ priority: number };

export type Selection = { active: boolean; tiles: Selected[]; maxLevel: number; maxError: number };

const DEFAULTS = { maxError: 1, maxTiles: 140, activeDiameter: 1.15 };

/** The globe's disc across the view, as a fraction of the view's height. */
export function discDiameter(view: TileView): number {
  const d = Math.hypot(view.eye[0], view.eye[1], view.eye[2]);
  if (d <= 1) return Infinity;
  return 1 / Math.sqrt(d * d - 1) / Math.tan(view.fovY / 2);
}

function walk(view: TileView, scheme: TileScheme, maxError: number, out: Selected[]) {
  const [ex, ey, ez] = view.eye;
  const d = Math.hypot(ex, ey, ez);
  const horizon = Math.acos(Math.min(1, 1 / d));
  const pxPerRad = view.heightPx / 2 / Math.tan(view.fovY / 2);
  const m = view.clip;

  const visit = (t: TileId) => {
    // Small tiles are judged at 3 by 3 points; the large ones above the first drawn level at 5 by 5.
    const n = t.z < scheme.minLevel ? 4 : 2;
    let maxDot = -1;
    let minDist = Infinity;
    let facing = 0;
    let left = 0;
    let right = 0;
    let below = 0;
    let above = 0;
    let behind = 0;
    let centreX = 0;
    let centreY = 0;
    let first: V3 | null = null;
    let spacing = 0;
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const p = scheme.point(t, i / n, j / n);
        if (!first) first = p;
        else if (i === 1 && j === 1) spacing = Math.max(spacing, Math.acos(Math.min(1, first[0] * p[0] + first[1] * p[1] + first[2] * p[2])));
        const dot = (p[0] * ex + p[1] * ey + p[2] * ez) / d;
        if (dot > maxDot) maxDot = dot;
        const vx = ex - p[0];
        const vy = ey - p[1];
        const vz = ez - p[2];
        const dist = Math.hypot(vx, vy, vz);
        if (dot * d > 1) {
          if (dist < minDist) minDist = dist;
          facing = Math.max(facing, (p[0] * vx + p[1] * vy + p[2] * vz) / dist);
        }
        const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
        const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
        const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
        // A tenth of the view of slack, since the surface between the points bulges towards the camera.
        const w = Math.abs(cw) * 1.1;
        if (cw <= 0) behind++;
        else {
          if (cx < -w) left++;
          if (cx > w) right++;
          if (cy < -w) below++;
          if (cy > w) above++;
        }
        if (i * 2 === n && j * 2 === n && cw > 0) {
          centreX = cx / cw;
          centreY = cy / cw;
        }
      }
    // Behind the limb: no judged point is on the near side, with the spacing of the points as slack.
    if (Math.acos(Math.max(-1, Math.min(1, maxDot))) > horizon + spacing) return;
    const count = (n + 1) * (n + 1);
    if (t.z >= scheme.minLevel && (left === count || right === count || below === count || above === count || behind === count)) return;
    if (minDist === Infinity) minDist = Math.max(d - 1, 1e-6);
    const px = (scheme.texelRad(t) / minDist) * pxPerRad * Math.max(0.3, facing);
    if (px > maxError && t.z < scheme.maxLevel) {
      for (const c of scheme.children(t)) visit(c);
      return;
    }
    // Coarser than the first drawn level and already fine enough: the whole-globe map covers it.
    if (t.z >= scheme.minLevel) out.push({ tile: t, key: tileKey(t), priority: Math.hypot(centreX, centreY) });
  };
  for (const r of scheme.roots()) visit(r);
}

/** The tiles to draw for a view, nearest the view centre first. Empty until the globe is large in the view. */
export function selectTiles(view: TileView, schemes: TileScheme[], options: SelectOptions = {}): Selection {
  const o = { ...DEFAULTS, ...options };
  if (discDiameter(view) < o.activeDiameter) return { active: false, tiles: [], maxLevel: 0, maxError: o.maxError };
  let maxError = o.maxError;
  let tiles: Selected[] = [];
  for (let pass = 0; pass < 6; pass++) {
    tiles = [];
    for (const s of schemes) walk(view, s, maxError, tiles);
    if (tiles.length <= o.maxTiles) break;
    maxError *= 1.4;
  }
  tiles.sort((a, b) => a.priority - b.priority);
  if (tiles.length > o.maxTiles) tiles.length = o.maxTiles;
  return { active: true, tiles, maxLevel: tiles.reduce((z, t) => Math.max(z, t.tile.z), 0), maxError };
}

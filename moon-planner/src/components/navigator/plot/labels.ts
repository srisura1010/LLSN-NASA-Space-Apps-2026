// Text measuring and greedy, collision-free label placement for the plot.

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Region = "sky" | "terrain" | "mixed";
export type Align = "start" | "middle" | "end";

/** Colour family of a label line; the shade is picked from the region it lands in. */
export type Tone = "sun" | "earth" | "ink";
export type LabelLine = { text: string; width: number; tone: Tone; strong?: boolean };

export type LabelSpec = {
  id: string;
  lines: LabelLine[];
  lineHeight: number;
  /** Higher places first. */
  priority: number;
  /** Candidate spots: a point and the unit direction the label sits in from it. */
  anchors: { x: number; y: number; dx: number; dy: number }[];
  /** The point the label names; a leader is drawn to it when the label sits away from it. */
  target?: { x: number; y: number };
  /** Keep the label even when no spot is free, relaxing obstacles, then the terrain edge. */
  required?: boolean;
};

export type PlacedLabel = {
  id: string;
  lines: LabelLine[];
  lineHeight: number;
  box: Box;
  align: Align;
  region: Region;
  /** The spot used, and the named point, for drawing a leader. */
  anchor: { x: number; y: number };
  target?: { x: number; y: number };
};

let ctx: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();
let cacheEpoch = 0;

/**
 * Rendered width in px of a single-line label in the app's sans face. Pass a
 * new epoch once web fonts have loaded to drop widths measured with the fallback.
 */
export function measureText(text: string, fontPx: number, weight = 400, trackingEm = 0, epoch = 0): number {
  if (epoch !== cacheEpoch) {
    widthCache.clear();
    cacheEpoch = epoch;
  }
  const key = `${weight}|${fontPx}|${trackingEm}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  let w: number;
  if (typeof document !== "undefined") {
    ctx ??= document.createElement("canvas").getContext("2d");
  }
  if (ctx) {
    ctx.font = `${weight} ${fontPx}px "Public Sans", "Public Sans Fallback", sans-serif`;
    w = ctx.measureText(text).width;
  } else {
    w = text.length * fontPx * 0.58;
  }
  // Tabular figures run slightly wider than the proportional ones canvas measures.
  w = w * 1.04 + trackingEm * fontPx * text.length;
  widthCache.set(key, w);
  return w;
}

export const overlaps = (a: Box, b: Box, pad = 0) =>
  a.x0 - pad < b.x1 && b.x0 - pad < a.x1 && a.y0 - pad < b.y1 && b.y0 - pad < a.y1;

const inside = (a: Box, b: Box) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;

function boxAt(x: number, y: number, dx: number, dy: number, w: number, h: number): { box: Box; align: Align } {
  if (Math.abs(dx) > 0.3 && Math.abs(dy) > 0.3) {
    // Diagonal: the box's nearest corner sits on the point.
    const x0 = dx > 0 ? x : x - w;
    const y0 = dy > 0 ? y : y - h;
    return { box: { x0, y0, x1: x0 + w, y1: y0 + h }, align: dx > 0 ? "start" : "end" };
  }
  if (Math.abs(dy) >= Math.abs(dx)) {
    const y0 = dy < 0 ? y - h : y;
    return { box: { x0: x - w / 2, y0, x1: x + w / 2, y1: y0 + h }, align: "middle" };
  }
  const x0 = dx > 0 ? x : x - w;
  return { box: { x0, y0: y - h / 2, x1: x0 + w, y1: y + h / 2 }, align: dx > 0 ? "start" : "end" };
}

/**
 * Place labels in priority order at the first candidate spot that stays in
 * bounds, clears every obstacle and placed label, and does not straddle the
 * terrain edge. Labels with no free spot are dropped unless required.
 */
export function placeLabels(
  specs: LabelSpec[],
  opts: { bounds: Box; obstacles: Box[]; regionOf: (b: Box) => Region; pad?: number },
): PlacedLabel[] {
  const pad = opts.pad ?? 2;
  const placed: PlacedLabel[] = [];
  const order = [...specs].sort((a, b) => b.priority - a.priority);
  for (const spec of order) {
    const w = Math.max(...spec.lines.map((l) => l.width));
    const h = spec.lines.length * spec.lineHeight;
    const attempt = (useObstacles: boolean, useRegion: boolean): PlacedLabel | null => {
      for (const a of spec.anchors) {
        const { box, align } = boxAt(a.x, a.y, a.dx, a.dy, w, h);
        if (!inside(box, opts.bounds)) continue;
        if (useObstacles && opts.obstacles.some((o) => overlaps(box, o, pad))) continue;
        if (placed.some((p) => overlaps(box, p.box, pad))) continue;
        const region = opts.regionOf(box);
        if (useRegion && region === "mixed") continue;
        return {
          id: spec.id,
          lines: spec.lines,
          lineHeight: spec.lineHeight,
          box,
          align,
          region,
          anchor: { x: a.x, y: a.y },
          target: spec.target,
        };
      }
      return null;
    };
    const chosen = attempt(true, true) ?? (spec.required ? (attempt(false, true) ?? attempt(false, false)) : null);
    if (chosen) placed.push(chosen);
  }
  return placed;
}

// Shared state between the React tree and the three.js scene: DOM labels
// and edge indicators that follow the plate, plus view commands for the
// toolbar. The scene projects each anchor once per rendered frame and
// writes transforms directly; React only renders the elements.

import { Vector3, type Camera } from "three";
import type { RoseDrawer } from "./rose";

/** flag: selected region; chip: other regions; mark: landmark with a cross; pole: the pole mark; quiet: centred text. */
export type LabelKind = "flag" | "chip" | "mark" | "pole" | "quiet";

export type LabelSpec = { id: string; kind: LabelKind; anchor: Vector3; priority: number };

type LabelEntry = LabelSpec & {
  el: HTMLElement | null;
  box: HTMLElement | null;
  w: number;
  h: number;
  shown: boolean;
  x: number;
  y: number;
};

export type IndicatorKey = "sun" | "earth";
export type IndicatorPart = "el" | "arrow" | "box";

type IndicatorEntry = {
  active: boolean;
  site: Vector3;
  near: Vector3;
  edge: Vector3;
  el: HTMLElement | null;
  arrow: HTMLElement | null;
  box: HTMLElement | null;
  shown: boolean;
};

export type ViewCommands = {
  zoom: (direction: 1 | -1) => void;
  orbit: (azimuthRad: number, polarRad: number) => void;
  recentre: () => void;
};

export const FLAG_STAFF = 28;
/** Space between the bearing rose's ring and the flag above it. */
const FLAG_CLEAR = 30;

type Rect = [number, number, number, number];

const v = new Vector3();
const camSpace = new Vector3();

function project(p: Vector3, camera: Camera, w: number, h: number) {
  camSpace.copy(p).applyMatrix4(camera.matrixWorldInverse);
  v.copy(p).project(camera);
  return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, front: camSpace.z < -0.01, depth: -camSpace.z };
}

function overlaps(r: Rect, placed: Rect[], gap: number) {
  for (const q of placed) {
    if (r[0] < q[2] + gap && r[2] > q[0] - gap && r[1] < q[3] + gap && r[3] > q[1] - gap) return true;
  }
  return false;
}

/** Where a 2D ray from a along d leaves the rectangle; null if it never meets it. */
function rayExit(a: { x: number; y: number }, d: { x: number; y: number }, rect: Rect) {
  let t0 = -Infinity;
  let t1 = Infinity;
  const o = [a.x, a.y];
  const dd = [d.x, d.y];
  const lo = [rect[0], rect[1]];
  const hi = [rect[2], rect[3]];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(dd[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
      continue;
    }
    let ta = (lo[i] - o[i]) / dd[i];
    let tb = (hi[i] - o[i]) / dd[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  if (t0 > t1 || t1 < 0) return null;
  return { x: o[0] + dd[0] * t1, y: o[1] + dd[1] * t1 };
}

function indicator(): IndicatorEntry {
  return { active: false, site: new Vector3(), near: new Vector3(), edge: new Vector3(), el: null, arrow: null, box: null, shown: false };
}

export class PlateBridge {
  private labels = new Map<string, LabelEntry>();
  private indicators: Record<IndicatorKey, IndicatorEntry> = { sun: indicator(), earth: indicator() };
  private invalidateFn: () => void = () => {};
  private commands: ViewCommands | null = null;
  private rose: RoseDrawer | null = null;
  private stage: HTMLElement | null = null;
  /** Overlays on the plate (scale note, tools) that labels and indicators keep clear of. */
  private reserved = new Map<string, HTMLElement | null>();
  /** Lowest y the indicators may use this frame: above the overlays along the bottom. */
  private floor = Infinity;

  // ---------- Scene hooks ----------

  setInvalidate(fn: (() => void) | null) {
    this.invalidateFn = fn ?? (() => {});
  }

  invalidate() {
    this.invalidateFn();
  }

  setCommands(c: ViewCommands | null) {
    this.commands = c;
  }

  zoom(direction: 1 | -1) {
    this.commands?.zoom(direction);
  }

  orbit(azimuthRad: number, polarRad: number) {
    this.commands?.orbit(azimuthRad, polarRad);
  }

  recentre() {
    this.commands?.recentre();
  }

  // ---------- Rose and overlays ----------

  setRose(r: RoseDrawer | null) {
    this.rose = r;
    this.invalidate();
  }

  attachStage(el: HTMLElement | null) {
    this.stage = el;
  }

  attachReserved(key: string, el: HTMLElement | null) {
    this.reserved.set(key, el);
  }

  private reservedRects(): Rect[] {
    const out: Rect[] = [];
    if (!this.stage) return out;
    const s = this.stage.getBoundingClientRect();
    for (const el of this.reserved.values()) {
      if (!el || !el.offsetWidth) continue;
      const r = el.getBoundingClientRect();
      out.push([r.left - s.left, r.top - s.top, r.right - s.left, r.bottom - s.top]);
    }
    return out;
  }

  // ---------- Labels ----------

  private entry(id: string): LabelEntry {
    let e = this.labels.get(id);
    if (!e) {
      e = { id, kind: "chip", anchor: new Vector3(), priority: 9, el: null, box: null, w: 0, h: 0, shown: false, x: NaN, y: NaN };
      this.labels.set(id, e);
    }
    return e;
  }

  setLabels(specs: LabelSpec[]) {
    const keep = new Set(specs.map((s) => s.id));
    for (const k of [...this.labels.keys()]) if (!keep.has(k)) this.labels.delete(k);
    for (const s of specs) {
      const e = this.entry(s.id);
      if (e.kind !== s.kind) e.shown = false;
      e.kind = s.kind;
      e.anchor.copy(s.anchor);
      e.priority = s.priority;
      e.w = 0; // measure again: text or kind may have changed
    }
    this.invalidate();
  }

  attachLabel(id: string, part: "el" | "box", node: HTMLElement | null) {
    const e = this.entry(id);
    e[part] = node;
    // React re-attaches the same node on every render; keep the visibility the last frame gave it,
    // or a label that must now hide would be left showing.
    if (part === "el") e.shown = node?.style.visibility === "visible";
    if (part === "box") e.w = 0;
  }

  // ---------- Indicators ----------

  setIndicator(key: IndicatorKey, at: { site: Vector3; near: Vector3; edge: Vector3 } | null) {
    const ind = this.indicators[key];
    ind.active = !!at;
    if (at) {
      ind.site.copy(at.site);
      ind.near.copy(at.near);
      ind.edge.copy(at.edge);
    }
    this.invalidate();
  }

  attachIndicator(key: IndicatorKey, part: IndicatorPart, node: HTMLElement | null) {
    this.indicators[key][part] = node;
    if (part === "el") this.indicators[key].shown = node?.style.visibility === "visible";
  }

  // ---------- Per frame ----------

  /**
   * Project every label and indicator; hide what is off screen or would
   * overlap a higher-priority label. Order: the plate's reserved corners,
   * the bearing rose, the selected flag (its staff lifted clear of the
   * rose), the Sun and Earth indicators, the rose's azimuth labels, then
   * everything else.
   */
  sync(camera: Camera, w: number, h: number, target: Vector3 | null = null) {
    camera.updateMatrixWorld();
    const placed: Rect[] = this.reservedRects();
    this.floor = Infinity;
    for (const r of placed) if (r[3] > h - 60) this.floor = Math.min(this.floor, r[1] - 14);
    const ring = this.rose ? this.rose.layout(camera, w, h, target) : null;
    const projected = [...this.labels.values()].filter((e) => e.el).map((e) => ({ e, p: project(e.anchor, camera, w, h) }));
    projected.sort((a, b) => a.e.priority - b.e.priority || a.p.depth - b.p.depth);

    const place = ({ e, p }: (typeof projected)[number]) => {
      const el = e.el!;
      if (!e.w && e.box) {
        e.w = e.box.offsetWidth;
        e.h = e.box.offsetHeight;
      }
      // A flag on the rose's centre stands clear of the ring.
      let staff = FLAG_STAFF;
      if (e.kind === "flag" && ring && Math.hypot(p.x - ring.cx, p.y - ring.cy) < 3) {
        staff = Math.max(FLAG_STAFF, Math.round(ring.cy - ring.top + FLAG_CLEAR));
      }
      if (e.kind === "flag" && el.style.getPropertyValue("--staff") !== `${staff}px`) el.style.setProperty("--staff", `${staff}px`);
      // Labels sit to the right of their anchor, or to the left when that would run off the view.
      let r: Rect;
      let side: "right" | "left" = "right";
      if (e.kind === "quiet") r = [p.x - e.w / 2, p.y - e.h / 2, p.x + e.w / 2, p.y + e.h / 2];
      else {
        const top = e.kind === "flag" ? p.y - staff - e.h : p.y - e.h / 2;
        const bottom = e.kind === "flag" ? p.y + 4 : p.y + e.h / 2;
        const gap = e.kind === "flag" ? 0 : e.kind === "pole" ? 12 : 7;
        r = [p.x - (e.kind === "pole" ? 10 : 4), top, p.x + gap + e.w, bottom];
        if (r[2] > w - 2 && p.x - gap - e.w >= 2) {
          side = "left";
          r = [p.x - gap - e.w, top, p.x + 4, bottom];
        }
      }
      // The pole mark always shows when in view; its name moves to the left, or drops, to stay clear.
      let quiet = false;
      if (e.kind === "pole" && overlaps(r, placed, 4)) {
        const left: Rect = [p.x - 12 - e.w, r[1], p.x + 10, r[3]];
        if (p.x - 12 - e.w >= 2 && !overlaps(left, placed, 4)) {
          side = "left";
          r = left;
        } else {
          quiet = true;
          r = [p.x - 10, p.y - 10, p.x + 10, p.y + 10];
        }
      }
      if (e.kind === "pole" && (el.dataset.quiet === "1") !== quiet) el.dataset.quiet = quiet ? "1" : "0";
      const inView = r[0] >= 0 && r[2] <= w && r[1] >= 0 && r[3] <= h;
      const onScreen = p.front && p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h && (e.kind === "flag" || inView);
      // Graticule and meridian labels also keep off the bearing rose.
      const clear = e.kind !== "quiet" || !ring || !overlaps(r, [ring.box], 0);
      const show = onScreen && clear && (e.kind === "flag" || e.kind === "pole" || !overlaps(r, placed, 4));
      if (show && el.dataset.side !== side) el.dataset.side = side;
      if (show) {
        // A flag claims its box and its staff, not the open space beside the staff.
        if (e.kind === "flag") placed.push([r[0], r[1], r[2], p.y - staff], [p.x - 4, p.y - staff, p.x + 4, r[3]]);
        else placed.push(r);
        if (!e.shown || Math.abs(p.x - e.x) > 0.2 || Math.abs(p.y - e.y) > 0.2) {
          el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
          e.x = p.x;
          e.y = p.y;
        }
      }
      if (show !== e.shown) el.style.visibility = show ? "visible" : "hidden";
      e.shown = show;
    };

    projected.filter((q) => q.e.kind === "flag").forEach(place);
    this.placeIndicator(this.indicators.sun, camera, w, h, placed);
    this.placeIndicator(this.indicators.earth, camera, w, h, placed);
    this.rose?.placeLabels(placed);
    projected.filter((q) => q.e.kind !== "flag").forEach(place);
  }

  private placeIndicator(ind: IndicatorEntry, camera: Camera, w: number, h: number, placed: Rect[]) {
    const el = ind.el;
    if (!el) return;
    const hide = () => {
      if (ind.shown) el.style.visibility = "hidden";
      ind.shown = false;
    };
    if (!ind.active || w < 60 || h < 60) return hide();
    const inset = 22;
    const rect: Rect = [inset, inset, w - inset, Math.max(inset + 20, Math.min(h - inset, this.floor))];
    const s = project(ind.site, camera, w, h);
    const e = project(ind.edge, camera, w, h);
    const n = project(ind.near, camera, w, h);
    if (!s.front || !n.front) return hide();
    const far = e.front ? e : n;
    let dx = far.x - s.x;
    let dy = far.y - s.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return hide();
    dx /= len;
    dy /= len;
    let px: number;
    let py: number;
    if (e.front && e.x >= rect[0] && e.x <= rect[2] && e.y >= rect[1] && e.y <= rect[3]) {
      px = e.x;
      py = e.y;
    } else {
      const hit = rayExit(s, { x: dx, y: dy }, rect);
      if (!hit) return hide();
      px = hit.x;
      py = hit.y;
    }
    const bw = ind.box?.offsetWidth ?? 0;
    const bh = ind.box?.offsetHeight ?? 0;
    const rectAt = (x: number, y: number): Rect => {
      const left = x > w / 2;
      const bx0 = left ? x - 14 - bw : x + 14;
      return [Math.min(bx0, x - 10), y - Math.max(bh / 2, 10), Math.max(bx0 + bw, x + 10), y + Math.max(bh / 2, 10)];
    };
    // When another indicator or the flag is in the way, slide along the border.
    if (overlaps(rectAt(px, py), placed, 4)) {
      const alongX = Math.abs(py - rect[1]) < 1 || Math.abs(py - rect[3]) < 1;
      const step = alongX ? bw / 2 + 24 : bh + 8;
      for (const k of [1, -1, 2, -2, 3, -3, 4, -4]) {
        const nx = alongX ? px + k * step : px;
        const ny = alongX ? py : py + k * step;
        if (nx < rect[0] || nx > rect[2] || ny < rect[1] || ny > rect[3]) continue;
        if (!overlaps(rectAt(nx, ny), placed, 4)) {
          px = nx;
          py = ny;
          break;
        }
      }
    }
    el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
    if (ind.arrow) ind.arrow.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(dy, dx).toFixed(3)}rad) translateX(15px)`;
    if (ind.box) ind.box.style.transform = px > w / 2 ? "translate(calc(-100% - 14px), -50%)" : "translate(14px, -50%)";
    placed.push(rectAt(px, py));
    if (!ind.shown) el.style.visibility = "visible";
    ind.shown = true;
  }
}

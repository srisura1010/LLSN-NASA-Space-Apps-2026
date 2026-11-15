// The bearing rose: an azimuth ring around the selected site, laid in its
// local horizontal plane, carrying the Sun's and Earth's bearing paths over
// the mission window. The paths are drawn the way the horizon plot (Fig. 2)
// draws its tracks: cased where the body is in view, dashed behind terrain,
// ticked by hour with heavier ticks at 00h UTC, a bar at the window's start,
// an arrow at its end, and open circles at the rise and set contacts. The
// rose keeps a fixed size on screen; the scene redraws it every frame, along
// with the scale bar, by writing SVG attributes directly.

import { Vector3, type Camera } from "three";
import { sampleAt, type SiteData } from "@/lib/sky";
import { contactEvents, isRise, type ContactKind } from "../plot/contacts";
import { bearingAt, type V2 } from "./geo";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Synodic month: a window this long carries the Sun once round the ring. */
const LUNATION = 29.53 * DAY;
const TICK_CHOICES = [1, 2, 3, 6, 12, 24];
const MIN_TICK_GAP_PX = 5;
const TICK_MINOR = 3;
const TICK_MAJOR = 5.5;
/** Path radii as fractions of the graduated ring; each later lunation steps inward. */
const SUN_R = 0.84;
const EARTH_R = 0.66;
const SPIRAL = 0.07;

export type RoseBody = "sun" | "earth";

/** seg: whether the body is in view over the stretch from the previous sample to this one. */
type Sample = { ms: number; az: number; up: boolean; seg: boolean };

export type RosePath = {
  body: RoseBody;
  startMs: number;
  endMs: number;
  /** Hourly samples plus the contact instants, in time order. */
  samples: Sample[];
  contacts: { kind: ContactKind; ms: number; az: number }[];
};

export type RoseData = {
  /** Site centre in map metres and its ground height (m). */
  site: { x: number; y: number; h: number };
  lon: number;
  sun: RosePath | null;
  earth: RosePath | null;
};

export type RoseNow = { sunAz: number; earthAz: number; sunUp: boolean; earthUp: boolean } | null;

/** Hourly bearings of both bodies over the window, from the same model as the horizon plot. */
export function buildRoseData(
  site: SiteData | null,
  startMs: number,
  endMs: number,
  at: { x: number; y: number; h: number },
  lon: number,
): RoseData {
  if (!site || !(endMs > startMs)) return { site: at, lon, sun: null, earth: null };
  const first = site.sky.startMs;
  const last = first + (site.sky.count - 1) * site.sky.stepMs;
  const t0 = Math.max(startMs, first);
  const t1 = Math.min(endMs, last);
  if (!(t1 > t0)) return { site: at, lon, sun: null, earth: null };
  const contacts = contactEvents(site, t0, t1);
  const path = (body: RoseBody): RosePath => {
    const own = contacts.filter((c) => (body === "sun") === c.kind.startsWith("sun"));
    const times = [t0, t1, ...own.map((c) => c.ms)];
    for (let t = Math.ceil(t0 / HOUR) * HOUR; t < t1; t += HOUR) times.push(t);
    times.sort((a, b) => a - b);
    const upAt = (ms: number) => {
      const s = sampleAt(site, ms);
      return { az: body === "sun" ? s.sunAz : s.earthAz, up: body === "sun" ? s.sunFraction > 0 : s.earthUp };
    };
    const samples: Sample[] = [];
    for (const ms of times) {
      const prev = samples[samples.length - 1];
      if (prev && ms - prev.ms < 1000) continue;
      const here = upAt(ms);
      // The state over a stretch is read at its middle, so a contact instant splits it cleanly.
      const seg = prev ? upAt((prev.ms + ms) / 2).up : here.up;
      samples.push({ ms, az: here.az, up: here.up, seg });
    }
    return { body, startMs: t0, endMs: t1, samples, contacts: own.map((c) => ({ kind: c.kind, ms: c.ms, az: c.az })) };
  };
  return { site: at, lon, sun: path("sun"), earth: path("earth") };
}

// ---------- Drawing ----------

export type RoseNodes = {
  svg: SVGSVGElement | null;
  ringHalo: SVGPathElement | null;
  ring: SVGPathElement | null;
  grads: SVGPathElement | null;
  labels: (SVGTextElement | null)[];
  sunUpCase: SVGPathElement | null;
  sunUp: SVGPathElement | null;
  sunDownCase: SVGPathElement | null;
  sunDown: SVGPathElement | null;
  sunTickHalo: SVGPathElement | null;
  sunTicks: SVGPathElement | null;
  sunMajor: SVGPathElement | null;
  sunEnds: SVGPathElement | null;
  earthUpCase: SVGPathElement | null;
  earthUp: SVGPathElement | null;
  earthDownCase: SVGPathElement | null;
  earthDown: SVGPathElement | null;
  earthTickHalo: SVGPathElement | null;
  earthTicks: SVGPathElement | null;
  earthMajor: SVGPathElement | null;
  earthEnds: SVGPathElement | null;
  contacts: SVGGElement | null;
  sunNow: SVGGElement | null;
  earthNow: SVGGElement | null;
  scale: SVGElement | null;
  scaleBar: SVGPathElement | null;
  scaleFill: SVGPathElement | null;
  scaleLabels: (SVGTextElement | null)[];
};

export function emptyRoseNodes(): RoseNodes {
  return {
    svg: null,
    ringHalo: null,
    ring: null,
    grads: null,
    labels: [],
    sunUpCase: null,
    sunUp: null,
    sunDownCase: null,
    sunDown: null,
    sunTickHalo: null,
    sunTicks: null,
    sunMajor: null,
    sunEnds: null,
    earthUpCase: null,
    earthUp: null,
    earthDownCase: null,
    earthDown: null,
    earthTickHalo: null,
    earthTicks: null,
    earthMajor: null,
    earthEnds: null,
    contacts: null,
    sunNow: null,
    earthNow: null,
    scale: null,
    scaleBar: null,
    scaleFill: null,
    scaleLabels: [],
  };
}

/** Azimuth labels every 30°, as on the horizon plot's axis. */
export const ROSE_LABELS = Array.from({ length: 12 }, (_, k) => {
  const az = k * 30;
  const cardinal = ({ 0: "N", 90: "E", 180: "S", 270: "W" } as Record<number, string>)[az];
  return { az, text: cardinal ?? `${az}°`, cardinal: !!cardinal };
});

type Rect = [number, number, number, number];
type P2 = { x: number; y: number };

const tmp = new Vector3();
const camSpace = new Vector3();
const f1 = (v: number) => v.toFixed(1);

function project(p: Vector3, camera: Camera, w: number, h: number) {
  camSpace.copy(p).applyMatrix4(camera.matrixWorldInverse);
  tmp.copy(p).project(camera);
  return { x: (tmp.x * 0.5 + 0.5) * w, y: (-tmp.y * 0.5 + 0.5) * h, front: camSpace.z < -0.01 };
}

function overlaps(r: Rect, placed: Rect[], gap: number) {
  for (const q of placed) if (r[0] < q[2] + gap && r[2] > q[0] - gap && r[1] < q[3] + gap && r[3] > q[1] - gap) return true;
  return false;
}

const setD = (el: SVGPathElement | null, d: string) => {
  if (el && el.getAttribute("d") !== d) el.setAttribute("d", d);
};

/** Nice scale-bar length (km) for a given px per km: the bar runs 56 to 140 px. */
function niceKm(pxPerKm: number): number {
  for (const km of [1, 2, 4, 10, 20, 40, 100, 200]) if (km * pxPerKm >= 56) return km;
  return 200;
}

export class RoseDrawer {
  nodes: RoseNodes = emptyRoseNodes();
  private data: RoseData | null = null;
  private now: RoseNow = null;
  /** Unit bearings (map x/y) per whole degree of azimuth, for the site's longitude. */
  private bearings: V2[] = [];
  private bearingLon = NaN;
  private shown = false;
  private scaleShown = false;
  /** Azimuth label boxes from the last layout, shown or hidden by placeLabels. */
  private labelBoxes: (Rect | null)[] = [];

  constructor(private readonly heightScale: number) {}

  setData(d: RoseData | null) {
    this.data = d;
    if (d && d.lon !== this.bearingLon) {
      this.bearingLon = d.lon;
      this.bearings = Array.from({ length: 361 }, (_, a) => bearingAt(d.lon, a));
    }
  }

  setNow(n: RoseNow) {
    this.now = n;
  }

  /** Called from React refs: hand over the SVG elements the drawer writes to. */
  attach<K extends Exclude<keyof RoseNodes, "labels" | "scaleLabels">>(key: K, el: RoseNodes[K]) {
    this.nodes[key] = el;
    if (key === "svg") this.shown = false;
    if (key === "scale") this.scaleShown = false;
  }

  attachLabel(k: number, el: SVGTextElement | null) {
    this.nodes.labels[k] = el;
  }

  attachScaleLabel(k: number, el: SVGTextElement | null) {
    this.nodes.scaleLabels[k] = el;
  }

  private bearing(az: number): V2 {
    const a = ((az % 360) + 360) % 360;
    const i = Math.floor(a);
    const f = a - i;
    const p = this.bearings[i];
    const q = this.bearings[i + 1];
    const x = p.x + (q.x - p.x) * f;
    const y = p.y + (q.y - p.y) * f;
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }

  /** Scene point at azimuth az and distance r (m) from the site, in the site's horizontal plane. */
  private point(az: number, r: number, lift: number): Vector3 {
    const d = this.data!;
    const b = this.bearing(az);
    return new Vector3((d.site.x + b.x * r) / 1000, d.site.h * this.heightScale + lift, -(d.site.y + b.y * r) / 1000);
  }

  private hide(): null {
    if (this.shown && this.nodes.svg) this.nodes.svg.style.visibility = "hidden";
    this.shown = false;
    this.labelBoxes = [];
    return null;
  }

  /**
   * Show the azimuth labels that do not collide with what is already placed,
   * and claim their space. A label blocked by something narrow (the flag's
   * staff crosses the ring's far side, where S usually sits) steps aside.
   */
  placeLabels(placed: Rect[]) {
    ROSE_LABELS.forEach((_, k) => {
      const el = this.nodes.labels[k];
      if (!el) return;
      const r0 = this.labelBoxes[k];
      let r: Rect | null = null;
      if (r0) {
        const half = (r0[2] - r0[0]) / 2;
        // Far enough to clear the staff (4 px either side) with the 2 px gap.
        for (const dx of [0, half + 8, -(half + 8)]) {
          const c: Rect = [r0[0] + dx, r0[1], r0[2] + dx, r0[3]];
          if (!overlaps(c, placed, 2)) {
            r = c;
            el.setAttribute("x", ((c[0] + c[2]) / 2).toFixed(1));
            break;
          }
        }
      }
      const show = !!r;
      if (el.style.visibility !== (show ? "visible" : "hidden")) el.style.visibility = show ? "visible" : "hidden";
      if (r) placed.push(r);
    });
  }

  /**
   * Redraw the rose and the scale bar for this frame. Returns the rose's
   * centre and the top of its ring on screen, or null when it is not shown.
   */
  layout(
    camera: Camera,
    w: number,
    h: number,
    target: Vector3 | null,
  ): { cx: number; cy: number; top: number; box: Rect } | null {
    const n = this.nodes;
    if (!n.svg) return null;
    this.syncScale(camera, w, h, target);
    const d = this.data;
    if (!d || this.bearings.length === 0 || w < 120 || h < 120) return this.hide();

    const lift = 0.12;
    const centre = new Vector3(d.site.x / 1000, d.site.h * this.heightScale + lift, -d.site.y / 1000);
    const c = project(centre, camera, w, h);
    if (!c.front || c.x < -40 || c.x > w + 40 || c.y < -40 || c.y > h + 40) return this.hide();

    // Ring radius: a fixed size on screen, whatever the zoom.
    const targetPx = Math.min(132, Math.max(66, 0.3 * Math.min(w, h)));
    let maxPx = 0;
    for (const az of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const p = project(this.point(az, 1000, lift), camera, w, h);
      if (!p.front) return this.hide();
      maxPx = Math.max(maxPx, Math.hypot(p.x - c.x, p.y - c.y));
    }
    if (maxPx < 1e-3) return this.hide();
    const rM = (targetPx / maxPx) * 1000;

    const at = (az: number, frac: number) => {
      const p = project(this.point(az, rM * frac, lift), camera, w, h);
      return { x: p.x, y: p.y };
    };
    // Outward unit vector on screen at an azimuth (from the ring point toward a slightly larger ring).
    const outward = (az: number, frac: number, p: P2) => {
      const q = at(az, frac * 1.04);
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const l = Math.hypot(dx, dy) || 1;
      return { x: dx / l, y: dy / l };
    };

    // ---- Graduated ring ----
    let ring = "";
    let top = c.y;
    for (let a = 0; a <= 360; a += 3) {
      const p = at(a, 1);
      top = Math.min(top, p.y);
      ring += `${a ? "L" : "M"}${f1(p.x)} ${f1(p.y)}`;
    }
    ring += "Z";
    setD(n.ringHalo, ring);
    setD(n.ring, ring);
    let grads = "";
    for (let a = 0; a < 360; a += 10) {
      const p = at(a, 1);
      const o = outward(a, 1, p);
      const len = a % 30 === 0 ? 7 : 4;
      grads += `M${f1(p.x)} ${f1(p.y)}L${f1(p.x + o.x * len)} ${f1(p.y + o.y * len)}`;
    }
    setD(n.grads, grads);
    this.labelBoxes = ROSE_LABELS.map((lab, k) => {
      const el = n.labels[k];
      if (!el) return null;
      const p = at(lab.az, 1);
      const o = outward(lab.az, 1, p);
      const x = p.x + o.x * 15;
      const y = p.y + o.y * 13;
      el.setAttribute("x", f1(x));
      el.setAttribute("y", f1(y));
      const bw = lab.text.length * 6.6 + 4;
      const inView = x > bw / 2 + 2 && x < w - bw / 2 - 2 && y > 9 && y < h - 9;
      return inView ? ([x - bw / 2, y - 8, x + bw / 2, y + 8] as Rect) : null;
    });

    // ---- Bearing paths ----
    const contactMarks: string[] = [];
    for (const body of ["sun", "earth"] as const) {
      const path = d[body];
      const base = body === "sun" ? SUN_R : EARTH_R;
      const nd =
        body === "sun"
          ? { upCase: n.sunUpCase, up: n.sunUp, downCase: n.sunDownCase, down: n.sunDown, halo: n.sunTickHalo, ticks: n.sunTicks, major: n.sunMajor, ends: n.sunEnds }
          : { upCase: n.earthUpCase, up: n.earthUp, downCase: n.earthDownCase, down: n.earthDown, halo: n.earthTickHalo, ticks: n.earthTicks, major: n.earthMajor, ends: n.earthEnds };
      if (!path || path.samples.length < 2) {
        for (const el of Object.values(nd)) setD(el, "");
        continue;
      }
      const fracAt = (ms: number) => base - (SPIRAL * (ms - path.startMs)) / LUNATION;
      const pos = (ms: number, az: number) => at(az, fracAt(ms));
      let up = "";
      let down = "";
      let prevUp: boolean | null = null;
      let lengthPx = 0;
      let last: P2 | null = null;
      for (let i = 0; i < path.samples.length; i++) {
        const s = path.samples[i];
        const p = pos(s.ms, s.az);
        const segUp = s.seg;
        if (last) {
          lengthPx += Math.hypot(p.x - last.x, p.y - last.y);
          if (segUp !== prevUp) {
            if (segUp) up += `M${f1(last.x)} ${f1(last.y)}`;
            else down += `M${f1(last.x)} ${f1(last.y)}`;
          }
          if (segUp) up += `L${f1(p.x)} ${f1(p.y)}`;
          else down += `L${f1(p.x)} ${f1(p.y)}`;
          prevUp = segUp;
        }
        last = p;
      }
      setD(nd.upCase, up);
      setD(nd.up, up);
      setD(nd.downCase, down);
      setD(nd.down, down);

      // Ticks across the path, spaced so they stay at least 5 px apart.
      const hours = (path.endMs - path.startMs) / HOUR;
      const pxPerHour = hours > 0 ? lengthPx / hours : 0;
      const tickH = TICK_CHOICES.find((x) => x * pxPerHour >= MIN_TICK_GAP_PX) ?? 24;
      const tickMs = tickH * HOUR;
      let minor = "";
      let major = "";
      let halo = "";
      const byMs = new Map(path.samples.map((s) => [s.ms, s]));
      for (let t = Math.ceil(path.startMs / tickMs) * tickMs; t <= path.endMs; t += tickMs) {
        const s = byMs.get(t);
        if (!s) continue;
        const p = pos(t, s.az);
        const o = outward(s.az, fracAt(t), p);
        const big = t % DAY === 0;
        const len = big ? TICK_MAJOR : TICK_MINOR;
        const seg = `M${f1(p.x - o.x * len)} ${f1(p.y - o.y * len)}L${f1(p.x + o.x * len)} ${f1(p.y + o.y * len)}`;
        halo += seg;
        if (big) major += seg;
        else minor += seg;
      }
      setD(nd.halo, halo);
      setD(nd.ticks, minor);
      setD(nd.major, major);

      // Start bar across the path, arrowhead along the direction of travel at the end.
      const first = path.samples[0];
      const endS = path.samples[path.samples.length - 1];
      const prev = path.samples[path.samples.length - 2];
      const ps = pos(first.ms, first.az);
      const os = outward(first.az, fracAt(first.ms), ps);
      const pe = pos(endS.ms, endS.az);
      const pp = pos(prev.ms, prev.az);
      let tx = pe.x - pp.x;
      let ty = pe.y - pp.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const ax = pe.x - tx * 7;
      const ay = pe.y - ty * 7;
      setD(
        nd.ends,
        `M${f1(ps.x - os.x * 7)} ${f1(ps.y - os.y * 7)}L${f1(ps.x + os.x * 7)} ${f1(ps.y + os.y * 7)}` +
          `M${f1(ax - ty * 4)} ${f1(ay + tx * 4)}L${f1(pe.x)} ${f1(pe.y)}L${f1(ax + ty * 4)} ${f1(ay - tx * 4)}`,
      );

      for (const ct of path.contacts) {
        const p = pos(ct.ms, ct.az);
        contactMarks.push(`${f1(p.x)},${f1(p.y)},${isRise(ct.kind) ? 1 : 0}`);
      }
    }

    // Contacts: open circles, ink at a rise, limit red at a set (as on the horizon plot).
    if (n.contacts) {
      const key = contactMarks.join(";");
      if (n.contacts.dataset.key !== key) {
        n.contacts.dataset.key = key;
        const ns = "http://www.w3.org/2000/svg";
        while (n.contacts.firstChild) n.contacts.removeChild(n.contacts.firstChild);
        for (const m of contactMarks) {
          const [x, y, rise] = m.split(",");
          const el = document.createElementNS(ns, "circle");
          el.setAttribute("cx", x);
          el.setAttribute("cy", y);
          el.setAttribute("r", "3.5");
          el.setAttribute("stroke-width", "1.5");
          el.setAttribute("class", rise === "1" ? "fill-paper stroke-ink" : "fill-paper stroke-limit");
          n.contacts.appendChild(el);
        }
      }
    }

    // The bodies now, on their paths.
    const nowMark = (g: SVGGElement | null, az: number | null, frac: number, up: boolean) => {
      if (!g) return;
      if (az === null) {
        g.style.visibility = "hidden";
        return;
      }
      const p = at(az, frac);
      g.setAttribute("transform", `translate(${f1(p.x)} ${f1(p.y)})`);
      g.dataset.up = up ? "1" : "0";
      g.style.visibility = "visible";
    };
    const nw = this.now;
    const nowFrac = (path: RosePath | null, base: number, az: number | null) => {
      if (!path || az === null) return base;
      // Nearest sample in azimuth along the path, for its place on the spiral.
      let best = path.samples[0];
      let bd = Infinity;
      for (const s of path.samples) {
        const dd = Math.abs(((s.az - az + 540) % 360) - 180);
        if (dd < bd) {
          bd = dd;
          best = s;
        }
      }
      return base - (SPIRAL * (best.ms - path.startMs)) / LUNATION;
    };
    nowMark(n.sunNow, nw ? nw.sunAz : null, nowFrac(d.sun, SUN_R, nw ? nw.sunAz : null), !!nw?.sunUp);
    nowMark(n.earthNow, nw ? nw.earthAz : null, nowFrac(d.earth, EARTH_R, nw ? nw.earthAz : null), !!nw?.earthUp);

    if (!this.shown) n.svg.style.visibility = "visible";
    this.shown = true;
    let left = c.x;
    let right = c.x;
    let bottom = c.y;
    for (let a = 0; a < 360; a += 15) {
      const p = at(a, 1);
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
      bottom = Math.max(bottom, p.y);
    }
    return { cx: c.x, cy: c.y, top, box: [left - 18, top - 16, right + 18, bottom + 16] as Rect };
  }

  /** Scale bar at the orbit centre: a nice length in km drawn at that depth. */
  private syncScale(camera: Camera, w: number, h: number, target: Vector3 | null) {
    const n = this.nodes;
    if (!n.scale) return;
    const hideScale = () => {
      if (this.scaleShown) n.scale!.style.visibility = "hidden";
      this.scaleShown = false;
    };
    if (!target || w < 160) return hideScale();
    camera.updateMatrixWorld();
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const a = project(target, camera, w, h);
    const b = project(target.clone().addScaledVector(right, 1), camera, w, h);
    if (!a.front || !b.front) return hideScale();
    const pxPerKm = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(pxPerKm > 0)) return hideScale();
    const km = niceKm(pxPerKm);
    const len = km * pxPerKm;
    if (len > 180) return hideScale();
    const L = f1(len);
    const H = f1(len / 2);
    setD(n.scaleBar, `M0.5 0.5H${L}V5.5H0.5Z`);
    setD(n.scaleFill, `M0.5 0.5H${H}V5.5H0.5Z`);
    // The last figure carries the unit; it starts so its digits sit under the end tick.
    const labels = [
      { x: 0.5, text: "0" },
      { x: len / 2, text: String(km / 2) },
      { x: len - String(km).length * 3.4, text: `${km} km` },
    ];
    labels.forEach((l, i) => {
      const el = n.scaleLabels[i];
      if (!el) return;
      el.setAttribute("x", f1(l.x));
      if (el.textContent !== l.text) el.textContent = l.text;
    });
    if (!this.scaleShown) n.scale.style.visibility = "visible";
    this.scaleShown = true;
  }
}

"use client";

// The marks the Moon level and the System level share: the cased lines to the
// Sun and Earth with their arrowheads, the bearing marks at the selected
// region, the nine-regions mark, and the projector that places the labels.

import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { BackSide, Quaternion, Vector3, type Camera, type Group, type PerspectiveCamera } from "three";
import { latLonToBody } from "@/lib/moonFrame";
import { sites } from "@/lib/sites";
import type { Vec3 } from "@/lib/system";

const RAD = Math.PI / 180;

/** Body-fixed x, y, z (x through 0° N 0° E, z north) to scene axes with north up, matching three's sphere UVs. */
export const toScene = (v: Vec3, k = 1): Vec3 => [v[0] * k, v[2] * k, -v[1] * k];
export const onGlobe = (lat: number, lon: number, k = 1): Vec3 => toScene(latLonToBody(lat, lon), k);

/** From below the south pole, tipped towards the near side so the 0° meridian runs up the page: how both levels look at the regions. */
export const POLE_DIR = onGlobe(-78, 0);

/**
 * The names of the reference lines, the same at every level. The Moon level and the System level draw them from the
 * Moon; the site level draws the same two directions as bearings from the site.
 */
export const LINE_NAMES = { sun: "To the Sun", earth: "To Earth", terminator: "Terminator" } as const;

/** The direction the Moon was last seen from, in its body-fixed scene axes, so the next level can open on the same face. */
export const handoff: { moonDir: Vec3 | null } = { moonDir: null };

// ---------- Lines to the Sun and Earth ----------

/** Draws a line over its own casing: the two share a depth, so the upper one is pulled towards the camera. */
export const OVER = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 };

/** A coloured line over a casing, so it reads on paper, on the lit side and on the night side. Widths are screen pixels. */
export function Cased({ points, color, casing, dash = 0 }: { points: Vec3[]; color: string; casing: string; dash?: number }) {
  const dashed = dash > 0 ? { dashed: true, dashSize: dash, gapSize: dash * 0.7 } : null;
  return (
    <>
      <Line points={points} color={casing} lineWidth={3.5} renderOrder={1} {...dashed} />
      <Line points={points} color={color} lineWidth={1.75} renderOrder={2} {...OVER} {...dashed} />
    </>
  );
}

const UP = new Vector3(0, 1, 0);
/** Length of the lines to the Sun and Earth, in Moon radii from the centre; their labels sit beside the arrowheads. */
export const RAY = 1.13;

/**
 * The line from the Moon's centre through the point where the body is overhead, out past the limb, with an arrowhead
 * of constant screen size. It is drawn in Moon radii inside whatever group places the Moon. Where the Moon is small
 * on screen, beyondPx keeps that many pixels of the line clear of the limb; maxLen (radii) stops it short of the
 * body it points to; lenRef receives the length drawn, in radii, for the label at the tip.
 */
export function Ray({ dir, color, casing, beyondPx = 0, maxLen, lenRef }: { dir: Vec3; color: string; casing: string; beyondPx?: number; maxLen?: number; lenRef?: { current: number } }) {
  const shaft = useRef<Group>(null);
  const head = useRef<Group>(null);
  const quaternion = useMemo(() => new Quaternion().setFromUnitVectors(UP, new Vector3(...dir)), [dir]);
  const points = useMemo<Vec3[]>(() => [[0, 0, 0], dir], [dir]);
  const v = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const s = shaft.current;
    const h = head.current;
    const parent = s?.parent;
    if (!s || !h || !parent) return;
    parent.updateWorldMatrix(true, false);
    // World units per Moon radius, and per CSS pixel at unit distance.
    const k = parent.matrixWorld.getMaxScaleOnAxis();
    const perPx = (2 * Math.tan(((camera as PerspectiveCamera).fov * RAD) / 2)) / size.height;
    let len = RAY;
    let headK = 1;
    if (beyondPx > 0) {
      // On a Moon of a few pixels the line and its arrowhead shrink with it, down to about half size.
      const radiusPx = k / (Math.max(camera.position.distanceTo(v.setFromMatrixPosition(parent.matrixWorld)), 1e-9) * perPx);
      len = Math.max(RAY, 1 + Math.min(beyondPx, 10 + radiusPx * 2) / radiusPx);
      headK = Math.min(1, 0.45 + radiusPx / 20);
    }
    if (maxLen) len = Math.min(len, maxLen);
    if (lenRef) lenRef.current = len;
    s.scale.setScalar(len);
    h.position.set(dir[0] * len, dir[1] * len, dir[2] * len);
    v.copy(h.position).applyMatrix4(parent.matrixWorld);
    h.scale.setScalar((camera.position.distanceTo(v) * perPx * headK) / k);
  });
  return (
    <>
      <group ref={shaft}>
        <Cased points={points} color={color} casing={casing} />
      </group>
      <group ref={head} quaternion={quaternion}>
        <mesh position={[0, 4.5, 0]} renderOrder={1}>
          <coneGeometry args={[5.5, 14, 20]} />
          <meshBasicMaterial color={casing} side={BackSide} toneMapped={false} />
        </mesh>
        <mesh position={[0, 4.5, 0]} renderOrder={2}>
          <coneGeometry args={[3.5, 10, 20]} />
          <meshBasicMaterial color={color} toneMapped={false} {...OVER} />
        </mesh>
      </group>
    </>
  );
}

/** Lines on the surface are drawn this far out, in radii, so the globe does not cut them. */
export const LIFT = 1.003;

/** Points of the great-circle arc from a surface point towards a direction, between two angles in radians; null when the direction is overhead. */
export function arcTowards(from: Vec3, towards: Vec3): ((a: number) => Vec3) | null {
  const d = from[0] * towards[0] + from[1] * towards[1] + from[2] * towards[2];
  const t: Vec3 = [towards[0] - d * from[0], towards[1] - d * from[1], towards[2] - d * from[2]];
  const l = Math.hypot(t[0], t[1], t[2]);
  if (l < 1e-3) return null;
  return (a) => {
    const c = Math.cos(a) * LIFT;
    const s = (Math.sin(a) * LIFT) / l;
    return [from[0] * c + t[0] * s, from[1] * c + t[1] * s, from[2] * c + t[2] * s];
  };
}

/** A short bearing line on the surface from the selected region towards the Sun or Earth, ending in an open arrowhead; dashed while the body is below the horizon. */
export function Bearing({ from, towards, len, color, casing, below }: { from: Vec3; towards: Vec3; len: number; color: string; casing: string; below: boolean }) {
  const { shaft, head } = useMemo(() => {
    const at = arcTowards(from, towards);
    if (!at) return { shaft: null, head: null };
    const shaft: Vec3[] = [];
    for (let i = 0; i <= 10; i++) shaft.push(at(len * (0.2 + 0.8 * (i / 10))));
    const tip = at(len);
    const back = at(len * 0.84);
    const side: Vec3 = [tip[1] * back[2] - tip[2] * back[1], tip[2] * back[0] - tip[0] * back[2], tip[0] * back[1] - tip[1] * back[0]];
    const k = (len * 0.075) / Math.hypot(side[0], side[1], side[2]);
    const wing = (sign: number): Vec3 => [back[0] + side[0] * k * sign, back[1] + side[1] * k * sign, back[2] + side[2] * k * sign];
    return { shaft, head: [wing(1), tip, wing(-1)] };
  }, [from, towards, len]);
  if (!shaft || !head) return null;
  return (
    <>
      <Cased points={shaft} color={color} casing={casing} dash={below ? len * 0.07 : 0} />
      <Cased points={head} color={color} casing={casing} />
    </>
  );
}

// ---------- Labels ----------

// Labels and marks are plain DOM over the canvas. The scene projects their
// anchor points each frame, hides the ones behind the globe, sets the region
// names out in two columns, and then places the rest in priority order: text
// that would overlap text or a mark already placed is hidden, after trying
// its other positions.

export type Label = {
  key: string;
  at: Vec3;
  node: ReactNode;
  /** 0 is always shown; lower numbers are placed first and so win a collision. */
  pri: number;
  /** Radius in pixels of the mark at the anchor, which no other label may cover. */
  dot?: number;
  /** The text may sit on any side of the anchor. */
  float?: boolean;
  /** The columns of region names stand clear of this point. */
  clear?: boolean;
  /** Shown even when a body is in front of the anchor: for names that stand beside a body, not on it. */
  free?: boolean;
  /** One of the region names set out in two columns beside the group, each joined to its mark by a leader. */
  callout?: boolean;
};

type Box = { el: HTMLElement; l: number; t: number; w: number; h: number };
/** Left, top, right, bottom, the label it belongs to (whose own text may touch it), and for a mark its priority: text that outranks a mark may cover it. */
type Rect = [number, number, number, number, number, number?];
const ROW = 19;
const FLOAT_AT: ((b: Box) => [number, number])[] = [
  (b) => [11, -b.h / 2],
  (b) => [-11 - b.w, -b.h / 2],
  (b) => [-b.w / 2, -13 - b.h],
  (b) => [-b.w / 2, 13],
  (b) => [9, -b.h - 5],
  () => [9, 5],
  (b) => [-9 - b.w, -b.h - 5],
  (b) => [-9 - b.w, 5],
];

/** A body that hides the labels behind it: centre and radius in world units. */
export type Sphere = { x: number; y: number; z: number; r: number };
const UNIT_SPHERE: Sphere[] = [{ x: 0, y: 0, z: 0, r: 1 }];

/**
 * Projects and places the labels each frame. By default a label's anchor is its `at` in world units and the only
 * body is a unit sphere at the origin; a view with moving bodies passes `locate` to write each anchor's world
 * position and `spheres` to list the bodies as they stand in that frame.
 */
export function LabelProjector<L extends Label>({
  labels,
  overlay,
  locate,
  spheres,
}: {
  labels: L[];
  overlay: RefObject<HTMLDivElement | null>;
  locate?: (label: L, out: Vector3, camera: Camera, viewHeight: number) => void;
  spheres?: () => Sphere[];
}) {
  const invalidate = useThree((s) => s.invalidate);
  const v = useMemo(() => new Vector3(), []);
  const measured = useRef<{ labels: L[] | null; boxes: Box[][]; order: number[] }>({ labels: null, boxes: [], order: [] });
  useEffect(() => invalidate(), [labels, invalidate]);
  useEffect(() => {
    let live = true;
    // Text widths change when the web font arrives.
    document.fonts?.ready.then(() => {
      if (!live) return;
      measured.current.labels = null;
      invalidate();
    });
    return () => {
      live = false;
    };
  }, [invalidate]);

  useFrame(({ camera, size }) => {
    const host = overlay.current;
    if (!host || host.children.length < labels.length) return;
    const m = measured.current;
    if (m.labels !== labels) {
      m.labels = labels;
      m.order = labels.map((_, i) => i).sort((a, b) => labels[a].pri - labels[b].pri || a - b);
      m.boxes = labels.map((_, i) => {
        const el = host.children[i] as HTMLElement;
        const o = el.getBoundingClientRect();
        return Array.from(el.querySelectorAll<HTMLElement>("[data-box]"), (box) => {
          const r = box.getBoundingClientRect();
          return { el: box, l: r.left - o.left, t: r.top - o.top, w: r.width, h: r.height };
        });
      });
    }
    camera.updateMatrixWorld();
    const c = camera.position;
    const occluders = spheres ? spheres() : UNIT_SPHERE;
    const xs: number[] = [];
    const ys: number[] = [];
    const placed: Rect[] = [];
    const callouts: number[] = [];
    for (let i = 0; i < labels.length; i++) {
      const el = host.children[i] as HTMLElement;
      const label = labels[i];
      if (locate) locate(label, v, camera, size.height);
      else v.set(label.at[0], label.at[1], label.at[2]);
      // Closest approach of the sight line from the camera to the point; inside a body means hidden.
      let clear = true;
      if (!label.free) {
        for (const s of occluders) {
          const ox = c.x - s.x;
          const oy = c.y - s.y;
          const oz = c.z - s.z;
          const dx = v.x - c.x;
          const dy = v.y - c.y;
          const dz = v.z - c.z;
          const t = Math.min(1, Math.max(0, -(ox * dx + oy * dy + oz * dz) / (dx * dx + dy * dy + dz * dz)));
          if (Math.hypot(ox + dx * t, oy + dy * t, oz + dz * t) <= 0.995 * s.r) {
            clear = false;
            break;
          }
        }
      }
      v.project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      const shown = clear && v.z > -1 && v.z < 1 && x > -40 && y > -40 && x < size.width + 40 && y < size.height + 40;
      xs.push(shown ? x : NaN);
      ys.push(y);
      el.style.setProperty("visibility", shown ? "visible" : "hidden");
      if (!shown) continue;
      el.style.setProperty("transform", `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`);
      if (label.dot) placed.push([x - label.dot, y - label.dot, x + label.dot, y + label.dot, i, label.pri]);
      if (label.callout && m.boxes[i][0]) callouts.push(i);
    }

    // The region names: two columns, left and right of the group of marks, in the order of the marks down the page.
    if (callouts.length) {
      const cx = callouts.reduce((a, i) => a + xs[i], 0) / callouts.length;
      const cy = callouts.reduce((a, i) => a + ys[i], 0) / callouts.length;
      let reach = 0;
      for (let i = 0; i < labels.length; i++) if ((labels[i].callout || labels[i].clear) && !Number.isNaN(xs[i])) reach = Math.max(reach, Math.abs(xs[i] - cx));
      reach = Math.min(reach, size.width / 4) + 26;
      const byX = [...callouts].sort((a, b) => xs[a] - xs[b]);
      const split = Math.floor(byX.length / 2);
      for (const [side, column] of [
        [-1, byX.slice(0, split)],
        [1, byX.slice(split)],
      ] as const) {
        column.sort((a, b) => ys[a] - ys[b]);
        const top = Math.min(Math.max(cy - (column.length * ROW) / 2, 6), Math.max(6, size.height - 6 - column.length * ROW));
        column.forEach((i, row) => {
          const b = m.boxes[i][0];
          const edge = side < 0 ? Math.max(cx - reach, b.w + 6) : Math.min(cx + reach, size.width - b.w - 6);
          const left = side < 0 ? edge - b.w : edge;
          const mid = top + row * ROW + ROW / 2;
          b.el.style.setProperty("transform", `translate(${(left - xs[i]).toFixed(1)}px, ${(mid - b.h / 2 - ys[i]).toFixed(1)}px)`);
          placed.push([left - 3, mid - b.h / 2 - 1, left + b.w + 3, mid + b.h / 2 + 1, i]);
          const leader = host.children[i].querySelector<HTMLElement>("[data-leader]");
          if (leader) {
            const lx = edge - xs[i];
            const ly = mid - ys[i];
            leader.style.setProperty("width", `${Math.hypot(lx, ly).toFixed(1)}px`);
            leader.style.setProperty("transform", `rotate(${Math.atan2(ly, lx).toFixed(4)}rad)`);
          }
        });
      }
    }

    const free = (r: Rect, pri: number) =>
      placed.every((q) => q[4] === r[4] || (q[5] !== undefined && q[5] > pri) || r[0] >= q[2] || r[2] <= q[0] || r[1] >= q[3] || r[3] <= q[1]);
    for (const i of m.order) {
      const x = xs[i];
      const label = labels[i];
      if (Number.isNaN(x) || label.callout) continue;
      let done = false;
      for (const b of m.boxes[i]) {
        let ok = false;
        if (!done) {
          const spots: [number, number][] = label.float ? FLOAT_AT.map((f) => f(b)) : [[b.l, b.t]];
          for (const [ox, oy] of spots) {
            const r: Rect = [x + ox - 3, ys[i] + oy - 1, x + ox + b.w + 3, ys[i] + oy + b.h + 1, i];
            if (label.pri !== 0 && !free(r, label.pri)) continue;
            placed.push(r);
            if (label.float) b.el.style.setProperty("transform", `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`);
            ok = true;
            break;
          }
        }
        b.el.style.setProperty("visibility", ok ? "inherit" : "hidden");
        done ||= ok;
      }
    }
  });
  return null;
}

// ---------- Marks drawn over the canvas ----------

export const LABEL_TEXT = "text-[0.69rem] leading-4 font-semibold tracking-[0.1em] whitespace-nowrap uppercase select-none";

export const HIT = "pointer-events-auto absolute -top-3 -left-3 grid size-6 cursor-pointer place-items-center focus-visible:outline-offset-0";

/** The flag of the selected region: its name in ink on a leader, always shown. */
export function Flag({ text }: { text: string }) {
  return (
    <>
      <span aria-hidden="true" className="absolute bottom-0 left-0 block h-9 w-px bg-ink" />
      <span data-box aria-hidden="true" className={`absolute bottom-9 left-0 block bg-ink px-1.5 py-0.5 text-paper ${LABEL_TEXT}`}>
        {text}
      </span>
    </>
  );
}

/** The nine regions as one mark, for distances at which they would run together. */
export function ClusterMark({ onOpen, hint }: { onOpen: () => void; hint: string }) {
  return (
    <div className="relative">
      <span
        data-box
        aria-hidden="true"
        className={`absolute top-8 left-0 block border-l border-ink bg-paper/90 px-1.5 text-ink after:absolute after:bottom-full after:-left-px after:block after:h-8 after:w-px after:bg-ink ${LABEL_TEXT}`}
      >
        9 candidate regions
      </span>
      <button type="button" onClick={onOpen} aria-label={`Nine candidate regions. ${hint}`} title={hint} className={HIT}>
        <span className="block size-[11px] border-[1.5px] border-ink bg-paper" />
      </button>
    </div>
  );
}

/** A name beside the tip of a line to the Sun or Earth; on a bearing line it carries the body's elevation at the region. */
export function BearingTag({ text, className }: { text: string; className: string }) {
  return (
    <span data-box aria-hidden="true" className={`absolute top-0 left-0 block bg-paper px-1 ${LABEL_TEXT} ${className}`}>
      {text}
    </span>
  );
}

/** The legend entries for the reference lines, worded the same wherever they are listed. */
export function LineLegend({ item }: { item: string }) {
  return (
    <>
      <li className={item}>
        <span className="block h-[5px] w-4 shrink-0 border border-ink bg-sun" />
        {LINE_NAMES.sun}: the line from the Moon, and the bearing at the region
      </li>
      <li className={item}>
        <span className="block h-[3px] w-4 shrink-0 bg-earth" />
        {LINE_NAMES.earth}: the line from the Moon, and the bearing at the region
      </li>
      <li className={item}>
        <span className="block h-0 w-4 shrink-0 border-t border-dashed border-ink" />
        {LINE_NAMES.terminator}; a bearing is dashed while that body is below the horizon
      </li>
    </>
  );
}

/** Where the nine-regions mark stands: the middle of the nine region centres. */
export const CLUSTER_AT: Vec3 = (() => {
  const sum: Vec3 = [0, 0, 0];
  for (const s of sites) {
    const p = onGlobe(s.lat, s.lon);
    sum[0] += p[0];
    sum[1] += p[1];
    sum[2] += p[2];
  }
  const l = Math.hypot(sum[0], sum[1], sum[2]);
  return [sum[0] / l, sum[1] / l, sum[2] / l];
})();

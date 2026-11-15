"use client";

// The zoom gate that joins the levels. A view reports its camera distance and
// limits; once the camera rests on a limit, further wheel travel in the same
// direction is added up, and past a threshold the gate opens the next level.
// One stray scroll is not enough, and the count lapses when the wheel rests.

import { useCallback, useEffect, useRef, useState } from "react";

export type GateHint = "in" | "out" | "in-blocked" | null;

type Probe = { distance: number; min: number; max: number; inOk: boolean };

/** Wheel travel past the limit, in pixels, that opens the next level: about three notches. */
const THRESHOLD_PX = 300;
/** The count lapses after this long without wheel travel. */
const IDLE_MS = 700;
/** Wheel travel is ignored for this long after a view opens, so trackpad inertia does not carry through two levels. */
const ARM_MS = 500;

export function useZoomGate({ onIn, onOut }: { onIn?: () => void; onOut?: () => void }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [hint, setHint] = useState<GateHint>(null);
  const [progress, setProgress] = useState(0);
  const probe = useRef<Probe | null>(null);
  const handlers = useRef({ onIn, onOut });
  const armedAt = useRef(0);
  const acc = useRef({ dir: "", px: 0, at: 0 });

  useEffect(() => {
    handlers.current = { onIn, onOut };
  });

  /** Start the count again and ignore the wheel briefly, after the view has changed under the pointer. */
  const rearm = useCallback(() => {
    armedAt.current = performance.now() + ARM_MS;
    acc.current.px = 0;
    setProgress(0);
  }, []);

  /** Called by the scene with the camera's distance and the limits that open a level. */
  const report = useCallback((distance: number, min: number, max: number, inOk = true) => {
    probe.current = { distance, min, max, inOk };
    const h = handlers.current;
    const next: GateHint = h.onIn && distance <= min * 1.2 ? (inOk ? "in" : "in-blocked") : h.onOut && distance >= max * 0.85 ? "out" : null;
    setHint((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    if (!host) return;
    armedAt.current = performance.now() + ARM_MS;
    let timer = 0;
    const clear = () => {
      acc.current.px = 0;
      setProgress(0);
    };
    const onWheel = (e: WheelEvent) => {
      // A mark or label drawn over the canvas would swallow the wheel; pass it on so zooming works anywhere in the view.
      if (!(e.target instanceof HTMLCanvasElement)) {
        const canvas = host.querySelector("canvas");
        if (!canvas || !e.isTrusted) return;
        e.preventDefault();
        canvas.dispatchEvent(
          new WheelEvent("wheel", { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, clientX: e.clientX, clientY: e.clientY, ctrlKey: e.ctrlKey, bubbles: true, cancelable: true }),
        );
        return;
      }
      const p = probe.current;
      const now = performance.now();
      if (!p || now < armedAt.current || e.deltaY === 0) return;
      const dir = e.deltaY < 0 ? "in" : "out";
      const fire = dir === "in" ? handlers.current.onIn : handlers.current.onOut;
      const atLimit = dir === "in" ? p.inOk && p.distance <= p.min * 1.01 : p.distance >= p.max * 0.99;
      const a = acc.current;
      if (!fire || !atLimit) {
        if (a.px) clear();
        return;
      }
      const px = Math.min(120, Math.abs(e.deltaY) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1));
      if (a.dir !== dir || now - a.at > IDLE_MS) a.px = 0;
      a.dir = dir;
      a.at = now;
      a.px += px;
      window.clearTimeout(timer);
      if (a.px >= THRESHOLD_PX) {
        armedAt.current = now + ARM_MS;
        clear();
        fire();
        return;
      }
      setProgress(a.px / THRESHOLD_PX);
      timer = window.setTimeout(clear, IDLE_MS);
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.clearTimeout(timer);
      host.removeEventListener("wheel", onWheel);
    };
  }, [host]);

  return { setHost, report, rearm, hint, progress };
}

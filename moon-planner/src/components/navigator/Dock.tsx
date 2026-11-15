"use client";

// The dock under the site viewer: the scrub rail and a one-line readout are
// always there; the horizon panorama (Fig. 2) opens above them as a panel the
// reader can resize by its top edge (pointer or arrow keys). Whether it is
// open and how tall it is are kept in localStorage. With nothing stored it
// opens on screens at least 900 px tall, so the signature plot is in the first
// view at 1440x900.

import { useCallback, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useStored, useTallViewport, useWideViewport } from "@/state/stored";
import { ChevronMark, toggleClass } from "../ui";

const MIN_H = 90;
const STEP = 16;

const subscribeResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
/** The window height, for the panel's limits and default height (900 on the server). */
function useWindowHeight(): number {
  return useSyncExternalStore(
    subscribeResize,
    () => window.innerHeight,
    () => 900,
  );
}

export type DockState = { open: boolean; plotHeight: number; controls: ReactNode };

export default function Dock({ panelId, children }: { panelId: string; children: (d: DockState) => ReactNode }) {
  const tall = useTallViewport(900);
  const winH = useWindowHeight();
  const [storedOpen, setOpen] = useStored<boolean | null>("llsn.dock.open", null);
  const [storedH, setStoredH] = useStored<number | null>("llsn.dock.h", null);
  // Below xl the horizon plot is a panel of its own under the dock (the workspace's panel switch),
  // so the dock keeps only the rail and the readout there.
  const wide = useWideViewport(1280);
  const open = wide && (storedOpen ?? tall);
  const maxH = Math.max(MIN_H + 40, Math.round(winH * 0.42));
  const defaultH = Math.round(Math.min(200, Math.max(124, winH * 0.165)));
  const clamp = useCallback((h: number) => Math.round(Math.min(maxH, Math.max(MIN_H, h))), [maxH]);
  const [dragH, setDragH] = useState<number | null>(null);
  const height = clamp(dragH ?? storedH ?? defaultH);
  const drag = useRef<{ y: number; h: number } | null>(null);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: height };
    setDragH(height);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setDragH(clamp(d.h + (d.y - e.clientY)));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (dragH !== null) setStoredH(dragH);
    setDragH(null);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next =
      e.key === "ArrowUp" ? height + STEP : e.key === "ArrowDown" ? height - STEP : e.key === "Home" ? MIN_H : e.key === "End" ? maxH : null;
    if (next === null) return;
    e.preventDefault();
    setStoredH(clamp(next));
  };

  const controls = !wide ? null : (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={() => setOpen(!open)}
      title={open ? "Hide the horizon plot" : "Show the horizon plot"}
      className={`${toggleClass(open, "sm", true)} inline-flex items-center gap-1`}
    >
      Horizon
      <ChevronMark className={`size-3 transition-transform duration-150 motion-reduce:transition-none ${open ? "" : "rotate-180"}`} />
    </button>
  );

  return (
    <section aria-label="Horizon and time" data-dock className="relative shrink-0 border-t border-ink bg-paper">
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the horizon plot"
          aria-controls={panelId}
          aria-valuemin={MIN_H}
          aria-valuemax={maxH}
          aria-valuenow={height}
          tabIndex={0}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={onKey}
          data-dock-handle
          className="group/handle absolute inset-x-0 -top-1.5 z-20 flex h-3 cursor-row-resize touch-none items-center justify-center outline-none"
        >
          <span aria-hidden="true" className="block h-[3px] w-10 bg-ink-3 transition-colors duration-150 group-hover/handle:bg-ink group-focus-visible/handle:bg-earth" />
        </div>
      )}
      <div id={panelId} className="px-4 pt-1.5 pb-2">
        {children({ open, plotHeight: height, controls })}
      </div>
    </section>
  );
}

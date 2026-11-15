// Layout hooks: element width, root font size and web-font readiness.

import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";

/** Content width of an element in px, tracked with ResizeObserver; null until measured. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (w: number) => setWidth((prev) => (prev !== null && Math.abs(prev - w) < 1 ? prev : Math.round(w)));
    update(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => update(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function subscribeType(onChange: () => void) {
  window.addEventListener("resize", onChange);
  document.fonts?.addEventListener("loadingdone", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    document.fonts?.removeEventListener("loadingdone", onChange);
  };
}

const rootPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const fontsLoaded = () => (document.fonts?.status === "loaded" ? 1 : 0);

/**
 * Pixels per rem (so label sizes follow the reader's text size) and an epoch
 * that changes once web fonts have loaded, so label widths get re-measured.
 */
export function useTypeMetrics(): { remPx: number; fontEpoch: number } {
  const remPx = useSyncExternalStore(subscribeType, rootPx, () => 16);
  const fontEpoch = useSyncExternalStore(subscribeType, fontsLoaded, () => 0);
  return { remPx, fontEpoch };
}

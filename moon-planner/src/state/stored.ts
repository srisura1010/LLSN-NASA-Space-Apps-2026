"use client";

// Per-viewer layout preferences kept in localStorage: which rails are open,
// the dock's height, the plate's layers. Read through useSyncExternalStore, so
// the server render and hydration use the fallback and the stored value
// follows on the client without a mismatch. Storage that throws (a private
// window, blocked site data) leaves the fallback in place.

import { useCallback, useMemo, useSyncExternalStore } from "react";

const EVENT = "llsn-stored";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(cb: () => void) {
  const on = () => cb();
  window.addEventListener(EVENT, on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener("storage", on);
  };
}

export function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not kept; the value still applies until the page reloads.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** A JSON value kept under `key`; `fallback` until one is stored (and always on the server). */
export function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const value = useMemo<T>(() => {
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }, [raw, fallback]);
  const set = useCallback((v: T) => writeStored(key, JSON.stringify(v)), [key]);
  return [value, set];
}

const subscribeResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};

/** True when the window is at least `px` tall (false on the server). */
export function useTallViewport(px: number): boolean {
  return useSyncExternalStore(
    subscribeResize,
    () => window.innerHeight >= px,
    () => false,
  );
}

const noSubscribe = () => () => {};

/** False on the server and during hydration, true once the page runs on the client. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/**
 * True when the window is at least `px` wide. The server (and the first
 * client render) assumes a wide screen, which is the desktop layout.
 */
export function useWideViewport(px: number): boolean {
  return useSyncExternalStore(
    subscribeResize,
    () => window.innerWidth >= px,
    () => true,
  );
}

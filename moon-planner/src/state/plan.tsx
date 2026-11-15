"use client";

// The plan: the app state every view shares (the mission window, the selected
// site, the clock, the custom site, the picked point, the Compare picks and
// the launch plan). One zustand store per /tool page, made from the URL on
// first render and mirrored back into it. Components read single fields with
// usePlan(selector), so the clock ticking re-renders only what shows it.

import { createContext, useContext, useState, type ReactNode } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import type { SiteData } from "@/lib/sky";
import { HOUR } from "@/lib/format";
import type { LatLon, LaunchPick, UrlState, View } from "./url";

/** A slip or search measured against the plan it replaced, for the change note. */
export type WindowChange = {
  fromStartMs: number;
  fromHours: number;
  /** What moved the start, e.g. "Slip" or "Best start in July 2027". */
  reason: string;
};

/** The custom site and its load. */
export type CustomRecord = {
  lat: number;
  lon: number;
  status: "loading" | "ready" | "error";
  data?: SiteData;
  message?: string;
  /** Why the terrain around a point north of 80° S did not load; its data then has a smooth horizon. */
  terrainError?: string;
};

/** A custom-site load: the point and the window it must cover. Each new object starts a load. */
export type CustomRequest = { lat: number; lon: number; fromMs: number; toMs: number };

export type PlanState = {
  view: View;
  /** The About & data drawer is open. */
  aboutOpen: boolean;
  startMs: number;
  durationHours: number;
  /** The clock: the time every view shows. */
  nowMs: number;
  /** Outside the mission window, the System and Moon levels keep their own time. */
  systemMs: number | null;
  playing: boolean;
  /** The site the user chose; null falls back to the top of the ranking. */
  selectedId: string | null;
  /** Dark spells and comms gaps longer than this many hours are flagged. */
  gap: number;
  change: WindowChange | null;
  custom: CustomRecord | null;
  customReq: CustomRequest | null;
  point: LatLon | null;
  /** Compare picks; null lets Compare choose (the selected site and the next best). */
  picked: string[] | null;
  launchSiteId: string | null;
  launchPick: LaunchPick | null;
  transitDays: number;
  /** Bumped each time an incoming URL is applied, so the page writes its URL back and opens any #anchor. */
  urlEpoch: number;
};

type Fields = keyof PlanState;
type Update<T> = T | ((prev: T) => T);
export type PlanStore = StoreApi<PlanState>;

export function stateFromUrl(u: UrlState): PlanState {
  return {
    view: u.view,
    aboutOpen: u.about,
    startMs: u.startMs,
    durationHours: u.hours,
    nowMs: u.startMs + u.atHours * HOUR,
    systemMs: null,
    playing: false,
    selectedId: u.site,
    gap: u.gap,
    change: null,
    custom: u.custom ? { ...u.custom, status: "loading" } : null,
    customReq: u.custom ? { ...u.custom, fromMs: u.startMs, toMs: u.startMs + u.hours * HOUR } : null,
    point: u.pt,
    picked: u.cmp,
    launchSiteId: u.launchSiteId,
    launchPick: u.launchPick,
    transitDays: u.transitDays,
    urlEpoch: 0,
  };
}

export function createPlanStore(initial: PlanState): PlanStore {
  return createStore<PlanState>()(() => initial);
}

const PlanContext = createContext<PlanStore | null>(null);

export function PlanProvider({ initial, children }: { initial: () => PlanState; children: ReactNode }) {
  const [store] = useState(() => createPlanStore(initial()));
  return <PlanContext.Provider value={store}>{children}</PlanContext.Provider>;
}

/** The store itself, for handlers that read or write without subscribing. */
export function usePlanStore(): PlanStore {
  const store = useContext(PlanContext);
  if (!store) throw new Error("usePlan needs a PlanProvider above it.");
  return store;
}

/** Read part of the plan; the component re-renders only when that part changes. */
export function usePlan<T>(selector: (s: PlanState) => T): T {
  return useStore(usePlanStore(), selector);
}

const setters = new WeakMap<PlanStore, Map<Fields, (v: unknown) => void>>();

/** A stable setter for one field, taking a value or an updater like React's setState. */
export function setterFor<K extends Fields>(store: PlanStore, key: K): (v: Update<PlanState[K]>) => void {
  let byStore = setters.get(store);
  if (!byStore) setters.set(store, (byStore = new Map()));
  let fn = byStore.get(key);
  if (!fn) {
    fn = (v: unknown) =>
      store.setState((s) => {
        const next = typeof v === "function" ? (v as (p: PlanState[K]) => PlanState[K])(s[key]) : (v as PlanState[K]);
        return Object.is(next, s[key]) ? s : ({ [key]: next } as Partial<PlanState>);
      });
    byStore.set(key, fn);
  }
  return fn;
}

/** One field of the plan as a [value, setter] pair, the shape of useState. */
export function usePlanField<K extends Fields>(key: K): [PlanState[K], (v: Update<PlanState[K]>) => void] {
  const store = usePlanStore();
  const value = useStore(store, (s) => s[key]);
  return [value, setterFor(store, key)];
}

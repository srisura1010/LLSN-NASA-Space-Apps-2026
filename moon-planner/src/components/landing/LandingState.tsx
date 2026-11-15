"use client";

// Shared selection (region and start date) for every live part of the landing
// page, plus the selected region's 2027 tracks.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { preload } from "react-dom";
import { loadSite, type SiteData } from "@/lib/sky";
import { DEFAULT_DATE, DEFAULT_SITE_ID, parseDate } from "./model";

type LandingState = {
  siteId: string;
  /** Raw value of the date inputs (YYYY-MM-DD, may be empty or out of range while typing). */
  date: string;
  /** Last valid start (ms, 00:00 UTC); figures keep showing it while the input is invalid. */
  startMs: number;
  dateValid: boolean;
  setSiteId: (id: string) => void;
  setDate: (value: string) => void;
  /** Tracks being shown: the selected region's once loaded, the previous region's meanwhile. */
  data: SiteData | null;
  dataSiteId: string | null;
  status: "loading" | "ready" | "error";
  retry: () => void;
};

const Ctx = createContext<LandingState | null>(null);

export function useLanding(): LandingState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLanding must be used inside LandingProvider");
  return v;
}

export function LandingProvider({ children }: { children: ReactNode }) {
  // The default region's tracks, hinted in the server-rendered HTML. Issued from this client
  // component, not the page, so that prefetching the landing page from another route (the
  // navbar link on /tool) does not pull the hints, and the files, into that page.
  preload(`/data/sky/${DEFAULT_SITE_ID}.json`, { as: "fetch", crossOrigin: "anonymous" });
  preload(`/data/horizon/${DEFAULT_SITE_ID}.json`, { as: "fetch", crossOrigin: "anonymous" });
  const [siteId, setSiteIdRaw] = useState(DEFAULT_SITE_ID);
  const [date, setDateRaw] = useState(DEFAULT_DATE);
  const [startMs, setStartMs] = useState(() => parseDate(DEFAULT_DATE) as number);
  const [loaded, setLoaded] = useState<Record<string, SiteData>>({});
  const [failed, setFailed] = useState<Record<string, true>>({});
  const [shownId, setShownId] = useState<string | null>(null);

  useEffect(() => {
    if (loaded[siteId] || failed[siteId]) return;
    loadSite(siteId).then(
      (d) => {
        setLoaded((p) => ({ ...p, [siteId]: d }));
        setShownId(siteId);
      },
      () => setFailed((p) => ({ ...p, [siteId]: true })),
    );
  }, [siteId, loaded, failed]);

  const dataSiteId = loaded[siteId] ? siteId : shownId;
  const data = dataSiteId ? (loaded[dataSiteId] ?? null) : null;
  const status = loaded[siteId] ? "ready" : failed[siteId] ? "error" : "loading";

  const setSiteId = useCallback(
    (id: string) => {
      if (dataSiteId) setShownId(dataSiteId);
      setSiteIdRaw(id);
    },
    [dataSiteId],
  );

  const setDate = useCallback((value: string) => {
    setDateRaw(value);
    const ms = parseDate(value);
    if (ms !== null) setStartMs(ms);
  }, []);

  const retry = useCallback(() => {
    setFailed((p) => {
      const next = { ...p };
      delete next[siteId];
      return next;
    });
  }, [siteId]);

  const value = useMemo<LandingState>(
    () => ({
      siteId,
      date,
      startMs,
      dateValid: parseDate(date) !== null,
      setSiteId,
      setDate,
      data,
      dataSiteId,
      status,
      retry,
    }),
    [siteId, date, startMs, setSiteId, setDate, data, dataSiteId, status, retry],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

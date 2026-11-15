// Fetching and keeping tiles: a queue with a cap on requests in flight, a
// least-recently-used cache, one retry, and the rule that a tile not yet
// loaded is stood in for by its nearest loaded ancestor, so the picture never
// has a hole. Generic over what a loaded tile is, so it runs without WebGL.

import { tileKey, type SchemeId, type TileId, type TileScheme } from "./schemes";
import type { Selected } from "./select";

export type TileLoader<T> = (url: string, signal: AbortSignal) => Promise<T>;

export type Drawn<T> = { tile: TileId; key: string; value: T };

export type ManagerStatus = {
  /** Finest level on screen, 0 when no tile is drawn. */
  level: number;
  /** Wanted tiles still queued or in flight. */
  loading: number;
  /** The tile server could not be reached at all; nothing more is asked of it until reset(). */
  unavailable: boolean;
};

type Entry<T> = {
  tile: TileId;
  key: string;
  state: "queued" | "loading" | "ready" | "failed";
  value?: T;
  tries: number;
  abort?: AbortController;
  priority: number;
  /** The update that last wanted it, and the one that last drew it. */
  wanted: number;
  used: number;
};

export type ManagerOptions<T> = {
  schemes: Record<SchemeId, TileScheme>;
  load: TileLoader<T>;
  /** Frees what load() made; called on eviction, on reset and for a tile that arrives after it was cancelled. */
  dispose: (value: T) => void;
  /** Called when a tile arrives or fails, so the owner can draw again. */
  onChange?: () => void;
  maxConcurrent?: number;
  /** Loaded tiles kept before the least recently drawn are freed. */
  maxTiles?: number;
};

/** Requests that fail before any has succeeded, after which the server is taken to be out of reach. */
const GIVE_UP_AFTER = 4;
/** Until one tile has arrived only this many are asked for at once, so a blocked network costs a handful of failed requests. */
const PROBE_CONCURRENT = 2;
/** How far below a tile to look for loaded tiles to stand in for it when nothing above it is loaded. */
const DESCEND = 2;

export class TileManager<T> {
  private entries = new Map<string, Entry<T>>();
  private inflight = 0;
  private stamp = 0;
  private successes = 0;
  private failures = 0;
  private unavailable = false;
  private readonly maxConcurrent: number;
  private readonly maxTiles: number;
  /** Requests started, for tests and the status line. */
  requests = 0;

  constructor(private readonly o: ManagerOptions<T>) {
    this.maxConcurrent = o.maxConcurrent ?? 6;
    this.maxTiles = o.maxTiles ?? 256;
  }

  /** Take the tiles a view wants; returns what to draw now and starts what is missing. */
  update(selected: Selected[]): { draw: Drawn<T>[]; status: ManagerStatus } {
    const stamp = ++this.stamp;
    const draw = new Map<string, Drawn<T>>();
    const show = (e: Entry<T>) => {
      e.used = stamp;
      if (!draw.has(e.key)) draw.set(e.key, { tile: e.tile, key: e.key, value: e.value as T });
    };
    let loading = 0;

    for (const s of selected) {
      const scheme = this.o.schemes[s.tile.s];
      let e = this.want(s.tile, s.key, s.priority, stamp);
      // A tile that failed twice hands its place to its parent, which is then fetched like any other.
      while (e && e.state === "failed") {
        const p = scheme.parent(e.tile);
        e = p && p.z >= scheme.minLevel ? this.want(p, tileKey(p), s.priority, stamp) : null;
      }
      if (e?.state === "ready") {
        show(e);
        continue;
      }
      if (e) loading++;
      let stood = false;
      for (let p = scheme.parent(e?.tile ?? s.tile); p && p.z >= scheme.minLevel; p = scheme.parent(p)) {
        const a = this.entries.get(tileKey(p));
        if (a?.state === "ready") {
          show(a);
          stood = true;
          break;
        }
      }
      if (!stood) this.showBelow(scheme, s.tile, DESCEND, show);
    }

    // What no view wants any more is dropped from the queue, and stopped if already in flight.
    for (const e of this.entries.values()) {
      if (e.wanted === stamp || e.state === "ready" || e.state === "failed") continue;
      if (e.state === "loading") {
        e.abort?.abort();
        this.inflight--;
      }
      this.entries.delete(e.key);
    }
    this.pump();
    this.evict(stamp);

    let level = 0;
    for (const d of draw.values()) level = Math.max(level, d.tile.z);
    return { draw: [...draw.values()], status: { level, loading: this.unavailable ? 0 : loading, unavailable: this.unavailable } };
  }

  /** Forget failures and try the server again; loaded tiles are kept. */
  retry() {
    this.unavailable = false;
    this.successes = 0;
    this.failures = 0;
    for (const e of [...this.entries.values()]) if (e.state === "failed") this.entries.delete(e.key);
  }

  /** Stop every request and free every tile. */
  dispose() {
    for (const e of this.entries.values()) {
      if (e.state === "loading") e.abort?.abort();
      if (e.state === "ready") this.o.dispose(e.value as T);
    }
    this.entries.clear();
    this.inflight = 0;
  }

  get size() {
    let n = 0;
    for (const e of this.entries.values()) if (e.state === "ready") n++;
    return n;
  }

  private want(tile: TileId, key: string, priority: number, stamp: number): Entry<T> | null {
    let e = this.entries.get(key);
    if (!e) {
      if (this.unavailable) return null;
      e = { tile, key, state: "queued", tries: 0, priority, wanted: stamp, used: 0 };
      this.entries.set(key, e);
    }
    e.wanted = stamp;
    e.priority = priority;
    return e;
  }

  private showBelow(scheme: TileScheme, t: TileId, depth: number, show: (e: Entry<T>) => void) {
    if (depth === 0 || t.z >= scheme.maxLevel) return;
    for (const c of scheme.children(t)) {
      const e = this.entries.get(tileKey(c));
      if (e?.state === "ready") show(e);
      else this.showBelow(scheme, c, depth - 1, show);
    }
  }

  private pump() {
    if (this.unavailable) return;
    const cap = this.successes > 0 ? this.maxConcurrent : Math.min(PROBE_CONCURRENT, this.maxConcurrent);
    while (this.inflight < cap) {
      let next: Entry<T> | null = null;
      for (const e of this.entries.values()) if (e.state === "queued" && (!next || e.priority < next.priority)) next = e;
      if (!next) return;
      this.start(next);
    }
  }

  private start(e: Entry<T>) {
    const abort = new AbortController();
    e.state = "loading";
    e.abort = abort;
    this.inflight++;
    this.requests++;
    const live = () => this.entries.get(e.key) === e && e.abort === abort;
    this.o.load(this.o.schemes[e.tile.s].url(e.tile), abort.signal).then(
      (value) => {
        if (!live()) {
          this.o.dispose(value);
          return;
        }
        this.inflight--;
        e.state = "ready";
        e.value = value;
        e.abort = undefined;
        this.successes++;
        this.pump();
        this.o.onChange?.();
      },
      () => {
        if (!live()) return;
        this.inflight--;
        e.abort = undefined;
        this.failures++;
        if (e.tries === 0) {
          e.tries = 1;
          e.state = "queued";
        } else e.state = "failed";
        if (this.successes === 0 && this.failures >= GIVE_UP_AFTER) this.giveUp();
        else this.pump();
        this.o.onChange?.();
      },
    );
  }

  private giveUp() {
    this.unavailable = true;
    for (const e of [...this.entries.values()]) {
      if (e.state === "ready") continue;
      if (e.state === "loading") e.abort?.abort();
      this.entries.delete(e.key);
    }
    this.inflight = 0;
  }

  private evict(stamp: number) {
    let ready = 0;
    for (const e of this.entries.values()) if (e.state === "ready") ready++;
    if (ready <= this.maxTiles) return;
    const idle = [...this.entries.values()].filter((e) => e.state === "ready" && e.used !== stamp).sort((a, b) => a.used - b.used);
    for (const e of idle) {
      if (ready <= this.maxTiles) break;
      this.o.dispose(e.value as T);
      this.entries.delete(e.key);
      ready--;
    }
  }
}

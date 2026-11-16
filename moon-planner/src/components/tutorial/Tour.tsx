"use client";

// The guided tour: a coach-mark card beside a real part of the interface,
// which is outlined in ink while the rest of the page is dimmed by a flat
// umbra tint with a hole cut around it. The card follows its target every
// frame (resize, scroll, a rail opening), waits for targets that load late
// (the 3D views), and falls back to a centred card when one never shows.
// Below md the card is a sheet along the bottom and the target is scrolled
// into the space above it. Esc closes, the arrow keys step, focus moves to the
// card on each step and back to where it was when the tour ends.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "@/state/stored";
import { TOUR_STEPS, finishState, type TourControls } from "./steps";

type Box = { x: number; y: number; w: number; h: number };

const PAD = 4;
const GAP = 12;
const EDGE = 8;
/** After this long without a target the card says so; after WAIT_MS it centres. */
const LOADING_MS = 500;
const WAIT_MS = 8000;
const SHEET_BELOW = 768;

function visible(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  const s = window.getComputedStyle(el);
  if (s.visibility === "hidden" || s.display === "none") return null;
  return r;
}

/** The on-screen elements a step names, each group taking its first alternative that shows. */
function findTargets(targets: string[] | undefined): HTMLElement[] {
  if (!targets) return [];
  const out: HTMLElement[] = [];
  for (const group of targets) {
    for (const id of group.split("|")) {
      const el = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)).find((e) => visible(e));
      if (el) {
        out.push(el);
        break;
      }
    }
  }
  return out;
}

/** Padded boxes, clipped to the viewport; boxes that touch are merged so the cut-outs never cross. */
function boxesOf(els: HTMLElement[]): Box[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let boxes: Box[] = [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    const x0 = Math.max(0, r.left - PAD);
    const y0 = Math.max(0, r.top - PAD);
    const x1 = Math.min(vw, r.right + PAD);
    const y1 = Math.min(vh, r.bottom + PAD);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    boxes.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  let merged = true;
  while (merged && boxes.length > 1) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h) {
          const x = Math.min(a.x, b.x);
          const y = Math.min(a.y, b.y);
          const u = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
          boxes = boxes.filter((_, k) => k !== i && k !== j).concat(u);
          merged = true;
          break outer;
        }
      }
  }
  return boxes;
}

function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/** Where the card goes beside the target: the first side with room, else the roomiest, kept on screen. */
function place(t: Box | null, cw: number, ch: number): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.min(Math.max(EDGE, x), Math.max(EDGE, vw - cw - EDGE));
  const clampY = (y: number) => Math.min(Math.max(EDGE, y), Math.max(EDGE, vh - ch - EDGE));
  if (!t) return { x: clampX((vw - cw) / 2), y: clampY((vh - ch) / 2) };
  const room = {
    right: vw - EDGE - (t.x + t.w + GAP),
    left: t.x - GAP - EDGE,
    below: vh - EDGE - (t.y + t.h + GAP),
    above: t.y - GAP - EDGE,
  };
  const at = {
    right: { x: t.x + t.w + GAP, y: clampY(t.y) },
    left: { x: t.x - GAP - cw, y: clampY(t.y) },
    below: { x: clampX(t.x + t.w - cw), y: t.y + t.h + GAP },
    above: { x: clampX(t.x + t.w - cw), y: t.y - GAP - ch },
  };
  // A wide, short target (a bar) is read from above or below; a tall one from the side.
  const order: (keyof typeof room)[] = t.w > t.h * 2 ? ["below", "above", "right", "left"] : ["right", "left", "below", "above"];
  for (const s of order) {
    const need = s === "right" || s === "left" ? cw : ch;
    if (room[s] >= need) return at[s];
  }
  const best = order.reduce((a, b) => (room[b] / (b === "right" || b === "left" ? cw : ch) > room[a] / (a === "right" || a === "left" ? cw : ch) ? b : a));
  return { x: clampX(at[best].x), y: clampY(at[best].y) };
}

const sameBoxes = (a: Box[], b: Box[]) =>
  a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 0.5 && Math.abs(p.y - b[i].y) < 0.5 && Math.abs(p.w - b[i].w) < 0.5 && Math.abs(p.h - b[i].h) < 0.5);

function PointerMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className="mt-0.5 size-3.5 shrink-0">
      <path d="M4 2.5v10l2.6-2.4 1.8 4 1.7-.8-1.8-3.9H12Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export default function Tour({
  open,
  controls,
  wide,
  onClose,
}: {
  open: boolean;
  controls: TourControls;
  /** The side-by-side workspace (from xl); below it the panels stack. */
  wide: boolean;
  /** Called after the app is put back in its end state; `completed` is false for a skip. */
  onClose: (completed: boolean) => void;
}) {
  const uid = useId();
  const mounted = useMounted();
  const [index, setIndex] = useState(0);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [found, setFound] = useState(true);
  const [waited, setWaited] = useState(0);
  const [cardPos, setCardPos] = useState<{ x: number; y: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const controlsRef = useRef(controls);
  const wideRef = useRef(wide);
  useLayoutEffect(() => {
    controlsRef.current = controls;
    wideRef.current = wide;
  });

  const step = TOUR_STEPS[index];
  const total = TOUR_STEPS.length;
  const last = index === total - 1;

  // Opening (the parent mounts the tour afresh each time): remember where focus was.
  useLayoutEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);

  // Each step prepares the app, then the frame loop below finds its target.
  const stepStart = useRef(0);
  const scrolled = useRef(false);
  useEffect(() => {
    if (!open) return;
    TOUR_STEPS[index].prepare?.(controlsRef.current, window.innerWidth >= 768 && wideRef.current);
    stepStart.current = performance.now();
    scrolled.current = false;
    // Focus the card once it has its new content, after any panel the step opened has taken focus.
    const t = window.setTimeout(() => cardRef.current?.focus({ preventScroll: true }), 80);
    return () => window.clearTimeout(t);
  }, [open, index]);

  // Follow the target every frame: it may load late, move, resize or scroll.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let prev: Box[] = [];
    let prevPos: { x: number; y: number } | null = null;
    let prevFound = true;
    let prevWaited = -1;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = TOUR_STEPS[index];
      const els = findTargets(s.targets);
      const isSheet = window.innerWidth < SHEET_BELOW;
      setSheet(isSheet);
      setVp((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
      const card = cardRef.current;
      const ch = card?.offsetHeight ?? 0;
      const cw = card?.offsetWidth ?? 0;
      const hasTargets = !!s.targets?.length;
      const ok = !hasTargets || els.length > 0;
      const elapsed = performance.now() - stepStart.current;
      const w = ok ? 0 : elapsed > WAIT_MS ? 2 : elapsed > LOADING_MS ? 1 : 0;
      if (w !== prevWaited) setWaited((prevWaited = w));
      if (ok !== prevFound) setFound((prevFound = ok));
      // Bring the target into view once per step: beside the card, or above the sheet on phones.
      if (els.length && !scrolled.current && card) {
        scrolled.current = true;
        const top = Math.min(...els.map((e) => e.getBoundingClientRect().top));
        const bottom = Math.max(...els.map((e) => e.getBoundingClientRect().bottom));
        const availTop = EDGE;
        const availBottom = window.innerHeight - (isSheet ? ch : 0) - EDGE;
        if (top < availTop || bottom > availBottom) {
          const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
          if (isSheet) {
            const h = bottom - top;
            const want = h <= availBottom - availTop ? availTop + (availBottom - availTop - h) / 2 : availTop;
            window.scrollBy({ top: top - want, behavior });
          } else {
            els[0].scrollIntoView({ block: "nearest", inline: "nearest", behavior });
          }
        }
      }
      const b = boxesOf(els);
      if (!sameBoxes(b, prev)) setBoxes((prev = b));
      if (!isSheet && card) {
        const p = place(union(b), cw, ch);
        if (!prevPos || Math.abs(p.x - prevPos.x) > 0.5 || Math.abs(p.y - prevPos.y) > 0.5) setCardPos((prevPos = p));
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, index]);

  const close = useCallback(
    (completed: boolean) => {
      finishState(controlsRef.current);
      onClose(completed);
      if (window.innerWidth < 1280) window.scrollTo({ top: 0 });
      const to = returnTo.current;
      // Back to the control that started the tour; when that has gone (the first-visit note), the Tutorial button.
      requestAnimationFrame(() => {
        const usable = to && to !== document.body && to.isConnected && to.offsetParent !== null;
        const fallback = Array.from(document.querySelectorAll<HTMLElement>('[data-tour="tutorial"], [data-tour="mode-menu"]')).find((e) => e.offsetParent !== null);
        (usable ? to : fallback)?.focus({ preventScroll: true });
      });
    },
    [onClose],
  );
  const go = useCallback(
    (d: number) => {
      if (d > 0 && last) return close(true);
      setIndex((i) => Math.min(total - 1, Math.max(0, i + d)));
    },
    [last, total, close],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
        return;
      }
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      // Arrow keys step the tour only from the card, so a slider or field the user is trying keeps them.
      const a = document.activeElement;
      if (a && a !== document.body && !cardRef.current?.contains(a)) return;
      if ((a as HTMLElement | null)?.closest?.("input, select, textarea")) return;
      e.preventDefault();
      go(e.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, go]);

  if (!open || !mounted) return null;

  const interactive = !!step.tryIt && found;
  const vw = vp.w;
  const vh = vp.h;
  const holes = boxes.map((b) => `M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z`).join("");
  const titleId = `${uid}-title`;
  const bodyId = `${uid}-body`;
  const btn = "inline-flex h-8 items-center justify-center px-3 text-small whitespace-nowrap transition-colors duration-150 max-md:h-11";
  const loading = !found && waited === 1;

  return createPortal(
    <div className="tour-root" data-tour-open>
      {/* Clicks on the dimmed page do nothing; the hole passes them through only on a "Try it" step. */}
      {!interactive && <div aria-hidden="true" className="fixed inset-0 z-[70]" onPointerDown={(e) => e.preventDefault()} />}
      <svg aria-hidden="true" className="pointer-events-none fixed inset-0 z-[70] h-full w-full" width={vw} height={vh}>
        <path
          d={`M0 0H${vw}V${vh}H0Z${holes}`}
          fillRule="evenodd"
          className="pointer-events-auto fill-umbra"
          fillOpacity={0.5}
          onPointerDown={(e) => e.preventDefault()}
        />
        {boxes.map((b, i) => (
          <g key={i}>
            <rect x={b.x - 2} y={b.y - 2} width={b.w + 4} height={b.h + 4} fill="none" className="stroke-paper" strokeWidth={2} />
            <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" className="stroke-ink" strokeWidth={2} />
          </g>
        ))}
      </svg>

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        data-tour-card
        data-step={step.id}
        className={`fixed z-[71] flex flex-col border-ink bg-paper text-ink outline-none ${
          sheet
            ? "inset-x-0 bottom-0 max-h-[55svh] overflow-y-auto border-t pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            : "w-[19rem] border shadow-[0_6px_24px_rgb(18_26_34/0.18)]"
        }`}
        style={sheet ? undefined : { left: cardPos?.x ?? -9999, top: cardPos?.y ?? 0 }}
      >
        <div aria-hidden="true" className="h-[3px] shrink-0 bg-rule">
          <div className="h-full bg-ink" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
        <div className="flex items-start gap-2 px-4 pt-3">
          <h2 id={titleId} className="min-w-0 flex-1 text-lead leading-snug font-semibold text-balance">
            {step.title}
          </h2>
          <button
            type="button"
            onClick={() => close(false)}
            className="-mt-1 -mr-2 inline-flex size-8 shrink-0 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-paper-3 hover:text-ink max-md:size-11"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
            <span className="sr-only">Close the tutorial</span>
          </button>
        </div>
        <div id={bodyId} className="px-4 pt-1">
          <p className="text-body leading-relaxed text-pretty">{step.body}</p>
          {step.tryIt && found && (
            <p className="mt-2 flex items-start gap-1.5 border-l-2 border-ink pl-2 text-small leading-snug">
              <PointerMark />
              <span>
                <span className="font-semibold">Try it: </span>
                {step.tryIt}
              </span>
            </p>
          )}
          {loading && <p className="mt-2 text-small text-ink-2">Still loading…</p>}
          {!found && waited === 2 && <p className="mt-2 text-small text-ink-2">This part is not on screen right now. Carry on with Next.</p>}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-rule px-4 py-2.5">
          <button type="button" onClick={() => close(false)} className={`${btn} -ml-3 font-medium text-ink-2 underline decoration-1 underline-offset-[3px] hover:text-ink`}>
            Skip tour
          </button>
          <span className="ml-auto text-label text-ink-2 tabular-nums" aria-hidden="true">
            {index + 1} of {total}
          </span>
          {index > 0 && (
            <button type="button" onClick={() => go(-1)} className={`${btn} border border-ink bg-paper font-medium hover:bg-paper-3`}>
              Back
            </button>
          )}
          <button type="button" data-tour-next onClick={() => go(1)} className={`${btn} border border-ink bg-ink font-semibold text-paper hover:bg-umbra`}>
            {step.next ?? "Next"}
          </button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {`Tutorial, step ${index + 1} of ${total}: ${step.title}.${loading ? " Still loading." : ""}`}
      </p>
    </div>,
    document.body,
  );
}

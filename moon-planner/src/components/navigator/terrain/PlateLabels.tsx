"use client";

import { useLayoutEffect, type ReactNode } from "react";
import type { Vector3 } from "three";
import { FLAG_STAFF, type LabelKind, type PlateBridge } from "./bridge";
import { ChevronIcon, EarthIcon, SunIcon } from "./icons";

export type PlateLabel = {
  id: string;
  kind: LabelKind;
  anchor: Vector3;
  priority: number;
  text: string;
  /** Second line on the flag. */
  detail?: string;
  /** Score swatch colour. */
  tint?: string | null;
  hovered?: boolean;
  onActivate?: () => void;
  ariaLabel?: string;
  /** Read after the visible text (kept in the accessible name, so it still matches what is shown). */
  srText?: string;
};

const hidden = { visibility: "hidden" } as const;

function Swatch({ tint }: { tint?: string | null }) {
  if (!tint) return null;
  return <span aria-hidden className="block h-2 w-2 shrink-0 outline outline-1 -outline-offset-1 outline-ink/25" style={{ background: tint }} />;
}

/** DOM labels pinned to the plate; the scene writes their positions each frame. */
export function LabelLayer({ bridge, labels }: { bridge: PlateBridge; labels: PlateLabel[] }) {
  useLayoutEffect(() => {
    bridge.setLabels(labels.map(({ id, kind, anchor, priority }) => ({ id, kind, anchor, priority })));
  }, [labels, bridge]);

  return (
    <>
      {labels.map((l) => {
        const setBox = (node: HTMLElement | null) => bridge.attachLabel(l.id, "box", node);
        let body: ReactNode;
        if (l.kind === "flag") {
          body = (
            <>
              <span aria-hidden className="absolute -left-[5px] -top-[5px] block h-2.5 w-2.5 rounded-full border-[1.5px] border-paper bg-ink" />
              <span aria-hidden className="absolute bottom-0 left-[-0.5px] block w-px bg-ink" style={{ height: `var(--staff, ${FLAG_STAFF}px)` }} />
              <button
                ref={setBox}
                type="button"
                onClick={l.onActivate}
                aria-pressed="true"
                aria-label={l.ariaLabel}
                className="pointer-events-auto absolute left-[-0.5px] block whitespace-nowrap border border-ink bg-paper px-2 py-1 text-left transition-colors duration-150 group-data-[side=left]:left-auto group-data-[side=left]:right-[-0.5px] hover:bg-paper-2 active:bg-paper-3"
                style={{ bottom: `var(--staff, ${FLAG_STAFF}px)` }}
              >
                <span className="flex items-center gap-1.5 text-[0.79rem] font-semibold uppercase leading-tight tracking-[0.06em] text-ink">
                  <Swatch tint={l.tint} />
                  {l.text}
                </span>
                {l.detail && (
                  <span className="block text-[0.702rem] leading-tight text-ink-2 tabular-nums">
                    <span className="sr-only">, </span>
                    {l.detail}
                  </span>
                )}
                {l.srText && <span className="sr-only">{l.srText}</span>}
              </button>
            </>
          );
        } else if (l.kind === "chip") {
          body = (
            <>
              <span aria-hidden className="absolute -left-[3px] -top-[3px] block h-1.5 w-1.5 rounded-full border border-ink bg-paper" />
              <button
                ref={setBox}
                type="button"
                onClick={l.onActivate}
                aria-pressed="false"
                aria-label={l.ariaLabel}
                className={`pointer-events-auto absolute left-[7px] top-0 flex -translate-y-1/2 items-center group-data-[side=left]:left-auto group-data-[side=left]:right-[7px] gap-1.5 whitespace-nowrap border bg-paper px-1.5 py-[3px] text-[0.702rem] font-semibold uppercase leading-none tracking-[0.08em] text-ink transition-colors duration-150 hover:border-ink hover:bg-paper-2 active:bg-paper-3 ${
                  l.hovered ? "border-ink bg-paper-2" : "border-ink/35"
                }`}
              >
                <Swatch tint={l.tint} />
                {l.text}
              </button>
            </>
          );
        } else if (l.kind === "pole") {
          // The pole: a surveyor's mark, circle and cross, with its latitude.
          body = (
            <>
              <svg aria-hidden width="19" height="19" viewBox="0 0 19 19" className="absolute -left-[9.5px] -top-[9.5px]">
                <circle cx="9.5" cy="9.5" r="4.25" className="fill-paper stroke-ink" strokeWidth="1.25" />
                <path d="M9.5 0.5v6M9.5 12.5v6M0.5 9.5h6M12.5 9.5h6" className="stroke-paper" strokeWidth="3" />
                <path d="M9.5 0.5v6M9.5 12.5v6M0.5 9.5h6M12.5 9.5h6" className="stroke-ink" strokeWidth="1.25" />
                <circle cx="9.5" cy="9.5" r="1.1" className="fill-ink" />
              </svg>
              <span
                ref={setBox}
                className="absolute left-[12px] top-0 -translate-y-1/2 whitespace-nowrap bg-paper/85 px-1 py-px text-[0.702rem] font-semibold uppercase leading-none tracking-[0.08em] text-ink group-data-[quiet=1]:invisible group-data-[side=left]:left-auto group-data-[side=left]:right-[12px]"
              >
                {l.text}
                {l.detail ? <span className="ml-1.5 font-normal tracking-normal text-ink-2 normal-case tabular-nums">{l.detail}</span> : null}
              </span>
            </>
          );
        } else if (l.kind === "mark") {
          body = (
            <>
              <svg aria-hidden width="9" height="9" viewBox="0 0 9 9" className="absolute -left-[4.5px] -top-[4.5px] text-ink">
                <path d="M4.5 0v9M0 4.5h9" stroke="currentColor" strokeWidth="1" />
              </svg>
              <span
                ref={setBox}
                className="absolute left-[7px] top-0 -translate-y-1/2 whitespace-nowrap bg-paper/85 group-data-[side=left]:left-auto group-data-[side=left]:right-[7px] px-1 py-px text-[0.702rem] font-medium uppercase leading-none tracking-[0.08em] text-ink-2"
              >
                {l.text}
              </span>
            </>
          );
        } else {
          body = (
            <span
              ref={setBox}
              className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap bg-paper/85 px-1 py-px text-[0.702rem] font-medium leading-none tracking-[0.04em] text-ink-2 tabular-nums"
            >
              {l.text}
            </span>
          );
        }
        return (
          <div
            key={`${l.id}:${l.kind}`}
            ref={(node) => bridge.attachLabel(l.id, "el", node)}
            className={`group pointer-events-none absolute left-0 top-0 will-change-transform ${l.kind === "flag" ? "z-10" : ""}`}
            style={hidden}
          >
            {body}
          </div>
        );
      })}
    </>
  );
}

function fmt(v: number, signed = false) {
  const s = Math.abs(v).toFixed(1);
  if (!signed) return `${s}°`;
  return `${v < 0 ? "−" : "+"}${s}°`;
}

/** Sun and Earth direction markers, pinned where the bearing leaves the plate or the view. */
export function Indicators({
  bridge,
  sun,
  earth,
}: {
  bridge: PlateBridge;
  sun: { az: number; el: number } | null;
  earth: { az: number; el: number } | null;
}) {
  const bodies = [
    { key: "sun" as const, v: sun, label: "Sun", tone: "text-sun-ink" },
    { key: "earth" as const, v: earth, label: "Earth", tone: "text-earth" },
  ];
  return (
    <>
      {/* Above the flag (z-10), below the zoom hint (z-20): on a cramped plate a box may cross the flag's staff, which must not run through its figures. */}
      {bodies.map(({ key, v, label, tone }) => (
        <div
          key={key}
          ref={(node) => bridge.attachIndicator(key, "el", node)}
          className="pointer-events-none absolute left-0 top-0 z-[15] will-change-transform"
          style={hidden}
          aria-hidden
        >
          <span ref={(node) => bridge.attachIndicator(key, "arrow", node)} className={`absolute left-0 top-0 block ${tone}`}>
            <ChevronIcon className="h-3 w-3" />
          </span>
          <span className="absolute left-0 top-0 block -translate-x-1/2 -translate-y-1/2">
            {key === "sun" ? <SunIcon className="h-4 w-4" below={!!v && v.el < 0} /> : <EarthIcon className="h-4 w-4" below={!!v && v.el < 0} />}
          </span>
          <span
            ref={(node) => bridge.attachIndicator(key, "box", node)}
            className={`absolute left-0 top-0 flex items-baseline gap-1.5 whitespace-nowrap border border-rule bg-paper px-1.5 py-[3px] text-[0.702rem] leading-none tabular-nums ${tone}`}
          >
            <span className="font-semibold uppercase tracking-[0.08em]">{label}</span>
            {v && (
              <>
                <span>az {fmt(v.az)}</span>
                <span>el {fmt(v.el, true)}</span>
              </>
            )}
          </span>
        </div>
      ))}
    </>
  );
}

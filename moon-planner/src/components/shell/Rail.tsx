"use client";

// A side rail of the Plan workspace (the regions at the left, the inspector at
// the right). From xl it can be collapsed to a narrow strip that keeps a
// labelled button to open it again; below xl the rails stack with the viewer
// and are always open. The content stays mounted while collapsed, so its
// state (and a portal into it) survives.

import { useEffect, useRef, type ReactNode } from "react";
import { capsLabel } from "../ui";

function RailChevron({ pointing }: { pointing: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className="size-3.5 shrink-0">
      <path d={pointing === "left" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

export default function Rail({
  id,
  side,
  label,
  open,
  onOpenChange,
  widthClass,
  className = "",
  children,
}: {
  id: string;
  side: "left" | "right";
  /** Short name of the rail, e.g. "Regions"; shown in its header and on the collapsed strip. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Width when open from xl, e.g. "xl:w-[300px]". */
  widthClass: string;
  className?: string;
  children: ReactNode;
}) {
  // Focus follows the toggle: the button pressed goes away, so its counterpart takes focus.
  const toggled = useRef(false);
  const hideRef = useRef<HTMLButtonElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!toggled.current) return;
    toggled.current = false;
    (open ? hideRef : showRef).current?.focus();
  }, [open]);
  const toggle = (v: boolean) => {
    toggled.current = true;
    onOpenChange(v);
  };
  const border = side === "left" ? "xl:border-r" : "xl:border-l";
  // The chevron points the way the rail moves.
  const closeDir = side === "left" ? "left" : "right";
  const openDir = side === "left" ? "right" : "left";
  return (
    <div
      className={`relative flex min-h-0 shrink-0 flex-col border-rule ${border} ${open ? widthClass : "xl:w-9"} ${className}`}
      data-rail={side}
      data-open={open ? "true" : "false"}
    >
      {open ? (
        <div className="hidden h-9 shrink-0 items-center justify-between border-b border-rule pr-1.5 pl-4 xl:flex">
          <span className={capsLabel}>{label}</span>
          <button
            type="button"
            aria-expanded="true"
            aria-controls={id}
            ref={hideRef}
            onClick={() => toggle(false)}
            title={`Hide ${label.toLowerCase()}`}
            className="inline-flex size-7 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-paper-3 hover:text-ink"
          >
            <RailChevron pointing={closeDir} />
            <span className="sr-only">Hide {label}</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          aria-expanded="false"
          aria-controls={id}
          ref={showRef}
          onClick={() => toggle(true)}
          title={`Show ${label.toLowerCase()}`}
          className="hidden h-full w-9 flex-col items-center gap-2 pt-2.5 text-ink-2 transition-colors duration-150 hover:bg-paper-3 hover:text-ink xl:flex"
        >
          <RailChevron pointing={openDir} />
          <span className="text-[0.75rem] font-semibold tracking-[0.08em] uppercase [writing-mode:vertical-rl]">
            <span className="sr-only">Show </span>
            {label}
          </span>
        </button>
      )}
      <div id={id} className={`min-h-0 flex-1 xl:overflow-y-auto ${open ? "" : "xl:hidden"}`}>
        {children}
      </div>
    </div>
  );
}

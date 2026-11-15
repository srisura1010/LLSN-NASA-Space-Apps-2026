"use client";

// The one bar above the workspace: the app's name (home), the three modes,
// the mission window chip with its controls, and About & data.

import Link from "next/link";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { fmtDateRange, fmtLengthShort, fmtSpan } from "@/lib/format";
import { ChevronMark, Popover } from "../ui";

export type Mode = "plan" | "launch" | "compare";

const MODES: { id: Mode; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "launch", label: "Launch" },
  { id: "compare", label: "Compare" },
];

/** Height of the bar; the workspace below fills the rest of the screen. */
export const APP_BAR_H = "3.5rem";

function InfoMark({ className = "size-[1.125rem]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className={`shrink-0 ${className}`}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7.25v4.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
    </svg>
  );
}

function ModeTabs({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = MODES.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onMode(MODES[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Mode" className="flex h-full w-full md:w-auto">
      {MODES.map((m, i) => {
        const on = m.id === mode;
        return (
          <button
            key={m.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`mode-${m.id}`}
            aria-selected={on}
            aria-controls={on ? "workspace" : undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => onMode(m.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={`h-full flex-1 px-3.5 text-[0.875rem] md:flex-none whitespace-nowrap transition-colors duration-150 focus-visible:outline-offset-[-2px] ${
              on ? "font-semibold text-ink shadow-[inset_0_-2px_0_var(--color-ink)]" : "font-medium text-ink-2 hover:text-ink hover:shadow-[inset_0_-1px_0_var(--color-ink-2)]"
            }`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

export default function AppBar({
  mode,
  onMode,
  startMs,
  endMs,
  hours,
  windowControls,
  windowOpen,
  onWindowOpen,
  onAbout,
  leading,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  startMs: number;
  endMs: number;
  hours: number;
  /** The mission window controls shown in the chip's popover; given close() to call after an action. */
  windowControls: (close: () => void) => ReactNode;
  windowOpen?: boolean;
  onWindowOpen?: (open: boolean) => void;
  onAbout: () => void;
  /** Extra buttons before the mode switcher (drawer toggles on narrow screens). */
  leading?: ReactNode;
}) {
  return (
    <header className="relative z-40 flex shrink-0 flex-wrap items-stretch gap-x-2 border-b border-ink bg-paper pl-4 pr-2 sm:gap-x-4 md:h-14 md:flex-nowrap">
      <Link
        href="/"
        className="flex h-14 min-w-0 shrink items-center gap-2 text-[0.95rem] font-bold tracking-[-0.01em] text-ink focus-visible:outline-offset-[-2px]"
        title="Lunar Landing Site Navigator: home"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5 shrink-0">
          <circle cx="10" cy="10" r="8.25" className="fill-paper stroke-ink" strokeWidth="1.5" />
          <path d="M10 1.75a8.25 8.25 0 0 1 0 16.5Z" className="fill-umbra" />
          <circle cx="10" cy="10" r="8.25" className="fill-none stroke-ink" strokeWidth="1.5" />
        </svg>
        <span className="hidden truncate lg:inline">Lunar Landing Site Navigator</span>
        <span className="hidden truncate sm:inline lg:hidden">Site Navigator</span>
      </Link>
      {leading}
      <nav aria-label="Modes" className="order-last -ml-4 flex h-11 w-[calc(100%+1.5rem)] items-stretch border-t border-rule md:order-none md:absolute md:inset-y-0 md:left-1/2 md:ml-0 md:h-auto md:w-auto md:-translate-x-1/2 md:border-t-0">
        <ModeTabs mode={mode} onMode={onMode} />
      </nav>
      <div className="ml-auto flex h-14 items-center gap-1.5">
        <Popover
          label="Mission window"
          open={windowOpen}
          onOpenChange={onWindowOpen}
          title={`Mission window: ${fmtSpan(startMs, endMs)}`}
          buttonClassName="inline-flex h-9 items-center gap-2 border border-ink bg-paper px-2.5 text-[0.875rem] font-semibold whitespace-nowrap text-ink tabular-nums transition-colors duration-150 hover:bg-paper-3 aria-expanded:bg-paper-3"
          button={
            <>
              <span className="sr-only">Mission window: </span>
              <span>{fmtDateRange(startMs, endMs)}</span>
              <span aria-hidden="true" className="font-normal text-ink-2">
                ·
              </span>
              <span className="font-normal">{fmtLengthShort(hours)}</span>
              <ChevronMark className="size-3.5 text-ink-2" />
            </>
          }
          panelClassName="w-[min(25rem,calc(100vw-1rem))]"
        >
          {(close) => windowControls(close)}
        </Popover>
        <button
          type="button"
          onClick={onAbout}
          aria-label="About & data"
          title="About & data: how the numbers are made, checked and credited"
          className="inline-flex size-9 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-paper-3 hover:text-ink"
        >
          <InfoMark />
        </button>
      </div>
    </header>
  );
}

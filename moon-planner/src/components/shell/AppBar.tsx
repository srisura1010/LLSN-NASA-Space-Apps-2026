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
    <div role="tablist" aria-label="Mode" className="flex h-full">
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
            className={`h-full px-3.5 text-body whitespace-nowrap transition-colors duration-150 focus-visible:outline-offset-[-2px] ${
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

/** Below sm the modes are a menu: one button with the current mode, the three modes in a panel under it. */
function ModeMenu({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  return (
    <Popover
      label="Mode"
      align="start"
      title="Change mode: Plan, Launch or Compare"
      buttonClassName="inline-flex h-11 items-center gap-1.5 border border-ink bg-paper px-3 text-body font-semibold text-ink transition-colors duration-150 hover:bg-paper-3 aria-expanded:bg-paper-3"
      button={
        <>
          <span className="sr-only">Mode: </span>
          {current.label}
          <ChevronMark className="size-3.5 text-ink-2" />
        </>
      }
      panelClassName="w-44 py-1"
    >
      {(close) => (
        <ul className="m-0 list-none p-0">
          {MODES.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                data-mode-item={m.id}
                aria-current={m.id === mode ? "page" : undefined}
                onClick={() => {
                  onMode(m.id);
                  close();
                }}
                className={`flex h-11 w-full items-center px-3 text-left text-body transition-colors duration-150 hover:bg-paper-3 ${
                  m.id === mode ? "font-semibold text-ink shadow-[inset_3px_0_0_var(--color-ink)]" : "font-medium text-ink-2"
                }`}
              >
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
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
    <header className="relative z-40 flex h-14 shrink-0 items-stretch gap-x-2 border-b border-ink bg-paper pr-1 pl-3 sm:gap-x-4 sm:pr-2 sm:pl-4">
      <Link
        href="/"
        className="flex h-14 min-w-0 shrink-0 items-center gap-2 text-lead font-bold tracking-[-0.01em] text-ink focus-visible:outline-offset-[-2px]"
        title="Lunar Landing Site Navigator: home"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5 shrink-0">
          <circle cx="10" cy="10" r="8.25" className="fill-paper stroke-ink" strokeWidth="1.5" />
          <path d="M10 1.75a8.25 8.25 0 0 1 0 16.5Z" className="fill-umbra" />
          <circle cx="10" cy="10" r="8.25" className="fill-none stroke-ink" strokeWidth="1.5" />
        </svg>
        <span className="hidden truncate lg:inline">Lunar Landing Site Navigator</span>
        <span className="sr-only lg:hidden">Lunar Landing Site Navigator</span>
      </Link>
      {leading}
      <div className="flex items-center sm:hidden">
        <ModeMenu mode={mode} onMode={onMode} />
      </div>
      <nav aria-label="Modes" className="hidden items-stretch sm:flex lg:absolute lg:inset-y-0 lg:left-1/2 lg:-translate-x-1/2">
        <ModeTabs mode={mode} onMode={onMode} />
      </nav>
      <div className="ml-auto flex h-14 shrink-0 items-center gap-1 sm:gap-1.5">
        <Popover
          label="Mission window"
          open={windowOpen}
          onOpenChange={onWindowOpen}
          title={`Mission window: ${fmtSpan(startMs, endMs)}`}
          buttonClassName="inline-flex h-11 items-center gap-1.5 border border-ink bg-paper px-2 sm:gap-2 sm:px-2.5 md:h-9 text-body font-semibold whitespace-nowrap text-ink tabular-nums transition-colors duration-150 hover:bg-paper-3 aria-expanded:bg-paper-3"
          button={
            <>
              <span className="sr-only">Mission window: </span>
              {/* Phones drop the year, which the panel shows, so the bar fits 360 px on one row. */}
              <span className="hidden sm:inline">{fmtDateRange(startMs, endMs)}</span>
              <span className="sm:hidden">{fmtDateRange(startMs, endMs).replace(/ \d{4}$/, "")}</span>
              <span aria-hidden="true" className="font-normal text-ink-2">
                ·
              </span>
              <span className="font-normal">{fmtLengthShort(hours)}</span>
              <ChevronMark className="size-3.5 text-ink-2" />
            </>
          }
          panelClassName="w-[min(25rem,calc(100vw-1rem))] max-h-[calc(100svh-4.5rem)] overflow-y-auto max-sm:fixed max-sm:inset-x-2 max-sm:top-[3.75rem] max-sm:w-auto"
        >
          {(close) => windowControls(close)}
        </Popover>
        <button
          type="button"
          onClick={onAbout}
          aria-label="About & data"
          title="About & data: how the numbers are made, checked and credited"
          className="inline-flex size-11 items-center justify-center text-ink-2 md:size-9 transition-colors duration-150 hover:bg-paper-3 hover:text-ink"
        >
          <InfoMark />
        </button>
      </div>
    </header>
  );
}

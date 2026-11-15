"use client";

// A button that opens a panel under it. Escape and a click outside close the
// panel; focus moves into it on open and back to the button on close.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

export function Popover({
  label,
  button,
  children,
  align = "end",
  side = "below",
  open: openProp,
  onOpenChange,
  buttonClassName = "",
  panelClassName = "",
  title,
}: {
  /** Accessible name of the panel. */
  label: string;
  /** Content of the trigger button. */
  button: ReactNode;
  /** The panel's content, or a function given a close() to call. */
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  /** Open under the trigger (default) or over it, for a trigger near the bottom of the screen. */
  side?: "below" | "above";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  buttonClassName?: string;
  panelClassName?: string;
  /** Tooltip on the trigger. */
  title?: string;
}) {
  const id = useId();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = useCallback(
    (v: boolean) => {
      setOwnOpen(v);
      onOpenChange?.(v);
    },
    [onOpenChange],
  );
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), [setOpen]);

  useEffect(() => {
    if (!open) return;
    const panelEl = panel.current;
    const triggerEl = trigger.current;
    const first = panelEl?.querySelector<HTMLElement>("input, select, button, [href], [tabindex]:not([tabindex='-1'])");
    (first ?? panelEl)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      // Closing from inside the panel (or as it unmounts) hands focus back to the trigger.
      const active = document.activeElement;
      if (!active || active === document.body || panelEl?.contains(active)) triggerEl?.focus();
    };
  }, [open, close, setOpen]);

  return (
    <div ref={wrap} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        aria-haspopup="dialog"
        title={title}
        onClick={() => setOpen(!open)}
        className={buttonClassName}
      >
        {button}
      </button>
      {open && (
        <div
          ref={panel}
          id={`${id}-panel`}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={`absolute z-50 ${side === "above" ? "bottom-full mb-1" : "top-full mt-1"} border border-ink bg-paper shadow-[0_6px_24px_rgb(18_26_34/0.18)] outline-none ${
            align === "end" ? "right-0" : "left-0"
          } ${panelClassName}`}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

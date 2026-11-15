"use client";

// A panel that slides over the page from one side, as a modal dialog:
// Escape or the backdrop closes it, focus moves in on open and back out on close.

import { useEffect, useRef, type ReactNode } from "react";

export function Drawer({
  open,
  onClose,
  label,
  side = "right",
  modal = true,
  widthClass = "w-[min(64rem,100vw)]",
  children,
  className = "",
  bodyRef,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  side?: "left" | "right" | "bottom";
  /** A modal drawer dims the page behind it and closes on a click there. */
  modal?: boolean;
  widthClass?: string;
  children: ReactNode;
  className?: string;
  /** The scrolling body, for callers that scroll to an anchor inside it. */
  bodyRef?: React.Ref<HTMLDivElement>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (returnTo.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open) return null;
  const place =
    side === "right"
      ? `right-0 top-0 h-full ${widthClass} border-l`
      : side === "left"
        ? `left-0 top-0 h-full ${widthClass} border-r`
        : "inset-x-0 bottom-0 max-h-[85dvh] w-full border-t";
  return (
    <div className="fixed inset-0 z-[60]">
      {modal && <div aria-hidden="true" className="absolute inset-0 bg-ink/30 motion-safe:animate-[fade_150ms_ease-out]" onClick={onClose} />}
      <div
        ref={panel}
        role="dialog"
        aria-modal={modal || undefined}
        aria-label={label}
        tabIndex={-1}
        className={`absolute flex flex-col border-ink bg-paper shadow-[0_0_32px_rgb(18_26_34/0.22)] outline-none ${place} ${className}`}
      >
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

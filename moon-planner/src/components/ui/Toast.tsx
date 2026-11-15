import type { ReactNode } from "react";

/** A notice pinned over the page's corner (under the app bar), announced politely. */
export function Toast({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={`pointer-events-auto w-[min(26rem,calc(100vw-2rem))] shadow-[0_6px_24px_rgb(18_26_34/0.18)] ${className}`}>
      {children}
    </div>
  );
}

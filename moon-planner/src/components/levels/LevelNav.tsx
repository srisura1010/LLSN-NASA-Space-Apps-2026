"use client";

// The level control that floats at the top left of the Plan viewer, and the
// note shown when zooming nears a limit that opens another level.

export type Level = "system" | "moon" | "site";

const LEVELS: { id: Level; label: string }[] = [
  { id: "system", label: "System" },
  { id: "moon", label: "Moon" },
  { id: "site", label: "Site" },
];

/** System · Moon · Site, the current one pressed. Zooming past a limit does the same by wheel. */
export default function LevelNav({ level, onLevel, className = "" }: { level: Level; onLevel: (l: Level) => void; className?: string }) {
  return (
    <nav aria-label="Zoom level" className={`pointer-events-auto ${className}`}>
      <ol className="flex border border-ink bg-paper shadow-[0_1px_4px_rgb(18_26_34/0.12)]">
        {LEVELS.map((l, k) => {
          const on = l.id === level;
          return (
            <li key={l.id} className={k ? "border-l border-ink" : ""}>
              <button
                type="button"
                aria-current={on ? "step" : undefined}
                aria-label={on ? `${l.label} level, current` : `Go to the ${l.label} level`}
                onClick={on ? undefined : () => onLevel(l.id)}
                className={`block h-8 px-3 text-label font-semibold tracking-[0.08em] whitespace-nowrap uppercase transition-colors duration-150 focus-visible:outline-offset-2 ${
                  on ? "cursor-default bg-ink text-paper" : "text-ink-2 hover:bg-paper-3 hover:text-ink"
                }`}
              >
                {l.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The note shown over a view when the camera nears a limit that opens another
 * level. Nothing switches until the user keeps scrolling past the limit (the
 * bar fills) or presses the button.
 */
export function ZoomHint({
  text,
  progress = 0,
  action,
}: {
  text: string | null;
  progress?: number;
  /** A button that opens the level the hint names, e.g. "Open Moon level". */
  action?: { label: string; onClick: () => void } | null;
}) {
  if (!text) return null;
  return (
    <div role="status" className="pointer-events-none absolute top-3 left-1/2 z-20 max-w-[calc(100%-1.5rem)] -translate-x-1/2 border border-ink bg-paper">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1">
        <p className="text-small leading-snug text-ink">{text}</p>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="pointer-events-auto inline-flex h-7 items-center gap-1 border border-ink bg-ink px-2 text-small font-semibold whitespace-nowrap text-paper hover:bg-umbra"
          >
            {action.label}
            <span aria-hidden="true">→</span>
          </button>
        )}
      </div>
      <div aria-hidden="true" className="h-[2px] bg-ink" style={{ width: `${Math.round(Math.min(1, progress) * 100)}%` }} />
    </div>
  );
}

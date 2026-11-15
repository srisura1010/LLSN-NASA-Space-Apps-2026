"use client";

// The level indicator shared by the System, Moon and site views, with the
// step buttons that do by keyboard what zooming past a limit does by wheel.

export type Level = "system" | "moon" | "site";

const LEVELS: { id: Level; label: string; name: string }[] = [
  { id: "system", label: "System", name: "System level" },
  { id: "moon", label: "Moon", name: "Moon level" },
  { id: "site", label: "Site", name: "site level" },
];

const STEP =
  "flex h-8 items-center gap-1.5 border border-ink px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-ink transition-colors duration-150 hover:bg-paper-3 focus-visible:outline-offset-2";

function Chevron({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d={up ? "M2 8l4-4 4 4" : "M2 4l4 4 4-4"} />
    </svg>
  );
}

export default function LevelNav({ level, onLevel, className = "" }: { level: Level; onLevel: (l: Level) => void; className?: string }) {
  const i = LEVELS.findIndex((l) => l.id === level);
  const up = LEVELS[i - 1];
  const down = LEVELS[i + 1];
  return (
    <nav aria-label="Zoom levels" className={`flex flex-wrap items-center gap-2 ${className}`}>
      {up && (
        <button type="button" onClick={() => onLevel(up.id)} className={STEP}>
          <Chevron up />
          Up to {up.name}
        </button>
      )}
      <ol className="flex border border-ink">
        {LEVELS.map((l, k) => {
          const on = l.id === level;
          return (
            <li key={l.id} className={k ? "border-l border-ink" : ""}>
              <button
                type="button"
                aria-current={on ? "step" : undefined}
                aria-label={on ? `${l.label} level, current` : `Go to the ${l.label} level`}
                onClick={on ? undefined : () => onLevel(l.id)}
                className={`block h-[1.875rem] px-2.5 text-[0.69rem] tracking-[0.1em] whitespace-nowrap uppercase transition-colors duration-150 focus-visible:outline-offset-2 ${
                  on ? "cursor-default bg-ink font-bold text-paper" : "font-semibold text-ink-2 hover:bg-paper-3 hover:text-ink"
                }`}
              >
                {l.label}
              </button>
            </li>
          );
        })}
      </ol>
      {down && (
        <button type="button" onClick={() => onLevel(down.id)} className={STEP}>
          <Chevron up={false} />
          Down to {down.name}
        </button>
      )}
    </nav>
  );
}

/** The note shown over a view when the camera nears a limit that opens another level. */
export function ZoomHint({ text, progress = 0 }: { text: string | null; progress?: number }) {
  if (!text) return null;
  return (
    <div role="status" className="pointer-events-none absolute top-3 left-1/2 z-20 max-w-[calc(100%-1.5rem)] -translate-x-1/2 border border-ink bg-paper">
      <p className="px-2.5 py-1 text-[0.8rem] leading-snug text-ink">{text}</p>
      <div aria-hidden="true" className="h-[2px] bg-ink" style={{ width: `${Math.round(Math.min(1, progress) * 100)}%` }} />
    </div>
  );
}

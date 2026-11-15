// Small drawn icons for the terrain plate: 16 px grid, 1.5 px strokes.

type IconProps = { className?: string };

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  "aria-hidden": true,
  focusable: false,
} as const;

export function SunIcon({ className, below = false }: IconProps & { below?: boolean }) {
  return (
    <svg {...base} className={className}>
      <circle
        cx="8"
        cy="8"
        r="3"
        className={below ? "fill-paper stroke-sun-ink" : "fill-sun stroke-sun-ink"}
        strokeWidth="1.5"
      />
      <g className="stroke-sun-ink" strokeWidth="1.5" strokeLinecap="butt">
        <path d="M8 0.75v2.5M8 12.75v2.5M0.75 8h2.5M12.75 8h2.5" />
        <path d="M2.87 2.87l1.77 1.77M11.36 11.36l1.77 1.77M2.87 13.13l1.77-1.77M11.36 4.64l1.77-1.77" />
      </g>
    </svg>
  );
}

export function EarthIcon({ className, below = false }: IconProps & { below?: boolean }) {
  return (
    <svg {...base} className={className}>
      <circle
        cx="8"
        cy="8"
        r="6"
        className={below ? "fill-paper stroke-earth" : "fill-earth-soft stroke-earth"}
        strokeWidth="1.5"
      />
      <path d="M2 8h12M8 2c-2.2 1.6-2.2 10.4 0 12M8 2c2.2 1.6 2.2 10.4 0 12" className="stroke-earth" strokeWidth="1.5" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

export function MinusIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

export function RecentreIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 0.75v3M8 12.25v3M0.75 8h3M12.25 8h3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Chevron pointing right; rotate it to point anywhere. */
export function ChevronIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5.5 3.5L10 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

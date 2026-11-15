// Drawn marks on a 16 px grid with 1.5 px strokes, shared across the app.

type MarkProps = { className?: string };

export function SunMark({ className = "size-4" }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`shrink-0 ${className}`}>
      <circle cx="8" cy="8" r="5.25" className="fill-sun stroke-sun-ink" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="1.4" className="fill-sun-ink" />
    </svg>
  );
}

export function EarthMark({ className = "size-4" }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`shrink-0 ${className}`}>
      <circle cx="8" cy="8" r="5.25" className="fill-earth-soft stroke-earth" strokeWidth="1.5" />
      <path d="M8 2.75v10.5M2.75 8h10.5" className="stroke-earth" strokeWidth="1.5" />
    </svg>
  );
}

export function AlertMark({ className = "size-3.5" }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className={`shrink-0 ${className}`}>
      <path d="M8 2.25 14.25 13.5H1.75Z" className="stroke-limit" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6.5v3.25" className="stroke-limit" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="0.9" className="fill-limit" />
    </svg>
  );
}

/** An exclamation in a circle, for a field error. */
export function ErrorMark({ className = "mt-[0.15em] size-3.5" }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className={`shrink-0 ${className}`}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.75v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.1" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function ArrowMark({ className = "size-3.5" }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className={`inline-block shrink-0 align-[-0.15em] ${className}`}>
      <path d="M2.5 8h10.5M9.25 4.25 13 8l-3.75 3.75" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function ChevronMark({ className = "size-3.5" }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className={`shrink-0 ${className}`}>
      <path d="M4 6.25 8 10.25l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

export function ExternalMark({ className = "size-3.5" }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className={`shrink-0 ${className}`}>
      <path d="M9.5 2.75h3.75V6.5M13.25 2.75 7.5 8.5M11.75 9.5v3.75h-9v-9H6.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Play or pause. */
export function PlayMark({ playing, className = "size-3.5" }: { playing: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className={`shrink-0 ${className}`}>
      {playing ? (
        <path d="M5.25 3.5v9M10.75 3.5v9" stroke="currentColor" strokeWidth="1.5" />
      ) : (
        <path d="M4.75 3.25v9.5L12.75 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      )}
    </svg>
  );
}

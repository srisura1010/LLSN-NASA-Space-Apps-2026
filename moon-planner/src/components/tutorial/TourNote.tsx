"use client";

// The first-visit note over the viewer's lower left: a quiet offer of the tour
// that never blocks the page. It shows once per browser; starting the tour,
// "Not now" and the close button all put it away for good.

export default function TourNote({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  const btn = "inline-flex h-8 items-center px-3 text-small whitespace-nowrap transition-colors duration-150 max-md:h-11";
  return (
    <aside
      aria-label="Tutorial"
      data-tour-note
      className="pointer-events-auto absolute bottom-14 left-3 z-30 w-[min(17.5rem,calc(100%-1.5rem))] border border-ink bg-paper shadow-[0_6px_24px_rgb(18_26_34/0.18)]"
    >
      <div className="flex items-start gap-2 pt-2.5 pl-3">
        <p className="min-w-0 flex-1 text-body leading-snug text-ink">
          <span className="font-semibold">New here?</span> Take the 1-minute tour of the Navigator.
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="-mt-1.5 mr-0.5 inline-flex size-8 shrink-0 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-paper-3 hover:text-ink max-md:size-11"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
          <span className="sr-only">Close</span>
        </button>
      </div>
      <div className="flex gap-2 px-3 pt-2 pb-3">
        <button type="button" onClick={onStart} data-tour-start className={`${btn} border border-ink bg-ink font-semibold text-paper hover:bg-umbra`}>
          Start tour
        </button>
        <button type="button" onClick={onDismiss} className={`${btn} border border-ink bg-paper font-medium text-ink hover:bg-paper-3`}>
          Not now
        </button>
      </div>
    </aside>
  );
}

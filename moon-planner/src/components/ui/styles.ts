// Class strings shared by the UI primitives, for the few places that style a
// native element (a label, an input, a link) rather than render a component.

/** Small uppercase label above a field or a group of values. */
export const capsLabel = "text-label font-semibold uppercase tracking-[0.08em] text-ink-2";

/** The same label, as a block above its field. */
export const fieldLabel = `block ${capsLabel}`;

/** A text input or select in the bulletin style: square, hairline border. */
export const fieldControl =
  "h-8 rounded-none border border-rule bg-paper px-2 text-lead text-ink caret-earth transition-colors duration-150 hover:border-ink-2 aria-invalid:border-ink aria-invalid:shadow-[inset_0_0_0_1px_var(--color-ink)] disabled:cursor-not-allowed disabled:text-ink-3";

const base = "inline-flex items-center gap-1.5 whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed";

/** Button classes by variant. */
export const buttonClass = {
  primary: `${base} h-8 border border-ink bg-ink px-3 text-body font-semibold text-paper hover:bg-umbra active:bg-ink-2 disabled:border-rule disabled:bg-paper-3 disabled:text-ink-3`,
  secondary: `${base} h-8 border border-ink bg-paper px-3 text-body font-medium text-ink hover:bg-paper-3 active:bg-umbra-soft disabled:border-rule disabled:text-ink-3 disabled:hover:bg-paper`,
  link: "text-left text-body font-medium text-earth underline decoration-1 underline-offset-[3px] hover:text-ink",
} as const;

/** A toggle button that stays pressed: ink when on. */
export function toggleClass(on: boolean, size: "sm" | "md" = "md", soft = false): string {
  const onClass = soft ? "bg-paper-3 font-semibold text-ink" : "bg-ink font-semibold text-paper";
  return `${size === "sm" ? "h-7 px-2" : "h-8 px-2.5"} border border-ink text-small whitespace-nowrap transition-colors duration-150 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:border-rule disabled:text-ink-3 ${
    on ? onClass : "font-medium text-ink hover:bg-paper-3"
  }`;
}

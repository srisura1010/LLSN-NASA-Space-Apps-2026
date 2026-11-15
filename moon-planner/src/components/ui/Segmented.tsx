/** A row of joined toggle buttons, one of which is on. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = "",
}: {
  /** Accessible name of the group. */
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`flex border border-ink ${className}`}>
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className={`h-8 px-3 text-[0.8rem] whitespace-nowrap transition-colors duration-150 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:text-ink-3 ${
              i ? "border-l border-ink" : ""
            } ${on ? "bg-ink font-semibold text-paper" : "font-medium text-ink hover:bg-paper-3"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

import type { ReactNode } from "react";
import { AlertMark, ArrowMark } from "./icons";

/**
 * One labelled value in a table: the label as the row header, the value on
 * the right. dense rows are the details panel's; the default is the Moon and
 * System readouts'. `was` prints a previous value before an arrow; `flagged`
 * paints the value in the limit red with an alert mark.
 */
export function Row({
  label,
  mark,
  value,
  note,
  was,
  flagged,
  flagNote,
  dense = false,
  name,
}: {
  label: ReactNode;
  mark?: ReactNode;
  value: ReactNode;
  /** A second line under the value. */
  note?: ReactNode;
  was?: string;
  flagged?: boolean;
  /** Read out after a flagged value, e.g. "longer than the 2 d gap limit". */
  flagNote?: string;
  dense?: boolean;
  /** data-row hook for tests. */
  name?: string;
}) {
  return (
    <tr className="border-b border-rule align-baseline last:border-b-0">
      <th scope="row" className={`${dense ? "py-1.5" : "py-2"} pr-3 text-left text-[0.844rem] font-normal text-ink-2`}>
        <span className="inline-flex items-center gap-1.5">
          {mark}
          {label}
        </span>
      </th>
      <td data-row={name} className={`${dense ? "py-1.5" : "py-2"} text-right whitespace-nowrap tabular-nums`}>
        {was !== undefined && was !== value && (
          <span className="mr-2 text-[0.75rem] text-ink-2">
            <span className="sr-only">was </span>
            {was}
            <ArrowMark className="ml-1 size-3" />
          </span>
        )}
        <span
          className={`inline-flex items-center gap-1 text-[0.95rem] ${
            flagged ? "font-semibold text-limit" : dense ? "font-medium text-ink" : "font-semibold text-ink"
          }`}
        >
          {flagged && <AlertMark />}
          {value}
          {flagged && flagNote && <span className="sr-only">, {flagNote}</span>}
        </span>
        {note && <span className="block text-[0.8rem] font-normal whitespace-normal text-ink-2">{note}</span>}
      </td>
    </tr>
  );
}

/** A label above a value: one figure in a group of key numbers. */
export function Stat({ label, value, note, className = "" }: { label: ReactNode; value: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[0.75rem] font-semibold tracking-[0.08em] text-ink-2 uppercase">{label}</dt>
      <dd className="mt-0.5 text-[1.068rem] font-semibold text-ink tabular-nums">{value}</dd>
      {note && <dd className="text-[0.8rem] text-ink-2">{note}</dd>}
    </div>
  );
}

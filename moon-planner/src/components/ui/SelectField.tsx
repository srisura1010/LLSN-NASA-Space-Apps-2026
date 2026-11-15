import type { SelectHTMLAttributes } from "react";
import { ChevronMark } from "./icons";
import { fieldControl } from "./styles";

/**
 * A native select in the bulletin style: square, hairline border and a drawn
 * chevron instead of the browser's. Layout classes (width, joins) go on the
 * wrapper through wrapClassName; the select fills it.
 */
export function SelectField({
  wrapClassName = "",
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { wrapClassName?: string }) {
  return (
    <span className={`relative inline-flex ${wrapClassName}`}>
      <select {...rest} className={`${fieldControl} peer w-full cursor-pointer appearance-none pr-7 [color-scheme:light] ${className}`}>
        {children}
      </select>
      <ChevronMark className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-2 peer-hover:text-ink peer-disabled:text-ink-3" />
    </span>
  );
}

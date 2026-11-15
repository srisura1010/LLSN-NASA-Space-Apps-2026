import type { ReactNode } from "react";

/** Uppercase section heading. "rule" draws the ink line under it (side panels); "plain" has none. */
export function SectionLabel({
  children,
  note,
  rule = true,
  as: Tag = "h3",
  id,
  className = "",
}: {
  children: ReactNode;
  /** Right-aligned note in sentence case, e.g. "Times in UTC". */
  note?: ReactNode;
  rule?: boolean;
  as?: "h2" | "h3" | "h4" | "p";
  id?: string;
  className?: string;
}) {
  return (
    <Tag
      id={id}
      className={`flex items-baseline justify-between gap-3 text-[0.75rem] font-semibold tracking-[0.08em] text-ink uppercase ${
        rule ? "border-b border-ink pb-1.5" : ""
      } ${className}`}
    >
      <span>{children}</span>
      {note && <span className="text-[0.75rem] font-normal tracking-normal text-ink-2 normal-case">{note}</span>}
    </Tag>
  );
}

/** A section of a side panel: a hairline above, an uppercase title, then the content. */
export function Panel({
  title,
  note,
  children,
  className = "",
}: {
  title: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border-t border-rule px-5 pt-3.5 pb-4 ${className}`}>
      <SectionLabel rule={false} note={note}>
        {title}
      </SectionLabel>
      <div className="mt-2">{children}</div>
    </section>
  );
}

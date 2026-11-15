import type { Body } from "@/lib/contacts";

/** A 10 px square in the body's up or down colour. */
export function StateSwatch({ body, up, className = "shrink-0" }: { body: Body; up: boolean; className?: string }) {
  const cls = body === "sun" ? (up ? "fill-sun" : "fill-umbra") : up ? "fill-earth" : "fill-umbra-soft";
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" className={className} aria-hidden="true">
      <rect width={10} height={10} className={cls} />
    </svg>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/tool", label: "Tool" },
];

// Height is h-11 (2.75rem); the Navigator's full-height shell subtracts it.
// The Navigator runs edge to edge; other pages keep the landing page's column.
export default function Navbar() {
  const pathname = usePathname();
  const fullWidth = pathname.startsWith("/tool");
  return (
    <header
      className={`flex h-11 shrink-0 items-center justify-between border-b border-ink bg-paper ${
        fullWidth
          ? "px-4"
          : "px-[max(1rem,calc((100%_-_84rem)/2_+_1rem))] sm:px-[max(2rem,calc((100%_-_84rem)/2_+_2rem))] lg:px-[max(3rem,calc((100%_-_84rem)/2_+_3rem))]"
      }`}
    >
      <Link
        href="/"
        className="text-[0.95rem] font-bold tracking-[-0.01em] text-ink focus-visible:outline-offset-4"
      >
        Lunar Landing Site Navigator
      </Link>
      <nav aria-label="Site">
        <ul className="flex items-center gap-1">
          {LINKS.map((l) => {
            const current = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={current ? "page" : undefined}
                  className={`inline-flex h-11 items-center px-2.5 text-[0.844rem] transition-colors duration-150 focus-visible:outline-offset-[-2px] ${
                    current
                      ? "font-semibold text-ink shadow-[inset_0_-2px_0_var(--color-ink)]"
                      : "font-medium text-ink-2 hover:text-ink"
                  }`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}

import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="flex items-center justify-between border-b border-white/10 px-6 py-4">
      <Link href="/" className="font-semibold tracking-tight">
        Lunar Site Planner
      </Link>
      <div className="flex gap-6 text-sm text-gray-400">
        <Link href="/" className="hover:text-white">
          Home
        </Link>
        <Link href="/tool" className="hover:text-white">
          Tool
        </Link>
      </div>
    </nav>
  );
}

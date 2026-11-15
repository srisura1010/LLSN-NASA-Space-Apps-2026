import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tool | Lunar Site Planner",
};

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-white/20 text-sm text-gray-500">
      {label}
    </div>
  );
}

export default function ToolPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:flex-row">
      {/* Sidebar: site and date controls go here */}
      <aside className="flex flex-col gap-4 md:w-72">
        <Placeholder label="Site selection" />
        <Placeholder label="Date / time controls" />
      </aside>

      {/* Main area: 3D view goes here */}
      <section className="flex min-h-[400px] flex-1">
        <Placeholder label="3D view" />
      </section>
    </div>
  );
}

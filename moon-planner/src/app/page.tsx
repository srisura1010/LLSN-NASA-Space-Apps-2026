import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Lunar Site Planner</h1>
      <p className="max-w-xl text-gray-400">
        A 3D tool for comparing lunar south pole landing sites by Sun and Earth
        visibility.
      </p>
      <Link
        href="/tool"
        className="rounded-md bg-white px-5 py-2.5 text-sm font-medium text-black hover:bg-gray-200"
      >
        Open the tool
      </Link>
    </div>
  );
}

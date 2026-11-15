import type { NextRequest } from "next/server";
import { getSkyTrack, type SkyTarget } from "@/lib/horizons";

// Proxy for JPL Horizons so the browser never calls it directly.
// GET /api/horizons?target=sun&lat=-89.5&lon=0&start=2027-01-01&stop=2027-01-03&step=1%20h
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;

  try {
    const target = q.get("target");
    if (target !== "sun" && target !== "earth") {
      throw new Error('target must be "sun" or "earth"');
    }

    const lat = Number(q.get("lat"));
    const lon = Number(q.get("lon"));
    const start = q.get("start");
    const stop = q.get("stop");
    if (!q.get("lat") || !q.get("lon") || Number.isNaN(lat) || Number.isNaN(lon)) {
      throw new Error("lat and lon must be numbers");
    }
    if (!start || !stop) {
      throw new Error("start and stop are required");
    }

    const points = await getSkyTrack({
      target: target as SkyTarget,
      lat,
      lon,
      start,
      stop,
      step: q.get("step") ?? undefined,
    });

    return Response.json(points);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return Response.json({ error }, { status: 500 });
  }
}

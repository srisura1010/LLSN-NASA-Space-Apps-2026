// Locator map: the nine region centres around the south pole in polar
// stereographic, longitude 0 at the top, with the selected region marked.

import { sites } from "@/lib/sites";
import { latLonToXY } from "@/lib/terrain";

const SIZE = 84;
const C = SIZE / 2;
const RANGE_M = 214_000; // map radius in metres from the pole
const k = (C - 4) / RANGE_M;

// Rounded so server and browser trigonometry render identical attributes.
const r2 = (v: number) => Math.round(v * 100) / 100;

function px(lat: number, lon: number) {
  const { x, y } = latLonToXY(lat, lon);
  return { x: r2(C + x * k), y: r2(C - y * k) };
}

const ring = (lat: number) => r2(latLonToXY(lat, 0).y * k);

export function Locator({ selectedId }: { selectedId: string }) {
  const sel = sites.find((s) => s.id === selectedId);
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" className="shrink-0">
      <circle cx={C} cy={C} r={ring(-83)} className="fill-paper-2 stroke-rule" strokeWidth={1} />
      <circle cx={C} cy={C} r={ring(-86)} className="fill-none stroke-rule" strokeWidth={1} />
      <path d={`M${C - 4} ${C}h8M${C} ${C - 4}v8`} className="stroke-ink-2" strokeWidth={1} />
      {sites.map((s) => {
        const p = px(s.lat, s.lon);
        return s.id === selectedId ? null : <circle key={s.id} cx={p.x} cy={p.y} r={2} className="fill-ink-3" />;
      })}
      {sel && (
        <g>
          <circle cx={px(sel.lat, sel.lon).x} cy={px(sel.lat, sel.lon).y} r={5.5} className="fill-none stroke-ink" strokeWidth={1.5} />
          <circle cx={px(sel.lat, sel.lon).x} cy={px(sel.lat, sel.lon).y} r={2.25} className="fill-ink" />
        </g>
      )}
    </svg>
  );
}

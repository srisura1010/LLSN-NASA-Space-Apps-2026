"use client";

import type { KeyboardEvent } from "react";
import { MOON_RADIUS_M } from "@/lib/terrain";
import { exitDistance, LANDMARKS, type RegionShape, type V2 } from "./geo";

// Flat plan of the regions, used when the 3D plate cannot run. Map
// metres are drawn in kilometres with y flipped (lon 0 at the top).

type Props = {
  regions: (RegionShape | null)[];
  names: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  site: V2 | null;
  /** Label for a site that is not one of the regions (a custom point); drawn as a marker. */
  siteLabel?: string | null;
  sunBearing: V2 | null;
  earthBearing: V2 | null;
  tints: (string | null)[] | null;
  half: number;
};

const X = (p: V2) => p.x / 1000;
const Y = (p: V2) => -p.y / 1000;

export default function PlanView({ regions, names, selectedIndex, onSelect, site, siteLabel, sunBearing, earthBearing, tints, half }: Props) {
  const view = 215;
  const rings = Array.from({ length: 8 }, (_, i) => 2 * MOON_RADIUS_M * Math.tan((((i + 1) / 2) * Math.PI) / 180) / 1000);
  const meridians = Array.from({ length: 12 }, (_, i) => (i * 30 * Math.PI) / 180);
  const bearingEnd = (b: V2) => {
    if (!site) return null;
    const t = Math.min(exitDistance(site, b, view * 1000 - 6000), 260000);
    return { x: site.x + b.x * t, y: site.y + b.y * t };
  };
  const sunEnd = sunBearing ? bearingEnd(sunBearing) : null;
  const earthEnd = earthBearing ? bearingEnd(earthBearing) : null;
  const order = regions.map((r, i) => ({ r, i })).filter((q): q is { r: RegionShape; i: number } => !!q.r);

  // Greedy label placement: right of the box, then left, above, below.
  const placed: [number, number, number, number][] = [];
  const labelAt = new Map<number, { x: number; y: number; anchor: "start" | "end" | "middle" }>();
  const byPriority = [...order].sort((a, b) => (a.i === selectedIndex ? -1 : b.i === selectedIndex ? 1 : b.r.areaKm2 - a.r.areaKm2));
  for (const { r, i } of byPriority) {
    const size = i === selectedIndex ? 12 : 10;
    const w = names[i].length * size * 0.68;
    const xs = r.corners.map(X);
    const ys = r.corners.map(Y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const cy = (y0 + y1) / 2;
    const cx = (x0 + x1) / 2;
    const options = [
      { x: x1 + 4, y: cy + size * 0.35, anchor: "start" as const, rect: [x1 + 4, cy - size / 2, x1 + 4 + w, cy + size / 2] },
      { x: x0 - 4, y: cy + size * 0.35, anchor: "end" as const, rect: [x0 - 4 - w, cy - size / 2, x0 - 4, cy + size / 2] },
      { x: cx, y: y0 - 4, anchor: "middle" as const, rect: [cx - w / 2, y0 - 4 - size, cx + w / 2, y0 - 4] },
      { x: cx, y: y1 + size + 2, anchor: "middle" as const, rect: [cx - w / 2, y1 + 2, cx + w / 2, y1 + 2 + size] },
    ];
    const free = options.find((o) => !placed.some((q) => o.rect[0] < q[2] && o.rect[2] > q[0] && o.rect[1] < q[3] && o.rect[3] > q[1]));
    const pick = free ?? options[0];
    placed.push(pick.rect as [number, number, number, number]);
    labelAt.set(i, pick);
  }
  const endLabel = (end: V2) => {
    if (!site) return { x: 0, y: 0 };
    const dx = X(end) - X(site);
    const dy = Y(end) - Y(site);
    const l = Math.hypot(dx, dy) || 1;
    return {
      x: Math.min(view - 22, Math.max(-view + 22, X(end) - (dx / l) * 16)),
      y: Math.min(view - 6, Math.max(-view + 14, Y(end) - (dy / l) * 16 - 4)),
    };
  };
  // Draw the selected region last so its outline sits on top.
  order.sort((a, b) => (a.i === selectedIndex ? 1 : 0) - (b.i === selectedIndex ? 1 : 0) || b.r.areaKm2 - a.r.areaKm2);

  const key = (i: number) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(i);
    }
  };

  return (
    <svg
      viewBox={`${-view} ${-view} ${2 * view} ${2 * view}`}
      className="h-full w-full"
      role="group"
      aria-label="Plan of the nine regions around the lunar south pole"
    >
      <defs>
        <clipPath id="plan-clip">
          <rect x={-half / 1000} y={-half / 1000} width={(2 * half) / 1000} height={(2 * half) / 1000} />
        </clipPath>
      </defs>
      <g clipPath="url(#plan-clip)" className="stroke-rule" fill="none" strokeWidth="1" vectorEffect="non-scaling-stroke">
        {rings.map((r) => (
          <circle key={r} cx="0" cy="0" r={r} vectorEffect="non-scaling-stroke" />
        ))}
        {meridians.map((a) => (
          <line key={a} x1={30 * Math.sin(a)} y1={-30 * Math.cos(a)} x2={400 * Math.sin(a)} y2={-400 * Math.cos(a)} vectorEffect="non-scaling-stroke" />
        ))}
      </g>

      {order.map(({ r, i }) => {
        const pts = r.corners.map((c) => `${X(c)},${Y(c)}`).join(" ");
        const sel = i === selectedIndex;
        return (
          <g
            key={r.id}
            role="button"
            tabIndex={0}
            aria-pressed={sel}
            aria-label={`Select ${names[i]}`}
            onClick={() => onSelect(i)}
            onKeyDown={key(i)}
            className="cursor-pointer outline-none [&:focus-visible>polygon]:stroke-earth"
          >
            <polygon points={pts} fill={tints?.[i] ?? "transparent"} fillOpacity={tints?.[i] ? 0.35 : 0} className="stroke-ink" strokeWidth={sel ? 4 : 1} vectorEffect="non-scaling-stroke" />
            {sel && <polygon points={pts} fill="none" className="stroke-sun" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
            <text
              x={labelAt.get(i)?.x ?? X(r.centre)}
              y={labelAt.get(i)?.y ?? Y(r.centre)}
              textAnchor={labelAt.get(i)?.anchor ?? "start"}
              className={`fill-ink uppercase ${sel ? "font-semibold" : "font-medium"}`}
              fontSize={sel ? 12 : 10}
              letterSpacing="0.06em"
            >
              {names[i]}
            </text>
          </g>
        );
      })}

      {LANDMARKS.map((m) => (
        <g key={m.id} className="fill-ink-2 stroke-ink-2">
          <path d={`M${X(m) - 3} ${Y(m)}h6M${X(m)} ${Y(m) - 3}v6`} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <text x={X(m) + 5} y={Y(m) + (m.id === "pole" ? -4 : 11)} fontSize="9" stroke="none" className="uppercase" letterSpacing="0.06em">
            {m.label}
          </text>
        </g>
      ))}

      {site && earthEnd && (
        <g>
          <line x1={X(site)} y1={Y(site)} x2={X(earthEnd)} y2={Y(earthEnd)} className="stroke-earth" strokeWidth="1.5" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          <text {...endLabel(earthEnd)} fontSize="10" textAnchor="middle" className="fill-earth font-semibold uppercase" letterSpacing="0.06em">
            Earth
          </text>
        </g>
      )}
      {site && sunEnd && (
        <g>
          <line x1={X(site)} y1={Y(site)} x2={X(sunEnd)} y2={Y(sunEnd)} className="stroke-sun-ink" strokeWidth="1.5" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          <text {...endLabel(sunEnd)} fontSize="10" textAnchor="middle" className="fill-sun-ink font-semibold uppercase" letterSpacing="0.06em">
            Sun
          </text>
        </g>
      )}
      {site && siteLabel && (
        <g>
          <circle cx={X(site)} cy={Y(site)} r="3.5" className="fill-sun stroke-ink" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          <text x={X(site) + 7} y={Y(site) + 4} fontSize="12" className="fill-ink font-semibold uppercase" letterSpacing="0.06em">
            {siteLabel}
          </text>
        </g>
      )}
    </svg>
  );
}

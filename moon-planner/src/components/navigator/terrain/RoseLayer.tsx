"use client";

// SVG for the bearing rose and the scale bar. React renders the elements
// once; RoseDrawer (rose.ts) writes their geometry every rendered frame.

import { ROSE_LABELS, type RoseDrawer, type RoseNodes } from "./rose";

type PathKey = {
  [K in keyof RoseNodes]: RoseNodes[K] extends SVGPathElement | null ? K : never;
}[keyof RoseNodes];

const hidden = { visibility: "hidden" } as const;
const halo = "[paint-order:stroke] stroke-paper [stroke-linejoin:round] [stroke-width:3px]";

export function RoseLayer({ drawer }: { drawer: RoseDrawer }) {
  const path = (key: PathKey) => (el: SVGPathElement | null) => drawer.attach(key, el);
  return (
    <svg
      ref={(el) => drawer.attach("svg", el)}
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      style={hidden}
      aria-hidden="true"
    >
      {/* Graduated azimuth ring, ink on a paper casing so it reads on light ground and on shadow. */}
      <g fill="none" strokeLinecap="butt">
        <path ref={path("ringHalo")} className="stroke-paper" strokeWidth={3} strokeOpacity={0.8} />
        <path ref={path("ring")} className="stroke-ink" strokeWidth={1} />
        <path ref={path("grads")} className="stroke-ink [paint-order:stroke]" strokeWidth={1} />
      </g>
      <g fontSize="0.702rem" textAnchor="middle" dominantBaseline="central" className="tabular-nums">
        {ROSE_LABELS.map((l, k) => (
          <text
            key={l.az}
            ref={(el) => drawer.attachLabel(k, el)}
            className={`${halo} ${l.cardinal ? "fill-ink font-semibold" : "fill-ink-2"}`}
            style={hidden}
          >
            {l.text}
          </text>
        ))}
      </g>

      {/* Earth's path (inner), then the Sun's: dashed behind terrain, cased in view, ticked by time. */}
      <g fill="none" strokeLinejoin="round">
        <path ref={path("earthDownCase")} className="stroke-paper" strokeWidth={3.5} strokeDasharray="4 3" />
        <path ref={path("earthDown")} className="stroke-earth" strokeWidth={1.5} strokeDasharray="4 3" />
        <path ref={path("earthUpCase")} className="stroke-paper" strokeWidth={4} strokeLinecap="round" />
        <path ref={path("earthUp")} className="stroke-earth" strokeWidth={2} strokeLinecap="round" />
        <path ref={path("earthTickHalo")} className="stroke-paper" strokeWidth={3} />
        <path ref={path("earthTicks")} className="stroke-earth" strokeWidth={1} />
        <path ref={path("earthMajor")} className="stroke-earth" strokeWidth={1.75} />
        <path ref={path("earthEnds")} className="stroke-earth" strokeWidth={1.75} strokeLinejoin="miter" />

        <path ref={path("sunDownCase")} className="stroke-sun-ink" strokeWidth={3} strokeDasharray="4 3" />
        <path ref={path("sunDown")} className="stroke-sun" strokeWidth={1.5} strokeDasharray="4 3" />
        <path ref={path("sunUpCase")} className="stroke-sun-ink" strokeWidth={4} strokeLinecap="round" />
        <path ref={path("sunUp")} className="stroke-sun" strokeWidth={2.25} strokeLinecap="round" />
        <path ref={path("sunTickHalo")} className="stroke-paper" strokeWidth={3} />
        <path ref={path("sunTicks")} className="stroke-sun-ink" strokeWidth={1} />
        <path ref={path("sunMajor")} className="stroke-sun-ink" strokeWidth={1.75} />
        <path ref={path("sunEnds")} className="stroke-sun-ink" strokeWidth={1.75} strokeLinejoin="miter" />
      </g>

      {/* Rise and set contacts, written by the drawer. */}
      <g ref={(el) => drawer.attach("contacts", el)} />

      {/* Earth and the Sun now, on their paths; dashed when behind terrain, as in Fig. 2. */}
      <g
        ref={(el) => drawer.attach("earthNow", el)}
        className="group"
        style={hidden}
      >
        <circle r={7.5} className="fill-paper" />
        <circle
          r={6}
          strokeWidth={1.5}
          className="fill-earth-soft stroke-earth group-data-[up=0]:fill-paper group-data-[up=0]:[stroke-dasharray:3_2]"
        />
        <path d="M0 -6V6M-6 0H6" className="stroke-earth group-data-[up=0]:hidden" strokeWidth={1} />
      </g>
      <g
        ref={(el) => drawer.attach("sunNow", el)}
        className="group"
        style={hidden}
      >
        <circle r={6} className="fill-paper" />
        <circle
          r={4.5}
          strokeWidth={1.25}
          className="fill-sun stroke-sun-ink group-data-[up=0]:fill-umbra group-data-[up=0]:stroke-sun group-data-[up=0]:[stroke-dasharray:2_1.5]"
        />
        <circle r={1.25} className="fill-sun-ink group-data-[up=0]:hidden" />
      </g>
    </svg>
  );
}

/** Scale bar for the plate, true at the orbit centre (the selected site by default). */
export function ScaleBar({ drawer }: { drawer: RoseDrawer }) {
  return (
    <svg
      ref={(el) => drawer.attach("scale", el)}
      width={190}
      height={20}
      viewBox="-4 -1 190 20"
      className="block shrink-0 overflow-visible"
      style={hidden}
      aria-hidden="true"
    >
      <path ref={(el) => drawer.attach("scaleBar", el)} className="fill-paper stroke-ink" strokeWidth={1} />
      <path ref={(el) => drawer.attach("scaleFill", el)} className="fill-ink" />
      <g fontSize="0.702rem" className="fill-ink tabular-nums">
        {[0, 1, 2].map((i) => (
          <text
            key={i}
            ref={(el) => drawer.attachScaleLabel(i, el)}
            y={16}
            textAnchor={i === 1 ? "middle" : "start"}
            className={halo}
          />
        ))}
      </g>
    </svg>
  );
}

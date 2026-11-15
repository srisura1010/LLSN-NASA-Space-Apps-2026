// Table 1: this model's year-2027 shares of sunlight and Earth visibility at
// the nine region centres beside NASA's long-term LOLA maps. The numbers come
// from public/data/validation.json (npm run build-validation), imported at
// build time so the table is plain HTML with nothing to fetch.

import validation from "../../../public/data/validation.json";

type Cell = { model: number; nasa: number; diff: number };
type Gap = { id: string; name: string; diff: number };
type BodySummary = {
  meanAbsDiff: number;
  within: { pts: number; regions: number };
  outside: Gap[];
  largest: Gap;
};
type Validation = {
  regions: { id: string; name: string; sun: Cell; earth: Cell }[];
  summary: { sun: BodySummary; earth: BodySummary };
};

const DATA: Validation = validation;
const TOTAL = DATA.regions.length;

/** Signed percentage points with a true minus sign, as the Navigator prints them. */
function signed(v: number): string {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return "0.0";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}`;
}

function points(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ${v === 1 ? "point" : "points"}`;
}

/** "within 1 point of NASA at 7 of the 9 regions; the gaps are larger at …" */
function agreement(s: BodySummary, ofNasa: boolean): string {
  const where = s.within.regions === TOTAL ? `at all ${TOTAL} regions` : `at ${s.within.regions} of the ${TOTAL} regions`;
  const head = `within ${points(s.within.pts)}${ofNasa ? " of NASA" : ""} ${where}`;
  const gap = (g: Gap, unit = false) => `${g.name} (${signed(g.diff)}${unit ? " points" : ""})`;
  const out = s.outside;
  if (out.length === 0) return head;
  if (out.length === 1) return `${head}; the gap is larger at ${gap(out[0], true)}`;
  if (out.length === 2) return `${head}; the gaps are larger at ${gap(out[0], true)} and ${gap(out[1])}`;
  return `${head}; the largest gap is at ${gap(s.largest, true)}`;
}

const head = "text-[0.75rem] font-semibold tracking-[0.08em] text-ink-2 uppercase sm:text-[0.79rem]";
const num = "py-2 pl-2 text-right tabular-nums sm:pl-4";
const groupStart = "border-l border-rule pl-2.5 sm:pl-4";

export function NasaCheck() {
  const { sun, earth } = DATA.summary;
  return (
    <>
      <p className="mt-2 max-w-[62ch] text-[1rem] leading-[1.6] text-ink-2">
        NASA&rsquo;s LOLA illumination maps (Mazarico and others, 2011) give the long-term share of time each point
        near the pole sees the Sun and sees Earth. Table 1 sets their value at each region centre beside this
        model&rsquo;s count over every hour of 2027, made from the same files the Navigator uses.
      </p>
      <p className="mt-3 max-w-[62ch] text-[1rem] leading-[1.6] text-ink-2">
        For sunlight the model is {agreement(sun, true)}. For Earth it is {agreement(earth, false)}. NASA&rsquo;s maps
        average many years and are read at the 120 m pixel over each centre; this model counts one year, 2027, from
        2 m above the centre itself.
      </p>

      <div className="mt-6 overflow-x-auto" tabIndex={0} role="region" aria-labelledby="nasa-check-caption">
        <table className="w-full min-w-[21rem] border-collapse text-left text-[0.844rem] text-ink sm:text-[1rem]">
          <caption
            id="nasa-check-caption"
            className="caption-top pb-3 text-left text-[0.889rem] leading-[1.55] text-ink-2"
          >
            <span className="font-semibold text-ink">Table 1.</span> Share of hours with the Sun above the terrain
            horizon and with Earth in view, per cent. 2027 is this model over every hour of the year; NASA is the
            long-term LOLA average at the region centre; Diff. is 2027 minus NASA, in percentage points.
          </caption>
          <thead>
            <tr className="border-t border-ink">
              <th scope="col" rowSpan={2} className={`${head} pt-2.5 pr-2 pb-2 align-bottom sm:pr-4`}>
                Region
              </th>
              <th scope="colgroup" colSpan={3} className={`${groupStart} pt-2.5 pb-1 font-semibold`}>
                <span className="inline-flex items-center gap-2 text-[0.844rem] text-ink sm:text-[0.889rem]">
                  <span aria-hidden="true" className="inline-block h-2 w-3.5 shrink-0 border border-sun-ink bg-sun" />
                  Sun above terrain
                </span>
              </th>
              <th scope="colgroup" colSpan={3} className={`${groupStart} pt-2.5 pb-1 font-semibold`}>
                <span className="inline-flex items-center gap-2 text-[0.844rem] text-ink sm:text-[0.889rem]">
                  <span aria-hidden="true" className="inline-block h-2 w-3.5 shrink-0 bg-earth" />
                  Earth in view
                </span>
              </th>
            </tr>
            <tr className="border-b border-ink">
              {(["sun", "earth"] as const).flatMap((body) =>
                ["2027", "NASA", "Diff."].map((h, i) => (
                  <th key={`${body}${h}`} scope="col" className={`${head} pb-2 text-right ${i === 0 ? groupStart : "pl-2 sm:pl-4"}`}>
                    {h}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {DATA.regions.map((r) => (
              <tr key={r.id} className="border-b border-rule">
                <th scope="row" className="py-2 pr-2 font-medium sm:pr-4">
                  {r.name}
                </th>
                {[r.sun, r.earth].map((c, i) => (
                  <Cells key={i} cell={c} />
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-y border-ink">
              <th scope="row" colSpan={3} className="py-2.5 pr-2 font-semibold sm:pr-4">
                Mean absolute difference
              </th>
              <td className={`${num} py-2.5 font-semibold`}>{sun.meanAbsDiff.toFixed(1)}</td>
              <td colSpan={2} className={groupStart} />
              <td className={`${num} py-2.5 font-semibold`}>{earth.meanAbsDiff.toFixed(1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function Cells({ cell }: { cell: Cell }) {
  return (
    <>
      <td className={`${num} ${groupStart}`}>{cell.model.toFixed(1)}</td>
      <td className={`${num} text-ink-2`}>{cell.nasa.toFixed(1)}</td>
      <td className={`${num} font-semibold`}>{signed(cell.diff)}</td>
    </>
  );
}

"use client";

// Moon level: the whole Moon as a printed relief globe, turned by the
// IAU/WGCCRE rotation model and lit from the Sun's real direction. It sits
// between the System level and the site-level terrain plate.

import { Component, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { BackSide, Color, LinearFilter, NoColorSpace, Quaternion, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2, Vector3, type Texture } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { elevationDeg, latLonToBody, moonFrameAt, type MoonFrame } from "@/lib/moonFrame";
import { sites, type Site } from "@/lib/sites";
import { EARTH_RADIUS_KM, MOON_RADIUS_KM, loadSystem, stateAt, systemEndMs, type SystemData, type SystemState, type Vec3 } from "@/lib/system";
import YearSlider, { fmtUtc, useYearPlayback } from "../system/YearSlider";

export type MoonViewProps = {
  nowMs: number;
  onScrub?: (ms: number) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Steps down to the terrain plate in the Navigator tab. */
  onOpenSite: () => void;
  /** The mission window, marked on the year rail. */
  windowMs?: { startMs: number; endMs: number };
  className?: string;
};

const INK = "#121a22";
const PAPER = "#eef1f0";
const SUN_INK = "#7a5600";
const EARTH = "#2453c2";

/** Half-width of the site-level terrain plate, km on the polar stereographic plane; its inscribed circle is 80° S. */
const PLATE_HALF_KM = 304;

/** Earlier landings, shown for context. Coordinates as published by NASA NSSDCA and the mission teams. */
const LANDINGS: { id: string; short: string; name: string; lat: number; lon: number; year: number; left?: boolean }[] = [
  { id: "apollo-11", short: "A11", name: "Apollo 11", lat: 0.674, lon: 23.473, year: 1969 },
  { id: "apollo-12", short: "A12", name: "Apollo 12", lat: -3.012, lon: -23.422, year: 1969, left: true },
  { id: "apollo-14", short: "A14", name: "Apollo 14", lat: -3.645, lon: -17.471, year: 1971 },
  { id: "apollo-15", short: "A15", name: "Apollo 15", lat: 26.132, lon: 3.634, year: 1971 },
  { id: "apollo-16", short: "A16", name: "Apollo 16", lat: -8.973, lon: 15.5, year: 1972, left: true },
  { id: "apollo-17", short: "A17", name: "Apollo 17", lat: 20.191, lon: 30.772, year: 1972 },
  { id: "chandrayaan-3", short: "CY-3", name: "Chandrayaan-3", lat: -69.37, lon: 32.32, year: 2023 },
  { id: "slim", short: "SLIM", name: "SLIM", lat: -13.32, lon: 25.25, year: 2024 },
  { id: "im-1", short: "IM-1", name: "IM-1 Odysseus", lat: -80.13, lon: 1.44, year: 2024 },
  { id: "change-6", short: "CE-6", name: "Chang'e 6", lat: -41.64, lon: -153.99, year: 2024 },
];

const RAD = Math.PI / 180;
/** Body-fixed x, y, z (x through 0° N 0° E, z north) to scene axes with north up, matching three's sphere UVs. */
const toScene = (v: Vec3, k = 1): Vec3 => [v[0] * k, v[2] * k, -v[1] * k];
const onGlobe = (lat: number, lon: number, k = 1): Vec3 => toScene(latLonToBody(lat, lon), k);

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtSigned = (n: number, digits = 2) => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(digits)}°`;
const fmtLat = (v: number, digits = 2) => `${Math.abs(v).toFixed(digits)}° ${v < 0 ? "S" : "N"}`;
const fmtLon = (v: number, digits = 2) => `${Math.abs(v).toFixed(digits)}° ${v < 0 ? "W" : "E"}`;

// ---------- Globe ----------

const GLOBE_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vP;
  void main() {
    vUv = uv;
    vP = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
// Grey relief print: albedo as paper-to-grey tone, slopes from the height map
// shaded by the real Sun, umbra slate past the terminator, and a 30-degree
// graticule drawn as hairlines (ink in daylight, paper in shadow).
const GLOBE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uHeight;
  uniform vec2 uTexel;
  uniform float uRelief;
  uniform vec3 uSunDir;
  uniform vec3 uDayLo;
  uniform vec3 uDayHi;
  uniform vec3 uNightLo;
  uniform vec3 uNightHi;
  uniform vec3 uInk;
  uniform vec3 uPaper;
  varying vec2 vUv;
  varying vec3 vP;

  float gridLine(float deg, float step) {
    float d = abs(fract(deg / step + 0.5) - 0.5) * step;
    float w = max(fwidth(deg), 1e-4);
    return 1.0 - smoothstep(w * 0.35, w * 0.9, d);
  }

  void main() {
    vec3 n = normalize(vP);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(-n.z, n.x);
    float cl = max(cos(lat), 0.1);
    vec3 east = vec3(-sin(lon), 0.0, -cos(lon));
    vec3 north = cross(n, east);
    float hE = texture2D(uHeight, vUv + vec2(uTexel.x, 0.0)).r - texture2D(uHeight, vUv - vec2(uTexel.x, 0.0)).r;
    float hN = texture2D(uHeight, vUv + vec2(0.0, uTexel.y)).r - texture2D(uHeight, vUv - vec2(0.0, uTexel.y)).r;
    vec3 bn = normalize(n - uRelief * (hE / cl * east + hN * north));

    float geo = dot(n, uSunDir);
    float ndl = dot(bn, uSunDir);
    // A crisp terminator from the sphere, and hillshade from the slope towards or away from the Sun.
    float lit = smoothstep(-0.012, 0.03, geo);
    float relief = clamp((ndl - geo) * 3.0, -1.0, 1.0);

    float tone = sqrt(dot(texture2D(uMap, vUv).rgb, vec3(0.2126, 0.7152, 0.0722)));
    tone = smoothstep(0.2, 0.74, tone);
    vec3 day = mix(uDayLo, uDayHi, tone) * (0.94 + 0.3 * relief);
    vec3 night = mix(uNightLo, uNightHi, tone) * (1.0 + 0.1 * relief);
    vec3 col = mix(night, day, lit);

    float latDeg = degrees(lat);
    float lonDeg = degrees(lon);
    float g = gridLine(latDeg, 30.0) * step(abs(latDeg), 75.0);
    g = max(g, gridLine(lonDeg, 30.0) * (1.0 - smoothstep(80.0, 84.0, abs(latDeg))));
    col = mix(col, mix(uPaper, uInk, lit), g * 0.55);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

type Textures = { map: Texture; height: Texture };

function Globe({ textures, sunDir }: { textures: Textures; sunDir: Vec3 }) {
  const uniforms = useMemo(() => {
    const img = textures.height.image as { width: number; height: number };
    return {
      uMap: { value: textures.map },
      uHeight: { value: textures.height },
      uTexel: { value: new Vector2(1 / img.width, 1 / img.height) },
      uRelief: { value: 7 },
      uSunDir: { value: new Vector3(1, 0, 0) },
      uDayLo: { value: new Color("#778182") },
      uDayHi: { value: new Color("#eceeed") },
      uNightLo: { value: new Color("#31465a") },
      uNightHi: { value: new Color("#4b6376") },
      uInk: { value: new Color(INK) },
      uPaper: { value: new Color(PAPER) },
    };
  }, [textures]);
  return (
    <>
      <mesh>
        <sphereGeometry args={[1, 128, 64]} />
        <shaderMaterial vertexShader={GLOBE_VERT} fragmentShader={GLOBE_FRAG} uniforms={uniforms} uniforms-uSunDir-value={sunDir} />
      </mesh>
      <mesh scale={1.006}>
        <sphereGeometry args={[1, 96, 48]} />
        <meshBasicMaterial color={INK} side={BackSide} toneMapped={false} />
      </mesh>
    </>
  );
}

/** A map line with a paper casing so it reads on both the lit and the shadowed side. */
function CasedLine({ points }: { points: Vec3[] }) {
  const lift = (k: number) => points.map((p) => [p[0] * k, p[1] * k, p[2] * k] as Vec3);
  return (
    <>
      <Line points={lift(1.003)} color={PAPER} lineWidth={3.5} />
      <Line points={lift(1.006)} color={INK} lineWidth={1.25} />
    </>
  );
}

/** Polar stereographic x (towards 90° E), y (towards 0°) in km to a point on the globe. */
function plateToGlobe(x: number, y: number): Vec3 {
  const colat = 2 * Math.atan(Math.hypot(x, y) / (2 * MOON_RADIUS_KM));
  return onGlobe(-90 + colat / RAD, Math.atan2(x, y) / RAD);
}

const PLATE = plateOutline();

function plateOutline(): { square: Vec3[]; circle: Vec3[] } {
  const h = PLATE_HALF_KM;
  const corners = [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
    [-h, -h],
  ];
  const square: Vec3[] = [];
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < 16; i++) {
      const f = i / 16;
      square.push(plateToGlobe(corners[c][0] + (corners[c + 1][0] - corners[c][0]) * f, corners[c][1] + (corners[c + 1][1] - corners[c][1]) * f));
    }
  }
  square.push(square[0]);
  const circle: Vec3[] = [];
  for (let i = 0; i <= 96; i++) circle.push(onGlobe(-80, (i / 96) * 360));
  return { square, circle };
}

const UP = new Vector3(0, 1, 0);

function Arrow({ dir, color }: { dir: Vec3; color: string }) {
  const at = (k: number): Vec3 => [dir[0] * k, dir[1] * k, dir[2] * k];
  const quaternion = new Quaternion().setFromUnitVectors(UP, new Vector3(...dir));
  return (
    <>
      <Line points={[at(1.05), at(1.2)]} color={color} lineWidth={1.5} />
      <mesh position={at(1.2)} quaternion={quaternion}>
        <coneGeometry args={[0.02, 0.07, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </>
  );
}

// Labels and marks are plain DOM over the canvas. The scene projects their
// anchor points each frame and hides the ones behind the globe.

type Label = { key: string; at: Vec3; node: ReactNode };

function LabelProjector({ points, overlay }: { points: Vec3[]; overlay: RefObject<HTMLDivElement | null> }) {
  const invalidate = useThree((s) => s.invalidate);
  const v = useMemo(() => new Vector3(), []);
  useEffect(() => invalidate(), [points, invalidate]);
  useFrame(({ camera, size }) => {
    const host = overlay.current;
    if (!host) return;
    camera.updateMatrixWorld();
    const c = camera.position;
    for (let i = 0; i < points.length; i++) {
      const el = host.children[i] as HTMLElement | undefined;
      if (!el) continue;
      const p = points[i];
      // Closest approach of the sight line from the camera to the point; inside the globe means hidden.
      const dx = p[0] - c.x;
      const dy = p[1] - c.y;
      const dz = p[2] - c.z;
      const t = Math.min(1, Math.max(0, -(c.x * dx + c.y * dy + c.z * dz) / (dx * dx + dy * dy + dz * dz)));
      const near = Math.hypot(c.x + dx * t, c.y + dy * t, c.z + dz * t);
      v.set(p[0], p[1], p[2]).project(camera);
      const shown = near > 0.995 && v.z > -1 && v.z < 1;
      el.style.setProperty("visibility", shown ? "visible" : "hidden");
      if (shown) el.style.setProperty("transform", `translate3d(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px, 0)`);
    }
  });
  return null;
}

type FramingId = "pole" | "near" | "sun";
type Framing = { id: FramingId; dir: Vec3 };
/** From below the south pole, tipped towards the near side so the 0° meridian runs up the page. */
const POLE_DIR = onGlobe(-66, 0);

function Rig({ framing }: { framing: Framing }) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const narrow = Math.max(1, 1.05 / aspect);
  const base = 5.2 * narrow;

  useEffect(() => {
    camera.position.set(framing.dir[0] * base, framing.dir[1] * base, framing.dir[2] * base);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
    invalidate();
  }, [camera, base, framing, invalidate]);

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      enableDamping={false}
      minDistance={1.45}
      maxDistance={base * 1.6}
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI - 0.05}
      rotateSpeed={0.55}
      zoomSpeed={0.8}
    />
  );
}

function Scene({
  textures,
  frame,
  framing,
  labelPoints,
  overlay,
}: {
  textures: Textures;
  frame: MoonFrame;
  framing: Framing;
  labelPoints: Vec3[];
  overlay: RefObject<HTMLDivElement | null>;
}) {
  const sun = toScene(frame.sunDir);
  const earth = toScene(frame.earthDir);
  return (
    <>
      <color attach="background" args={[PAPER]} />
      <Rig framing={framing} />
      <LabelProjector points={labelPoints} overlay={overlay} />
      <Globe textures={textures} sunDir={sun} />
      <CasedLine points={PLATE.circle} />
      <CasedLine points={PLATE.square} />
      <Arrow dir={sun} color={SUN_INK} />
      <Arrow dir={earth} color={EARTH} />
    </>
  );
}

// ---------- Overlay marks ----------

const LABEL_TEXT = "text-[0.69rem] leading-4 font-semibold tracking-[0.1em] whitespace-nowrap uppercase select-none";

function GridTag({ text }: { text: string }) {
  return (
    <span aria-hidden="true" className={`absolute block -translate-x-1/2 -translate-y-1/2 bg-paper/80 px-1 font-medium text-ink-2 ${LABEL_TEXT}`}>
      {text}
    </span>
  );
}

function EdgeTag({ text, className }: { text: string; className: string }) {
  return (
    <span aria-hidden="true" className={`absolute block -translate-x-1/2 -translate-y-1/2 bg-paper/85 px-1 ${LABEL_TEXT} ${className}`}>
      {text}
    </span>
  );
}

/** A round swatch on the surface with its name on a short leader. */
function PointTag({ text, swatch, below = false }: { text: string; swatch: string; below?: boolean }) {
  return (
    <div aria-hidden="true" className="relative">
      <span className={`absolute left-0 block w-px bg-ink ${below ? "top-0 h-7" : "bottom-0 h-7"}`} />
      <span className={`absolute -top-[5.5px] -left-[5.5px] block size-[11px] rounded-full border border-ink ${swatch}`} />
      <span className={`absolute left-0 block border-l border-ink bg-paper/90 px-1.5 text-ink ${LABEL_TEXT} ${below ? "top-7" : "bottom-7"}`}>{text}</span>
    </div>
  );
}

function LandingMark({ text, left }: { text: string; left?: boolean }) {
  return (
    <div aria-hidden="true" className="relative">
      <span className="absolute -top-[4.5px] -left-[4.5px] block size-[9px] rounded-full border-[1.5px] border-ink bg-paper/70" />
      <span className={`absolute -top-2 block bg-paper/75 px-0.5 font-medium text-ink ${LABEL_TEXT} ${left ? "right-[7px]" : "left-[7px]"}`}>{text}</span>
    </div>
  );
}

function RegionMark({ site, selected, onSelect }: { site: Site; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <div className="relative">
      {selected && (
        <>
          <span aria-hidden="true" className="absolute bottom-0 left-0 block h-9 w-px bg-ink" />
          <span aria-hidden="true" className={`absolute bottom-9 left-0 block bg-ink px-1.5 py-0.5 text-paper ${LABEL_TEXT}`}>
            {site.name}
          </span>
        </>
      )}
      <button
        type="button"
        onClick={() => onSelect(site.id)}
        aria-pressed={selected}
        aria-label={`${site.name}, ${fmtLat(site.lat)}, ${fmtLon(site.lon)}`}
        title={site.name}
        className="pointer-events-auto absolute -top-2.5 -left-2.5 grid size-5 cursor-pointer place-items-center"
      >
        <span className={`block border border-paper bg-ink ${selected ? "size-[11px] outline outline-1 outline-ink" : "size-2"}`} />
      </button>
    </div>
  );
}

// ---------- Fallback when WebGL is missing ----------

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

class GlBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A flat chart of the south polar cap to 60° S, 0° up and 90° E to the right, drawn without WebGL. */
function PolarFallback({ frame, selectedId, onSelect }: { frame: MoonFrame; selectedId: string | null; onSelect: (id: string) => void }) {
  const xy = (lat: number, lon: number): [number, number] => {
    const r = (90 + lat) * 3;
    return [r * Math.sin(lon * RAD), -r * Math.cos(lon * RAD)];
  };
  const label = "fill-ink text-[4.5px] font-semibold tracking-[0.1em] uppercase";
  const edge = (lon: number, k: number) => [k * Math.sin(lon * RAD), -k * Math.cos(lon * RAD)];
  const s0 = edge(frame.subSolar.lon, 94);
  const s1 = edge(frame.subSolar.lon, 108);
  const e0 = edge(frame.subEarth.lon, 94);
  const e1 = edge(frame.subEarth.lon, 108);
  return (
    <div className="absolute inset-0 flex flex-col">
      <p className="border-b border-rule px-4 py-2 text-[0.844rem] text-ink-2">
        This browser could not start WebGL, so the globe is replaced by a flat chart of the south polar cap. The ticks at
        the edge point to the longitudes where the Sun and Earth are overhead; the table values are unaffected.
      </p>
      <svg viewBox="-125 -125 250 250" role="group" aria-label="Chart of the lunar south polar cap with the nine regions" className="min-h-0 flex-1">
        <circle r={90} fill="#dfe4e3" stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <circle r={60} fill="none" stroke="#b9c3c2" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <circle r={30} fill="none" stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={0} y1={-90} x2={0} y2={90} stroke="#b9c3c2" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={-90} y1={0} x2={90} y2={0} stroke="#b9c3c2" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={s0[0]} y1={s0[1]} x2={s1[0]} y2={s1[1]} stroke={SUN_INK} strokeWidth={3} vectorEffect="non-scaling-stroke" />
        <line x1={e0[0]} y1={e0[1]} x2={e1[0]} y2={e1[1]} stroke={EARTH} strokeWidth={3} vectorEffect="non-scaling-stroke" />
        <text x={s1[0] * 1.07} y={s1[1] * 1.07 + 1.5} textAnchor="middle" className={label}>Sun</text>
        <text x={e1[0] * 1.07} y={e1[1] * 1.07 + 1.5} textAnchor="middle" className={label}>Earth</text>
        <text x={2} y={-62} className={label}>70° S</text>
        <text x={2} y={-32} className={label}>80° S, site level</text>
        {sites.map((s) => {
          const [x, y] = xy(s.lat, s.lon);
          const on = s.id === selectedId;
          return (
            <g key={s.id} role="button" tabIndex={0} aria-label={s.name} aria-pressed={on} className="cursor-pointer" onClick={() => onSelect(s.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(s.id)}>
              <rect x={x - (on ? 2.2 : 1.5)} y={y - (on ? 2.2 : 1.5)} width={on ? 4.4 : 3} height={on ? 4.4 : 3} fill={INK} stroke={PAPER} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              {on && <text x={x + 4} y={y + 1.5} className={label}>{s.name}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- Controls and readout ----------

const BUTTON = "h-8 border border-ink px-3 text-[0.8rem] whitespace-nowrap transition-colors duration-150 focus-visible:outline-offset-2";

function Row({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <tr className="border-b border-rule align-baseline">
      <th scope="row" className="py-2 pr-3 text-left text-[0.844rem] font-normal text-ink-2">
        {label}
      </th>
      <td className="py-2 text-right text-[0.95rem] font-semibold whitespace-nowrap text-ink">
        {value}
        {note && <span className="block text-[0.8rem] font-normal text-ink-2">{note}</span>}
      </td>
    </tr>
  );
}

const H3 = "border-b border-ink pb-1.5 text-[0.75rem] font-semibold tracking-[0.08em] text-ink uppercase";

function Readout({ frame, state, site }: { frame: MoonFrame; state: SystemState; site: Site | null }) {
  return (
    <div>
      <h3 className={H3}>Circumstances</h3>
      <table className="w-full border-collapse">
        <tbody>
          <Row label="Time" value={fmtUtc(frame.ms)} />
          <Row label="Sub-solar point" value={`${fmtLat(frame.subSolar.lat)}, ${fmtLon(frame.subSolar.lon)}`} note="where the Sun is overhead" />
          <Row
            label="Sub-Earth point"
            value={`${fmtLat(frame.subEarth.lat)}, ${fmtLon(frame.subEarth.lon)}`}
            note={`libration ${fmtSigned(frame.subEarth.lat, 1)} lat, ${fmtSigned(frame.subEarth.lon, 1)} lon`}
          />
          <Row label="Moon illuminated" value={`${(state.illuminated * 100).toFixed(1)} %`} note={`${state.phaseName}, from Earth`} />
          <Row label="Earth to Moon" value={`${fmtInt(state.earthMoonKm)} km`} note={`${(state.earthMoonKm / EARTH_RADIUS_KM).toFixed(1)} Earth radii`} />
        </tbody>
      </table>

      <h3 className={`mt-6 ${H3}`}>{site ? `At ${site.name}` : "At the selected region"}</h3>
      {site ? (
        <>
          <table className="w-full border-collapse">
            <tbody>
              <Row label="Position" value={`${fmtLat(site.lat)}, ${fmtLon(site.lon)}`} />
              <Row label="Sun elevation" value={fmtSigned(elevationDeg(site.lat, site.lon, frame.sunKm))} />
              <Row label="Earth elevation" value={fmtSigned(elevationDeg(site.lat, site.lon, frame.earthKm))} />
            </tbody>
          </table>
          <p className="mt-2 text-[0.8rem] leading-snug text-ink-2">
            Elevation of each body&apos;s centre over a smooth sphere of radius 1,737.4 km. The site level measures it
            against the terrain.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[0.844rem] leading-snug text-ink-2">Choose one of the nine regions below to see how high the Sun and Earth stand there.</p>
      )}
    </div>
  );
}

function Legend({ showLandings }: { showLandings: boolean }) {
  const item = "flex items-center gap-2.5 py-1 text-[0.844rem] text-ink-2";
  return (
    <ul>
      <li className={item}>
        <span className="mx-[2px] block size-2 shrink-0 bg-ink" />
        Region NASA named for Artemis III in 2024
      </li>
      <li className={item}>
        <span className="block size-3 shrink-0 border border-ink" />
        Site level plate, ±304 km about the pole, with the 80° S circle
      </li>
      <li className={item}>
        <span className="mx-px block size-[10px] shrink-0 rounded-full border border-ink bg-sun" />
        Sub-solar point and the arrow to the Sun
      </li>
      <li className={item}>
        <span className="mx-px block size-[10px] shrink-0 rounded-full border border-ink bg-earth" />
        Sub-Earth point and the arrow to Earth
      </li>
      <li className={item}>
        <span className="mx-px block size-[10px] shrink-0 bg-umbra" />
        Night side
      </li>
      {showLandings && (
        <li className={item}>
          <span className="mx-px block size-[10px] shrink-0 rounded-full border-[1.5px] border-ink" />
          Earlier landing
        </li>
      )}
    </ul>
  );
}

// ---------- View ----------

type Load = { status: "loading" } | { status: "ready"; data: SystemData; textures: Textures } | { status: "error"; message: string };

async function loadTextures(): Promise<Textures> {
  const loader = new TextureLoader();
  let map: Texture;
  let height: Texture;
  try {
    [map, height] = await Promise.all([loader.loadAsync("/textures/moon_color_2k.jpg"), loader.loadAsync("/textures/moon_height_3ppd.jpg")]);
  } catch {
    throw new Error("The Moon's colour and height maps did not load.");
  }
  map.colorSpace = SRGBColorSpace;
  map.wrapS = RepeatWrapping;
  map.anisotropy = 4;
  height.colorSpace = NoColorSpace;
  height.wrapS = RepeatWrapping;
  height.generateMipmaps = false;
  height.minFilter = LinearFilter;
  return { map, height };
}

const GRID_LABELS: { key: string; text: string; lat: number; lon: number }[] = [
  { key: "g-0", text: "0°", lat: -45, lon: 0 },
  { key: "g-90e", text: "90° E", lat: -45, lon: 90 },
  { key: "g-180", text: "180°", lat: -45, lon: 180 },
  { key: "g-90w", text: "90° W", lat: -45, lon: -90 },
  { key: "g-60s", text: "60° S", lat: -60, lon: 45 },
  { key: "g-30s", text: "30° S", lat: -30, lon: 45 },
  { key: "g-eq", text: "Equator", lat: 0, lon: 45 },
  { key: "g-30n", text: "30° N", lat: 30, lon: 45 },
  { key: "g-60n", text: "60° N", lat: 60, lon: 45 },
];

export default function MoonView({ nowMs, onScrub, selectedId, onSelect, onOpenSite, windowMs, className = "" }: MoonViewProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [framing, setFraming] = useState<Framing>({ id: "pole", dir: POLE_DIR });
  const [showLandings, setShowLandings] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [gl] = useState(hasWebGL);

  useEffect(() => {
    let live = true;
    Promise.all([loadSystem(), loadTextures()]).then(
      ([data, textures]) => live && setLoad({ status: "ready", data, textures }),
      (e: unknown) => live && setLoad({ status: "error", message: e instanceof Error ? e.message : "The files did not load." }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const data = load.status === "ready" ? load.data : null;
  const textures = load.status === "ready" ? load.textures : null;
  const ms = data ? Math.min(Math.max(nowMs, data.startMs), systemEndMs(data)) : nowMs;
  const frame = useMemo(() => (data ? moonFrameAt(data, ms) : null), [data, ms]);
  const state = useMemo(() => (data ? stateAt(data, ms) : null), [data, ms]);
  const site = useMemo(() => sites.find((s) => s.id === selectedId) ?? null, [selectedId]);

  const span = useMemo(() => (data ? { startMs: data.startMs, endMs: systemEndMs(data) } : null), [data]);
  useYearPlayback(playing, span, ms, onScrub);

  const overlay = useRef<HTMLDivElement>(null);
  const labels = useMemo<Label[]>(() => {
    if (!frame) return [];
    const out: Label[] = GRID_LABELS.map((g) => ({ key: g.key, at: onGlobe(g.lat, g.lon), node: <GridTag text={g.text} /> }));
    out.push({ key: "plate", at: onGlobe(-80, -140), node: <EdgeTag text="Site level" className="text-ink" /> });
    if (showLandings) for (const l of LANDINGS) out.push({ key: l.id, at: onGlobe(l.lat, l.lon), node: <LandingMark text={l.short} left={l.left} /> });
    out.push({ key: "to-sun", at: toScene(frame.sunDir, 1.3), node: <EdgeTag text="To the Sun" className="-mt-2.5 text-sun-ink" /> });
    out.push({ key: "to-earth", at: toScene(frame.earthDir, 1.3), node: <EdgeTag text="To Earth" className="mt-2.5 text-earth" /> });
    out.push({ key: "sub-solar", at: toScene(frame.sunDir), node: <PointTag text="Sub-solar point" swatch="bg-sun" /> });
    out.push({ key: "sub-earth", at: toScene(frame.earthDir), node: <PointTag text="Sub-Earth point" swatch="bg-earth" below /> });
    // The selected region goes last so its flag sits above its neighbours.
    for (const s of [...sites].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId))) {
      out.push({ key: `site-${s.id}`, at: onGlobe(s.lat, s.lon), node: <RegionMark site={s} selected={s.id === selectedId} onSelect={onSelect} /> });
    }
    return out;
  }, [frame, showLandings, selectedId, onSelect]);
  const labelPoints = useMemo(() => labels.map((l) => l.at), [labels]);

  const frameTo = (id: FramingId) => {
    if (!frame) return;
    setFraming({ id, dir: id === "pole" ? POLE_DIR : toScene(id === "near" ? frame.earthDir : frame.sunDir) });
  };

  const fallback = frame ? <PolarFallback frame={frame} selectedId={selectedId} onSelect={onSelect} /> : null;

  return (
    <div className={`flex min-h-0 flex-col xl:flex-row ${className}`}>
      <section aria-label="Globe of the Moon" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-rule px-4 py-2.5">
          <h2 className="text-[1.068rem] leading-snug font-semibold text-ink">The Moon{frame ? `, ${fmtUtc(frame.ms)}` : ""}</h2>
          <div className="flex flex-wrap gap-2.5">
            <div role="group" aria-label="View from" className="flex border border-ink">
              {(
                [
                  ["pole", "South pole"],
                  ["near", "Near side"],
                  ["sun", "Sun side"],
                ] as const
              ).map(([id, text], i) => {
                const on = framing.id === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    disabled={!frame}
                    onClick={() => frameTo(id)}
                    className={`h-8 px-3 text-[0.8rem] whitespace-nowrap transition-colors duration-150 focus-visible:outline-offset-2 ${i ? "border-l border-ink" : ""} ${
                      on ? "bg-ink font-semibold text-paper" : "font-medium text-ink hover:bg-paper-3"
                    }`}
                  >
                    {text}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-pressed={showLandings}
              onClick={() => setShowLandings((v) => !v)}
              className={`${BUTTON} ${showLandings ? "bg-paper-3 font-semibold text-ink" : "font-medium text-ink hover:bg-paper-3"}`}
            >
              Earlier landings
            </button>
            <button type="button" onClick={onOpenSite} className={`${BUTTON} bg-ink font-semibold text-paper hover:bg-ink-2`}>
              Open site level
            </button>
          </div>
        </header>

        <div className="relative isolate min-h-[24rem] flex-1 overflow-hidden bg-paper">
          {load.status === "loading" && (
            <p role="status" className="absolute inset-0 grid place-items-center text-[0.844rem] text-ink-2">
              Loading the Moon globe and the 2027 ephemeris
            </p>
          )}
          {load.status === "error" && (
            <div role="alert" className="absolute inset-0 grid place-items-center px-6">
              <div className="max-w-[44ch] border border-ink p-4">
                <p className="text-[0.95rem] font-semibold text-ink">The Moon globe did not load.</p>
                <p className="mt-1 text-[0.844rem] text-ink-2">{load.message} Check the connection, then try again.</p>
                <button
                  type="button"
                  onClick={() => {
                    setLoad({ status: "loading" });
                    setAttempt((n) => n + 1);
                  }}
                  className={`mt-3 ${BUTTON} font-semibold text-ink hover:bg-paper-3`}
                >
                  Try again
                </button>
              </div>
            </div>
          )}
          {frame && !gl && fallback}
          {frame && textures && gl && (
            <GlBoundary fallback={fallback}>
              <Canvas
                flat
                frameloop="demand"
                dpr={[1, 2]}
                camera={{ fov: 30, position: [POLE_DIR[0] * 5.2, POLE_DIR[1] * 5.2, POLE_DIR[2] * 5.2], near: 0.1, far: 40 }}
                gl={{ antialias: true }}
                aria-label="Globe of the Moon lit by the Sun. Drag to turn, scroll to zoom."
                role="img"
              >
                <Scene textures={textures} frame={frame} framing={framing} labelPoints={labelPoints} overlay={overlay} />
              </Canvas>
              <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden">
                {labels.map((l) => (
                  <div key={l.key} className="invisible absolute top-0 left-0">
                    {l.node}
                  </div>
                ))}
              </div>
            </GlBoundary>
          )}
        </div>

        <p className="border-t border-rule px-4 py-2 text-[0.8rem] leading-snug text-ink-2">
          Drag to turn the globe, scroll to zoom. The terminator and the Moon&apos;s orientation are computed for the
          time shown; relief shading is exaggerated and no cast shadows are drawn, so use the site level for terrain
          shadow.
        </p>

        {span && onScrub && (
          <YearSlider
            startMs={span.startMs}
            endMs={span.endMs}
            ms={ms}
            windowMs={windowMs}
            playing={playing}
            onPlay={() => setPlaying((p) => !p)}
            onScrub={(t) => {
              setPlaying(false);
              onScrub(t);
            }}
          />
        )}
      </section>

      <aside className="shrink-0 border-t border-ink px-4 py-4 xl:w-[21.5rem] xl:overflow-y-auto xl:border-t-0 xl:border-l">
        {frame && state ? (
          <Readout frame={frame} state={state} site={site} />
        ) : (
          <p className="text-[0.844rem] text-ink-2">{load.status === "error" ? "No values to show." : "Loading values"}</p>
        )}

        <h3 className={`mt-6 ${H3}`}>Regions</h3>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {sites.map((s) => {
            const on = s.id === selectedId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(s.id)}
                  className={`h-7 border border-ink px-2 text-[0.8rem] whitespace-nowrap transition-colors duration-150 ${
                    on ? "bg-ink font-semibold text-paper" : "font-medium text-ink hover:bg-paper-3"
                  }`}
                >
                  {s.name}
                </button>
              </li>
            );
          })}
        </ul>

        <h3 className={`mt-6 ${H3}`}>Marks</h3>
        <div className="mt-1.5">
          <Legend showLandings={showLandings} />
        </div>
        {showLandings && (
          <table className="mt-2 w-full border-collapse text-[0.8rem]">
            <caption className="sr-only">Earlier landings shown on the globe</caption>
            <tbody>
              {LANDINGS.map((l) => (
                <tr key={l.id} className="border-b border-rule">
                  <th scope="row" className="w-11 py-1 text-left text-[0.69rem] font-semibold tracking-[0.1em] text-ink uppercase">
                    {l.short}
                  </th>
                  <td className="py-1 text-ink-2">
                    {l.name}, {l.year}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap text-ink-2">
                    {fmtLat(l.lat, 1)}, {fmtLon(l.lon, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="mt-6 border-t border-rule pt-3 text-[0.8rem] leading-snug text-ink-2">
          Orientation: IAU/WGCCRE rotation model for the Moon, with Earth and Moon positions from NASA/JPL Horizons.
          Surface: NASA SVS CGI Moon Kit colour and elevation maps from Lunar Reconnaissance Orbiter data, printed in
          grey. Landing coordinates: NASA NSSDCA and mission pages.
        </p>
      </aside>
    </div>
  );
}

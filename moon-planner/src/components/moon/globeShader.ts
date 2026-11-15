// The Moon globe's shader, shared by the whole-globe mesh and the detail tiles
// drawn over it, so both print the same greys, Sun shading and map lines.

import { MOON_RADIUS_KM } from "@/lib/system";

/** Half-width of the site-level terrain plate, km on the polar stereographic plane; its inscribed circle is 80° S. */
export const PLATE_HALF_KM = 304;

// How scripts/build-moon-textures.py packs elevation into the two 8-bit maps, in km.
const BASE_RANGE_KM = 20.5;
const DETAIL_RANGE_KM = 3;

export const GLOBE_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vP;
  varying vec3 vViewN;
  varying vec3 vViewP;
  void main() {
    vUv = uv;
    vP = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewN = normalMatrix * normal;
    vViewP = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
// Grey relief print. Albedo sets the tone from mare grey to highland paper;
// slopes from the elevation maps are shaded by the real Sun, strongest near
// the terminator as on the Moon itself; past a thin penumbra band the night
// side is umbra slate with faint relief. Every map line is drawn here, one
// pixel wide at any zoom, so none can z-fight or show through the limb: the
// 30-degree graticule (light), the equator and prime meridian (full ink), the
// terminator (dashed), and the site-level plate with its 80 S circle (cased).
const fragment = (tile: boolean) => /* glsl */ `
  ${tile ? "#define TILE" : ""}
  #ifdef TILE
    uniform sampler2D uTile;
    uniform vec2 uTileTone;
    uniform float uSplit;
    #define RELIEF(t, uv) textureLod(t, uv, 0.0)
  #else
    #define RELIEF(t, uv) texture2D(t, uv)
  #endif
  uniform sampler2D uMap;
  uniform sampler2D uHeight;
  uniform sampler2D uDetail;
  uniform float uHasDetail;
  uniform vec2 uBaseTexel;
  uniform vec2 uDetailTexel;
  uniform float uRelief;
  uniform float uPx;
  uniform float uLines;
  uniform float uDash;
  uniform vec3 uSunDir;
  uniform vec3 uDayLo;
  uniform vec3 uDayHi;
  uniform vec3 uNightLo;
  uniform vec3 uNightHi;
  uniform vec3 uInk;
  uniform vec3 uPaper;
  varying vec2 vUv;
  varying vec3 vP;
  varying vec3 vViewN;
  varying vec3 vViewP;

  const float PI = 3.14159265;
  const float R_KM = ${MOON_RADIUS_KM.toFixed(1)};

  // Rise over run towards the east and the north. The east step widens with latitude so it spans the same ground everywhere.
  vec2 slopeOf(sampler2D t, vec2 uv, vec2 texel, float rangeKm, float cl) {
    float du = min(texel.x / cl, 0.02);
    float dv = texel.y;
    float hE = RELIEF(t, uv + vec2(du, 0.0)).r - RELIEF(t, uv - vec2(du, 0.0)).r;
    float hN = RELIEF(t, uv + vec2(0.0, dv)).r - RELIEF(t, uv - vec2(0.0, dv)).r;
    return rangeKm * vec2(hE / (4.0 * PI * du * cl * R_KM), hN / (2.0 * PI * dv * R_KM));
  }

  // Coverage of a line whose centre is d away, where w is the change of d across one device pixel; hw is the half-width in CSS pixels.
  float stroke(float d, float w, float hw) {
    return 1.0 - smoothstep(hw - 0.5, hw + 0.5, d / max(w * uPx, 1e-7));
  }

  void main() {
    vec3 n = normalize(vP);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(-n.z, n.x);
    float cl = max(cos(lat), 0.04);
    vec3 east = vec3(-sin(lon), 0.0, -cos(lon));
    vec3 north = cross(n, east);
    #ifdef TILE
      // A tile carries its own 0..1 coordinates, so the whole-globe relief maps are looked up by latitude and longitude.
      if (n.y > uSplit) discard;
      vec2 guv = vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
    #else
      vec2 guv = vUv;
    #endif
    vec2 s = slopeOf(uHeight, guv, uBaseTexel, ${BASE_RANGE_KM.toFixed(1)}, cl);
    if (uHasDetail > 0.5) s += slopeOf(uDetail, guv, uDetailTexel, ${DETAIL_RANGE_KM.toFixed(1)}, cl);
    vec3 bn = normalize(n - uRelief * (s.x * east + s.y * north));

    float geo = dot(n, uSunDir);
    float ndl = dot(bn, uSunDir);
    float lit = smoothstep(-0.006, 0.018, geo);
    // Brightness of a slope relative to level ground under the same Sun.
    float relief = clamp((ndl - geo) / (max(geo, 0.0) + 0.22), -1.0, 1.0);
    float fall = mix(0.72, 1.0, sqrt(clamp(geo, 0.0, 1.0)));
    float v = fall * (1.0 + 0.62 * relief);

    #ifdef TILE
      // The Moon Trek mosaic is printed darker than the whole-globe map; the gain and offset bring it to the same greys.
      float tone = sqrt(dot(texture2D(uTile, vUv).rgb, vec3(0.2126, 0.7152, 0.0722))) * uTileTone.x + uTileTone.y;
    #else
      float tone = sqrt(dot(texture2D(uMap, vUv).rgb, vec3(0.2126, 0.7152, 0.0722)));
    #endif
    tone = smoothstep(0.17, 0.8, tone);
    vec3 night = mix(uNightLo, uNightHi, tone) * (1.0 + 0.26 * clamp((ndl - geo) * 2.5, -1.0, 1.0));
    vec3 day = mix(night, mix(uDayLo, uDayHi, tone), clamp(v, 0.0, 1.0)) * (1.0 + 0.3 * max(v - 1.0, 0.0));
    vec3 col = mix(night, day, lit);

    // Slight limb darkening, so the globe keeps its edge against the paper.
    float ndv = dot(normalize(vViewN), normalize(-vViewP));
    col *= mix(0.86, 1.0, smoothstep(0.0, 0.5, ndv));

    vec3 lineCol = mix(uPaper, uInk, lit);
    float latDeg = degrees(lat);
    float lonDeg = degrees(lon);
    float g = stroke(abs(fract(latDeg / 30.0 + 0.5) - 0.5) * 30.0, fwidth(latDeg), 0.5) * step(abs(latDeg), 75.0);
    g = max(g, stroke(abs(fract(lonDeg / 30.0 + 0.5) - 0.5) * 30.0, fwidth(lonDeg), 0.5) * (1.0 - smoothstep(80.0, 84.0, abs(latDeg))));
    col = mix(col, lineCol, g * 0.3 * uLines);

    float major = max(stroke(abs(n.y), fwidth(n.y), 0.6), stroke(abs(n.z), fwidth(n.z), 0.6) * step(0.0, n.x));
    col = mix(col, lineCol, major * mix(0.4, 0.92, lit) * uLines);

    // The terminator, dashed every 2.5 degrees around the Sun's axis.
    vec3 tu = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
    vec3 tv = cross(uSunDir, tu);
    float dash = step(fract(atan(dot(n, tv), dot(n, tu)) * 72.0 / PI), 0.62);
    col = mix(col, uInk, stroke(abs(geo), fwidth(geo), 0.6) * dash * 0.92 * uDash);

    // The site-level plate (a square on the south polar stereographic plane) and the 80 S circle inscribed in it.
    if (n.y < -0.9) {
      float c80 = abs(n.y + ${Math.sin(80 * (Math.PI / 180)).toFixed(6)});
      vec2 st = 2.0 * R_KM * vec2(-n.z, n.x) / (1.0 - n.y);
      float sq = abs(max(abs(st.x), abs(st.y)) - ${PLATE_HALF_KM.toFixed(1)});
      float wc = fwidth(n.y);
      float ws = fwidth(max(abs(st.x), abs(st.y)));
      col = mix(col, uPaper, max(stroke(c80, wc, 1.9), stroke(sq, ws, 1.9)) * 0.9 * uLines);
      col = mix(col, uInk, max(stroke(c80, wc, 0.6), stroke(sq, ws, 0.6)) * uLines);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** The whole-globe shader, and the same print for one detail tile: its own image for the tone, everything else shared. */
export const globeFragment = (kind: "base" | "tile") => fragment(kind === "tile");

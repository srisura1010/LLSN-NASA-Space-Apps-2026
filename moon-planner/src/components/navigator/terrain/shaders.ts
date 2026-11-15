// GLSL for the terrain plate. Written against three's WebGL2 prefix
// (GLSL ES 3.00 with the gl_FragColor and varying compatibility defines).
//
// The light pass traces shadows once per Sun position into a map-space
// texture at the DEM's own resolution: for each 640 m pixel it marches the
// true-scale heightmap toward the Sun, with lunar curvature, and stores the
// visible fraction of the solar disc. The surface pass reads that texture,
// so orbiting the camera costs no tracing.

export type ShaderDefines = {
  half: number; // m
  pixel: number; // m
  /** Highest terrain on the plate, m. Default 7100 (the south polar plate). */
  hMax?: number;
  /**
   * A plate around any point: azimuthal equidistant, x east and y north of
   * the centre. lonStep is the meridian spacing of its graticule, degrees.
   */
  local?: { lat0: number; lon0: number; lonStep: number };
  /** Shadow march: sample count and growth of the step with distance. Default 128 and 0.045 (the south polar plate). */
  march?: { steps: number; growth: number };
  /** First openness sample, in pixels. Default 1. */
  openStart?: number;
};

const polarSky = /* glsl */ `
// A body's unit vector s (plate frame) seen from map point p: xy is the
// horizontal direction in map x/y, z is the sine of its elevation. Same
// frame as localFrameAt() in geo.ts.
vec3 localSky(vec2 p, vec3 s) {
  float r = length(p);
  float c = 2.0 * atan(r / (2.0 * R_MOON));
  float sl = r > 1.0 ? p.x / r : 0.0;
  float cl = r > 1.0 ? p.y / r : 1.0;
  float sc = sin(c);
  float cc = cos(c);
  vec3 E = vec3(cl, -sl, 0.0);
  vec3 N = vec3(cc * sl, cc * cl, -sc);
  vec3 U = vec3(sc * sl, sc * cl, cc);
  return vec3(dot(s, E) * vec2(cl, -sl) + dot(s, N) * vec2(sl, cl), dot(s, U));
}
`;

// Local plate: the frame at p is the centre's frame turned by the arc r / R
// about the horizontal axis across p, and bearings from the centre are true.
const localSkyLocal = /* glsl */ `
vec3 localSky(vec2 p, vec3 s) {
  float r = length(p);
  vec2 rad = r > 1.0 ? p / r : vec2(0.0, 1.0);
  vec2 tg = vec2(-rad.y, rad.x);
  float c = r / R_MOON;
  float sr = dot(s.xy, rad);
  float st = dot(s.xy, tg);
  return vec3((sr * cos(c) - s.z * sin(c)) * rad + st * tg, sr * sin(c) + s.z * cos(c));
}
`;

const common = ({ half, pixel, hMax, local }: ShaderDefines) => /* glsl */ `
#define R_MOON 1737400.0
#define HALF ${half.toFixed(1)}
#define PX ${pixel.toFixed(1)}
#define SUN_R 0.0046513
#define H_MAX ${(hMax ?? 7100).toFixed(1)}

uniform sampler2D uHeight;

vec2 mapUv(vec2 p) {
  return vec2((p.x + HALF) / (2.0 * HALF), (HALF - p.y) / (2.0 * HALF));
}

float heightAt(vec2 p) {
  vec2 t = texture(uHeight, mapUv(p)).rg;
  return t.r + t.g;
}

${local ? localSkyLocal : polarSky}
`;

export const lightVertex = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const lightFragment = (d: ShaderDefines) => /* glsl */ `
${common(d)}
#define STEPS ${d.march?.steps ?? 128}
#define GROWTH ${(d.march?.growth ?? 0.045).toFixed(4)}

uniform vec3 uSun;

void main() {
  vec2 p = vec2(-HALF + gl_FragCoord.x * PX, HALF - gl_FragCoord.y * PX);
  vec3 L = localSky(p, uSun);
  float el = asin(clamp(L.z, -1.0, 1.0));
  if (el < -SUN_R) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 dir = length(L.xy) > 1e-6 ? normalize(L.xy) : vec2(0.0, 1.0);
  float h0 = heightAt(p) + 1.0;
  float tanLo = tan(el - SUN_R);
  float tanHi = tan(el + SUN_R);
  float inv2R = 0.5 / R_MOON;
  float best = -1.0e4;
  float d = 0.5 * PX;
  for (int i = 0; i < STEPS; i++) {
    vec2 q = p + dir * d;
    if (max(abs(q.x), abs(q.y)) > HALF - 0.5 * PX) break;
    // Tangent of the terrain's elevation angle, with the sphere falling away.
    float t = (heightAt(q) - h0) / d - d * inv2R;
    best = max(best, t);
    if (best >= tanHi) break;
    // Nothing further out can rise above what is already known.
    if ((H_MAX - h0) / d - d * inv2R < max(best, tanLo)) break;
    d += max(0.5 * PX, d * GROWTH);
  }
  // Visible share of the solar disc, as sampleAt() computes it in sky.ts.
  float frac = clamp((el - atan(best) + SUN_R) / (2.0 * SUN_R), 0.0, 1.0);
  gl_FragColor = vec4(frac, 0.0, 0.0, 1.0);
}
`;

// Openness (sky-view factor) at half resolution, once per plate: the mean
// of 1 - sin(horizon angle) over eight directions out to 18 km. Crater
// floors come out low, ridges high; it shades relief inside shadows.
export const opennessFragment = (d: ShaderDefines) => /* glsl */ `
${common(d)}
#define DIRS 8
#define STEPS 10

void main() {
  vec2 p = vec2(-HALF + gl_FragCoord.x * 2.0 * PX, HALF - gl_FragCoord.y * 2.0 * PX);
  float h0 = heightAt(p);
  float sum = 0.0;
  for (int k = 0; k < DIRS; k++) {
    float a = (float(k) + 0.5) * 6.2831853 / float(DIRS);
    vec2 dir = vec2(cos(a), sin(a));
    float best = 0.0;
    float d = ${(d.openStart ?? 1).toFixed(2)} * PX;
    for (int i = 0; i < STEPS; i++) {
      best = max(best, (heightAt(p + dir * d) - h0) / d);
      d *= 1.45;
    }
    sum += best / sqrt(1.0 + best * best);
  }
  gl_FragColor = vec4(1.0 - sum / float(DIRS), 0.0, 0.0, 1.0);
}
`;

export const surfaceVertex = /* glsl */ `
varying vec2 vMap;
varying vec3 vWorld;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vMap = vec2(position.x, -position.z) * 1000.0;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** Local plates carry each vertex's latitude and longitude offset from the centre (degrees) for the graticule. */
export const surfaceVertexLocal = /* glsl */ `
attribute vec2 geo;
varying vec2 vMap;
varying vec3 vWorld;
varying vec2 vGeo;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vMap = vec2(position.x, -position.z) * 1000.0;
  vGeo = geo;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const REGION_COUNT = 9;

const polarGraticule = /* glsl */ `
  // Graticule: 1 degree of latitude, 30 degrees of longitude.
  float r = length(p);
  float colat = degrees(2.0 * atan(r / (2.0 * R_MOON)));
  float ringPx = abs(colat - floor(colat + 0.5)) / (max(fwidth(colat), 1e-7) * uDpr);
  float ring = lineMask(ringPx, 0.5) * step(0.5, colat);
  float lon = r > 1.0 ? degrees(atan(p.x, p.y)) : 0.0;
  float mer = floor(lon / 30.0 + 0.5) * 30.0;
  vec2 md = vec2(sin(radians(mer)), cos(radians(mer)));
  vec2 mn = vec2(md.y, -md.x);
  float merA = lineMask(abs(dot(p, mn)) * pxPerM(mn, dx, dy), 0.5) * step(0.0, dot(p, md)) * smoothstep(15000.0, 35000.0, r);
  col = mix(col, line, mix(0.22, 0.13, lit) * max(ring, merA) * uGrat);
`;

// Whole degrees of latitude and every lonStep degrees of longitude, from the
// per-vertex offsets (small numbers, so the lines stay sharp close in).
const localGraticule = (l: { lat0: number; lon0: number; lonStep: number }) => {
  const frac = (v: number, step: number) => (v / step - Math.round(v / step)).toFixed(7);
  return /* glsl */ `
  float gLat = vGeo.x + (${frac(l.lat0, 1)});
  float ring = lineMask(abs(gLat - floor(gLat + 0.5)) / (max(fwidth(vGeo.x), 1e-9) * uDpr), 0.5);
  float gLon = vGeo.y / ${l.lonStep.toFixed(1)} + (${frac(l.lon0, l.lonStep)});
  float gw = fwidth(vGeo.y) / ${l.lonStep.toFixed(1)};
  float merA = lineMask(abs(gLon - floor(gLon + 0.5)) / (max(gw, 1e-9) * uDpr), 0.5) * (1.0 - step(0.25, gw));
  col = mix(col, line, mix(0.22, 0.13, lit) * max(ring, merA) * uGrat);

`;
};

export const surfaceFragment = (d: ShaderDefines) => /* glsl */ `
${common(d)}
#define REGIONS ${REGION_COUNT}
#define RIBBON 3.0

uniform sampler2D uLight;
uniform sampler2D uOpen;
uniform float uHasSun;
uniform vec3 uSun;
uniform float uExag;
uniform float uDpr;
/** 1 draws the graticule, 0 hides it (the Layers popover). */
uniform float uGrat;

uniform vec3 uLitLo;
uniform vec3 uLitHi;
uniform vec3 uShLo;
uniform vec3 uShHi;
uniform vec3 uNeuLo;
uniform vec3 uNeuHi;
uniform vec3 uSunCol;
uniform vec3 uEarthCol;
uniform vec3 uInk;
uniform vec3 uPaper;

uniform vec4 uEdges[REGIONS * 4];
uniform vec4 uTint[REGIONS];
uniform float uSelected;
uniform float uHovered;

uniform vec2 uSite;
uniform float uHasSite;
uniform vec2 uSunBear;
uniform float uShowSunBear;
uniform vec2 uEarthBear;
uniform float uShowEarthBear;

uniform vec3 uFade;

varying vec2 vMap;
varying vec3 vWorld;
${d.local ? "varying vec2 vGeo;" : ""}

float lineMask(float distPx, float halfWidth) {
  return 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, distPx);
}

// CSS pixels per metre across the map-plane direction n.
float pxPerM(vec2 n, vec2 dx, vec2 dy) {
  return 1.0 / (max(length(vec2(dot(dx, n), dot(dy, n))), 1e-4) * uDpr);
}

void bearing(inout vec3 col, vec2 rel, vec2 dir, vec3 casing, vec3 core, vec2 dx, vec2 dy) {
  float along = dot(rel, dir);
  vec2 nb = vec2(dir.y, -dir.x);
  float px = abs(dot(rel, nb)) * pxPerM(nb, dx, dy);
  float on = smoothstep(600.0, 1200.0, along) * (1.0 - smoothstep(90000.0, 220000.0, along));
  float dash = step(fract(along / 2400.0), 0.62);
  float a = on * dash;
  col = mix(col, casing, a * lineMask(px, 1.75));
  col = mix(col, core, a * lineMask(px, 0.9));
}

void main() {
  vec2 p = vMap;
  vec2 dx = dFdx(p);
  vec2 dy = dFdy(p);
  vec2 uv = mapUv(p);

  float hE = heightAt(p + vec2(PX, 0.0));
  float hW = heightAt(p - vec2(PX, 0.0));
  float hN = heightAt(p + vec2(0.0, PX));
  float hS = heightAt(p - vec2(0.0, PX));
  vec2 grad = vec2(hE - hW, hN - hS) / (2.0 * PX);
  vec3 nTrue = normalize(vec3(-grad, 1.0));
  vec3 nShow = normalize(vec3(-grad * uExag, 1.0));

  // Openness darkens hollows a little; less in shadow, which stays one fill.
  float open = smoothstep(0.55, 0.97, texture(uOpen, uv).r);

  vec3 col;
  // 1 on sunlit ground, 0 in shadow; linework picks ink or paper from it.
  float lit = 1.0;
  if (uHasSun > 0.5) {
    vec3 L = localSky(p, uSun);
    vec2 h = length(L.xy) > 1e-6 ? normalize(L.xy) : vec2(0.0, 1.0);
    // Form light: the Sun's azimuth raised to 30 degrees, for relief only.
    float form = clamp(dot(nShow, normalize(vec3(h * 0.866, 0.5))), 0.0, 1.0);
    // True incidence on the true-scale slope; below the disc edge it is self-shadow.
    float inc = dot(nTrue, L);
    float facing = clamp((inc + SUN_R) / (2.0 * SUN_R), 0.0, 1.0);
    // Cast shadow as a solid fill: a hard edge where half the Sun's disc is
    // hidden, anti-aliased over about one screen pixel.
    float light = texture(uLight, uv).r * facing;
    float aa = clamp(fwidth(light), 0.02, 0.45);
    lit = smoothstep(0.5 - aa, 0.5 + aa, light);
    // Sunlit ground: the paper ramp, by the (exaggerated) slope's incidence on the low Sun, eased with the form light.
    float shade = 0.65 * smoothstep(0.0, 0.45, dot(nShow, L)) + 0.35 * form;
    vec3 litCol = mix(uLitLo, uLitHi, shade) * mix(0.96, 1.0, open);
    vec3 shCol = mix(uShLo, uShHi, form * form) * mix(0.96, 1.0, open);
    col = mix(shCol, litCol, lit);
  } else {
    float form = clamp(dot(nShow, normalize(vec3(-0.5, 0.5, 0.7071))), 0.0, 1.0);
    col = mix(uNeuLo, uNeuHi, form) * mix(0.8, 1.03, open);
  }
  vec3 line = mix(uPaper, uInk, lit);

${d.local ? localGraticule(d.local) : polarGraticule}
  // Region outlines, with a tinted ribbon inside when scores are given.
  for (int i = 0; i < REGIONS; i++) {
    float sd = -1.0e9;
    vec2 nAct = vec2(1.0, 0.0);
    for (int j = 0; j < 4; j++) {
      vec4 ed = uEdges[i * 4 + j];
      float s = dot(p - ed.xy, ed.zw);
      if (s > sd) {
        sd = s;
        nAct = ed.zw;
      }
    }
    float px = sd * pxPerM(nAct, dx, dy);
    float fi = float(i);
    float sel = 1.0 - step(0.5, abs(fi - uSelected));
    float hov = 1.0 - step(0.5, abs(fi - uHovered));
    float rib = RIBBON + 1.5 * sel;
    float band = (1.0 - smoothstep(-0.5, 0.5, px)) * smoothstep(-rib - 0.5, -rib + 0.5, px);
    col = mix(col, uTint[i].rgb, uTint[i].a * band);
    float hair = mix(0.5, 1.0, hov);
    // The selected region: a 2.5 px ink rule with a paper casing outside, legible on light and on shadow.
    col = mix(col, uPaper, sel * step(0.0, px) * lineMask(px, 3.0));
    col = mix(col, sel > 0.5 ? uInk : line, lineMask(abs(px), mix(hair, 1.25, sel)));
  }

  // Bearings from the selected site toward the Sun and Earth.
  if (uHasSite > 0.5) {
    vec2 rel = p - uSite;
    if (uShowEarthBear > 0.5) bearing(col, rel, uEarthBear, uPaper, uEarthCol, dx, dy);
    if (uShowSunBear > 0.5) bearing(col, rel, uSunBear, uInk, uSunCol, dx, dy);
  }

  // Distant relief settles into the paper.
  float vd = distance(cameraPosition, vWorld);
  col = mix(col, uPaper, uFade.z * smoothstep(uFade.x, uFade.y, vd));

  gl_FragColor = vec4(col, 1.0);
}
`;

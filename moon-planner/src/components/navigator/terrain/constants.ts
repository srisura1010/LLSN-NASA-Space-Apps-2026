// Shared constants for the terrain plate.

/** Vertical exaggeration of the displayed relief. Shadows are traced at true scale. */
export const EXAGGERATION = 3.5;

/** Scene units are kilometres; map metres divide by this. */
export const M_PER_UNIT = 1000;

/** Apparent solar radius (rad), matching SUN_RADIUS_DEG in src/lib/sky.ts. */
export const SUN_RADIUS_RAD = (0.2665 * Math.PI) / 180;

/** Colours from the bulletin tokens in src/app/globals.css, as sRGB hex. */
export const TOKENS = {
  paper: "#eef1f0",
  paper2: "#e3e8e7",
  paper3: "#d6dddc",
  ink: "#121a22",
  ink2: "#3a4752",
  ink3: "#5d6a74",
  rule: "#b9c3c2",
  umbra: "#3d5466",
  umbraSoft: "#c3ced3",
  sun: "#f0b400",
  sunInk: "#7a5600",
  earth: "#2453c2",
  earthSoft: "#c9d5f1",
  limit: "#c42b1c",
} as const;

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const h = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Linear mix in sRGB space, as CSS color-mix(in srgb) does. */
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const T = {
  paper: hexToRgb(TOKENS.paper),
  paper3: hexToRgb(TOKENS.paper3),
  ink: hexToRgb(TOKENS.ink),
  umbra: hexToRgb(TOKENS.umbra),
  umbraSoft: hexToRgb(TOKENS.umbraSoft),
  sun: hexToRgb(TOKENS.sun),
};

/**
 * Relief tones, derived from the tokens. Sunlit ground is the bulletin's
 * paper ramp (paper-3 to paper, no sun tint: cadmium marks only the Sun's
 * path and the score fill). Shadow is umbra slate, near flat so it reads as
 * one solid fill, with a whisper of relief. Linework over shadow switches
 * from ink to paper in the shader, so outlines keep their contrast there.
 */
export const RELIEF = {
  litLo: T.paper3,
  litHi: T.paper,
  shadowLo: mixRgb(T.umbra, T.ink, 0.08),
  shadowHi: mixRgb(T.umbra, T.umbraSoft, 0.1),
  neutralLo: mixRgb(T.paper3, T.umbraSoft, 0.55),
  neutralHi: T.paper,
};

/** Region score tint on the umbra (0) to sun (1) scale. */
export function scoreTint(v: number): RGB {
  return mixRgb(T.umbra, T.sun, Math.min(1, Math.max(0, v)));
}

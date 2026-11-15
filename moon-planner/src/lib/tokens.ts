// The one source for the bulletin's colours. The root layout writes TOKENS
// into CSS custom properties (tokenCss), which globals.css maps onto the
// Tailwind colour names (bg-paper, text-ink, ...). Shaders, canvases and SVG
// drawn from code import the same values from here.

export const TOKENS = {
  paper: "#eef1f0",
  paper2: "#e3e8e7", // rails, toolbars
  paper3: "#d6dddc", // pressed, selected rows
  ink: "#121a22",
  ink2: "#3a4752", // secondary text, >= 4.5:1 on paper
  ink3: "#5d6a74", // tertiary, large text only
  rule: "#b9c3c2", // 1px hairlines
  umbra: "#3d5466",
  umbraSoft: "#c3ced3",
  sun: "#f0b400",
  sunInk: "#7a5600", // sun-coloured text on paper
  earth: "#2453c2",
  earthSoft: "#c9d5f1",
  limit: "#c42b1c",
} as const;

export type TokenName = keyof typeof TOKENS;

/** CSS custom property name for a token: paper2 -> --paper-2, umbraSoft -> --umbra-soft. */
export function tokenVar(name: TokenName): string {
  return `--${name.replace(/([a-z])([A-Z0-9])/g, "$1-$2").replace(/([a-z])(\d)/g, "$1-$2").toLowerCase()}`;
}

/** `:root { --paper: …; … }`, written into the page by the root layout. */
export const tokenCss = `:root{${(Object.keys(TOKENS) as TokenName[]).map((k) => `${tokenVar(k)}:${TOKENS[k]}`).join(";")}}`;

/**
 * Shades used only by the 3D materials and drawn charts, each a print colour
 * mixed for one surface. Kept here so no view carries its own hex values.
 */
export const RENDER = {
  /** Lit lunar surface in the flat fallback charts and the phase disc. */
  moonLit: "#dfe4e3",
  /** The Moon's lit limb in the System diagram. */
  moonLimb: "#c4cacb",
  /** Moon globe relief ramp, day and night. */
  moonDayLo: "#5b676d",
  moonDayHi: "#f4f5f3",
  moonNightLo: "#2e4455",
  moonNightHi: "#496174",
  /** Earth globe: sea by day and night, land relief, land by night. */
  earthSea: TOKENS.earth,
  earthNight: "#273a52",
  earthLandLo: "#8d9897",
  earthLandHi: "#f1f3f1",
  earthLandNight: TOKENS.umbra,
} as const;

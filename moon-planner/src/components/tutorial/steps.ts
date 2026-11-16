// The guided tour of /tool: one step per part of the interface, in the order a
// newcomer meets them. Each step names its targets by their `data-tour`
// attribute and can prepare the app (mode, level, rails, panels) before it
// shows, through the controls NavigatorApp hands the tour.

import type { View } from "@/state/url";

/** What a step may change before it shows. Every step sets what it needs, so Back works from any step. */
export type TourControls = {
  setView: (v: View) => void;
  /** Open (true) or collapse (false) the Regions and Bulletin rails (from xl). */
  setRails: (left: boolean, right: boolean) => void;
  /** Open or close the horizon panel in the dock (from xl). */
  setHorizon: (open: boolean) => void;
  /** Below xl: which stacked panel shows under the viewer. */
  setPanel: (tab: "ranking" | "details" | "horizon") => void;
  setWindowOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
};

export type TourStep = {
  id: string;
  title: string;
  body: string;
  /** A short thing to try; the target then takes clicks while the step shows. */
  tryIt?: string;
  /**
   * Targets, each a `data-tour` id or alternatives "a|b" (the first one on screen wins).
   * None: a centred card.
   */
  targets?: string[];
  prepare?: (c: TourControls, wide: boolean) => void;
  /** Label of the Next button on this step. */
  next?: string;
};

const plan = (c: TourControls) => {
  c.setView("navigator");
  c.setWindowOpen(false);
  c.setAboutOpen(false);
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Plan a landing at the Moon's south pole",
    body: "Pick a landing region and dates. The Navigator shows when the Sun is up, for solar power, and when Earth is in view, for radio contact, then ranks the regions for you.",
    prepare: (c) => plan(c),
    next: "Show me",
  },
  {
    id: "viewer",
    title: "The 3D view",
    body: "Real Moon terrain, measured by NASA's LOLA laser altimeter. The shadows are traced from where the Sun really is at the time shown.",
    tryIt: "Drag to turn the view, scroll to zoom.",
    targets: ["viewer"],
    prepare: (c) => {
      plan(c);
      c.setRails(true, true);
    },
  },
  {
    id: "regions",
    title: "The regions, ranked",
    body: "The nine regions NASA named for Artemis III in 2024, ranked for your dates. A higher score means more sunlight, more Earth contact and shorter dark spells.",
    tryIt: "Click a region to open it.",
    targets: ["regions"],
    prepare: (c) => {
      plan(c);
      c.setRails(true, true);
      c.setPanel("ranking");
    },
  },
  {
    id: "window",
    title: "Your mission window",
    body: "When you land and how long you stay. The slip buttons, such as +1 week, show what a delay would cost at this site.",
    targets: ["window", "window-panel"],
    prepare: (c, wide) => {
      plan(c);
      // On phones the panel would fill the screen, so the chip alone is shown.
      if (wide) c.setWindowOpen(true);
    },
  },
  {
    id: "verdict",
    title: "The verdict",
    body: "The answer in one sentence, then why this region ranks where it does: Sun power, Earth in view and the longest dark spell, each as a bar.",
    targets: ["verdict"],
    prepare: (c) => {
      plan(c);
      c.setRails(true, true);
      c.setPanel("details");
    },
  },
  {
    id: "dock",
    title: "Time at the site",
    body: "Play runs the clock through your window, and the time rail lets you jump. On the rail, yellow marks sunlight at the site and blue marks Earth in view.",
    tryIt: "Press Play, or drag along the rail.",
    targets: ["dock"],
    prepare: (c) => plan(c),
  },
  {
    id: "horizon",
    title: "The horizon plot",
    body: "The grey shape is the real terrain horizon seen from the site. Yellow is the Sun's path and blue is Earth's, hour by hour. Where a path dips behind the grey, that body is hidden.",
    targets: ["horizon"],
    prepare: (c) => {
      plan(c);
      c.setHorizon(true);
      c.setPanel("horizon");
    },
  },
  {
    id: "levels",
    title: "Three levels",
    body: "Step between the whole Earth–Moon System, the Moon and this Site. You can also keep scrolling to zoom out, and in again.",
    targets: ["levels"],
    prepare: (c) => plan(c),
  },
  {
    id: "moon",
    title: "The Moon level",
    body: "The whole Moon at the time shown. Use Pick a point to read the Sun and Earth anywhere on it, then open that point as a site of its own.",
    targets: ["pick-point"],
    prepare: (c) => {
      c.setWindowOpen(false);
      c.setAboutOpen(false);
      c.setView("moon");
    },
  },
  {
    id: "launch",
    title: "Launch mode",
    body: "Work back from the landing: when to lift off from Earth, and from which launch site, to arrive at the start of your window.",
    targets: ["mode-launch|mode-menu"],
    prepare: (c) => {
      c.setWindowOpen(false);
      c.setAboutOpen(false);
      c.setView("launch");
    },
  },
  {
    id: "compare",
    title: "Compare, and About & data",
    body: "Compare puts regions side by side. The About & data button, the circled i, explains the method; its Checked against NASA section shows how these numbers match NASA's own maps.",
    targets: ["mode-compare|mode-menu", "about"],
    prepare: (c) => {
      c.setWindowOpen(false);
      c.setAboutOpen(false);
      c.setView("compare");
    },
    next: "Start planning",
  },
];

/** Where the tour leaves the app: Plan, Site level, both rails and the horizon panel open. */
export function finishState(c: TourControls) {
  c.setWindowOpen(false);
  c.setAboutOpen(false);
  c.setView("navigator");
  c.setRails(true, true);
  c.setHorizon(true);
  c.setPanel("ranking");
}

/** Kept once the tour is started, finished or the first-visit note is dismissed. */
export const TOUR_SEEN_KEY = "llsn.tour.seen.v1";

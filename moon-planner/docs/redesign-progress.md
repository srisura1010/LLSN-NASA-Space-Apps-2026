# /tool redesign: progress

This file and `docs/tool-ui-audit.md` are the starting point for the next session. Section numbers like §3.3 refer
to the audit. The audit still describes the layout and metrics, but not the Phase 1–2 shell and file moves listed
below. Status: **Phases 1 to 5 done.** Nothing is committed.

## Phase 1: foundation (done)

- **Store:** shared state lives in `src/state/plan.tsx` (zustand, one store per page, created from the URL).
  - Fields: view, startMs, durationHours, nowMs, systemMs, playing, selectedId, gap, change, custom and customReq,
    point, picked, launchSiteId, launchPick, transitDays, aboutOpen, urlEpoch.
  - In components, `usePlanField("x")` returns `[value, setter]` and `usePlan(selector)` reads a single value.
- **URL:** reading and writing are in `src/state/url.ts`. New parameters: `launch`, `liftoff`, `arrive`,
  `transit` and `about=1`. Incoming URLs are applied in a `useLayoutEffect` in `NavigatorApp`.
- **One stats source:** `missionScore(site, start, end, id?)` in `lib/sky.ts`, cached per site and window. It
  carries `parts` (the three weighted shares of the score) for the Phase 4 "Why" bars.
  - Used by `rankSites`, Compare, TimelineStrip, PointPanel, the HorizonPlot description and MissionControls.
  - `contactEvents` is cached the same way.
  - The Launch tab's search is memoised.
- **One up test:** `isUp(site, body, ms)` in `src/lib/contacts.ts`, which moved from `navigator/plot/contacts.ts`.
  `sampleAt` no longer has `earthUp`.
- **Formatters:** all of them live in `src/lib/format.ts`, and `pct()`'s "<1%"/">99%" rule now applies everywhere,
  including the score reasons and timeline captions. `plot/format.ts` is deleted. Mission constants are in
  `src/lib/mission.ts`, including `SLIP_STEPS` (as planned, +1 day, +1 week, +2 weeks).
- **UI primitives:** `src/components/ui/` has Button and ToggleButton (with a `soft` option), Segmented,
  SelectField, Panel, SectionLabel, Row (with a `dense` option), Stat, StateSwatch, icons, ErrorBoundary, Popover,
  Drawer, Toast and the shared class strings in `styles.ts`.
- **Colours:** `src/lib/tokens.ts` holds `TOKENS` (and `RENDER` for colours used only in 3D). The root layout
  writes them into `:root`, and `globals.css` maps them to Tailwind names. The shaders, MoonView and SystemView use
  the module.
- **WebGL check:** shared in `src/lib/webgl.ts`.
- **Bug fix:** `validateSitePoint()` in `lib/customSite.ts` is the one rule for opening any point on the Moon,
  except within 0.1° of either pole or off the edge of the polar LOLA grid. The custom-site form, the PointPanel
  "Open site level" button and Moon zoom-in all use it, and the form's help text matches it.

## Phase 2: shell and navigation (done)

- **App bar:** `src/components/shell/AppBar.tsx`, 56 px tall. It holds the name (linking home), the
  [Plan · Launch · Compare] modes, the window chip and an ⓘ button. It replaces the Navbar (which now hides on
  `/tool`), the masthead and the controls row.
- **Window chip:** opens a Popover with `MissionControls layout="stack"`. The search is labelled "Best start for
  <site> in", and the slip buttons are +1 day, +1 week and +2 weeks. The change note is now a Toast with Undo and
  Keep. The window appears only in the chip, and has been removed from the ranking, the bulletin, Compare, Launch
  and PointPanel.
- **About & data:** a Drawer, opened by `about=1` or `view=about`. The `#about-*` anchors and the
  `#about-check` link work.
- **Levels:** Moon and System are levels of the Plan mode, and the store's `view` field is navigator, moon or
  system for Plan. `LevelNav` is now a floating [System · Moon · Site] control at the top left of each viewer,
  with no Up/Down buttons. `ZoomHint` has a clickable "Open … →" button, and zooming past the limit still switches.
- **Phones:** below 768 px the app bar wraps, with the modes on a second row, and nothing overflows at 390 px.
- **Measured at 1440×900:** the Fig. 1 canvas is 720×405, up from 720×279.
- **Screenshots:** the scratchpad `redesign/` folder holds `0-before`, `1-phase1` and `2-phase2` sets.

## Unfinished or known issues

- The Fig. 1 caption still holds the legend, and Sun/Earth az/el still show on the plate and in Fig. 2. Both are
  Phase 3.
- Two Play buttons and two clocks remain (Phase 4). The Moon and System header buttons are still in their headers
  (Phase 4).
- The mobile layout is only kept from overflowing: the ranking still comes first, and the modes are not yet in a
  menu (Phase 5).
- Type sizes are still arbitrary rem values (Phase 5).
- A test created two Horizons cache files: `data/horizons-cache/*_-80.0010_45.0000_*.json`. Delete them before
  committing unless you want them.
- `npm install zustand` changed `package.json` and the lockfile.

## Files created

`src/state/plan.tsx`, `src/state/url.ts`, `src/lib/format.ts`, `src/lib/mission.ts`, `src/lib/tokens.ts`,
`src/lib/contacts.ts` (moved), `src/lib/webgl.ts`, `src/components/ui/*` (`index.ts`, `styles.ts`, `Button`,
`Segmented`, `SelectField`, `Panel`, `Row`, `StateSwatch`, `icons`, `ErrorBoundary`, `Popover`, `Drawer`, `Toast`),
`src/components/shell/AppBar.tsx`, `docs/redesign-progress.md`.

## Phase 3: layout (done)

- **Workspace:** at every Plan level (Site, Moon, System) the page is one shell: a left rail (300 px) with the
  ranking, the gap select and a "+ Custom site" expander; the centre viewer (`data-viewer`); a right inspector
  (340 px); and, at the Site level, a dock under the viewer.
  - Rails are `src/components/shell/Rail.tsx`. From xl (1280 px) each collapses to a 36 px strip that keeps a
    labelled button ("Regions", "Bulletin" or "Details"); focus moves to the counterpart button. Below xl the rails
    stack with the viewer and are always open.
  - Collapse states, the dock and the plate layers are kept per viewer in localStorage through
    `src/state/stored.ts` (`useStored`, hydration-safe via useSyncExternalStore). Keys: `llsn.rail.left`,
    `llsn.rail.right`, `llsn.dock.open`, `llsn.dock.h`, `llsn.plate.layers`.
- **Moon and System in the viewer slot:** both now render inside `data-viewer`. Their side panel (circumstances,
  point panel, marks, sources) is portalled into the inspector rail through a new `inspector` prop; without the prop
  they still draw their own aside. The Moon panel's "Regions" buttons are hidden in the workspace (the ranking is
  beside it). Their header, caption and YearSlider stay inside the view.
- **Dock:** `src/components/navigator/Dock.tsx` wraps `HorizonPlot` in a new `dock` mode. Always visible: the
  compact TimelineStrip and a one-line readout ([Horizon] toggle, Play, time, Sun and Earth az/el/state/next). The
  panorama (Fig. 2) opens above them; its top edge is a `role="separator"` handle (drag, or arrow keys, Home, End).
  Default: open when the window is at least 900 px tall, height `clamp(124, 0.165 x innerHeight, 200)`. The plot's
  key moved into a "Key" popover in its caption. `Popover` gained `side="above"`.
- **Terrain plate:** the caption bar is gone. The level control and "Fig. 1 Terrain at …" float at the top left;
  Legend and Layers popovers at the top right. Layers: region outlines, graticule (a new `uGrat` shader uniform, via
  `PlateRenderer.setGraticule`), bearing rose, region and landmark labels (the selected flag always stays). The Sun
  and Earth plate indicators no longer print az/el; the dock readout carries them.
- **Ranking:** columns are #, region (with "Sun · Earth · dark" on a second line), score (0 to 1, with a bar) and a
  separate warning column: `AlertMark` as an inline SVG with `role="img"`, `aria-label` and `title` naming the
  dark spell and/or comms gap and the limit. The old Sun/Earth share bars are gone; the footer explains the weights.
- **Measured** (`data-viewer`): 1440x900 site 800x535 (was 720x405; +47% area) with the horizon plot open and both
  rails; 1366x768 726x619 (plot closed by default); Moon/System at 1440x900 800x844. No page scroll at 1440x900 or
  1366x768; 390x844 has no sideways overflow.
- **Screenshots:** scratchpad `shots/phase3/`.

### Unfinished or known issues (Phase 3)

- At about 800 px viewer width the dock readout clips the "next contact" text (it truncates to "·"); the time and
  az/el stay. A shorter format or a second line at narrow widths would fix it.
- Moon and System still carry their long caption paragraphs and own YearSlider/Play inside the viewer (the Moon
  caption is ~190 px tall at 800 px wide). The second Play/clock remains (Phase 4).
- The dock is shown at the Site level only; Moon and System use their YearSlider.
- Turning off "Region outlines" also removes the plate's click-to-pick regions (the chips still select).
- Mouse click on the time rail was not confirmed by the test (keyboard scrubbing, drag of the dock and Play were).
- Below xl the rails do not collapse, and the ranking still comes before the viewer on phones (Phase 5).

## Where Phase 4 starts

1. One clock and one Play: fold the Moon/System YearSlider and their Play into the dock (a year rail at those
   levels), so the dock exists at all three levels.
2. Move the Moon and System header controls (framing, scale, landings, pick a point) into compact toolbars or
   popovers over the viewer, and shorten or fold their caption paragraphs into an info popover.
3. "Why" bars in the bulletin from `missionScore().parts`, and tidy the dock readout's narrow-width format.
4. Trim the bulletin so Circumstances and Contacts fit the inspector without scrolling at 1440x900.

## Where Phase 3 started (done)

1. Rework the `view === "navigator"` grid in the `Navigator` component's JSX in
   `src/components/navigator/NavigatorApp.tsx`:
   - a collapsible left sidebar (about 300 px) holding RegionTable, the gap select and a "+ Custom site" expander;
   - the center viewer;
   - a collapsible right inspector (about 340 px) holding SiteBulletin for now;
   - a bottom dock under the viewer.
   Give the viewer a `data-viewer` attribute; the screenshot script measures it.
2. Render the Moon and System views inside the same center viewer slot rather than as full panels.
3. Build the dock from `HorizonPlot`'s rail parts (`TimelineStrip compact` plus a one-line readout), with a
   resizable [Horizon ▴] panel that remembers its size in localStorage.
4. In `TerrainPlate.tsx`, reduce the caption to an overlay. The legend goes into a Legend popover, and a Layers
   popover controls the overlays, remembered in localStorage. Remove the az/el boxes from the plate's indicators
   (`terrain/PlateLabels.tsx Indicators`).
5. In `RegionTable.tsx`, add a score column with a bar, and move the gap warnings to a separate ⚠ marker with a
   title.

## Phase 4 (done)

- **One clock, one Play.** The dock is at all three levels and holds the only Play and clock.
  - Site: unchanged (`Dock` + `HorizonPlot dock`).
  - Moon and System: a new `src/components/navigator/LevelClock.tsx` under the viewer. It has the rail, Play, the time
    and, inside the window, the site's Sun and Earth state. A Segmented control sets the rail's range: "Mission window"
    (the site's TimelineStrip) or "All of 2027" (`YearSlider.tsx`, now a plain year rail with no Play).
  - The range is kept in localStorage (`llsn.clock.range`, default window). A time outside the window (a year scrub,
    or a lift-off from Launch) always shows on the year rail. "Mission window" clears `systemMs`.
  - Playback lives in `NavigatorApp`. Over the window it runs as before (12 s per window). Over the year it runs at 6
    days per second: inside the window it moves `nowMs` (with `systemMs` null); outside the window it moves `systemMs`.
    `useYearPlayback`, the Moon/System Play buttons, their `playing` state and the time in their headers and in the
    "Time" rows are gone. `systemMs` semantics and the URL (`at=` only inside the window) are unchanged.
  - Dock readout: at narrow widths it wraps a whole body to a second line instead of clipping "next contact" to "·".
    All Play buttons carry `data-play` and the clocks `data-clock` (for tests).
- **Answers in plain words** (`SiteBulletin.tsx`):
  - `verdict()` (exported) writes a bold sentence under the site name from the stats alone. Rank 1 gives all three
    facts. Other ranks lead with the weakest weighted part, then any gap over the limit; a dark spell and a comms gap
    that are both over the limit share one clause. It uses `pct()` and `fmtDuration()`.
  - "Why it ranks here" moved above the numbers. It is now three labelled bars from `missionScore().parts`, each out
    of its weight (Sun power 45% in cadmium, Earth in view 30% in cobalt, short longest dark 25% in umbra), the score
    in the panel note, one line on ties, and the better-start box.
  - Renamed headings: "Circumstances" became "Over this window" and "Contacts" became "Rises and sets". The Moon and
    System panels show the state at one moment, so they say "At the time shown" rather than "Over this window".
    PointPanel had neither heading.
  - Glosses under "Mean disc power" and "Mean Sun clearance". All rows are dense, and the coordinates and Moon Trek
    link share one line.
  - The Fig. 2 Key popover opens with a "How to read this" line.
- **Moon and System toolbars.**
  - Their headers are gone (the h2s are sr-only). Their controls float top right over the viewer, as on the terrain
    plate:
    - Moon: View from, Pick a point, a Layers popover (Earlier landings, Detail tiles and the tile status) and an
      About popover (the old caption).
    - System: Framing, a Scale popover and an About popover (the caption), with a second row per framing. The pair
      framing has Centre on and Top/Side/Reset. The Earth framing has one grouped `SelectField` (United States, NASA
      partner agencies, US partner countries) plus "Day side" and "Moon overhead"; this replaces the 16 Face buttons.
  - Each view keeps a one-line "Drag to turn · scroll to zoom …" hint at the bottom left. ZoomHint sits under the
    toolbar row. The Moon's "9 candidate regions / site" tag is not drawn in the Earth framing.
  - The System inspector's long "On Earth" rows no longer overflow: the labels are shorter and the launch-site name
    went into the note.
- **Launch → Earth:**
  - New store field `systemFraming` (not in the URL). SystemView opens in that framing and clears it.
  - "Show this launch on Earth" sets view `system`, `systemFraming: "earth"`, the launch site and
    `systemMs = chosen.launchMs` (and pauses). The view opens over the launch site at lift-off, on the year rail.
- **Region outlines off:** the outlines are hidden through a new `outlines` prop on `terrain/Scene.tsx`, and the
  regions are still picked by click.
- **Verified:** tsc, eslint and next build are clean. Playwright (`scratchpad/tools/phase4.cjs`) ran at 1440x900 and
  1366x768.
  - There is one Play at each level, and it advances time at each. The year range works, and so does a scrub outside
    the window. All three System framings work, and the Earth dropdown faces Kourou.
  - Each verdict matches its table row: rank 1, rank 7 and rank 9.
  - The wheel zoom chain Site → Moon → System → Moon → Site works.
  - Launch → "Show this launch on Earth" lands at System, in the Earth framing, with KSC selected and the clock at
    lift-off.
  - At 390 px nothing overflows sideways. There were 0 console errors. Screenshots are in scratchpad `shots/phase4/`.

### Unfinished or known issues (Phase 4)

- At 390 px the System/Moon overlay toolbar wraps to two or three rows over the top of the diagram (the Earth framing
  hides part of Earth). A static toolbar above the canvas on phones is Phase 5.
- At 1440x900 the bulletin still scrolls for "Rises and sets" and "Checked against NASA"; the verdict, the Why bars
  and "Over this window" are in the first view.
- The System toolbar sits over the orbit line near the top edge in some framings (cosmetic).
- The mouse click on the time rail is still not separately confirmed by a test (keyboard, fill and Play are).

## Where Phase 5 starts

1. Phones: the ranking after the viewer, the modes in a menu, and the Moon/System toolbars as a static row above the
   canvas below `sm`.
2. A type scale in place of the arbitrary rem sizes.
3. Fit the bulletin at 1440x900: collapse "Checked against NASA" into a disclosure, and maybe cap "Rises and sets" with
   a "show all".
4. Delete the test Horizons cache files (`data/horizons-cache/*_-80.0010_45.0000_*.json`) before committing.

## Phase 5 (done)

- **Below xl (< 1280 px) the Plan workspace stacks, viewer first:** app bar, then the viewer
  (`h-[max(22rem,60svh)]`: 390x506 on a phone, 768x614, 1024x461), then the dock or LevelClock, then a
  `Segmented` panel switch (44 px tall) [Ranking | Details | Horizon] that shows one panel at a time. Horizon is
  only offered at the Site level and shows a full `HorizonPlot` (with its legend) under the switch; the dock's own
  panorama and Horizon toggle are hidden below xl. The rails are the same `Rail`s, reordered with `max-xl:order-*`
  and hidden with `max-xl:hidden` when not chosen, so the Moon/System inspector portal still works. The switch's
  state is local (`panelTab`, default Ranking). From xl nothing changed.
  - New hook `useWideViewport(px)` in `src/state/stored.ts` (server snapshot: wide). `Segmented` gained
    `size="lg"` and `fill`.
- **App bar:** one 56 px row at every width. Below sm the modes are a "Plan ▾" menu (`ModeMenu`, items carry
  `data-mode-item`); from sm the tabs are inline, and centred from lg. The window chip drops the year below sm and
  its panel is pinned to the viewport (`max-sm:fixed inset-x-2`). Chip, info and menu are 44 px below md. The
  window-change toast sits at the bottom of the screen below sm.
- **Viewer toolbars on phones:** below md the Moon and System toolbars and the plate's level control, Fig. 1 title
  and Legend/Layers sit in a static row above the canvas (paper-2, hairline under it); from md they float as before.
  Moon and System canvases have an 18rem floor. Play is 44 px below md.
- **Type scale** (`globals.css` `@theme`): `text-label` 0.75, `text-small` 0.8125, `text-body` 0.875, `text-lead` 1,
  `text-heading` 1.125, `text-title` 1.25, `text-display` 1.5 rem. All `text-[…rem]` sizes in the /tool UI were
  converted (14 distinct sizes before, 7 after; each within about ±1 px except 0.66rem → 0.75 and 1.352 → 1.25).
  SVG user-unit sizes (`text-[4px]`, `text-[7px]`, `fontSize` in SVG) and the landing page are untouched.
- **Leftovers:** LevelClock's range switch reads "Window | All 2027" and "At <site>" shows only from 2xl, so it no
  longer wraps at 1366. "Checked against NASA" is a closed `<details>` (`data-nasa-check`), and rise/set rows put
  the bearing on the name line. The dock readout uses `text-small`.
- **Verified** (`scratchpad/tools/phase5.cjs`, screenshots in `shots/phase5/`): tsc, eslint, next build clean. At
  390, 768, 1024, 1366 and 1440: Site, Moon, System (and Earth framing), Launch and Compare have no sideways overflow;
  0 console errors. At 390 the viewer starts at y=56; the panel switch, row select, Play, window chip (+1 day) and
  About work. Wheel zoom chain Site → Moon → System → Moon → Site and Launch → "Show this launch on Earth" work at
  1440.
  - Measured `data-viewer`: 1440x900 site 800x514 (phase 3 noted 800x535; the dock is ~20 px taller with the
    scale, readout still on two lines at 800 px), Moon/System 800x749; 1366x768 site 726x598.

### Left after Phase 5

- 1440x900 site viewer is ~20 px shorter than in phase 3; trimming the dock caption/rail would win it back.
- The bulletin still scrolls at 1440x900 for the end of "Rises and sets" (bottom at ~1050 px).
- Compare's slip table still scrolls sideways inside its own region below md (the page does not).
- System toolbar over the orbit line near the top edge (md+) was not addressed. On phones the System toolbar is
  2–3 rows (~125 px) in the Earth–Moon and Earth framings.
- Viewer toolbar buttons are 32 px (not 44) on phones; Play, modes, chip, info and the panel switch are 44 px.
- Delete the test Horizons cache files (`data/horizons-cache/*_-80.0010_45.0000_*.json`) before committing.

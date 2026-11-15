# /tool redesign: progress

This file and `docs/tool-ui-audit.md` are the starting point for the next session. Section numbers like §3.3 refer
to the audit. The audit still describes the layout and metrics, but not the Phase 1–2 shell and file moves listed
below. Status: **Phases 1, 2 and 3 done. Phase 4 not started.** Nothing is committed.

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

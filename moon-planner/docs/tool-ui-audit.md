# /tool page UI audit

A factual description of the `/tool` page ("Lunar Landing Site Navigator") as of commit `ce44195` on `main`
(first written against `4cfb1b6`; updated for the Launch tab and the expanded System view added since). It is
written so the page can be redesigned by someone who cannot see the code. Paths are relative to `moon-planner/`.
Pixel figures were measured in headless Edge at the stated viewport against the dev server (default URL `/tool`,
default window 14 Nov 2027 00:00 UTC + 6.5 days, selected site = top of the ranking, "de Gerlache Rim 2").

**What the app does, in one paragraph.** For nine Artemis III candidate regions near the lunar south pole (plus a
user-entered custom point), it computes, over a user-chosen mission window in 2027, how much of the time the Sun is
above the real terrain horizon (power) and Earth is above it (direct-to-Earth comms), ranks the regions, and shows
why with a 3D terrain view (Fig. 1), a horizon panorama with Sun/Earth tracks (Fig. 2), a time scrubber and a
details panel. Extra tabs show the whole Moon (globe), the Sun–Earth–Moon system (now with a textured Earth and
launch sites), a launch planner (when and from which of 16 Earth launch sites to lift off to arrive at the start of
the landing window), a side-by-side comparison and a methods/about page.

---

## 1. Layout map

### 1.1 Page frame (all tabs)

The page is `src/app/tool/page.tsx` (18 lines), which renders `<NavigatorApp />` inside a `Suspense` with
`NavigatorSkeleton` as the fallback. The root layout (`src/app/layout.tsx`) puts `<Navbar />` above `<main>`.

`NavigatorApp`'s root (`src/components/navigator/NavigatorApp.tsx:1053`):
`relative flex flex-col xl:h-[calc(100dvh-2.75rem)] xl:min-h-[38rem] xl:overflow-hidden`.
At ≥1280 px (`xl`) the app is locked to exactly one screen (viewport minus the 44 px navbar) and the page itself does
not scroll; each column scrolls on its own. Below 1280 px the lock is removed and the whole page scrolls.

Top to bottom, every tab shares these three bars:

| # | Region | File | Sizing rules | 1440×900 box | Share of viewport |
|---|---|---|---|---|---|
| 1 | Site navbar ("Lunar Landing Site Navigator", Home, Tool) | `src/components/Navbar.tsx` (63 lines) | `h-11` (44 px) fixed, `border-b border-ink`; full-bleed `px-4` on /tool | 1440×44 at y0 | 4.9% |
| 2 | Masthead: "LANDING WINDOW BULLETIN" + window text + data line, with the 6 view tabs on the right (Navigator, Moon, System, Launch, Compare, About & data) | `Masthead` in `NavigatorApp.tsx:285` | `xl:flex-row xl:items-end xl:justify-between`; tabs `h-10`; below `xl` the tabs move to their own full-width row (`flex-1` buttons) | 1440×55 at y44 | 6.1% |
| 3 | Controls row: Start (UTC), Mission length, Find best start in, Slip start | `MissionControls.tsx` (583 lines), wrapped in `NavigatorApp.tsx:1056` | `bg-paper-2 border-b`; `px-4 pt-2 pb-2.5`; form is `flex flex-wrap items-end gap-x-5 gap-y-3`; adds a line below for error/info text | 1440×73 at y99 | 8.1% |

These three bars take **172 px (19%) of a 900 px-tall screen on every tab**, including Launch, Compare and About,
where the date controls still apply but the masthead tabs are the only navigation. (Re-measured after the Launch tab
was added: unchanged at 1440 and 1280.)

### 1.2 Navigator tab (the default)

Tab panel `#view-navigator` (`NavigatorApp.tsx:1067`):
`grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(19rem,22rem)_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)_21rem]`.

```
┌──────────────────────────────────────────────────────────────────────────────┐ y0
│ Navbar (44)                                                                   │
├──────────────────────────────────────────────────────────────────────────────┤ y44
│ LANDING WINDOW BULLETIN · window · data line          [Navigator|Moon|System|Compare|About & data] (55)
├──────────────────────────────────────────────────────────────────────────────┤ y99
│ START, UTC [14][Nov] 2027 [00:00]  MISSION LENGTH [6.5][days]  FIND BEST START IN [Nov 2027][Search]  SLIP START [+1 week][+2 weeks] (73)
├──────────────┬───────────────────────────────────────────┬───────────────────┤ y172
│ Ranking      │ FIG. 1 caption: title, level nav, legend  │ Site bulletin     │
│ panel        │ (63)                                      │ (scrolls)         │
│ 384 wide     ├───────────────────────────────────────────┤ 336 wide          │
│ (scrolls)    │ 3D terrain stage 720×279                  │                   │
│              ├───────────────────────────────────────────┤ y514              │
│              │ FIG. 2 horizon panorama (svg 688×184)     │                   │
│              │ time rail + now readout + legend (385)    │                   │
└──────────────┴───────────────────────────────────────────┴───────────────────┘ y900
```

| Region | File | Sizing rules | Scrolls? | 1440×900 box | Share |
|---|---|---|---|---|---|
| Left: ranking panel ("Regions ranked for this window", 9 rows, bar legend, "Flag gaps longer than" select, then "Add a custom site" form) | `RegionTable.tsx` (445 lines; `RegionTable` + `CustomSiteForm`) in a wrapper `NavigatorApp.tsx:1074` | Column fixed at `24rem` (384 px) at `xl`; `minmax(19rem,22rem)` at `md`; `bg-paper-2`; `xl:overflow-y-auto` | Yes: content 952 px in a 728 px column. **The custom-site form and most of the legend/gap-limit row are below the fold.** | 384×728 at x0 y172 | 21.6% |
| Centre top: Fig. 1 caption bar ("FIG. 1 Terrain at …", level nav "Up to Moon level" + SYSTEM/MOON/SITE, legend: Sunlit, Shadow, Score, Bearings…) | `TerrainPlate.tsx:496` (`figcaption`) | `flex flex-wrap … px-4 py-1`; wraps to **2 lines at 1440, 3 lines at 1280** | No | 720×63 at y172 | 3.5% |
| Centre top: Fig. 1 3D terrain stage (WebGL canvas + DOM labels + bearing rose + scale bar + zoom tools) | `TerrainPlate.tsx:538` | Section `xl:min-h-[17rem] xl:flex-1`; wrapper `h-[24rem] sm:h-[30rem] xl:h-auto xl:flex-1`; stage `min-h-0 flex-1` | No (canvas) | **720×279** at x384 y235 | **15.5%** |
| Centre bottom: Fig. 2 (caption + notes, horizon panorama SVG, compact time rail, "now" readout with Play button, compact legend) | `HorizonPlot.tsx` (1104 lines) + `TimelineStrip.tsx` (444 lines), section at `NavigatorApp.tsx:1120` | `border-t border-ink px-4 pt-1.5 pb-2.5 xl:shrink-0`; panorama drawing height = `clamp(124, 0.165 × innerHeight, 220)` px (`usePlotHeight`, `NavigatorApp.tsx:334`) = 149 px at 900 tall | Centre column can scroll (`xl:overflow-y-auto`); at 1440×900 it just fits; **at 1280×800 it overflows (723/628 px)** | 720×385 at y515 (SVG 688×184) | 21.4% |
| Right: site bulletin (name, coordinates, Moon Trek link, window, rank/score; sections Circumstances, Contacts, Why it ranks here, Checked against NASA) | `SiteBulletin.tsx` (568 lines) in a section `NavigatorApp.tsx:1151` | Column fixed at `21rem` (336 px) at `xl`; `xl:overflow-y-auto xl:border-l` | Yes: content 1277 px in 728 px. **Contacts is cut off; "Why it ranks here" and "Checked against NASA" are below the fold.** | 336×728 at x1104 y172 | 18.9% |

The 3D view gets **720×279 px = 15.5% of a 1440×900 screen** (canvas measured at x384 y235). At 1280×800 it gets
**560×182 px = 10%**.

What limits it, in order of effect:
1. **Two fixed side columns**: 24rem + 21rem = 720 px of width are always taken at `xl`, leaving 720 px at 1440 and 560
   px at 1280.
2. **172 px of chrome on top** (navbar, masthead, controls), all of which is always visible.
3. **Fig. 2 is `shrink-0`** and takes 385 px. Its SVG (184 px) is only half of that; the rest is the caption line, the
   time rail (ruler + two bands ≈ 46 px), the now readout (2 rows + Play, ≈ 72 px, wraps at this width) and the
   compact legend (≈ 31 px).
4. **The Fig. 1 caption wraps** (63 px at 1440, 90 px at 1280), because one flex row holds the title, the level-nav
   buttons (332 px wide) and a four-item legend.
5. Fig. 1 only gets what is left over (`flex-1`), with `xl:min-h-[17rem]` (272 px) for the whole section, caption
   included.

Below the fold at 1440×900: in the left column, the custom-site form; in the right column, half of Contacts, all of
"Why it ranks here" (scoring explanation plus "Move start to …" suggestion) and "Checked against NASA". Nothing in
the centre column is hidden at 1440×900.

### 1.3 Moon tab

`src/components/moon/MoonView.tsx` (984 lines), panel `NavigatorApp.tsx:1202`
(`relative min-h-0 flex-1 xl:overflow-hidden`). Root `flex min-h-0 flex-col xl:flex-row`.

| Region | Sizing | 1440×900 |
|---|---|---|
| Header: "The Moon, 14 Nov 2027, 00:00 UTC" + buttons: [South pole / Near side / Sun side], [Earlier landings], [Pick a point], [Up to System level], [SYSTEM/MOON/SITE], [Down to site level] | `flex flex-wrap … border-b px-4 py-2.5` | 1096 wide, ~87 px tall (title line + one row of buttons) |
| Globe canvas (R3F) with DOM labels | `relative isolate min-h-[24rem] flex-1` | **1096×451 (38% of viewport)** |
| Caption strip: instructions paragraph + "Detail: …" tile status + [Detail tiles] toggle | `border-t px-4 py-2` | ~105 px |
| Year slider: Play button, month-ticked range input over 2027, shaded mission window, note | `YearSlider.tsx` (118 lines) | ~85 px; its Play button is at the bottom-left edge |
| Right aside: Circumstances (time, sub-solar point, sub-Earth point, illumination, Earth–Moon distance); "At <region>" (position, Sun elevation, Earth elevation); "At this point" (PointPanel: lat/lon form, quick picks, stats for a picked point); Regions (9 toggle buttons); Marks (legend); earlier-landings table; credits | `xl:w-[21.5rem] xl:overflow-y-auto xl:border-l`; stacks below the globe under `xl` | 344×728, scrolls internally |

### 1.4 System tab

`src/components/system/SystemView.tsx` (**1768 lines**, up from 1109), plus `system/earthGlobe.tsx` (285 lines, the
Earth globe, launch-site marks and azimuth fans) and `lib/earthFrame.ts` (124 lines, Earth orientation). Same frame
as the Moon tab.

| Region | Sizing | 1440×900 |
|---|---|---|
| Header: "The Sun, Earth and Moon, <time>" + framing toggle **[Sun–Earth–Moon / Earth–Moon / Earth]** + [Display scale / True scale] + [SYSTEM/MOON/SITE] + [Down to Moon level] | `border-b px-4 py-2.5` | ~87 px |
| Extra bar, **Earth–Moon framing only**: "CENTRE ON [Both / Earth / Moon]" + [Top view] [Side view] [Reset view] | `border-b px-4 py-2` | ~49 px (takes height from the canvas) |
| Extra bar, **Earth framing only**: "FACE" + one button per launch site (16) + [Day side] [Moon overhead] | `border-b px-4 py-2`, buttons wrap over several rows | Several rows (takes height from the canvas) |
| 3D orbit diagram (R3F). Earth is now a textured globe (NASA Blue Marble, printed as sea, land relief and coastline), turned by the Earth Rotation Angle; when Earth is large on screen it shows the 16 launch-site marks, their names, lines from Earth to the Sun and Moon, and the selected site's allowed-azimuth fan. A **transfer arc** (launch site at lift-off → Moon at arrival) is drawn when a launch is chosen on the Launch tab. In the Earth–Moon framing, clicking a body centres on it, double-click resets. The canvas host is focusable: arrow keys turn, +/− zoom. | `relative isolate min-h-[22rem] flex-1` | **1096×504 (43% of viewport)** in the default Sun–Earth–Moon framing |
| Scale caption (a two-line paragraph explaining display vs true scale) | `border-t px-4 py-2 text-[0.8rem]` | ~50 px |
| Year slider (same component as Moon) | | ~85 px |
| Right aside: Circumstances (time, Earth–Sun au, Earth–Moon km, Moon illuminated, light times), phase disc + phase name, "At <region>" Sun/Earth elevation, **"On Earth"** (Sun overhead at, Moon overhead at; with a launch site chosen: launch site name and position, Sun elevation there, Moon elevation there), Marks legend (with a launch legend), sources paragraph | `xl:w-[21.5rem]` | 344×728 |

The zoom chain now has three System framings: Sun–Earth–Moon → Earth–Moon → (Earth, when centred on Earth) or the
Moon level (when centred on the Moon or both).

### 1.5 Launch tab (new)

`src/components/launch/LaunchPanel.tsx` (540 lines), `LaunchDetail.tsx` (302), `launchFormat.tsx` (90); model in
`src/lib/launchWindow.ts` (447) and `src/lib/launchSites.ts` (291, 16 sites). Panel `NavigatorApp.tsx`
(`relative flex min-h-0 flex-1 flex-col xl:overflow-hidden`), content scrolls inside it (2073 px tall at 1440×900).
Full width (no max width), `bg-paper-2`. Uses Tailwind **container queries** (`@container`, `@xl`, `@3xl`, `@4xl`,
`@6xl`) rather than viewport breakpoints.

Top to bottom:

1. **"Launch from Earth"** (1.352rem) and a sentence: "When to lift off, and from where, to reach **<selected
   landing site>** at the start of the landing window: **<start>**, with <length> on the surface to follow." The
   arrival target is the Navigator's window start; the landing site is the Navigator's selection.
2. **Filter bar**: Transfer time (select 2.5–5 days, default 3), Launch sites (select: All sites, US, NASA partner, US
   partner), a custom "Usable only" checkbox, and a status line "16 of 16 listed sites can launch for this arrival".
3. **Ranked table of launch sites** (usable first, then by how close the arrival is to the target). At ≥72rem
   container width it is a 9-column table: #, Launch site (name, country · operator), Lift-off UTC, Window UTC
   (span and length), Azimuth, Inclination, Rotation gain (m/s), Arrival (h early/late), Status ("Usable" blue
   square, "Usable at a cost" half square, "Blocked" red triangle, with a one-line reason). Narrower, each row
   becomes a labelled card grid. Each row is a disclosure button with a chevron.
4. **Expanded row** (`LaunchDetail`): every opportunity in the search span on a UTC axis (pickable; the pick becomes
   the "chosen" lift-off), an azimuth dial with the site's allowed headings, and mission steps (lift-off → arrival
   timeline).
5. **"If the landing slips"**: for the selected (or top-ranked) launch site, the same search for As planned, +1 day,
   +1 week and +2 weeks: lift-off, time-of-day shift, azimuth, inclination, status, and how many listed sites are
   usable. A summary sentence (red if a slip leaves the site blocked).
6. **"Estimate, not a trajectory design"** box with a `<details>` "Full method and what it leaves out".

At 1440×900 the fold falls at about row 7 of 16; the slip analysis and method box need scrolling.

### 1.6 Compare tab

`ComparePanel.tsx` (436 lines). Centred column `mx-auto max-w-[80rem] px-4 py-5 xl:px-8`, scrolling inside the
panel (content 1632 px high in 728 px). Top to bottom:

1. "Compare regions" + window sentence.
2. Change note (only after a slip or search).
3. "PICK TWO OR THREE (n of 3)": 9–11 checkbox chips (regions in `sites.ts` order, not rank order; plus the custom
   site and a picked Moon point when they exist).
4. Side-by-side table: Rank, Score, Sun up, Mean disc power, Earth in view, Sun and Earth together, Longest dark,
   Longest without comms, Rises and sets in window. Best value is bold; values over the gap limit are red with an
   alert icon.
5. "OVER THE WINDOW": one multi-row `TimelineStrip` (full size, with readout) with every picked site on one time axis.
6. "IF THE START SLIPS": table of Rank/Sun/Earth/Dark for as planned, +1 week and +2 weeks, then one
   `TimelineStrip` per picked site with its +1 and +2 week bands stacked.

With 2 picks at 1440×900, only the table fits above the fold; the timelines and the slip analysis need scrolling.

### 1.7 About & data tab

`AboutPanel.tsx` (393 lines; the System level section now also credits the Blue Marble Earth texture). `mx-auto max-w-[72rem]`, at `xl` a 2-column grid: sticky table of contents (13rem) +
`max-w-[68ch]` text. Sections: The nine regions, How the numbers are made, How regions are ranked, Limits, Moon level,
Any point on the Moon, System level, Checked against NASA (a 9-row validation table versus NASA LOLA averages), NASA
data and credits, How AI was used. **Content is 5042 px tall** (about 7 screens).

---

## 2. Views and navigation

### 2.1 Every navigation control

| Control | Where | What it changes | State read/written |
|---|---|---|---|
| Navbar **Home / Tool** | `Navbar.tsx`, top right | Route `/` or `/tool`. A bare `/tool` link keeps the current plan (URL-in logic, `NavigatorApp.tsx:456`). | Next router; `usePathname` for the active underline |
| Masthead tabs **Navigator · Moon · System · Launch · Compare · About & data** | `Tabs` in `NavigatorApp.tsx:227`, inside the masthead | Which panel renders (only one is mounted at a time) | `view` (`useState`, mirrored to URL `view=`); `changeView` also clears the zoom crossfade and `arrival` |
| **SYSTEM / MOON / SITE** segmented indicator | `LevelNav.tsx` (76 lines), rendered in the Fig. 1 caption, the Moon header and the System header | Same as the tabs: System → `system` tab, Moon → `moon` tab, **Site → `navigator` tab** | `stepLevel` → `goLevel(level, false)` → `view` and `arrival` ("above"/"below") |
| **Up to Moon level / Up to System level** and **Down to Moon level / Down to site level** buttons | Same `LevelNav`, beside the segmented control | One step up or down the same three levels | Same as above. "Down to site level" from Moon uses `openSiteAt(viewCentre)`, which can also **create a custom site** at the globe centre if it is not over a region (`NavigatorApp.tsx:971`) |
| **Wheel zoom past a limit** ("zoom gate") | `useZoomGate.ts` (102 lines) on the Fig. 1 stage, the Moon globe and the System diagram | Scrolling about 300 px of wheel travel past the camera's zoom limit opens the next level, with a 200 ms crossfade. A hint box with a progress bar ("Keep zooming out to open the Moon level") appears at the top of the view. | `report(distance, min, max)` from each scene; calls `zoomToMoon`, `zoomToSystem` and `zoomToSite` in `NavigatorApp` |
| Fig. 1 **− / + / re-centre** tool buttons | Bottom-right of the stage, `TerrainPlate.tsx:665` | Camera zoom and fly back to the selected site | `PlateBridge` imperative commands (not React state) |
| Fig. 1 region **chips and flag** | DOM labels over the canvas (`terrain/PlateLabels.tsx`) | Clicking a chip selects that region; clicking the selected flag re-centres | `onSelect` → `selectedId` |
| Fig. 1 keyboard | Stage `onKeyDown` | Arrows orbit, +/− zoom, Home/0 re-centre | `PlateBridge` |
| Moon **South pole / Near side / Sun side** | Moon header | Camera framing direction | `MoonView` local `framing` |
| Moon **Earlier landings** toggle | Moon header | Show/hide Apollo and other landing marks and the table in the aside | local `showLandings` |
| Moon **Pick a point** toggle (plus shift-click at any time) | Moon header | Click on the globe drops a pin | local `pickMode`; writes app `point` (URL `pt=`) |
| Moon **Detail tiles** toggle | Moon caption strip | Load NASA Moon Trek tiles when zoomed in | local `detail` |
| Moon aside **Regions** buttons (9) | Moon aside | Select a region (same as the ranking) | `selectedId` |
| Moon globe region marks | Over the canvas when zoomed in | Select a region | `selectedId` |
| Moon "9 candidate regions" cluster mark | Over the canvas | Zoom to the pole | local `framing` |
| System **Sun–Earth–Moon / Earth–Moon / Earth** | System header | Framing; the zoom gate also switches it | local `framing` |
| System **Display scale / True scale** | System header | Body sizes and distances (reopens the framing) | local `scale` |
| System **Centre on Both / Earth / Moon**, **Top view / Side view / Reset view**; click or double-click a body | Extra bar in the Earth–Moon framing; the canvas | Camera pivot and presets | local `focus`, camera rig |
| System **Face** buttons (16 launch sites + Day side + Moon overhead) | Extra bar in the Earth framing | Turns Earth to that site; choosing a site also selects it as the launch site | `launchSiteId` in NavigatorApp (shared with the Launch tab) |
| System launch-site marks on the globe | Over the canvas when Earth is large | Select a launch site | `launchSiteId` |
| Launch **Transfer time**, **Launch sites** group filter, **Usable only** | Launch filter bar | The search and the list | LaunchPanel local `transitDays`, `group`, `usableOnly` |
| Launch row (disclosure button) | Launch table | Selects the launch site and expands its detail; clicking again collapses | `launchSiteId` (NavigatorApp) + local `collapsed` |
| Launch opportunity on the detail's UTC axis | Expanded row | The chosen lift-off, reported up as `launchPick`, which draws the transfer arc on the System view | local `picked` → `launchPick` |
| Launch **Full method and what it leaves out** (`<details>`) | Method box | Expands text | — |
| System "9 candidate regions" cluster mark | Over the canvas | Opens the Moon tab | `zoomToMoon` |
| Bulletin **How the numbers are made and checked** link | Bottom of the bulletin | Switches to About and scrolls to `#about-check` | `view`, `pendingAnchor` ref |
| PointPanel **Open site level / Compare / Clear** | Moon aside, after a point is picked | Turns the point into a custom site and opens the Navigator; adds it to Compare; clears it | `addCustom` + `changeView("navigator")`; `picked` + `changeView("compare")`; `point = null` |

### 2.2 Overlaps

- **The tabs and the level control do the same job under different names.** Navigator, Moon and System tabs equal
  Site, Moon and System levels. "Site" is called "Navigator" in the tabs and "site level" in the buttons. On each of
  those three tabs the user sees two navigation bars: the masthead tabs and the segmented control, plus up/down
  buttons.
- **There are four ways to change level**: tabs, segmented control, up/down buttons and wheel-zoom past a limit.
- **There are four places to pick a region**: the ranking rows, the Fig. 1 chips, the Moon aside buttons and the Moon
  globe marks. The Compare checkboxes are a separate multi-selection.
- **There are three ways to change the start date**: the controls row (typed start, "Find best start in" month
  search, "+1 week" and "+2 weeks"), the bulletin's "Move start to …" suggestion, and Compare's "If the start slips"
  table, which is read-only but answers the same question as the slip buttons. **The Launch tab adds a fourth slip
  analysis** ("If the landing slips": +1 day, +1 week, +2 weeks), with different slip steps from the controls row
  and Compare (which use +1 and +2 weeks).
- **Launch-site selection has two places**: the Launch table rows and the System view's Face buttons and globe marks.
  They share one state, so picking a site on either tab carries over.
- **There are now three ranked lists** with similar row styling (#, name, columns of figures, status): the region
  ranking (Navigator), the launch-site ranking (Launch) and the Compare table. Each uses its own ordering rule.
- **The same window appears three times on the Navigator tab**: masthead ("14 Nov 2027, 00:00 to 20 Nov, 12:00 UTC,
  6.5 days"), ranking header (same string) and bulletin ("Window 14 Nov 00:00 to 20 Nov 12:00 UTC", in a different
  format). The controls row shows it a fourth time as inputs.
- **There are two Play buttons with different behaviour.** Fig. 2's Play runs the mission window in 12 s and loops.
  The Moon and System year slider's Play runs through 2027 at 6 days per second. Each has its own `playing` state.
- **Two time scopes share one clock.** The Moon and System year sliders cover the whole year. Inside the mission window
  they move the shared `nowMs`; outside it they set a separate `systemMs`, which is dropped on returning to the
  Navigator (`NavigatorApp.tsx:733`). A user can scrub to March on the Moon tab, go to Navigator and find the time
  back inside November.

### 2.3 What each top tab shows

- **Navigator**: everything in §1.2. Controls: ranking row buttons, gap-limit select, custom-site form (latitude,
  longitude, Add/Replace/Try again, Remove), Fig. 1 chips, flag, zoom tools and level nav, Fig. 2 draggable tracks,
  time rail slider and Play, bulletin "Move start to …", "Try again" and the "How the numbers…" link.
- **Moon**: §1.3. Controls listed in 2.1, plus the PointPanel form (latitude/longitude text boxes, "Set point",
  quick picks for Apollo 11, Apollo 15, Chandrayaan-3 and Chang'e-6) and the year slider.
- **System**: §1.4. Framing (3) and scale toggles, the Earth–Moon "Centre on" bar or the Earth "Face" bar, level
  nav, year slider. Read-only aside apart from the launch-site choice it reflects.
- **Launch**: §1.5. Transfer time, site group filter, usable-only checkbox, 16 expandable launch-site rows with
  pickable opportunities, the slip table and the method box. Driven by the Navigator's window start and selected
  landing site; it has no time scrubber.
- **Compare**: §1.6. Checkboxes (max 3), two timeline strips (each a slider), and the slip tables.
- **About & data**: §1.7. Only a table-of-contents nav and external links.

---

## 3. Every control and readout

### 3.1 Inputs, buttons and dropdowns

| Label | Location | Changes | Used by |
|---|---|---|---|
| Start day (select 1–31) | Controls row | `startMs` via `applyWindow(…, null)` (typed changes clear the change note) | Every tab |
| Start month (select Jan–Dec) | Controls row | `startMs` | Every tab |
| "2027" (static text) | Controls row | — | — |
| Start hour (select 00:00–23:00) | Controls row | `startMs` | Every tab |
| Mission length (text, decimal) | Controls row | `durationHours`; validated on each keystroke, empty values reported on blur | Every tab |
| Unit (select days/hours) | Controls row | Reformats the length text | Controls only |
| Find best start in (select "January 2027" … "December 2027") | Controls row | Local `month` only | Controls |
| **Search** (primary, dark) | Controls row | Runs `bestStart` for the **selected site** over that month and applies it with reason "Best start in <Month>" (shows the change note) or an info line | Every tab |
| **+1 week / +2 weeks** | Controls row "Slip start" | `startMs += 7 or 14 days`, reason "Slip" (shows the change note); disabled if past 1 Jan 2028 | Every tab |
| Change note: **Back to the plan / Keep the new start** | Top of the ranking panel and of Compare (`ChangeNote` in `MissionControls.tsx:186`) | Undo (`applyWindow(from…)`) or dismiss (`change = null`) | Navigator, Compare |
| Ranking row (button) | Left panel | `selectedId` | All views (selection is global) |
| Flag gaps longer than (select 12 h, 1 d, 2 d, 3 d, 4 d, 7 d) | Left panel, below the table | `gap` (URL `gap=`) | Ranking, bulletin and Compare red flags |
| Custom site Latitude, Longitude (text), **Add site / Replace site / Try again**, **Remove** | Left panel, below the fold | `custom`, `customReq`, `selectedId = "custom"` | Ranking (as a 10th row), Fig. 1, Fig. 2, bulletin, Compare chip |
| Fig. 1 region chip / selected flag | Over the 3D stage | `selectedId` / re-centre | Global |
| Fig. 1 − / + / ⌖ | Bottom-right of the stage | Camera | Fig. 1 |
| Level nav (Up…, SYSTEM, MOON, SITE, Down…) | Fig. 1 caption, Moon header, System header | `view` | Global |
| Fig. 2 track drag (mouse/pen within 18 px of a track) | Fig. 2 SVG | `nowMs` (stops play) | Global clock |
| Time rail (slider thumb, click/drag on the bands; arrows ±1 h, Shift ±1 d, PageUp/Down, Home/End) | Under the Fig. 2 panorama | `nowMs` (snaps to the hour) | Global clock |
| **Play / Pause** (square icon button) | Fig. 2 now readout | `playing` | Navigator |
| Bulletin **Move start to <date>** | Bulletin "Why it ranks here" (below the fold) | `applyWindow(best, …, "Best start in the next two weeks")` | Global |
| Bulletin **Try again** | Bulletin error state | Re-fetch the site | — |
| Bulletin **Open in Moon Trek** (external link) | Bulletin header | New tab | — |
| Bulletin **How the numbers are made and checked** | Bulletin bottom | `view = about`, scroll to anchor | — |
| Moon: South pole / Near side / Sun side, Earlier landings, Pick a point, Detail tiles, Regions buttons, PointPanel form and buttons | Moon tab | Local Moon state; `selectedId`; `point` | Moon (and Compare/Navigator via the point actions) |
| System: Sun–Earth–Moon / Earth–Moon / Earth, Display scale / True scale, Centre on, view presets | System tab | Local System state | System |
| System: Face buttons and launch-site marks | System tab (Earth framing / large Earth) | `launchSiteId` | System, Launch |
| Launch: Transfer time (2.5, 3, 3.5, 4, 4.5, 5 days) | Launch filter bar | Local `transitDays` | Launch (and the transfer arc on System) |
| Launch: Launch sites group (All / US / NASA partner / US partner) | Launch filter bar | Local `group` | Launch |
| Launch: Usable only (checkbox) | Launch filter bar | Local `usableOnly` | Launch |
| Launch: site row; opportunity pick | Launch table / expanded row | `launchSiteId`; `launchPick` | Launch, System |
| Year slider (range input) + Play | Moon and System bottom | `nowMs` inside the window, otherwise `systemMs` | Moon, System |
| Compare checkboxes (max 3) | Compare | `picked` (URL `cmp=`) | Compare |
| Compare timeline strips | Compare | `nowMs` | Global clock |

### 3.2 Metrics and where they appear

Underlying computation (all in `src/lib/sky.ts` unless noted):
- `windowStats(site, start, end)` returns `sunlit`, `sunPower`, `earthVisible`, `both`, `longestDarkHours`,
  `longestNoCommsHours`, `meanSunClearance`, `maxSunClearance` and the dark/no-comms spans.
- `scoreWindow(id, stats)` adds `score = 0.45·sunPower + 0.30·earthVisible + 0.25·(1 − longestDark/windowHours)`,
  clamped, plus `reasons[]`.
- `rankSites(map, start, hours)` scores every site and sorts with `compareScores` (score, then peak Sun clearance,
  then Earth time). `tiedRanks` (exported from `ComparePanel.tsx:46`) assigns shared ranks.
- `sampleAt(site, ms)` gives the instantaneous Sun/Earth azimuth, elevation, terrain horizon at that azimuth,
  `sunFraction` and `earthUp`.
- `src/components/navigator/plot/contacts.ts` gives minute-refined rise and set events (`contactEvents`,
  `nextContact`, `isUpAt`, `visibilitySpans`).

| Metric | Where it appears on screen | Computed by |
|---|---|---|
| **Sun up %** (share of the window with any of the solar disc above terrain) | Ranking "SUN" column + yellow share bar; bulletin "Sun up"; change note "Sun up" before→after; bulletin "Why it ranks here" bullet; bulletin "Move start to" sentence; Compare table "Sun up"; Compare slip table "Sun"; Compare timeline row caption "Sun x%"; Moon PointPanel "Sun up"; Fig. 2 SVG `<desc>` (screen readers) | `rankSites`→`windowStats` (ranking/bulletin/compare); `rankSites` again for the baseline (change note); `bestStart` (suggestion); `windowStats` again in `TimelineStrip.rowData`; `windowStats` in PointPanel and in `HorizonPlot.computeLayout` |
| **Earth in view %** | Ranking "EARTH" column + blue bar (red with ⚠ if the comms gap exceeds the limit); bulletin; change note; reasons; suggestion; Compare table and slip table; timeline row caption; PointPanel; Fig. 2 desc | Same as above |
| **Mean disc power %** (`sunPower`) | Bulletin "Mean disc power"; Compare table | `windowStats` |
| **Sun and Earth together %** (`both`) | Bulletin "Sun and Earth"; Compare "Sun and Earth together" (different label) | `windowStats` |
| **Longest dark** | Ranking "LONGEST DARK" column (red ⚠ over the limit); bulletin (red over the limit); change note; reasons ("longest dark spell …"); suggestion; Compare table and slip "Dark"; timeline row caption; PointPanel "Longest dark" | `windowStats` (several times, see above) |
| **Longest without comms** | Bulletin; Compare table; PointPanel ("Longest without Earth", different label); in the ranking **only as the red flag on the Earth column**, never as a number | `windowStats` |
| **Mean Sun clearance / Peak Sun clearance** | Bulletin only | `windowStats` |
| **Score (0–1)** | Bulletin header "score 0.99"; Compare "Score" row; "Move start to" sentence; Fig. 1 region outline and chip swatch colour (umbra→sun gradient, legend "Score"). **Not shown as a number in the ranking.** | `scoreWindow` via `rankSites`; tint via `terrain/constants.ts scoreTint` |
| **Rank** | Ranking "#" column with a ▲▼ shift after a slip; bulletin "Rank 1 of 9"; change note "Rank a of n → b of n"; Compare "Rank" row; slip table "Rank" per start | `tiedRanks(rankSites(...))`; Compare slips run `rankSites` 3 more times (`ComparePanel.tsx:103`) |
| **Sun az/el now** | Fig. 1 edge indicator box ("SUN az 61.8° el +2.3°"); Fig. 2 now readout ("az 61.8° el +2.3° terrain +0.2°"); Fig. 1 screen-reader description; System aside "Sun elevation" (centre over a level horizon); Moon aside "Sun elevation" and the globe label "SUN +2.3°"; PointPanel "Sun elevation" | `sampleAt(selectedData, nowMs)` in `NavigatorApp.tsx:642` (Fig. 1, Fig. 2); `sampleAt(selectedData, systemNow)` (System aside); **a separate model** in the Moon tab: `elevationDeg(lat, lon, frame.sunKm)` from `lib/moonFrame.ts` (Horizons vectors + IAU rotation). The two models agree here (+2.3 vs +2.35) but are separate code. |
| **Earth az/el now** | Same places as the Sun | Same |
| **Terrain horizon height under each body** ("terrain +0.2°") | Fig. 2 now readout only | `sampleAt` → `horizonElevationAt` |
| **Up / behind terrain status** | Fig. 2 now readout ("Up", "n% of disc up", "In view", "Behind terrain" in red); Fig. 1 bearing rose "now" marks; Fig. 2 discs (dashed when behind) | `isUpAt` (contacts.ts) in the readout; `sampleAt().sunFraction` in the disc and status text; **a third inline test** in `TerrainPlate.tsx:312` (`el + radius > horizonElevationAt`) |
| **Next sunrise/sunset/Earthrise/Earthset + countdown** | Fig. 2 now readout ("Sunset 24 Nov 01:10, in 10 d 1 h"); full-size `TimelineStrip` readout on Compare ("Sunset in …"); PointPanel "Next sunset" | `nextContact` |
| **Contacts list** (every rise/set in the window, with azimuth) | Bulletin "Contacts" table (with window opens/closes rows); Fig. 2 labelled open circles ("EARTHSET 20 Nov 05:34"); Fig. 1 bearing rose open circles; Compare "Rises and sets in window" (count) | `contactsFor` → `contactEvents` (bulletin, Compare); `contactEvents` in `HorizonPlot.computeLayout`; `buildRoseData` in `terrain/rose.ts` |
| **Window open/close sky state** ("Sun up, Earth in view") | Bulletin Contacts | `skyState` → `sampleAt` |
| **Better start in the next 14 days** | Bulletin "Why it ranks here" | `bestStart(site, start, start + 14 d, hours, 1)` (hourly, about 336 window evaluations) on every window change |
| **Model vs NASA** (Sun %, Earth %, difference in points) | Bulletin "Checked against NASA" (selected region); About "Checked against NASA" (all 9) | `compareWithNasa` in `lib/validation.ts` |
| **Elapsed time** ("T+0 h") and full time ("14 Nov 2027, 00:00 UTC") | Fig. 2 now readout; full-size timeline readout | `plot/format.ts fmtElapsed`, `fmtFull` |
| System-level values (au, km, illumination %, phase name, light times) | System aside; Moon aside (subset: illumination, Earth–Moon km) | `lib/system.ts stateAt` |
| Sub-solar / sub-Earth point, libration | Moon aside + globe labels | `lib/moonFrame.ts moonFrameAt` |
| Sun / Moon overhead on Earth; Sun and Moon elevation at the launch site | System aside "On Earth" + globe tags | `lib/earthFrame.ts earthFrameAt`, `elevationDeg` |
| **Launch opportunity** per site: lift-off time, window span and length, azimuth, inclination, rotation gain (m/s), arrival offset (h early/late), status and reason | Launch table; expanded detail (all opportunities on a UTC axis, azimuth dial, mission steps); slip table | `lib/launchWindow.ts launchOpportunities`, `bestOpportunity`; ranked in `LaunchPanel.tsx` (`rank`); formatted in `launchFormat.tsx` |
| Usable launch sites count ("16 of 16 listed sites can launch") | Launch filter bar; slip table "Listed sites usable" | `LaunchPanel.tsx` (filter of the results) |

### 3.3 Shown or computed more than once

- Sun %, Earth % and longest dark appear in **up to 6 places per screen** across the ranking, bulletin, change note,
  reasons and suggestion, and again on Compare.
- `windowStats` runs separately for the same site and window in `rankSites` (NavigatorApp), `TimelineStrip.rowData`
  (cached per site and window), `HorizonPlot.computeLayout` (for the description text) and PointPanel. Compare runs
  `rankSites` four times (current + 3 slips) and NavigatorApp runs it a second time for the change-note baseline.
- Rise and set events are computed separately by the bulletin (`contactsFor`), Fig. 2 (`contactEvents`), the rose
  (`buildRoseData`) and Compare (`contactsFor` count). They share one solver, so the times agree.
- "Is the body up?" has three implementations: `sampleAt` (lib/sky.ts), `isUpAt` (contacts.ts) and inline in
  `TerrainPlate.tsx:312`.
- Site Sun/Earth elevation comes from two models: the Horizons topocentric tracks (Navigator, System aside) and the
  Moon-frame geometry (Moon tab).
- The Launch tab runs its full 16-site search **four times** on every change of start or transfer time (as planned
  plus three slips, `LaunchPanel.tsx:166-170`).
- **The percentages are rounded inconsistently.** Tables use `pct()`, which never rounds a partial share up to
  "100%" or down to "0%" (it shows ">99%" or "<1%"). The "Why it ranks here" bullets use `Math.round` in
  `scoreWindow`, so a 99.6% value reads ">99%" in the table and "Sun up 100%" in the bullet. Compare timeline row
  captions use another plain `Math.round`.
- **The same metric has different labels in different places**: "Sun and Earth" vs "Sun and Earth together"; "Longest
  without comms" vs "Longest without Earth"; "SUN"/"EARTH" column heads vs "Sun up"/"Earth in view"; the "Dark"
  column vs "Longest dark".

---

## 4. Visual system

### 4.1 Tokens (`src/app/globals.css`, Tailwind v4 `@theme inline`)

The design brief is called the "eclipse-bulletin world": a printed bulletin on paper with ink, where the umbra colour
marks shadow and lost signal.

| Token | Hex | Used for |
|---|---|---|
| `paper` | `#eef1f0` | Page and panel ground, sunlit relief (high) |
| `paper-2` | `#e3e8e7` | Rails, toolbars, left ranking panel, controls row, skeletons |
| `paper-3` | `#d6dddc` | Pressed and selected states, sunlit relief (low), hover |
| `ink` | `#121a22` | Text, borders for emphasis, primary button fill, active tab underline |
| `ink-2` | `#3a4752` | Secondary text (≥4.5:1 on paper) |
| `ink-3` | `#5d6a74` | Tertiary text, disabled, 0° line on Fig. 2 |
| `rule` | `#b9c3c2` | 1 px hairlines, field borders, grid lines |
| `umbra` | `#3d5466` | Terrain silhouette in Fig. 2, shadow in Fig. 1, Sun-down band, score 0 end |
| `umbra-soft` | `#c3ced3` | Bar tracks, Earth-down band, active press |
| `sun` | `#f0b400` | Sun track, Sun-up band, share bar, score 1 end, `::selection` |
| `sun-ink` | `#7a5600` | Sun track casing, Sun-coloured text on paper |
| `earth` | `#2453c2` | Earth track, Earth band and bar, links, **focus ring** (`:focus-visible` 2 px outline) |
| `earth-soft` | `#c9d5f1` | Earth behind terrain (dashed), Earth disc fill |
| `limit` | `#c42b1c` | Warnings: over-limit gaps (with an alert triangle), "Behind terrain", set contacts on Fig. 2 |

The same hexes are **hard-coded again** in `src/components/navigator/terrain/constants.ts` (`TOKENS`, for shaders), as
`INK`, `PAPER`, `SUN`, `SUN_INK`, `EARTH` constants in `MoonView.tsx:54` and SystemView, and there is one literal
`#dfe4e3` in SystemView's phase disc. Relief colours in the 3D shader are mixes of these tokens
(`terrain/constants.ts RELIEF`).

**Type**: Public Sans via `next/font` (`--font-public-sans`), with tabular and lining numerals on globally
(`font-feature-settings: "tnum" 1, "lnum" 1`). Sizes are arbitrary rem values rather than a named scale:
0.69, 0.702, 0.75, 0.79, 0.8, 0.844, 0.95, 1, 1.068, 1.2, 1.266 and 1.52rem (about 11 to 24 px). The most common are
0.75rem (labels, captions), 0.844rem (body and secondary) and 0.95rem (values). Weights 400/500/600/700, plus 800 on
the landing page. Labels and section headings are UPPERCASE with 0.06–0.1em tracking (`fieldLabel` in
`SiteBulletin.tsx:68`, and an `H3` constant copied into MoonView, SystemView and PointPanel; the Launch tab adds
a near-identical `capsLabel` in `launchFormat.tsx` and a 1.352rem page title, a size used nowhere else).

**Shape and spacing**: no rounded corners anywhere (square fields and buttons, `rounded-none`). Buttons and fields are
32 px tall (`h-8`). Joined button groups use `-ml-px`. Borders are 1 px `rule` for hairlines and `ink` for emphasis
(masthead bottom, the Fig. 2 top rule, selected row inset `shadow-[inset_0_0_0_1px_ink]`). Panel padding is `px-4`
or `px-5`, sections `pt-3.5 pb-4`. Shared class strings live in `SiteBulletin.tsx:59-71` (`smallButton`,
`primaryButton`, `linkButton`, `fieldLabel`, `fieldControl`) and a `SelectField` with a drawn chevron. Moon and
System define their own `BUTTON`, `Segmented` and (System) `FaceButton` styles instead. The Launch tab reuses
`SelectField`, `fieldLabel` and `smallButton`, draws its own square checkbox, and lays out its table with **container
queries** (`@container` with `@xl`…`@6xl`), the only place in the app that does.

**Status marks (Launch)**: "Usable" = filled `earth` square, "Usable at a cost" = half-filled square, "Blocked" =
the red `limit` alert triangle (`launchFormat.tsx Status`).

**Icons**: hand-drawn inline SVG on a 16 px grid with 1.5 px strokes: `SunMark`, `EarthMark`, `AlertMark`, `ArrowMark`,
`ChevronMark`, `ExternalMark` (SiteBulletin), plus `terrain/icons.tsx` and `landing/icons.tsx`. No icon library.

### 4.2 Figures

- **Figure captions**: a small bold uppercase number ("FIG. 1", 0.75rem, 0.1em tracking) followed by a 0.95rem
  semibold title ("Terrain at de Gerlache Rim 2", "Horizon from de Gerlache Rim 2"). Fig. 1's caption also holds its
  legend and the level nav. Fig. 2's caption holds a technical note ("Ticks 6 h (Earth 24 h), heavy at 00h UTC ·
  elevation ×4.4").
- **Fig. 2 horizon panorama** (`HorizonPlot.tsx`, hand-built SVG, no chart library):
  - **Axes**: x is azimuth across 360° centred on north, with S at both edges. Labels every 30°, with bold cardinal
    letters S W N E. Ticks are 5 px major and 3 px minor, every 10° on the x axis.
  - **Elevation**: y is elevation, stretched vertically (×4–6, printed in the caption). Ticks are 5 px major and 3 px
    minor, labels use a true minus sign. The grid is in `rule`, the 0° line in `ink-3`.
  - **Terrain**: an `umbra` silhouette with a 1 px ink edge.
  - **Tracks**: the Sun is a cased line (4 px `sun-ink` under 2.25 px `sun`), Earth a 2 px `earth` line on a paper
    casing. Behind the terrain both are dashed (4 3) in `sun` or `earth-soft`. Hour ticks run perpendicular to the
    track, heavy at 00 h UTC. A bar marks the window start and an arrowhead the end.
  - **Contacts**: open circles, ink outline for a rise and red outline for a set. Labels are auto-placed with collision
    avoidance (`plot/labels.ts`) and leader lines.
  - **"Now" discs**: drawn at true angular size on the elevation scale. The Sun has a reticle, Earth a crosshair, and
    the part behind the terrain is dashed.
  - **Legend**: six swatches ("Sun track, Earth track, Behind terrain, Terrain horizon, Rise, set, Now").
  - **Narrow screens**: the panorama scrolls sideways with a sticky elevation axis, starting centred on north.
- **Fig. 1 terrain plate** (`TerrainPlate.tsx` + `terrain/*`, about 2.3k lines in total):
  - **Rendering**: React Three Fiber `<Canvas frameloop="demand" flat dpr={[1,2]}>` with a perspective camera (fov 30)
    and a custom `CameraRig` around three's `OrbitControls` (`terrain/rig.ts`: damping 0.12, zoom to cursor, distance
    10–1500 km, max polar angle 1.36 rad). The default view is oblique at a 36° pitch, looking from the site's outward
    side toward the pole, with an eased fly-to between sites.
  - **Surface**: custom GLSL in `terrain/shaders.ts` and `engine.ts`. The mesh is a 950×950 LOLA 640 m heightmap
    (3.6 MB, downloaded with a progress bar) with relief exaggerated ×3.5. A map-space light pass traces the shadows
    at true scale, with lunar curvature, **once per Sun position**. Openness shading, side walls and a base frame
    complete the plate.
  - **Regions**: outlines from the USGS, drawn as ribbons tinted by score.
  - **Overlays**: DOM, not WebGL. `PlateBridge` (`terrain/bridge.ts`) projects anchors every frame and writes the CSS
    transforms. They include the selected-site flag (name and coordinates), region chips, the pole mark, landmarks,
    graticule labels, and Sun and Earth edge indicators (icon, arrow, "SUN az … el …" box).
  - **Bearing rose** (`terrain/rose.ts`, SVG redrawn every frame): an azimuth ring in the site's horizontal plane,
    with 30° labels and the Sun and Earth bearing paths over the window, ticked like Fig. 2.
  - **Bottom of the stage**: a scale bar and a note ("LOLA 640 m grid, relief ×3.5; shadows traced at true scale").
  - **Fallbacks**: without WebGL 2, `terrain/PlanView.tsx` draws an SVG plan of the regions. Errors are caught by an
    error boundary, with a "Restart the 3D view" option.
- **Moon globe and System diagram**: also React Three Fiber, but with drei's `OrbitControls` and `Line` and their own
  rigs. Surface maps are the NASA SVS CGI Moon Kit textures, with Moon Trek detail tiles (`moon/tiles/*`). Labels are
  DOM elements positioned by a `LabelProjector` (`moon/marks.tsx`, shared by both views). Without WebGL they fall back
  to SVG polar or plan charts.
- **System view Earth** (`system/earthGlobe.tsx`): a globe textured from NASA Blue Marble (2k and 4k JPEGs in
  `public/textures/`), recoloured to the bulletin palette (sea, land relief, coastline), oriented by
  `lib/earthFrame.ts`. Launch sites appear as marks with name tags, the selected one with an azimuth fan; "Sun
  overhead" and "Moon overhead" tags; and the transfer arc to the Moon. How much is drawn depends on Earth's size on
  screen (three detail steps). The Earth–Moon framing glides its pivot between Earth, the midpoint and the Moon over
  520 ms.

### 4.3 Motion and playback

- **Fig. 2 Play** (`NavigatorApp.tsx:806`): a `requestAnimationFrame` loop advances `nowMs` so the whole window plays
  in 12 s, then loops. Any scrub stops it. The URL `at=` is not written while playing.
- **Time rail** (`TimelineStrip` compact): a ruler with day ticks and labels (6-hourly minor ticks when there is room)
  and Sun and Earth bands (up/down colours, hatched where there is no data). The playhead is a line plus a 10 px square
  `role="slider"` thumb that snaps to the hour. Dragging the Fig. 2 tracks moves the same clock.
- **Year slider** (Moon/System): a native range input with a hairline track, month ticks and the mission window shaded.
  Its Play runs 6 days per second.
- **Level change by zoom**: a 200 ms opacity crossfade (`LEVEL_FADE_MS`), skipped when reduced motion is requested.
- **Camera fly-to** on site change (skipped when reduced motion is requested).
- **Small transitions**: colour changes take 150 ms, skeletons pulse, and Fig. 1's overlays fade in over 200 ms on the
  first frame.

---

## 5. State and data flow

### 5.1 Where state lives

There is **no context and no store**. All shared state is `useState` in `NavigatorApp` (about 25 hooks) and is passed
down as props. The URL is a mirror, written with `history.replaceState` after a 300 ms debounce
(`NavigatorApp.tsx:847`). URL parameters:

| Param | State | Notes |
|---|---|---|
| `site` | `selectedId` (falls back to rank #1, or `de-gerlache-2` before the ranking loads) | Always written |
| `start` | `startMs` | `2027-11-14T00:00Z` form |
| `hours` | `durationHours` | 1 to 1440 |
| `view` | `view` | Omitted for navigator |
| `cmp` | `picked` (Compare) | Up to 3 ids |
| `custom` | custom site lat,lon | |
| `pt` | `point` picked on the Moon | |
| `at` | `nowMs − startMs` in hours | Not written while playing |
| `gap` | `gap` (flag limit) | Omitted at the default of 48 |

Incoming URL changes (for example from the landing page's form) are detected by comparing the query string during
render and reset the plan (`NavigatorApp.tsx:456`).

Other app-level state that is not in the URL: `loads` (9 site loads), `custom`/`customReq`, `system` (ephemeris),
`playing`, `change` (the change note baseline), `systemMs`, `arrival`, `fading`, and (new) `launchSiteId` and
`launchPick` (the chosen launch site and lift-off, shared by the Launch tab and the System view). **The launch choice
is not written to the URL**, so it is lost on reload and not carried by a shared link, unlike every other selection.

**Local state, not shared:**
- `MissionControls`: the text drafts, unit, search month and error/info text. It resyncs from props with a "seen"
  pattern.
- `CustomSiteForm`: its text drafts.
- `TerrainPlate`: terrain data, readiness, hover, and the camera (inside the imperative `PlateBridge`/`CameraRig`, not
  React).
- `MoonView`: framing, pick mode, landings toggle, detail tiles, its own play state.
- `SystemView`: framing, scale, focus (Earth–Moon pivot), Earth facing, its own play state.
- `LaunchPanel`: transfer time, group filter, usable-only, expanded/collapsed, the picked opportunity. These are not
  in the URL and reset when the tab unmounts (switching tabs).
- `HorizonPlot`: drag state.
- `TimelineStrip`: dragging.

**Shared across all tabs**: the window (start and length), the selected site, the gap limit, the clock (`nowMs`), the
custom site, the picked point and the Compare picks. Because the controls row sits above every tab, a change made on
any tab affects all of them.

### 5.2 What happens when …

- **Page load**: all 9 regions' tracks and horizons are fetched in parallel (`loadSite`, cached), and the ranking waits
  for all 9. Fig. 1 lazy-loads the 3.6 MB heightmap and the region outlines. Moon and System load the 2027 ephemeris
  and the textures only when opened, or when a point is picked.
- **The site changes** (ranking row, chip, Moon button):
  - `selectedId` changes, which changes `effectiveId`, then `selectedData`, then `sample`.
  - Fig. 2 is **remounted** (its error boundary is keyed by site id) and recomputes its layout and label placement.
  - Fig. 1 flies the camera to the site and rebuilds the rose.
  - The bulletin recomputes the contacts, `bestStart` over the next 14 days and the NASA check.
  - Nothing is refetched, except a custom site.
- **The start or length changes** (controls, slip, search, suggestion, undo):
  - `applyWindow` sets `startMs` and `durationHours` and clamps `nowMs` into the new window.
  - All 9 sites are re-ranked (`rankSites`), and the baseline is ranked again if a change note is open.
  - The ranking, bulletin (including `bestStart`), Fig. 2 layout, rose and Compare (4 rankings) recompute.
  - A custom site is **refetched** if its tracks don't cover the new window. Region tracks cover all of 2027, so they
    are never refetched.
  - When the Launch tab is open, it re-solves all 16 launch sites for the new arrival and its three slips.
- **The time changes** (scrub, drag, play):
  - `nowMs` updates `sample`.
  - In Fig. 1, the Sun vector changes, so the GPU light pass re-traces the shadows. Each frame of playback can trigger
    this.
  - Fig. 2 moves the "now" discs (its layout is not recomputed) and updates the readout.
  - The URL updates 300 ms after the last change, unless playing.
  - On Moon and System the year slider drives the globe or diagram. Outside the window it uses `systemMs`.
- **The gap limit changes**: only the red flags and the legend text change (ranking, bulletin, Compare).
- **The selected landing site changes**: the Launch tab's sentence names the new site, but the launch search itself
  depends only on the arrival time, not on which landing site is chosen, so its results do not change.

---

## 6. Structure

### 6.1 Component tree for /tool (line counts)

```
src/app/tool/page.tsx (18)
└─ NavigatorApp  src/components/navigator/NavigatorApp.tsx (1267)  ← all state, URL sync, loading, routing
   ├─ Masthead + Tabs  (in NavigatorApp)
   ├─ MissionControls  navigator/MissionControls.tsx (583)  (also exports time constants, fmtWhen/fmtSpan/fmtLength/fmtShift, ChangeNote)
   ├─ [navigator]
   │  ├─ RegionTable + CustomSiteForm  navigator/RegionTable.tsx (445)
   │  ├─ TerrainPlate (dynamic, no SSR)  navigator/TerrainPlate.tsx (729)
   │  │  ├─ LevelNav, ZoomHint  levels/LevelNav.tsx (76); useZoomGate  levels/useZoomGate.ts (102)
   │  │  ├─ terrain/Scene.tsx (205) → engine.ts (339), shaders.ts (354), rig.ts (194), data.ts (261), geo.ts (128)
   │  │  ├─ terrain/bridge.ts (386), PlateLabels.tsx (201), rose.ts (560), RoseLayer.tsx (125), icons.tsx (79), constants.ts (78)
   │  │  └─ terrain/PlanView.tsx (171)  (no-WebGL fallback)
   │  ├─ HorizonPlot  navigator/HorizonPlot.tsx (1104)
   │  │  ├─ plot/contacts.ts (133), tracks.ts (147), labels.ts (129), scale.ts (103), format.ts (95), hooks.ts (40)
   │  │  └─ TimelineStrip (compact)  navigator/TimelineStrip.tsx (444)
   │  └─ SiteBulletin  navigator/SiteBulletin.tsx (568)  (also exports pct/degrees/spell/dayClock, button classes, SelectField, icons, contactsFor, covers)
   ├─ [moon]  MoonView (dynamic)  moon/MoonView.tsx (984)
   │  ├─ marks.tsx (420), moonMaterial.tsx (175), globeShader.ts (157), siteTarget.ts (47)
   │  ├─ tiles/TileLayer.tsx (190), manager.ts (238), schemes.ts (170), select.ts (125)
   │  ├─ PointPanel  moon/PointPanel.tsx (282)  → TimelineStrip
   │  └─ YearSlider  system/YearSlider.tsx (118), LevelNav
   ├─ [system]  SystemView (dynamic)  system/SystemView.tsx (1768)  → system/earthGlobe.tsx (285), moon/marks, moonMaterial, YearSlider, LevelNav
   ├─ [launch]  LaunchPanel  launch/LaunchPanel.tsx (540) → launch/LaunchDetail.tsx (302), launch/launchFormat.tsx (90)
   ├─ [compare]  ComparePanel  navigator/ComparePanel.tsx (436)  → TimelineStrip ×(1 + picks); exports tiedRanks
   └─ [about]  AboutPanel  navigator/AboutPanel.tsx (393)
lib: sky.ts (288), horizons.ts (326), customSite.ts (425), localTerrain.ts (471), anySite.ts (182), horizonFromGrid.ts (384),
     system.ts (126), moonFrame.ts (142), earthFrame.ts (124), launchWindow.ts (447), launchSites.ts (291),
     terrain.ts (118), validation.ts (68), sites.ts (26), moontrek.ts (18)
```

The total UI for /tool is about 13,800 lines of TSX/TS (about 11,000 before the Launch tab and the Earth globe).

### 6.2 The largest and most tangled pieces

- **`NavigatorApp.tsx` (1267)** does several jobs at once:
  - URL parsing, writing and incoming-change detection.
  - Data loading for 3 kinds of site (region, polar custom, global custom via Moon Trek, plus the smooth-horizon
    point).
  - Ranking and baseline ranking.
  - Selection fallback rules, two clocks and two playback paths.
  - Level/zoom crossfade orchestration, and building about 20 derived props for 6 panels.
  - The custom-site special cases (`plateLocal`, `methodNote`, `customTag`, `customNote`) spread across about 80
    lines.
- **`SystemView.tsx` (1768, now the largest file)** and **`MoonView.tsx` (984)** each contain a scene, a rig, labels,
  a fallback chart, a header, an aside readout, a legend and loading/error states in one file. SystemView now also
  holds three framings with their own camera limits, glide and presets, the Earth facing logic and the launch-site
  wiring.
- **`NavigatorApp.tsx`** grew by about 30 lines to wire the Launch tab and pass launch-site props into SystemView.
- **`HorizonPlot.tsx` (1104)** holds the layout engine (`computeLayout`, about 225 lines), the SVG, the now readout,
  the legend, a second unused-in-rail `Circumstances` table, the sticky axis and the screen-reader description.
- **`SiteBulletin.tsx` (568)** has become the shared utility and style module: `MissionControls`, `RegionTable`,
  `ComparePanel`, `PointPanel` and `NavigatorApp` import formatting, button classes, icons, `covers` or
  `contactsFor` from it. **`MissionControls.tsx`** also exports the time constants and formatters used by
  NavigatorApp, Compare and PointPanel. **`ComparePanel.tsx`** exports `tiedRanks`, which NavigatorApp needs.

### 6.3 Duplicated JSX and logic

| What | Copies |
|---|---|
| Month-name array `["Jan", …]` | 5 (`MissionControls`, `SiteBulletin`, `plot/format`, `YearSlider`, `landing/model`); `launchFormat.tsx` adds its own date formatters (`fmtDate`, `fmtClock`, `fmtDateTime`) |
| `HOUR_MS` / `DAY_MS` constants | `MissionControls` (`HOUR`, `DAY`), `plot/format`, `launchFormat`, `YearSlider`, `PointPanel` |
| Uppercase label class | `SiteBulletin.fieldLabel`, `launchFormat.capsLabel`, the `H3` strings |
| Slip analysis | Compare "If the start slips" (+0/+1/+2 weeks, landing regions) and Launch "If the landing slips" (+0/+1 day/+1/+2 weeks, launch sites): similar table, separate code |
| `fmtSpan` (window text) | 2 different implementations (`MissionControls.tsx:61`, `plot/format.ts:80`) |
| `fmtShift` | 2 (`MissionControls.tsx:77`, `plot/format.ts:65`) |
| Day + time formatter | `SiteBulletin.dayClock` vs `plot/format.fmtDayTime` (one rounds to the minute, one doesn't) |
| Full UTC time | `plot/format.fmtFull`, `YearSlider.fmtUtc`, `lib/sky.formatUtc` (unused) |
| Duration formatter | `plot/format.fmtDuration` vs `lib/sky.formatHours` (the latter is used only in the score reasons) |
| Latitude/longitude text | `sites.formatLatLon`, MoonView `fmtLat`/`fmtLon`, PointPanel `fmtLat`/`fmtLon`, TerrainPlate `latText`/`lonText` |
| Percent formatting | `SiteBulletin.pct` (never rounds to 0 or 100), `TimelineStrip RowCaption` (plain round), `scoreWindow` reasons (plain round) |
| `StateSwatch` (10 px square) | `HorizonPlot.tsx:591`, `TimelineStrip.tsx:437` (identical) |
| Table `Row` component | 5 variants (SiteBulletin, MoonView, SystemView, PointPanel, landing/Answers) |
| `H3` heading class string | 3 (MoonView, SystemView, PointPanel) |
| WebGL check + error boundary | 3 each (TerrainPlate, MoonView, SystemView), plus `PanelBoundary` in NavigatorApp |
| Segmented toggle | `LevelNav`, SystemView `Segmented`, MoonView's inline "View from" group |
| Playback loop | NavigatorApp (window) and `useYearPlayback` (year) |
| Sun/Earth "up" test | 3 (see §3.3) |
| Colour hexes | `globals.css`, `terrain/constants.ts`, MoonView and SystemView constants |
| Skeleton rows | Separate skeletons in NavigatorApp, RegionTable, SiteBulletin, ComparePanel, AboutPanel |

---

## 7. Observations

### 7.1 Cluttered, repeated or confusing for a first-time user

1. **The 3D view, the main visual, gets only 15% of the screen at 1440×900 and 10% at 1280×800.** At 1280×800 the
   plate is 560×182 px, a thin strip under a three-line caption.
2. **Navigation is doubled.** Each of the Navigator, Moon and System tabs shows both the masthead tabs and a
   SYSTEM/MOON/SITE control with up/down buttons, and the two use different words for the same level
   (Navigator = Site). Wheel-zooming past a limit also silently changes tab, which can surprise someone who is only
   trying to zoom.
3. **Too many "start date" tools.** Typed start, month search, +1 and +2 week slips, the bulletin's "Move start to"
   (below the fold) and Compare's slip table. "Find best start in" searches **for the selected site only**, but sits
   in the global bar, so it reads as if it searched all regions.
4. **The window is printed three times** on the Navigator tab, in two formats, plus the inputs.
5. **The ranking doesn't show the score that ranks it.** The score appears only in the bulletin header and on
   Compare. The ranking shows Sun %, Earth % and longest dark. The 45/30/25 weights are explained only below the fold
   in the bulletin and in About.
6. **The Earth % column turns red to mean "the comms gap is too long"**, which is a different metric from the
   percentage shown. A user reads "67%" in red as "67% is bad".
7. **Jargon throughout**: "Mean disc power", "terrain +0.2°", "elevation ×4.4", "Ticks 6 h (Earth 24 h), heavy at
   00h UTC", "LOLA LDEM_80S", "T+0 h", "Circumstances", "Contacts" (meaning rise and set events). "Circumstances"
   means window statistics in the bulletin but instantaneous geometry on the Moon and System tabs.
8. **Fig. 1's caption holds too much**: title, level navigation and a four-item legend whose last item is a sentence
   ("Bearings to the Sun and to Earth, ticked as Fig. 2"). It wraps to 2–3 lines and takes height from the plate.
9. **The plate is busy**: score-tinted outlines, chips, a flag, landmarks, graticule labels, the bearing rose with 30°
   labels and hour ticks, Sun and Earth edge indicators with az/el boxes, a scale bar and a note.
10. **Important content is below the fold** in both side columns: the custom-site form, the gap-limit legend, the
    scoring explanation, the better-start suggestion and the NASA check.
11. **Two Play buttons behave differently** (12 s for the window vs 6 days per second for the year). Scrubbing
    outside the window on Moon or System uses a separate clock that resets on returning to the Navigator.
12. **The custom-site form contradicts itself.** Its help text says "Any point on the Moon", but validation rejects
    any northern latitude with "The terrain covers the south pole only. Use a negative latitude between −80 and −90"
    (`RegionTable.tsx:325`), even though southern points north of 80° S are accepted. Meanwhile, a point picked on the
    Moon globe in the north can be opened at site level through "Open site level", which skips that validation.
13. **The controls row appears on About & data** (and Compare and System), where only part of it applies. On About it
    is noise.
14. **About is about 7 screens long.** The bulletin's "How the numbers are made and checked" link jumps into the
    middle of it.
15. **The Compare chips are in file order, not rank order**, so the best regions aren't first.
16. **Small type**: many labels are 0.702–0.75rem (11–12 px), including all axis labels, plate chips and legends.
17. **The Launch tab answers a different question** (when to leave Earth) inside a page framed as a "Landing window
    bulletin". It sits between System and Compare, and it ignores most of the Navigator's context: the launch search
    depends only on the window start, not on the selected landing region. The only links between them are the
    sentence naming the site and the transfer arc on the System view.
18. **The launch choice doesn't survive a reload or a shared link** (not in the URL), and the Launch tab's filters
    reset when the user switches tabs.
19. **The System header is getting crowded**: three framings, two scales, the level nav, then in some framings an
    extra bar (Centre on and presets, or 18 Face buttons). It pushes the canvas down.

### 7.2 What matters to whom

**Mission planner** (choose a region and a window, defend the choice):
- Ranking, the window controls and slip analysis, longest dark and longest without comms against a limit,
  rise/set times (Contacts), the score breakdown, the better-start suggestion, Compare and the NASA cross-check.
- Fig. 2 and the time rail answer "when exactly do we lose Sun or Earth". The 3D plate is supporting context.
- **Hidden or buried for this user**: the score and weights, the comms-gap number in the ranking, the suggestion and
  the slip analysis (Compare only).

**Educator or student** (understand why the south pole is hard):
- Fig. 1 (shadows, the bearing rose), the Moon globe (sub-solar point, terminator, libration), the System diagram
  (scale, phases), the Fig. 2 panorama with tracks dipping behind the terrain, Play, and About.
- **Hidden or buried for this user**: the 3D views are small on the Navigator tab, the technical labels need
  explaining, and the narrative order (System → Moon → Site) runs opposite to the tab order (Navigator first).

The page currently tries to serve both on one screen. Every planner number and every educational view is visible at
once, so neither gets room.

### 7.3 Responsive behaviour

The breakpoints are Tailwind's defaults: `sm` 640, `md` 768, `xl` 1280.

- **≥1280 (`xl`)**: the locked one-screen layout described above, with 3 columns of 384 / flexible / 336 px. **1280 is
  exactly the breakpoint, so a 1280×800 laptop gets the most cramped version**: the plate is 560×182, the caption
  wraps to 3 lines, the centre column scrolls internally (723 px of content in 628 px) and Fig. 2's readout wraps.
- **768–1279 (`md`)**: the height lock is removed and the whole page scrolls (2281 px tall at 1180×820). Measured at
  1180×820:
  - **Grid**: two columns. The ranking is on the left (`minmax(19rem,22rem)`, 352 px, spanning both rows), with
    Fig. 1, Fig. 2 and then the bulletin stacked on the right.
  - **Fig. 1**: the plate grows to a fixed `h-[30rem]` (480 px; canvas 828×417), better than at 1440.
  - **Masthead**: the tabs drop to their own full-width row, so the masthead grows to 76 px.
  - **Bulletin**: it moves under Fig. 2 at y≈1106, so the details for the selected site are a long scroll away from
    the ranking that selects it.
  - **Fig. 2**: `usePlotHeight` returns undefined, so the drawing height uses defaults of 196 or 216 px.
  - **At 768 px**: the right column is only 416 px wide, so Fig. 2's SVG (min 480 px with the rail) **scrolls
    sideways** ("Scroll sideways for all 360°" appears), and the Fig. 1 caption wraps to 4 lines (112 px).
- **<768**: a single column, 3548 px tall at 390×844. The controls stack into 271 px. The **ranking (953 px) comes
  before the 3D plate**, which starts at y≈1386 (the second screen and a half on a phone) and is 390×272. Fig. 2
  scrolls sideways (640 px SVG in 390 px), the time rail and readout stack, and the bulletin follows at y≈2313. The
  masthead tabs are squeezed into one row (`text-[0.79rem]`, `flex-1`). **With six tabs they no longer fit at
  390 px: "About & data" is cut off at the right edge** ("About & dat"), with no scroll or wrap.
- **Moon and System below `xl`**: the right aside stacks below the canvas (`min-h-[24rem]` / `min-h-[22rem]`), and the
  header buttons wrap onto several rows.
- **Compare**: the tables scroll sideways inside `overflow-x-auto` regions (the slip table has `min-w-[46rem]`, with a
  "Swipe the table sideways" hint below `md`).
- **About**: the table-of-contents column is hidden below `xl`.
- **Launch**: responds to its own width (container queries), not the viewport. The 9-column table appears only when
  the panel is at least 72rem (1152 px) wide; below that each site is a stacked card with labelled values (2, 3 or 5
  columns at the `@xl`, `@3xl` breakpoints). The slip table switches to columns at 56rem (`@4xl`).

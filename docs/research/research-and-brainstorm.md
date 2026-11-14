# Research and brainstorm: Lunar Landing Site Navigator

Branch `ryan/research` (local only, not pushed). Written overnight Fri Nov 13 → Sat Nov 14, 2026.
Markdown only, no code. Prepared for Ryan with AI assistance (Claude), which the team should
count in the submission's "Use of AI" section if any of this is used.

**Status of everything here: research and proposals.** Nothing is a team decision. Anything that
touches the shared design, stack, data or who-does-what is listed as a question in section 7.
Sri's scaffold in `moon-planner/` is the base to build on, not something to replace.

How to read the confidence labels used below:

- **[checked tonight]** I opened the primary source or ran the query myself tonight.
- **[third-party]** comes from someone else's analysis. Useful, but verify before it goes in the app.
- **[from the plan]** carried over from `space-apps-plan.md`, not re-checked tonight.

---

## 1. Everything in one place

| What | Where | Notes |
|---|---|---|
| Official challenge text | [spaceappschallenge.org, Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/) | Summarized in section 2 [checked tonight] |
| Team plan (Alvin's Google Doc, "NASA Space Apps") | https://docs.google.com/document/d/1-S3vYRvTtv38bnKK7jxvQSae527k8ABZ_EpnV0i9bPY/edit | Goals, 9 sites, data sources, design idea, framework, references [checked tonight] |
| The repo | `moon-planner/` (Next.js 16.4.6, React 19.3, Tailwind 4, three + react-three-fiber + drei) | Starter page only so far; 7 of 8 commits by Sri [checked tonight, commit `61ce6fd`] |
| Full hackathon plan | `space-apps-plan.md` (copy in this folder) | Architecture, pipeline, features, timeline, submission checklist, open questions |
| Two-machine workflow | `two-machine-workflow.md` (copy in this folder) | Mac + HP + cloud, branch rules, lanes (proposals) |
| This doc | `research-and-brainstorm.md` | New research, a live Horizons test, prior art, brainstorm |

### Schedule (Arizona time, Phoenix virtual event)

| When | What |
|---|---|
| Sat Nov 14, 9:00am | Judge intros + livestream. Submission opens. Coding may start. |
| Sat 3pm and 6pm | Mentor Zoom sessions |
| Sun Nov 15, 3pm and 6pm | Judges available for questions |
| **Sun Nov 15, 11:59pm** | **Submission deadline** (target 10pm, see the plan) |
| By Nov 22 | Winners emailed |

### Ryan's working rules (apply to Claude too)

- Work on `ryan/<feature>` branches. Never push to `main`.
- No push, merge, PR or deploy without Ryan's explicit "yes".
- Don't overwrite or refactor teammates' work. Team-level choices go on the question list.
- Double-check all coordinates, units and reference frames.
- No `CLAUDE.md` in the repo, ever.

---

## 2. What the challenge actually asks for [checked tonight]

The gap NASA describes: QuickMap, Moon Trek and JPL Horizons are "built for detailed analysis" and
hard for non-specialists to use "for rapid scenario comparison." They want an intuitive tool that
turns ephemeris and topography into "clear, comparable visualizations."

Things the text calls out by name. These are the closest thing to a judging checklist we have:

1. **Site selection and comparison.** A curated list (they suggest past Apollo sites, CLPS targets,
   other commercial and international landers) plus **custom coordinates**. Side-by-side comparison.
2. **Date and time flexibility.** Explore how conditions change over lunar days and seasons.
3. **Sun and Earth vs the horizon** at a chosen site and date. They specifically mention
   **"how much time remains before sunset or Earthset."**
4. **Power and comms metrics:** solar elevation angle, duration of sunlight, Earth visibility windows.
5. **Multiple views:** 2D maps, 3D surface, "or other creative representations."
6. **Temporal dynamics:** animations or timelines across a lunar day or many days.
7. **Accessibility across skill levels:** planners, educators, the public.

Themes from the background and "considerations" that are easy to miss:

- **Schedule slips are the core use case.** "Hardware development challenges, launch delays... force
  mission planners to reconsider their original landing date and location." A tool that answers
  "what if we slip two weeks?" or "what about the site next door?" hits the brief directly.
- **"Why small location or date changes have large impacts."** They want this made visible.
- **No atmosphere:** the horizon is "local terrain and the edge of the lunar sphere." No refraction.
- **Libration** ("Earth's libration (wobble)") is named. Earth is not fixed in the lunar sky.
- **Real topography** for horizons is encouraged, not required.
- **Make lunar-vs-Earth differences striking** (a 2-week "day", a Sun that circles the horizon).
- Pre-computed datasets are explicitly allowed.

The team's doc already covers 1, 3, 4, 5 and part of 6. The least covered are the countdown to
sunset/Earthset, the schedule-slip comparison, and the "small move, big change" idea.

---

## 3. Research findings

### 3.1 Site coordinates

NASA published the nine Artemis III regions as **areas, not points**. The official outlines are the
USGS grids: McClernan 2024, *Down Selected Artemis III Candidate Landing Site Navigational Grids*,
[doi:10.5066/P1MEQ6UK](https://doi.org/10.5066/P1MEQ6UK). I confirmed tonight [checked tonight] that
the ScienceBase item lists one zip per region (68 MB to 1.2 GB each) plus a small
**`A3_9regions-lonlat-simplified.zip` (637 KB)** that holds all nine outlines in lon/lat. That small
file is the one to use. I have **not downloaded it** (see section 8).

**Region centres below are [third-party].** They come from an open-source project, LunaNav
([`data/sites.yaml`](https://github.com/yutuf/lmNasa/blob/HEAD/data/sites.yaml), MIT license), which
says each is the area-weighted centre of the USGS 1 km grid. They pass my sanity checks against the
named craters (for example, Nobile Rim 1 lands about 39 km west of Nobile's centre, which is on its
79 km-wide rim). Treat them as placeholders until we recompute them from the USGS file ourselves.

| Region | Lat (°, south negative) | Lon (°E, −180..180) | Lon (°E, 0..360, Horizons style) | Region area [third-party] | Notes |
|---|---|---|---|---|---|
| Peak near Cabeus B | −83.6514 | −68.7263 | 291.2737 | 441 km² | Farthest from the pole (~193 km) |
| Haworth | −86.7661 | −22.6199 | 337.3801 | 930 km² | |
| Malapert Massif | −86.0 | 0.0 | 0.0 | 462 km² | Not a computed centre. LROC describes "the relatively flat area (86°S, 0°E)" as the heart of the region ([LROC post 1294](https://lroc.im-ldi.com/images/1294)). Whole degrees only, so ±15 km in latitude. |
| Mons Mouton Plateau | −84.3375 | 30.6186 | 30.6186 | 4524 km² | By far the largest region |
| Mons Mouton | −85.4218 | 31.6755 | 31.6755 | 289 km² | Overlaps the Plateau region |
| Nobile Rim 1 | −85.4338 | 37.3276 | 37.3276 | 441 km² | |
| Nobile Rim 2 | −83.9545 | 58.7938 | 58.7938 | 420 km² | |
| de Gerlache Rim 2 | −88.2263 | −65.1126 | 294.8874 | 441 km² | Closest to the pole (~54 km) |
| Slater Plain | −87.1697 | 125.4596 | 125.4596 | 441 km² | Leans toward the far side |

Things to keep straight:

- **A region centre is not a landing point.** LunaNav reports that Sun-plus-Earth availability at the
  centres ranges from 2% (Slater Plain) to 28% (Nobile Rim 2), while the best ground inside each
  region reaches 35% to 84% [third-party]. Whichever point we show, the UI should say what it is.
- Regions are roughly 21 × 21 km (441 km²), not the "15 × 15 km" of the 2022 announcement.
- Frame for all of the above: planetocentric, Moon Mean Earth (ME).
- The named-crater coordinates in `space-apps-plan.md` section 3.1 are *nearby features*, kept there
  as a cross-check only.

Other cited points that could go in a curated list (the challenge suggests non-Artemis sites too).
As cited by LunaNav, to verify at the source before use [third-party]:

- IM-2 "Athena" resting place on Mons Mouton: 84.7906°S, 29.1957°E ([LROC post 1408](https://lroc.im-ldi.com/images/1408)). It sits inside the Mons Mouton *Plateau* region.
- Shackleton–de Gerlache connecting ridge: 89.4395°S, 222.8066°E (Gläser et al., EPSC 2014-136).
- Apollo 11 as an equatorial contrast: 0.67408°N, 23.47297°E.

How NASA's older site codes map to today's region names (useful when reading LOLA products)
[checked tonight, from [arXiv:2406.19863](https://arxiv.org/html/2406.19863v2) Table 1 and the PGDA site list]:
Site06 = Nobile Rim 1, DM2 = Nobile Rim 2, Site20 = Leibnitz Beta Plateau (the old name for the
Mons Mouton area), Site23 = Malapert Massif, SL2 = de Gerlache Rim 2, Haworth = Haworth.
Slater Plain, Mons Mouton and Peak near Cabeus B have no 5 m site DEM under those names.

### 3.2 JPL Horizons: a live test [checked tonight]

I ran the Horizons API for a point on the Moon to confirm the approach in the plan works. It does.

Query settings that worked (placeholder point: 0°E, 86°S, height 0):

- `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `SITE_COORD='<E-lon deg>,<lat deg>,<height km>'`
- `COMMAND='10'` for the Sun, `'399'` for Earth
- `EPHEM_TYPE='OBSERVER'`, `QUANTITIES='4'` (apparent azimuth and elevation), add `13` for angular diameter
- `START_TIME`, `STOP_TIME`, `STEP_SIZE`

What Horizons reported about itself for that query:

- Frame: **`MEAN_ME (high precision)`**, east longitude positive. Same frame family as LOLA.
- Reference surface: sphere of **1737.4 km**. Height in `SITE_COORD` is above that sphere, in km.
- `Atmos refraction: NO (AIRLESS)`. Ephemeris: DE441.
- Times are UTC.

Sample output, 0°E 86°S, height 0, Nov 14 to Dec 14, 2026 (every 3 days):

| Date (00:00 UTC) | Sun az | Sun el | Earth az | Earth el |
|---|---|---|---|---|
| Nov 14 | 126.6° | −0.83° | 358.8° | −0.65° |
| Nov 17 | 90.2° | +1.54° | 354.8° | +3.02° |
| Nov 20 | 53.8° | +3.91° | 352.7° | +7.14° |
| Nov 23 | 17.2° | +5.35° | 354.7° | +9.98° |
| Nov 26 | 340.7° | +5.29° | 0.2° | +9.45° |
| Nov 29 | 304.2° | +3.74° | 5.2° | +5.56° |
| Dec 2 | 267.8° | +1.32° | 6.9° | +0.90° |
| Dec 5 | 231.4° | −1.04° | 5.9° | −2.20° |
| Dec 8 | 194.8° | −2.42° | 3.4° | −2.73° |
| Dec 11 | 158.2° | −2.29° | 359.7° | −0.74° |
| Dec 14 | 121.7° | −0.72° | 355.6° | +2.92° |

What this shows, and it is the whole story of the south pole in one table:

- The **Sun circles the full horizon** about once a month and never gets higher than ~5°.
- **Earth barely moves in azimuth** (it hovers within ~7° of due north here) and bobs up and down
  by about ±6.5° over a month because of libration. It dips below the ideal horizon for days.
- Angular sizes: Sun ≈ 0.54° across (radius 0.27°). Earth ≈ 1.8° to 2.0° across (radius 0.90° to 1.02°).
  Partial visibility of either disk is a real state, not an edge case.

Two practical catches:

1. **No CORS header.** A GET with an `Origin` header returned `200` with no
   `Access-Control-Allow-Origin`. A browser page can't call Horizons directly. It needs a
   server-side hop (a Next.js route handler) or data fetched ahead of time.
2. **Elevation is measured from the ideal sphere horizon, not the terrain.** Horizons knows nothing
   about mountains. Also, if we pass height 0 for a site that really sits kilometres up, we misstate
   the geometry. See 3.5 for how much height matters.

### 3.3 SPICE and other ways to compute the same angles

Kernel files confirmed to exist on NAIF tonight [checked tonight]
([generic_kernels](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/)):

| Kernel | File | Size |
|---|---|---|
| Planet/Moon positions | `spk/planets/de440s.bsp` (or `de442s.bsp`, 2025) | 31 MB |
| Moon orientation | `pck/moon_pa_de440_200625.bpc` | 12 MB |
| Moon frames (defines `MOON_ME`) | `fk/satellites/moon_de440_250416.tf` | small |
| Body constants | `pck/pck00011.tpc` | 128 KB |
| Leap seconds | `lsk/naif0012.tls` | small (name from memory, not re-listed tonight) |

Options side by side:

| Option | Runs where | Pros | Cons |
|---|---|---|---|
| **A. Horizons, fetched ahead of time** | A one-off fetch, results saved as JSON | Named in the challenge and in Alvin's doc. No kernels, no frame setup. Proven tonight. | One request per site × body. No terrain. |
| **B. SPICE (spiceypy) or Skyfield in Python** | Offline pipeline | Fast for many points and grids. Full control of frames. | Setup time. Adds Python to a JS repo. |
| **C. A JS ephemeris library in the browser** | Client | Custom coordinates with no backend. Works offline at the judging table. | Needs the Moon's orientation model, and validation against Horizons. Whether a library such as `astronomy-engine` exposes enough for a lunar-surface observer is **unverified**. |
| **D. Horizons live via a Next.js route** | Server | Lowest-effort live path for custom coordinates. | Network dependency during the demo. Rate and latency unknown. |

A shortcut worth knowing [third-party, LunaNav's README]: the Sun and Earth are so far away that
moving 1 km on the Moon changes their direction by less than 0.0002°. So one time series per region
can be **rotated into the local frame of any nearby point** with plain trigonometry, with no new
ephemeris call. (Earth is close enough that a parallax correction matters over long distances:
they quote 0.33° error at 2,700 km without it.) This makes "nudge the site 500 m" cheap.

### 3.4 Terrain data (LOLA) [checked tonight]

Everything below is south polar stereographic, `MOON_ME` frame (DE421), radius 1737.4 km.

| Product | What it is | Size / resolution | Use for us |
|---|---|---|---|
| [PGDA product 69](https://pgda.gsfc.nasa.gov/products/69), Mazarico et al. 2011 | **Ready-made maps**: average solar illumination, average Earth visibility, permanent shadow, sky visibility. Averaged hourly over 18.6 years. | 60 m/px for 85–90°S, 120 m/px for 75–90°S, 240 m/px for 65–90°S. IMG, JP2, GeoTIFF and **cloud-optimized GeoTIFF**. | A heat map with **zero computation**, and an independent check on our numbers. |
| [PGDA product 78](https://pgda.gsfc.nasa.gov/products/78), Barker et al. 2021 | 5 m/px site DEMs with **slope maps** and uncertainty maps | Per site. Sites include Site06, Site20/20v2, Site23, Haworth, DM2, SL2 | Slope per site, and close-up 3D terrain |
| [PGDA product 81](https://pgda.gsfc.nasa.gov/products/81) | 5 m/px mosaic of 87–90°S | 3.3 GB DEM, 4.9 GB slope | Too big for a weekend. Skip. |
| LOLA polar gridded DEMs on PDS (for example 20 to 80 m/px, 80–90°S) | Wide-area terrain | Hundreds of MB | Horizon masks, since horizons are set by terrain up to ~100–150 km away |

Caveats:

- The 60 m illumination map stops at 85°S. **Peak near Cabeus B (83.7°S), Nobile Rim 2 (84.0°S) and
  Mons Mouton Plateau (84.3°S) fall outside it.** Use the 120 m, 75–90°S product for all nine.
- Mazarico's Earth visibility counts Earth as visible if *any part* of its disk shows, which the
  page itself calls "very slightly optimistic" for radio links.
- 5 m DEMs are ~90% interpolated between laser tracks. Median slope error is 1.5° to 2.5°. Slope
  depends on the baseline it is measured over, so the UI should state the baseline.
- These averages cover 18.6 years. A specific two-week mission can be far better or worse.

### 3.5 Polar geometry cheat sheet (computed tonight from the coordinates in 3.1)

Simple formulas, ideal sphere, no terrain. Good for sanity-checking anything the pipeline outputs.

- **Highest the Sun can ever get** ≈ (90° − |latitude|) + 1.54° (the Moon's tilt to the ecliptic).
- **Earth's average elevation** = asin(cos(lat) · cos(lon)). Libration then moves it roughly ±6.5° to ±8°.
- **Direction to Earth** is close to "toward the near side": due north at 0° longitude.

| Region | Max Sun elevation | Earth's average elevation | Earth sits toward (azimuth) | Distance from pole |
|---|---|---|---|---|
| Peak near Cabeus B | 7.9° | +2.3° | 69° (ENE) | 193 km |
| Haworth | 4.8° | +3.0° | 23° (NNE) | 98 km |
| Malapert Massif | 5.5° | +4.0° | 0° (N) | 121 km |
| Mons Mouton Plateau | 7.2° | +4.9° | 329° (NNW) | 172 km |
| Mons Mouton | 6.1° | +3.9° | 328° (NNW) | 139 km |
| Nobile Rim 1 | 6.1° | +3.6° | 323° (NW) | 139 km |
| Nobile Rim 2 | 7.6° | +3.1° | 301° (WNW) | 183 km |
| de Gerlache Rim 2 | 3.3° | +0.8° | 65° (ENE) | 54 km |
| Slater Plain | 4.4° | **−1.6°** | 235° (SW) | 86 km |

The Malapert row matches the Horizons test in 3.2 (Sun peaked at 5.35°, Earth ranged −2.7° to +10.0°
around a +4° mean), so the formulas and the query agree.

Takeaways:

- Every number that matters is **a few degrees**. A ridge that subtends 3° decides everything.
- **Slater Plain's Earth sits below the ideal horizon on average.** Comms there depend on
  libration and on height. This is a nice teaching example of "why site choice matters."
- **Height buys horizon.** How far the ideal horizon drops below level as you go up:

| Height above the 1737.4 km sphere | Horizon dip | Distance to horizon |
|---|---|---|
| 2 m (a mast) | 0.09° | 2.6 km |
| 10 m | 0.19° | 5.9 km |
| 1 km | 1.9° | 59 km |
| 3 km | 3.4° | 102 km |
| 5 km | 4.3° | 132 km |

  A massif top several km up can see the Sun and Earth when they are *below* 0° elevation. So the
  site height we pass to Horizons, and the terrain around it, both matter as much as the ephemeris.

### 3.6 Prior art: LunaNav, an open-source tool for this same problem [checked tonight]

[github.com/yutuf/lmNasa](https://github.com/yutuf/lmNasa) ("LunaNav"), MIT license, created Nov 10
and updated as recently as Nov 14 (UTC). I can't tell whether it is a Space Apps entry. It is
public, so judges and other teams can see it too. What it does, per its README:

- Vite + React + three.js web app, plus a Python package and a Streamlit planner.
- **Search instead of pick:** scores 21,856 points on a 2 km grid around the pole, hourly, against
  each point's real LOLA horizon, for a mission you describe (length, minimum sunlight, Earth contact,
  longest darkness, battery, slope).
- GO / NO-GO verdicts in one sentence, a 360° horizon view with Sun and Earth paths, a sunlight map
  you can scrub, compare 2 to 4 sites, shareable links, CSV export, a DSN check, an AI guide,
  a rover game, English and Turkish.
- Data: JPL DE440 via Skyfield, LOLA DEMs, Mazarico illumination maps for validation, USGS regions.

What this means for us (my read, for the team to weigh):

- **We should not try to out-feature it in 39 hours,** and we must not copy it. Space Apps asks for
  original work and for every outside source to be credited. If we use any of its numbers (such as
  the centres in 3.1), we credit it and verify them ourselves.
- It validates the approach in our plan: precompute offline, ship static data, compare against a
  real terrain horizon, check against Mazarico.
- It is dense and expert-leaning. The challenge's stated gap is *intuitive* and *rapid comparison*
  for non-specialists. A simpler, clearer, more visual tool built around the team's own design
  (3D view in the centre, 2 to 3 sites side by side, sliders, a time scrubber) can still stand out
  on Presentation, Creativity and Relevance.
- Its own "limits" list is a map of open ground: no thermal model, no relay satellites, slopes from
  a 40 m map, an illustrative lander.

Other tools the challenge names, for reference: [QuickMap](https://quickmap.lroc.asu.edu/),
[Moon Trek](https://trek.nasa.gov/moon/), [Horizons](https://ssd.jpl.nasa.gov/horizons/).

### 3.7 2025 global winners (partial)

The official [2025 winners page](https://www.spaceappschallenge.org/2025/awards/global-winners/)
renders its list with JavaScript and I couldn't read it tonight. From a web search summary, not
verified against the official page: Resonant Exoplanets (Best Use of Data), Astro Sweepers
(Galactic Impact), SpaceGenes+ (Best Use of Science), Zumorroda-X (Art & Technology), Twisters
(Best Use of Technology), HerCode Space (Best Use of Storytelling). Ten winners were picked from
11,500+ submissions. Someone should open the page in a browser Saturday and skim two or three
winning project pages for what their demos look like.

Judging criteria [from the plan]: Impact, Creativity, Validity, Relevance, Presentation. NASA data
use is required for a global award.

---

## 4. Brainstorm

Ideas only. Grouped so the team can pick. Each has a rough size: S (under 2 h), M (2 to 5 h), L (more).

### 4.1 Ideas that answer the brief's exact words

| Idea | Why | Size |
|---|---|---|
| **"Time until sunset" and "time until Earthset" countdowns** on each site card | The challenge names this twice. Few tools show it up front. | S once the data exists |
| **Schedule-slip slider:** "launch slips by N days" re-scores every site | The background section's central scenario | M |
| **Compare matrix:** 2 to 3 sites × 2 to 3 dates in one grid, colour-coded | "Rapid scenario comparison" in one glance. Matches Alvin's design. | M |
| **"Nudge it" control:** move the point 500 m or 1 km and watch the numbers jump | "Why small location changes have large impacts" | M (needs horizon data near the site) |
| **Sky strip:** a 360° unrolled horizon with the terrain silhouette, the Sun's path and Earth's little loop | The clearest single picture of the problem. Works in 2D if 3D slips. | M |
| **Earth vs Moon contrast card:** "On Earth the Sun climbs 60°. Here it never passes 5°." with Apollo 11 as a comparison site | "Make the differences apparent" | S |

### 4.2 Ideas built on the team's design (3D centre, bars around it)

| Idea | Why | Size |
|---|---|---|
| **3D terrain patch per site** from a downsampled LOLA height map in react-three-fiber, with a directional light at the real Sun azimuth/elevation | Shadows come for free from the renderer. The time scrubber then *is* the shadow animation from Alvin's doc. | M to L |
| **Earth as a small sprite in the sky** at its real az/el, with a line-of-sight beam that turns red when terrain blocks it | Makes "direct-to-Earth comms" visible, not just a number | S to M |
| **Heat map from NASA's own maps** (PGDA 69 average illumination or Earth visibility draped on the terrain) | A "sun heat map" without computing one | M |
| **Vertical exaggeration toggle** and a "true scale" badge | Polar relief is subtle at true scale. Honest labelling helps Validity. | S |
| **Sidebar sliders** (min solar, max slope, mission duration) that grey out sites failing the limits | Already in the team's plan. Pairs well with the compare matrix. | M |
| **"More info" tab** as an explain mode: what libration is, why the Sun circles, glossary | Covers educators and the public. Already hinted at in Alvin's doc. | S to M |

### 4.3 Ideas that add depth for planners

| Idea | Why | Size |
|---|---|---|
| **Mission presets:** "14-day CLPS lander", "crew surface stay", "rover" set the sliders | Speeds up the demo and shows the audience range | S |
| **Mast height slider** (2 m, 10 m) | Section 3.5 shows height matters. Cheap if horizons are precomputed at a couple of heights. | M |
| **Simple power estimate** from the visible fraction of the Sun's disk, clearly labelled as illustrative | Turns angles into "power generation potential" | S to M |
| **Longest dark gap and longest comms gap** per mission window | More decision-relevant than averages | S |
| **Confidence note** per number: "terrain model uncertainty ±X" | Validity. PGDA publishes uncertainty maps. | S for a text note |
| **Shareable link** that encodes sites, date and sliders | Handy for the 30-second demo and for judges | S |
| **One-page site brief** (print or PNG) | Something a planner would actually paste in a slide | M |

### 4.4 Wildcards

- A "day in the life" 30-second auto-tour that doubles as the demo video.
- Sound: a quiet tone that drops out when Earth sets (comms lost).
- "Postcard from the site": a rendered horizon view with date and coordinates.
- Classroom mode with three guided questions.

### 4.5 Data-path options to weigh

| Path | What ships in the app | Risk | Fits |
|---|---|---|---|
| **1. Lean:** Horizons fetched ahead of time for 9 sites, ideal-sphere horizon, NASA's averaged maps for sunlight/Earth percentages | Small JSON per site + one or two map images | Low. Could work by Saturday noon. Terrain enters only through NASA's precomputed averages. | A safe floor |
| **2. Terrain-aware:** add a 360° horizon mask per site from a LOLA DEM | Same, plus ~720 numbers per site | Medium. Needs DEM handling and care with projection and curvature. | The plan's recommended core |
| **3. Explore-anywhere:** a coarse grid of horizon masks, or a browser ephemeris, for custom points | A few MB of grid data | High for a weekend | Stretch |

A sensible ladder: get path 1 working end to end for **one site** first (Ryan's "Prompt 2" already
says this), then upgrade that site to path 2, then roll out to all nine.

### 4.6 Risks to name early

- **Coordinates and frames.** East vs west longitude, 0..360 vs −180..180, ME vs PA frames, height
  above which surface. One wrong sign puts a site on the far side.
- **Big downloads.** Several LOLA files are gigabytes. Pick the smallest product that does the job.
- **Next.js 16 is new.** `moon-planner/AGENTS.md` warns its APIs differ from older docs. Check
  `node_modules/next/dist/docs/` before using a route handler or static export.
- **Shared files** (`package.json`, the lock file, `page.tsx`): see the workflow doc.
- **Demo limits.** 30 seconds of video or 7 slides. Plan the story before the features.
- **AI disclosure.** The team doc says the UI should not be "vibe-coded." Agree how AI help is used
  and record it for the submission form.

---

## 5. What "done" could look like (a strawman for the team)

A visitor picks two or three Artemis regions and a date. The centre shows the terrain with the Sun
and Earth where they really are. Each site card shows: Sun elevation now, Earth visible or not,
time until sunset, time until Earthset, sunlight % and Earth-contact % over the mission, slope.
Dragging the time scrubber moves the Sun, the shadows and the numbers together. A "slip by N days"
control shows which site copes best with a delay. An info tab explains why the pole is strange.
Every number has a source line under it.

---

## 6. First steps once Ryan says "begin" (not before 9am Saturday)

1. Recompute the nine region centres from the USGS lon/lat outline file and compare them with the
   table in 3.1. Record the method next to the numbers.
2. Get a site height for each point from LOLA so Horizons gets a real height, not 0.
3. One site end to end (suggest Malapert Massif, since tonight's test already covers it): Horizons
   series → small JSON → shown in the app → checked against the cheat sheet in 3.5.
4. Compare one site's sunlight % and Earth % against NASA's averaged maps (PGDA 69).
5. Only then add the terrain horizon mask.

---

## 7. New questions for the team

These add to section 6 of `space-apps-plan.md`. They don't replace it.

1. **Another open-source tool (LunaNav) already covers this challenge in depth.** Do we aim for
   "simplest and clearest" instead of "most complete"? What is our one-sentence difference?
2. For each region, do we show the **region centre**, a **best point inside it**, or both? Centres
   are easy to cite but can be poor places to land.
3. Should the curated list include **non-Artemis sites** (IM-2 Athena, an Apollo site for contrast,
   other landers), as the challenge suggests? Each needs a cited coordinate.
4. Which **data path** from 4.5 do we commit to as the floor, and who owns the upgrade to terrain?
5. Is the ephemeris source **Horizons fetched ahead of time** (matches Alvin's doc and the challenge
   text, proven tonight) or SPICE/Skyfield? Is anyone on the team comfortable owning Python?
6. Does the "sun heat map" idea mean **average sunlight** (NASA already publishes this map) or
   something we compute per date?
7. Which of the brief's own phrases do we treat as must-haves: **time until sunset/Earthset**,
   **schedule slip**, **small-move sensitivity**?
8. Do we want a **mast height** control, or is surface-only enough?
9. Who opens the 2025 winners page in a browser and reports what winning demos look like?
10. How do we credit third-party numbers if we use any (LunaNav's centres), and who verifies them?

---

## 8. What I couldn't do tonight, and what I need from Ryan

- **USGS outline file not downloaded.** Verifying the centres needs
  `A3_9regions-lonlat-simplified.zip` (637 KB, USGS ScienceBase, public domain). Ryan approved the
  download, but ScienceBase puts that one file behind a **CAPTCHA**, which a person has to complete
  in a browser: open the [item page](https://www.sciencebase.gov/catalog/item/671a6fa8d34efed5620f89f8)
  and click the file name. The per-region zips on the same page download without a CAPTCHA, but they
  are 68 MB to 1.2 GB each (about 2.1 GB for all nine).
- **Nothing was pushed.** The branch `ryan/research` exists only on the Mac.
- The official 2025 winners list and the challenge's Resources tab didn't load without a browser.
- The LOLA polar gridded DEM file names and sizes on PDS were not re-checked tonight.
- `npm install` was not run, so nothing was checked against the Next.js 16 docs in `node_modules`.

---

## Sources

Checked tonight:

- NASA Space Apps 2026, [Lunar Landing Site Navigator challenge page](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/)
- JPL [Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) (live queries, Nov 13–14 2026)
- NAIF [generic kernels](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/) directory listings
- NASA GSFC PGDA: [product 69, Lunar Polar Illumination](https://pgda.gsfc.nasa.gov/products/69); [product 78, High-Resolution LOLA Topography for Lunar South Pole Sites](https://pgda.gsfc.nasa.gov/products/78) and its [README](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/README); [product 81, South Pole LOLA DEM Mosaic](https://pgda.gsfc.nasa.gov/products/81)
- USGS ScienceBase item for [doi:10.5066/P1MEQ6UK](https://doi.org/10.5066/P1MEQ6UK) (file list and description only)
- [arXiv:2406.19863](https://arxiv.org/html/2406.19863v2), site-code to region-name table
- LunaNav, [github.com/yutuf/lmNasa](https://github.com/yutuf/lmNasa) (README and `data/sites.yaml`), MIT license
- Alvin's team doc and this repo at commit `61ce6fd`

Cited but not opened tonight:

- Mazarico et al. 2011, *Icarus* 211, [doi:10.1016/j.icarus.2010.10.030](https://doi.org/10.1016/j.icarus.2010.10.030)
- Barker et al. 2021, *Planetary and Space Science* 203, [doi:10.1016/j.pss.2020.105119](https://doi.org/10.1016/j.pss.2020.105119)
- LROC posts [1294](https://lroc.im-ldi.com/images/1294) and [1408](https://lroc.im-ldi.com/images/1408) (quoted via LunaNav)
- NASA, [Artemis III Moon landing regions update](https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/) (Oct 2024)
- NASA Space Apps [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/)

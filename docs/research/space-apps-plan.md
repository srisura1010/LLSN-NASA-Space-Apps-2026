# Lunar Landing Site Navigator: hackathon plan (draft for team review)

NASA Space Apps 2026 · Team: Alvin Gao (owner), Benjamin Koh, Srivatsav Sura, Ryan
Written Fri night Nov 13, updated Sat Nov 14 at about 4:45 pm Arizona time to match and beat the 2021–2025 global winners (see `past-winners-research.md`). Everything here is a proposal. Anything touching shared design, stack, data, or who-does-what is listed in section 6 as a question for the team, not a decision.

---

## 0. How we match and beat the past winners (new, Sat afternoon)

The 50 global winners from 2021 to 2025 share a few habits (full list in `past-winners-research.md`). Winners **end at an answer, not a picture**; they **back it with a number**; they have **one hook a judge can repeat**; and they **finish the demo and write-up properly**. 3D Moon tools have won five times (Selene 2022, Brute Force 2022, LunarTech Ensemble 2023, Spacebee 2023, plus Three.js and 3D tools in 2021 and 2025), so our format is right. What follows turns each lesson into concrete work, mapped onto the five judging criteria (**Influence, Creativity, Validity, Relevance, Presentation**; "Influence" is the current name for what this plan used to call Impact).

| # | What winners did | What we build or do | Criterion | Feature (section 4) | Owner |
|---|---|---|---|---|---|
| W1 | Turned data into a decision ("2plant", SkySense's "safest time") | **Recommendation panel:** for a mission start date and length, rank the nine regions and name the best date window with reasons, e.g. "Region A, Dec 3–9: Sun up 92% of hours, Earth up 100%". The 3D view then explains the answer. | Relevance, Influence | 17 | open |
| W2 | Quoted a measured figure (Storm Prophet's accuracy) | **Validation number:** compare our Sun and Earth elevation/azimuth with JPL Horizons at 3 regions × 3 dates, and show "agrees with JPL Horizons to within X°" in the app footer, the write-up and the demo. Only publish a number we actually computed. | Validity | 3, 18 | open |
| W3 | Went one step past the brief (SkyShield, PureFlow) | **One named differentiator versus LunaNav** (the open-source tool for this same challenge, `yutuf/lmNasa`). Proposed: a **mission-window finder** that searches dates and answers "when should we land here?". LunaNav reports availability; ours picks the window. Credit LunaNav openly in the data list. Choosing it is question P4. | Creativity | 17 | team decision (P4) |
| W4 | One six-word hook | Draft hook: **"Pick a region, get your landing window."** Use it as the first line of the summary, the title slide and the video. | Presentation | 16 | open |
| W5 | Polished, short demo | **30-second video** (script in section 5) with English subtitles, or a **7-slide deck** as the fallback. Recorded Sun afternoon, not at 11 pm. | Presentation | 16 | open (P3) |
| W6 | Listed NASA data precisely (required for any global award) | **`DATA_SOURCES.md`** in the repo plus credits in the app's footer: CGI Moon Kit (LRO LROC/LOLA), USGS Artemis III region outlines, JPL Horizons (and SPICE if used). | Validity, eligibility | 19 | open |
| W7 | Declared AI use (required) | **AI-use statement** naming each tool and what it did (e.g. Claude helped write code and research notes; every number was checked against the cited source). No AI images or NASA logos. Each person adds their own use (T6). | Eligibility | 19 | everyone |
| W8 | Small teams won by scoping hard | Cut to P0 + W1–W7. Heat map and 3D terrain shadows only if everything above is done by Sun 1 pm. | All | — | — |
| W9 | Live link for all three judging rounds | Deploy to a public URL Sat night (needs Ryan's yes, S4). | Relevance | 12 | open (S4) |

**Award fit to aim the write-up at:** Best Use of Data ("makes space data accessible") and Best Mission Concept ("most plausible concept and design"), with Best Use of Science as a stretch if the Horizons validation is solid. Teams don't pick the award, but the write-up can make the fit obvious.

**What "beyond the winners" means for us:** the closest past winners (Selene, Spacebee, LunarTech Ensemble) visualized Moon data on a 3D globe. We'd be the first in that line to **answer a planning question with a validated number**: a 3D Moon, plus a ranked landing window, plus a stated error against JPL.

---

## 1. What's in the repo today

**Updated Sat ~4:45 pm.** On GitHub:
- `main` (Srivatsav): the Next.js 16 starter in `moon-planner/` with three.js, react-three-fiber and drei installed (commit `61ce6fd`). Still the template page.
- `ryan/3d-layout` (Ryan, not merged): a working 3D Moon (NASA CGI Moon Kit texture), all nine region centres as clickable markers, a left site list, and a bottom time bar with Sun and Earth elevation readouts. Sun/Earth directions there are an **approximate placeholder model**; real ephemerides (feature 3) replace them.
- `ryan/research` (Ryan): these notes, `research-and-brainstorm.md`, and `past-winners-research.md`.

**Alvin's team plan doc** ("NASA Space Apps" Google Doc) is the team's starting point, and this plan builds on it. It already sets:
- the goal (the challenge statement) and the nine candidate sites
- the data resources: QuickMap, Moon Trek, JPL Horizons
- the design: pick 2–3 sites, then a window comparing sunlight %, Earth line-of-sight, and terrain slope; sidebar sliders for minimum solar power, maximum safe landing slope, mission duration, "and whatever else may be relevant"
- ideas: a scrubber for shadows as the Moon rotates, a 3D map from lunar topography, a sun heat map, a 3D view in the middle with input bars on the top/sides/bottom, and **another tab for additional info**
- the framework: Next.js/React, "backend get some API for the 3D", Tailwind/CSS, and the NASA data in "some database or master file" in the backend
- references: Rushil's example UI video ("except not vibe-coded"), the 2025 global winners, and the submission guide

Where this plan differs from Alvin's doc, it's flagged in section 6 (questions S6, S7, D8).

**Ryan's working rules:** Ryan works only on `ryan/<feature>` branches. Nothing gets pushed, merged, opened as a PR, or deployed without Ryan's explicit "yes".

Wherever a teammate has already started a piece, that piece stays theirs and the plan adapts to it.

---

## 2. Proposed architecture (to fit around existing work)

### Shape

The core idea is to precompute the heavy science offline and keep the web app mostly static.

```
[Offline Python pipeline]                      [Web app: Next.js/React + Tailwind]
 SPICE kernels ─┐                               ┌─ Site picker (9 sites + custom lat/lon)
 LOLA DEM ──────┼─> per-site JSON ──> /public ──┼─ 3D/2D view: horizon ring + Sun/Earth tracks
 Site list ─────┘   (horizon mask, slope,       ├─ Compare panel (2-3 sites): sunlight %, DTE %, slope
                     Sun/Earth az-el series,     ├─ Sidebar filters: min solar, max slope, duration
                     derived stats)              └─ Time scrubber
                                                   │
 Custom lat/lon ──> live path (see 6: open question) ─┘
```

Why this shape: the nine sites are known in advance, so their numbers can be computed once, checked, and shipped as small JSON files. The app then loads instantly, works offline at the judging table, and needs no backend for the main demo. Only the custom lat/lon feature needs something live (section 3.4).

### Suggested file layout (only for the parts that don't already exist)

This is a sketch to adapt to whatever is in the repo, not a replacement for it.

```
moon-planner/             existing Next.js 16 app (Srivatsav's scaffold); paths below are inside it
/app (or /pages)          existing Next.js routes stay as they are
/components
   SiteSelector, CompareTable, HorizonView (3D or polar plot),
   TimeScrubber, FilterSidebar, Heatmap (stretch)
/lib
   sites.ts              site list + sources (from section 3.1)
   geometry.ts           az/el -> 3D direction, "is Sun above horizon mask" helpers
   stats.ts              sunlight %, Earth-visibility %, longest dark period
/public/data/sites/<site-id>.json      generated by the pipeline
/pipeline (Python)        kernels download script, horizon-mask, ephemeris, export
   README.md              how to regenerate data, kernel versions, frames used
/docs                     data sources + AI-use notes for the submission form
```

### Per-site JSON (sketch of the contract between pipeline and app)

Agreeing on this early lets frontend and pipeline people work in parallel against a fake file.

- `id`, `name`, `lat`, `lon_east`, `elevation_m`, `source`
- `horizon`: elevation angle (deg) of the terrain horizon at each azimuth (e.g. 0.5° or 1° steps)
- `slope`: slope at the point plus a small summary for the surrounding area (mean, p90)
- `series`: time steps (e.g. 1 or 2 hours UTC) with Sun az/el and Earth az/el
- `derived`: % of time Sun is above the mask (full disk and partial), % of time Earth is above the mask, longest continuous darkness, longest comms gap

---

## 3. Data pipeline

### 3.1 Site coordinates (done)

**Verified region centres for all nine regions** are in `research-and-brainstorm.md` section 3.1, computed from the USGS outline file *A3_9regions-lonlat-simplified* (McClernan 2024, [doi:10.5066/P1MEQ6UK](https://doi.org/10.5066/P1MEQ6UK)), and are already in the app on `ryan/3d-layout` (`moon-planner/src/lib/sites.ts`). A region centre is not a landing point, so the UI should say what the marker is (question D1).

### 3.2 Sun and Earth az/el at a lunar site: Horizons vs SPICE

**JPL Horizons API** ([API doc](https://ssd-api.jpl.nasa.gov/doc/horizons.html), [manual](https://ssd.jpl.nasa.gov/horizons/manual.html))

- How: `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `SITE_COORD='<east-lon>,<lat>,<height-km>'`, observer table with the azimuth/elevation quantity, `COMMAND='10'` (Sun) and `'399'` (Earth).
- Pros: no kernels to manage; JPL handles frames. The manual says lunar sites use the DE421 Mean Earth frame (high-precision pole model from 1550 to 2650 AD). It's good for cross-checking.
- Cons: one HTTP call per site × body × time range, so it's slow for sweeping many sites or a heat map. It's a network dependency during the demo. Calling it from a browser may hit CORS, so it'd need a server-side proxy (to verify). Lunar longitude is east-positive 0–360. No terrain: elevation is above the ideal horizon, not the real one.

**SPICE via spiceypy**

- How: load `naif0012.tls`, `de440.bsp` (or de421), `pck00011.tpc`, a lunar PA binary PCK (`moon_pa_de440_*.bpc`), and the lunar frame kernel defining `MOON_ME`. Turn the site's lat/lon/height into a `MOON_ME` position vector, get the Sun/Earth position relative to the Moon center, subtract the site, rotate into local East-North-Up, and compute az/el. Recent toolkits also have `azlcpo` (az/el from a surface point) to do this in one call. Use `LT+S` aberration correction.
- Pros: fast. A year of hourly steps for all nine sites takes seconds, and the heat map becomes possible. Runs offline, it's deterministic, and you control the frame (same Mean Earth frame as LOLA).
- Cons: the kernel and frame setup takes about an hour to get right the first time, and it means a Python step in the toolchain.

**Recommendation:** use **SPICE for the precomputed data** (nine sites, plus a heat-map grid if we get to it), and use **Horizons as a validation check**: pick 2–3 sites and times and confirm the az/el values match within roughly 0.01–0.1°. For custom lat/lon, Horizons through a server-side route is the lowest-effort live option (see question S2). Which language and runtime the pipeline uses is a team call (question S1).

### 3.3 Horizon masks and slope from LOLA

**Data** ([LOLA PDS data node](https://pds-geosciences.wustl.edu/missions/lro/lola.htm), also browsable in [LROC QuickMap](https://quickmap.lroc.asu.edu/) and [Moon Trek](https://trek.nasa.gov/moon/)):
- LOLA south-polar gridded DEMs (polar stereographic; 20–60 m/px for the wider polar cap, with finer 5–10 m/px tiles closer to the pole). Choose the resolution by coverage and file size.
- LOLA-derived slope products exist. Slope depends on the baseline (the distance it's measured over), so record which baseline we use.
- For validation: published LOLA polar illumination/visibility maps (Mazarico et al. 2011, *Icarus*) and QuickMap's illumination layers. Our sunlight % should land in the same range.

**Horizon mask method (per site):**
1. Cut a DEM window around the site. Horizons at the pole are set by terrain up to ~100–200 km away, so the window needs to be big. A coarser DEM is fine for far-off terrain.
2. For each azimuth (0.5° or 1°), step outward along the ray, and at each step compute the elevation angle to the terrain *including the Moon's curvature* (drop ≈ d²/2R, R = 1737.4 km). The horizon is the maximum.
3. Sun is "up" when Sun elevation is above the horizon at the Sun's azimuth. Track full-disk and partial separately (Sun's radius ≈ 0.27°). Earth is "visible" likewise (Earth's angular radius ≈ 0.95°).
4. Store the mask (360–720 numbers) in the site JSON. The app then needs only a lookup.
5. Consider the observer's height (lander solar array mast vs surface). A few meters can noticeably change illumination at the pole. This could be a slider (question D4).

**Slope:** read the slope at the site point and summarize slope over the region (or within a few hundred m). Use the DEM's own spacing or a fixed baseline, and label it in the UI.

### 3.4 Custom lat/lon

Options (team decision, question S2):
- (a) Ephemeris only: compute Sun/Earth az/el live (Horizons via server route, or a small Python service), with the horizon approximated as flat and clearly labeled.
- (b) Precompute a coarse grid (e.g. every 1–2 km over the polar cap) of horizon masks and snap custom points to it. Same data as the heat map.
- (c) Live horizon computation server-side. Most accurate, but the most work and a hosting risk.

### 3.5 Units and frames to double-check

- **Longitude:** Horizons wants east-positive 0–360; the Gazetteer gives −180 to 180 east; some sources write "W". Pick one internal convention (e.g. east-positive −180..180) and convert at the edges.
- **Planetocentric vs planetographic latitude:** on the Moon they're effectively equal (near-spherical reference), but note which one each source uses.
- **Frames:** LOLA and the USGS grids use **Mean Earth (ME)**. SPICE must use `MOON_ME`, not `MOON_PA` or `IAU_MOON`. These can differ by hundreds of meters, which matters at the pole.
- **Heights:** LOLA heights are relative to a 1737.4 km sphere. Horizons takes height above its reference ellipsoid. Make sure "0 m" means the same thing in both.
- **Projection:** polar stereographic parameters (center −90°, scale, radius 1737.4 km) must match when reading the DEM and the USGS shapefiles.
- **Time:** SPICE uses ET/TDB internally. The UI should be UTC. Label time zones in the scrubber.
- **Azimuth convention:** measured from local north, clockwise toward east. Near the pole "north" points almost straight at the near side, so it behaves well, but there's a singularity exactly at −90°. Guard for it in custom input.
- **Aberration and light time:** use `LT+S` (apparent positions). Make sure the Horizons comparison uses the same setting (apparent vs geometric).
- **Earth elevation is low at the south pole** and swings with libration over each month, so small errors in the horizon mask flip comms windows on and off. Validate this one hardest.
- **Sun elevation is also tiny**: at most about (90° − |latitude|) + 1.5° above the ideal horizon (so only a few degrees at 85–88°S), so the terrain mask decides almost everything for sunlight.

---

## 4. Features in priority order, with rough estimates

Estimates are for one person focused on the task, and assume the per-site JSON format is agreed first. "P0" is what has to exist for a working submission.

| # | Feature | Priority | Rough time | Depends on |
|---|---|---|---|---|
| 1 | Per-site JSON contract + one fake file | P0 | 0.5 h | none (do first, unblocks everyone) |
| 2 | Site list with cited coordinates (USGS centroids) | P0 | 1–2 h | shapefiles |
| 3 | Ephemeris pipeline (SPICE) for 9 sites, plus Horizons cross-check | P0 | 3–4 h | 2 |
| 4 | Horizon masks from LOLA for 9 sites | P0 | 4–6 h | 2, DEM download |
| 5 | Derived stats (sunlight %, Earth-visible %, longest dark/no-comms period) | P0 | 1–2 h | 3, 4 |
| 6 | Site picker + compare table for 2–3 sites | P0 | 2–3 h | 1 |
| 7 | Horizon view: polar plot or 3D horizon ring, with Sun/Earth markers | P0 | 3–5 h (2D polar plot is the fast fallback) | 1 |
| 8 | Time scrubber + date range / mission duration | P1 | 2–3 h | 7 |
| 9 | Sidebar filters (min solar %, max slope, duration) ranking the sites | P1 | 2 h | 5, 6 |
| 10 | Slope per site | P1 | 1–2 h | DEM |
| 11 | Custom lat/lon (option a from 3.4) | P1 | 2–3 h | 3 |
| 12 | Deployed public URL | P0 | 1 h | 6 |
| 13 | Heat map of sunlight/Earth visibility over the polar cap | P2 | 4–8 h | 3, 4 on a grid |
| 14 | 3D terrain with live shadows | P2 | 6+ h | DEM tiles |
| 15 | "Explain mode" for educators and the public (tooltips, glossary), possibly as the "additional info" tab from Alvin's doc | P2 | 1–2 h | 6 |
| 16 | Demo (30 s video with English subtitles, or ≤7 slides) + submission text | P0 | 3–4 h | everything above |
| 17 | **Recommendation panel + mission-window finder** (W1, W3): rank regions for a start date and length, name the best window with reasons | P0 | 3–4 h | 3 (works on the placeholder model first, real data drops in) |
| 18 | **Horizons validation** (W2): 3 regions × 3 dates, compute max error, show it in the app and write-up | P0 | 1–2 h | 3 |
| 19 | **Credits and AI-use** (W6, W7): `DATA_SOURCES.md`, footer credits, AI-use statement | P0 | 1 h | none |

### Suggested split (roles to map onto people; edit freely)

Each role should go to whoever already has related work in the repo. I've left owners blank on purpose.

| Role | Covers features | Owner |
|---|---|---|
| A. Frontend shell + compare + recommendation | 1 (with B), 6, 9, 12, **17** | ? |
| B. Visualization | 7, 8, 14 (stretch) | ? (Ryan's `ryan/3d-layout` is a starting point, if the team wants it) |
| C. Ephemeris + validation | 3, 5, 11, **18** | ? |
| D. Terrain (LOLA) | 2, 4, 10, 13 (stretch) | ? |
| E. Story + submission (can be shared, or a 5th person, e.g. Ansh if they join in time) | 15, 16, **19** | ? |

**If time is short, the minimum winning set is:** 3, 5, 6, 7 (the 3D view already exists), 12, 16, 17, 18, 19. Terrain horizon masks (4) make the numbers better but the recommendation and validation still work on a smooth-Moon model, as long as the UI says so.

---

## 5. Timeline: rest of Saturday → Sun Nov 15, 11:59 pm

All times are **Arizona time** (MST, UTC−7). The team is at the **Phoenix, AZ (virtual)** event, so the deadline is **Sun 11:59 pm Arizona time**. About **31 hours** were left when this was updated (Sat ~4:45 pm). Fixed slots: **Sat 6 pm** mentor Zoom, **Sun 3 pm and 6 pm** judges' Q&A.

**Saturday evening**
- **5:00–6:00** Settle P4 (differentiator), S4 (deploy) and the role owners (T2). Start feature 19 (credits, AI-use): it needs no code.
- **6:00** Mentor Zoom: ask whether "recommend a landing window" plus a Horizons error figure is what judges want for this challenge.
- **6:30–10:30** In parallel: ephemeris for the nine regions (3) and the Horizons check (18); recommendation panel (17) on the current placeholder model; compare table (6).
- **10:30** Checkpoint: real Sun/Earth data drives the 3D view and the recommendation. Deploy a first public URL (needs Ryan's yes).
- **Sleep.** Past winners say it matters more than one more feature.

**Sunday**
- **9:00–1:00** Validation number final; fix anything that failed it. Slope (10) and filters (9) if on track. Write the project page text (summary with the hook first; then challenge, what it does, how it works, data and validation, what's next).
- **1:00** **Feature freeze.** Anything unfinished is cut, not rushed.
- **1:00–3:00** Polish, test on another laptop and a phone, check every credit.
- **3:00** Judges' Q&A: show a run-through, ask what they'd want to see.
- **3:30–6:00** **Make the demo.** 30-second script:
  - 0–5 s: the problem: "Where and when do you land at the lunar south pole?"
  - 5–22 s: screen recording: pick two regions, scrub the date, Sun and Earth move, the recommendation appears.
  - 22–30 s: "Agrees with JPL Horizons to within X°" plus NASA data credits and the hook.
  - English subtitles, aim for 29 s, unlisted YouTube, test in a private window. Fallback: 7 slides (title, problem, demo screenshot, how it works, validation, data, team).
- **6:00** Second judges' Q&A.
- **6:00–9:00** Fill the submission form (one editor at a time), **Save Progress early** as a draft.
- **9:00** **Target submit.** Leaves about 3 hours of buffer.
- **11:59** Hard close. Late saves aren't judged.

### Submission requirements (from the [project submission guide](https://www.spaceappschallenge.org/resources/project-submission-guide/))

Heads-up: when I read it tonight, the guide still showed last year's dates (Oct 4–5), so confirm the 2026 dates and time zone with the Local Lead.

Required form fields, all in English:
1. Project name
2. High-level project summary (what, how it meets the challenge, why it matters)
3. Link to project demo: ≤30 s video with English subtitles, or ≤7 slides including the title slide. Over the limit means **not eligible for global judging**.
4. Link to final project: public, no password or registration (deployed site and/or public repo; see question T3 since the repo is private now).
5. Detailed project description (what it does, how it works, benefits, tools/languages)
6. NASA data used and how. **NASA data is required for a global award.** Cite SPICE/NAIF, Horizons, LOLA, QuickMap, Moon Trek, the USGS grids.
7. Space agency partner and other data: list all data, code, images, and tools, including open-source libraries, with permission for anything copyrighted.
8. Use of AI: name the tools and how they were used. AI images/videos need a visible watermark. AI-generated code and data must be acknowledged in text and metadata. No AI-modified NASA logos or mission identifiers.
9. Verification: tick terms and originality, then **Submit for Judging**.

Other rules worth knowing: images on the project page are JPG/PNG/GIF up to 10 MB, and videos/docs have to be linked, not uploaded. "Save Progress" changes are publicly visible. The editing "Lock" can be overridden by a teammate, so agree on one person editing the form at a time. Judging criteria are Influence (formerly Impact), Creativity, Validity, Relevance, and Presentation. Everyone must be confirmed at the same Local Event to be eligible for awards.

---

## 6. Open questions and decisions for the team

**Stack and architecture**
- S1. Is the data pipeline Python (spiceypy + numpy/rasterio), or does someone prefer another approach? Who's comfortable with it?
- S2. Custom lat/lon: ephemeris-only with a flat horizon (simplest), snap to a precomputed grid, or a live backend (Horizons via a Next.js API route, or a small Python service)?
- S3. Is the view really 3D (three.js / react-three-fiber), or do we start with a 2D polar horizon plot and upgrade to 3D if time allows?
- S4. Where do we deploy (Vercel, GitHub Pages, other), and who owns it?
- S6. Alvin's doc lists **Horizons** as the ephemeris source, and the challenge names it too. This plan recommends SPICE (also NASA/JPL) for precomputing, with Horizons as a cross-check. A middle path is calling Horizons offline to precompute the nine sites, so the app still has no live dependency. Which one does the team want?
- S7. Alvin's doc says "backend get some API for the 3D" and a "database or master file" for NASA data. Is a precomputed master file (static JSON per site, as in section 2) enough, or does the team want a real backend or database? And what does "API for the 3D" mean: terrain tiles, a 3D model source, or something else?
- S5. The repo already has Next.js 16 with three.js/react-three in `moon-planner/`. Is Tailwind in there yet or planned? And does Srivatsav have a plan for the 3D scene that the horizon view should slot into?

**Data**
- D1. Use USGS shapefile centroids as the "official" site points, or pick a specific point inside each region (e.g. the best-lit spot)? Either way, show the source in the UI.
- D2. Which date range? (Artemis III target window, or "next 12 months," or both?) What time step (1 h vs 2 h)?
- D3. Which LOLA DEM resolution and window size, given download size and laptop compute?
- D4. Observer height: surface only, or a slider for mast height (e.g. 0–10 m)?
- D5. How do we count "sunlight": full disk only, partial disk weighted, or both? Same question for Earth visibility.
- D6. What slope threshold do we show as "safe"? We'd need a cited source for any Artemis/HLS number.
- D8. Alvin's doc mentions a **sun heat map** projected on the surface. Does that mean sunlight % over the area (plan feature 13), surface temperature, or both? Temperature would need another dataset (e.g. LRO Diviner).
- D7. How do we validate? Proposed: Horizons cross-check for az/el, plus a comparison against published LOLA illumination maps for sunlight %.

**Product and scope**
- P1. Who is the primary audience for the demo: mission planners (numbers first) or educators/public (visuals first)?
- P2. Which stretch goal do we go for if there's time: heat map or 3D terrain shadows?
- P3. Video or slide deck for the demo, and who makes it?
- P4. Which one differentiator versus LunaNav do we commit to? Proposed: the mission-window finder (W3). Alternatives: side-by-side comparison on the same dates, a shareable link, or local terrain horizon effects.
- P5. Is the hook "Pick a region, get your landing window." or something better?
- P6. Do we show the Horizons validation number in the app itself, or only in the write-up and demo?

**Team and logistics**
- T1. Answered: we're at the Phoenix, AZ (virtual) event, so the deadline is 11:59 pm Arizona time. Worth a one-line confirmation with the Local Lead, since the guide page still shows last year's dates.
- T2. Who owns each role in section 4? Who edits the submission form (one person at a time)?
- T3. Will the repo be made public for the "final project" link, or do we link only the deployed site?
- T4. Branching/PR conventions so four people don't collide (e.g. one branch per role, merge to main via PR).
- T5. Is everyone confirmed at the Phoenix event (needed for award eligibility)? Ansh still has to sign up, register for Phoenix, request to join the team, and send their GitHub username to Srivatsav. Is Ansh joining, and in which role?
- T6. How are we each using AI tools, so we can fill in the AI-use section accurately? (Alvin's doc notes the example UI should be "not vibe-coded", so it's worth agreeing how much AI help is OK.)

---

## 7. Message to paste in the group chat

> Hey team! I updated the plan in `docs/research/space-apps-plan.md` (branch `ryan/research`) after looking at all 50 global winners from 2021–2025. The short version: winners end with an answer, not just a visual, and back it with a number. So I'm proposing we add (1) a recommendation panel that ranks the nine regions and names the best landing window, (2) a "matches JPL Horizons to within X°" check, (3) one named thing LunaNav doesn't do, and (4) start the 30-second video and the NASA-data and AI-use credits early, since those are required. Section 0 has the table and section 5 has the timeline from now to Sun 11:59 pm.
>
> Nothing's decided. Could everyone look at questions P4–P6 and T2 (who owns what) before the 6 pm mentor call?

---

### Sources consulted
- `past-winners-research.md` in this folder (2021–2025 global winners, judging criteria, submission rules)
- NASA Space Apps [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/)
- NASA, [Artemis III candidate landing regions update](https://www.nasa.gov/?p=748006) (Oct 2024)
- George, Rubio, Lawrence, Curell, [Artemis III Site Selection Update: Downselection From Thirteen to Nine Candidate Regions](https://ntrs.nasa.gov/citations/20250011660), LPSC 2026
- McClernan, [Down Selected Artemis III Candidate Landing Site Navigational Grids](https://www.usgs.gov/data/down-selected-artemis-iii-candidate-landing-site-navigational-grids), USGS, doi:10.5066/P1MEQ6UK
- [IAU Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/) (Nobile entry)
- Wikipedia entries for Cabeus, Haworth, Malapert, Mons Mouton, de Gerlache, Slater (feature centers; to cross-check against the Gazetteer)
- NASA SVS, [Mons Mouton, a Newly Named Lunar Mountain](https://svs.gsfc.nasa.gov/cgi-bin/details.cgi?aid=5074)
- JPL [Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html) and [Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- NAIF [`azlcpo`](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/MATLAB/mice/cspice_azlcpo.html) (az/el from a surface point)

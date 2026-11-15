# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Primary (inferred, sent to Ryan for confirmation on 2026-11-15): lunar mission planners on science and engineering teams who need to compare south-pole landing regions and dates quickly, especially when a schedule slips or a site has to change.
- Secondary (inferred): educators, students and the public curious about why landing at the lunar south pole is hard.
- Evaluators: NASA Space Apps 2026 judges, who score Impact, Creativity, Validity, Relevance and Presentation from a 30-second demo and the live project.

## Product Purpose

Lunar Landing Site Navigator (working name, inferred as final) turns JPL Horizons ephemeris and LOLA topography into a fast answer: for a candidate region and a mission window, when is the Sun above the real terrain horizon (power) and when is Earth above it (direct-to-Earth comms). Success is a planner picking a region and start date and getting a ranked, explained landing window in seconds.

## Positioning

Built for the NASA Space Apps 2026 "Lunar Landing Site Navigator" challenge. Existing NASA tools (Moon Trek, LROC QuickMap, JPL Horizons) are powerful but slow for scenario comparison. This tool combines them: Sun and Earth tracks from Horizons for each site, measured against a terrain horizon computed from the LOLA south-pole DEM, so every visibility number accounts for real terrain rather than a smooth sphere. It ends in a recommendation, not just a picture, and checks itself against NASA's published LOLA illumination maps.

## Operating Context

- Sites: the nine south-pole candidate regions NASA named for Artemis III in October 2024 (USGS outlines, McClernan 2024). NASA now describes Artemis III as an Earth-orbit test, so copy must say "regions NASA named for Artemis III in 2024", never that they are current landing sites for a specific mission.
- Time: precomputed Sun and Earth tracks cover 2027 at 1-hour steps; other ranges call Horizons live through the app's API route.
- Used on laptops during team reviews and on a projector or screen recording for the demo; judges open a public link with no login.

## Capabilities and Constraints

- Next.js 16 (App Router), React 19, Tailwind 4, three.js with @react-three/fiber and drei. Repo shared by a five-person team; Sri owns the Horizons and terrain engine (src/lib/horizons.ts, src/lib/terrain.ts, scripts/).
- Terrain horizons per site at 0.5° azimuth steps from LOLA LDEM_80S_80MPP (80 m near field, coarser far field), limited to 80° S. The Sun is treated as a point at its centre; libration effects come from Horizons.
- 3D heightmap: 950 x 950 at 640 m covering ±304 km around the pole.
- Moon Trek WMTS tiles and ArcGIS services allow cross-origin use; PGDA and imbrium files do not (server-side or build-time only).
- Submission rules: public link, no login, 30 s video or 7 slides max, NASA data listed, AI use disclosed inside the project.
- Undecided: final product name with the team; hosting.

## Brand Commitments

- No NASA logos, insignia, flags or mission identifiers in the product or any generated media (Space Apps rule).
- The team expects hand-built, considered work ("not vibe coded"), and Ryan asked that it must not look like a default AI-built app.

## Evidence on Hand

- Real data: nine region centres and outlines (public/data/artemis3-regions.geojson), LOLA heightmap and per-site horizon profiles (public/data/), 2027 Horizons tracks (data/horizons-cache/), LRO textures (public/textures/), sources in DATA_SOURCES.md.
- Published reference values for validation: Mazarico et al. 2011 LOLA average illumination and Earth visibility (PGDA product 69), sampled at the nine centres.
- No user testimonials, usage numbers or endorsements exist; never invent them.

## Product Principles

1. Answer the planning question; every view leads to a site-and-date decision.
2. Terrain-true numbers only, with their method and limits stated.
3. Show the cost of change: what a two-week slip or the next region over does.
4. Fast for experts, legible for newcomers, in the same screen.
5. Credit NASA data precisely.

## Accessibility & Inclusion

Not established beyond WCAG 2.1 AA as a baseline; the demo must read on a projector and in a small video frame.

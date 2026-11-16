# Artemis Assist

A browser tool for comparing lunar south pole landing sites and dates: when each site has sunlight for power, and when Earth is in view for direct communication.

**Live app:** https://artemis-assist.vercel.app/

Built by team **Zenacor** (Srivatsav Sura, Alvin Gao, Benjamin Koh, Ryan Cheng, Ansh Devlekar) for the NASA Space Apps Challenge 2026, Phoenix, Arizona local event. Challenge: *Lunar Landing Site Navigator*. Submitted November 15, 2026.

## What it does

Pick a mission window anywhere in 2027 (1 hour to 60 days). The app ranks the nine Artemis III candidate regions, or any custom point on the Moon, by:

- **Power:** share of time the Sun is above the terrain, mean solar power, longest dark spell
- **Communications:** share of time Earth is in view, longest comms gap, time with both Sun and Earth up
- **Timing:** every sunrise, sunset, Earthrise and Earthset to the minute

Each result is explained with a 3D terrain view and a horizon panorama showing the Sun and Earth tracks against the real horizon. Slip buttons, a best-start search and an "If the start slips" table show how a delay changes the ranking. Up to three sites can be compared side by side. Zoomable Moon and Sun–Earth–Moon views show why south pole lighting behaves the way it does.

## How it works

1. **Sun and Earth positions:** JPL Horizons azimuth and elevation, hourly through 2027. Precomputed for the nine regions, fetched live for custom points.
2. **Terrain horizon:** traced from NASA LOLA elevation data (LDEM_80S_80MPP) at 720 bearings, as seen from a 2 m mast, including lunar curvature.
3. **Visibility:** the Sun is a 0.53° disc, so a partly hidden Sun counts as partial power. Earth is in view when any part of it clears the terrain.
4. **Score (0–1):** 45% mean solar power, 30% Earth visibility, 25% for keeping the longest dark spell short.

**Validation:** compared with NASA Goddard's long-term LOLA illumination maps (Mazarico et al. 2011), the mean difference across the nine regions is 2.0 percentage points for the Sun and 1.9 for Earth.

**Limits:** hourly sampling, one centre point per region, terrain to 80° S, 2027 only, line-of-sight Earth visibility. Launch windows are estimates, not trajectory designs.

## Run it locally

```bash
cd moon-planner
npm install
npm run dev
```

Then open http://localhost:3000.

## Tech stack

Next.js, React, TypeScript, Tailwind CSS, Three.js (React Three Fiber, drei), zustand and geotiff.js. Python (NumPy, Pillow) builds the Moon textures.

## Data sources

All NASA and other sources are listed in [`DATA_SOURCES.md`](DATA_SOURCES.md). The main ones are JPL Horizons, LRO LOLA elevation and illumination data (NASA Goddard PGDA), NASA Moon Trek, the NASA SVS CGI Moon Kit, Blue Marble, and USGS Artemis III region outlines.

## How AI was used

The Space Apps rules call AI tools Super Intelligence. The team used Claude (Anthropic), through Claude Code, to help write and review the application code, the data-processing scripts, the interface text and this documentation, and to help research data sources. The Moon picture behind the landing page heading (`moon-planner/public/landing/moon.jpg`) was generated with ChatGPT (OpenAI). It is labelled as AI-generated on the page and is not NASA imagery. No other AI-generated images, audio or video are used. All data comes from the NASA and USGS sources listed in `DATA_SOURCES.md`, and every number on screen is computed from them.

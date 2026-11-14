# moon-planner

Web app for the Lunar Landing Site Navigator (NASA Space Apps 2026). It shows the
nine Artemis III candidate regions on a 3D Moon and lets you scrub through a lunar
day to see when each site is lit and when Earth is above the horizon.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Layout

- `src/components/MoonScene.tsx` – three.js scene (react-three-fiber)
- `src/components/Sidebar.tsx`, `BottomBar.tsx` – site list and time controls
- `src/lib/moonMath.ts` – Moon-fixed frame and Sun/Earth elevation
- `src/lib/sites.ts` – region centres

## Data

- Moon colour and elevation maps: NASA SVS CGI Moon Kit (LRO LROC / LOLA).
- Region centres: USGS Artemis III region outlines, McClernan 2024.

Sun and Earth directions are currently a simple periodic model (no libration or
solar declination). Real ephemerides from JPL Horizons are next.

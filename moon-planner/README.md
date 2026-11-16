# moon-planner

Artemis Assist: the web app for the Lunar Landing Site Navigator challenge (NASA Space Apps 2026). Pick a
region near the lunar south pole and a mission window, and it ranks the nine
Artemis III candidate regions by when each one sees the Sun (power) and Earth
(direct radio contact) above its real terrain horizon. It shows the answer on a
3D LOLA terrain plate with a horizon plot, lets you slip the start date, compare
regions, open any other point on the Moon, step out to the Moon and the
Sun–Earth–Moon system, and work out a launch from Earth.

Next.js 16, React 19, react-three-fiber (three.js), zustand, Tailwind CSS 4.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

Production build:

```bash
npm run build
npm run start      # http://localhost:3000
```

- `/` is the landing page; `/tool` is the Navigator (Plan, Launch and Compare
  modes, and the About & data drawer with the method, the NASA check, credits
  and how AI was used).
- Everything for the nine regions in 2027 is precomputed in `public/data/`, so
  the app runs without network access. Custom sites call JPL Horizons through
  `src/app/api/horizons/route.ts` (cached in `data/horizons-cache/`), and points
  away from the south pole and the zoomed-in Moon globe load terrain and map
  tiles from NASA Moon Trek in the browser.
- `npm run lint` runs ESLint; `npx tsc --noEmit` type-checks.

## Data scripts

Run from this folder. Their outputs are committed, so they are only needed to
rebuild the data.

| Command | What it does |
| --- | --- |
| `npm run precompute` | Fetch hourly Sun and Earth azimuth/elevation for 2027 at each region centre from JPL Horizons into `data/horizons-cache/` |
| `npm run build-sky` | Pack those tracks into `public/data/sky/<region>.json` |
| `npm run process-dem` | Download the LOLA south pole DEM (PGDA product 90), build the plate heightmap in `public/data/terrain/` and trace each region's horizon into `public/data/horizon/` |
| `npm run build-validation` | Compare the model with NASA's LOLA illumination maps (PGDA product 69) into `public/data/validation.json` |
| `npm run build-system` | Fetch heliocentric Earth and Moon vectors for 2027 from JPL Horizons into `public/data/system/2027.json` |
| `python3 scripts/build-moon-textures.py` | Build the Moon globe textures in `public/textures/` from the SVS CGI Moon Kit |
| `npx tsx scripts/check-*.ts` | Checks of the Moon frame, Earth frame, map tiles, launch windows and custom-site terrain against NASA data |

## Where the data comes from

- Sun and Earth positions: NASA/JPL Horizons (observer tables and vector tables).
- Terrain: LRO LOLA, the LDEM_80S_80MPP south pole model (NASA GSFC PGDA
  product 90), and for other points the LOLA mosaics served by NASA Moon Trek.
- Check: Mazarico et al. (2011) LOLA illumination and Earth visibility maps
  (NASA GSFC PGDA product 69).
- Regions: USGS Artemis III candidate landing regions (McClernan 2024).
- Moon globe: NASA SVS CGI Moon Kit and NASA Moon Trek LROC tiles; Earth globe:
  NASA Blue Marble Next Generation.

Full list with files, URLs and credit lines: [`../DATA_SOURCES.md`](../DATA_SOURCES.md).

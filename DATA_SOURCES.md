# Data sources

Every NASA and USGS dataset used by Moon Planner, where it lives in this repo,
and the credit line to show with it. NASA and USGS data are public domain in
the United States; Space Apps asks that each source is credited.

## NASA CGI Moon Kit (globe textures)

- **Files:**
  - `moon-planner/public/textures/moon_color_2k.jpg` (2048 x 1024, 0.46 MB):
    colour map, shown first.
  - `moon-planner/public/textures/moon_color_4k.jpg` (4096 x 2048, 1.4 MB):
    colour map, replaces the 2k map once loaded. From `lroc_color_poles_4k.tif`.
  - `moon-planner/public/textures/moon_height_1k.jpg` (1024 x 512, 0.1 MB):
    elevation, 0 to 255 covering -9.5 to +11.0 km. From `ldem_16.tif`.
  - `moon-planner/public/textures/moon_relief_4k.jpg` (4096 x 2048, 1.6 MB):
    fine elevation, the 4096 x 2048 reduction of `ldem_16.tif` minus the 1k
    map, 0 to 255 covering -1.5 to +1.5 km.
  - `moon-planner/scripts/build-moon-textures.py` builds the last three from
    the two TIFFs (Python with numpy and Pillow).
- **Source:** NASA Scientific Visualization Studio, CGI Moon Kit,
  https://svs.gsfc.nasa.gov/4720 (downloads `lroc_color_poles_4k.tif` and
  `ldem_16.tif`, the 16 pixels per degree floating-point elevation in km).
- **Underlying data:** colour map from the Lunar Reconnaissance Orbiter Camera
  (LROC) Wide Angle Camera mosaic; elevation from the Lunar Orbiter Laser
  Altimeter (LOLA).
- **Credit line:** NASA's Scientific Visualization Studio. LRO LROC and LOLA
  data courtesy NASA/GSFC/Arizona State University.

## USGS Artemis III candidate landing regions (site outlines and centres)

- **Files:**
  - `data/usgs/A3_9regions-lonlat-simplified.zip`: the original download,
    unchanged (shapefile, GeoJSON, QGIS metadata and a preview map).
  - `moon-planner/public/data/artemis3-regions.geojson`: the nine region
    outlines with corners, area and a computed centre for each.
  - `moon-planner/src/lib/sites.ts`: the same nine centres, used by the app.
- **Source:** McClernan, M.T., 2024, Artemis III candidate landing regions:
  U.S. Geological Survey data release, https://doi.org/10.5066/P1MEQ6UK.
  ScienceBase item: https://www.sciencebase.gov/catalog/item/671a6fa8d34efed5620f89f8
- **Coordinate system:** GCS_Moon_2000 (IAU sphere, radius 1737.4 km),
  planetocentric latitude, east-positive longitude, as given in the
  shapefile's `.prj`. The bundled `.qmd` sidecar says WGS 84, which is a
  QGIS default and not the real reference frame.
- **How the centres are computed:** each region is a four-corner polygon. The
  corners are projected to south-polar stereographic, averaged, and converted
  back to latitude and longitude. A plain average of the raw lat/lon values is
  off by up to 0.6° of longitude this close to the pole. The results match
  `sites.ts` to four decimal places (for example Haworth −86.7639, −22.7770).
- **Credit line:** Artemis III candidate landing regions: U.S. Geological
  Survey (McClernan, 2024), doi:10.5066/P1MEQ6UK.

## JPL Horizons vector tables (System view)

- **Files:** `moon-planner/public/data/system/2027.json`, built by
  `moon-planner/scripts/build-system.ts` (`npm run build-system`)
- **Source:** NASA/JPL Solar System Dynamics, Horizons API,
  https://ssd.jpl.nasa.gov/api/horizons.api (documentation:
  https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- **Contents:** heliocentric positions of Earth (399) and the Moon (301) from
  the Sun's centre (500@10), ecliptic J2000, km, hourly from 2027-01-01 to
  2028-01-01 (TDB epochs; the file's `startMs` is the matching UTC instant),
  rounded to 1 km.
- **Credit line:** Ephemeris data from NASA/JPL Horizons, Solar System
  Dynamics Group, Jet Propulsion Laboratory.

## Moon level (globe, rotation model, earlier landings)

- **Files:** `moon-planner/src/lib/moonFrame.ts`,
  `moon-planner/src/components/moon/MoonView.tsx`, checked by
  `moon-planner/scripts/check-moon-frame.ts` (`npx tsx scripts/check-moon-frame.ts`)
- **Rotation model:** IAU Working Group on Cartographic Coordinates and
  Rotational Elements, Moon pole (right ascension, declination) and prime
  meridian W with periodic terms E1 to E13: Archinal et al. (2018), "Report of
  the IAU Working Group on Cartographic Coordinates and Rotational Elements:
  2015", Celestial Mechanics and Dynamical Astronomy 130:22,
  doi:10.1007/s10569-017-9805-5. Applied to the Horizons vectors above
  (ecliptic J2000 to equatorial J2000 with the J2000 mean obliquity).
- **Check:** Sun and Earth elevation over a smooth sphere at the nine region
  centres agree with the JPL Horizons observer tracks
  (`public/data/sky/*.json`) to 0.003 degrees at every hour of 2027.
- **Textures:** the CGI Moon Kit colour and elevation maps listed above,
  printed in grey with relief shading from the slopes of the elevation maps.
- **Region outlines:** `moon-planner/public/data/artemis3-regions.geojson`
  (USGS, listed above), draped on the globe when zoomed in on the south pole.
- **Earlier landing coordinates** (planetocentric, east-positive, checked
  2026-11-14):
  - Apollo 11, 12, 14, 15, 16 and 17 lunar modules: NASA Space Science Data
    Coordinated Archive (NSSDCA), "Lunar landing site coordinates",
    https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html (Mean
    Earth/Polar Axis frame, DE421). Apollo 11 0.67416, 23.47314; Apollo 12
    -3.0128, -23.4219; Apollo 14 -3.64589, -17.47194; Apollo 15 26.13239,
    3.63330; Apollo 16 -8.9734, 15.5011; Apollo 17 20.1911, 30.7723.
  - Chandrayaan-3 (2023): 69.3741 S, 32.32 E, LROC "Chandrayaan-3 Landing
    Site", https://lroc.im-ldi.com/posts/1314
  - SLIM (2024): 13.3160 S, 25.2510 E, NASA "NASA's LRO Spots Japan's Moon
    Lander", https://www.nasa.gov/missions/lro/nasas-lro-spots-japans-moon-lander
  - IM-1 Odysseus (2024): 80.13 S, 1.44 E, NASA "NASA's LRO Images Intuitive
    Machines' Odysseus Lander",
    https://www.nasa.gov/missions/lro/nasas-lro-images-intuitive-machines-odysseus-lander/
  - Chang'e 6 (2024): 41.6385 S, 206.0148 E (153.9852 W), LROC "First Look:
    Chang'e 6", https://lroc.im-ldi.com/images/1374
- **Credit lines:** Moon maps: NASA's Scientific Visualization Studio, CGI
  Moon Kit (LRO/LROC and LOLA). Rotation model: IAU WGCCRE (Archinal et al.
  2018). Landing coordinates: NASA NSSDCA; NASA/GSFC/Arizona State
  University (LROC) for the 2023 and 2024 landers.

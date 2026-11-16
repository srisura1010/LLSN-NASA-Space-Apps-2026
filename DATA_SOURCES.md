# Data sources

Every NASA and USGS dataset used by Artemis Assist, where it lives in this repo,
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

## JPL Horizons observer tables (Sun and Earth from each region)

- **Files:**
  - `moon-planner/data/horizons-cache/*.json`: raw Horizons answers, one per
    body and site, written by `moon-planner/scripts/precompute-horizons.ts`
    (`npm run precompute`).
  - `moon-planner/public/data/sky/<region>.json`: the same tracks packed for
    the browser by `moon-planner/scripts/build-sky.ts` (`npm run build-sky`).
- **Source:** NASA/JPL Solar System Dynamics, Horizons API,
  https://ssd.jpl.nasa.gov/api/horizons.api (observer table, `CENTER`
  `coord@301` at each region centre, `QUANTITIES 4`: apparent azimuth and
  elevation), Sun (10) and Earth (399), hourly from 2027-01-01 to 2028-01-01.
  Custom sites from 80 S to the pole fetch the same table live through
  `moon-planner/src/app/api/horizons/route.ts` for the window in use.
- **Credit line:** Ephemeris data from NASA/JPL Horizons, Solar System
  Dynamics Group, Jet Propulsion Laboratory.

## LOLA south pole elevation model (terrain horizons and the terrain plate)

- **Files:** `moon-planner/data/raw/ldem80s_*` (80 m windows around each
  region and 320 m / 640 m reductions), `moon-planner/public/data/terrain/heightmap.*`
  (the 640 m plate heightmap) and `moon-planner/public/data/horizon/<region>.json`
  (the traced horizons), built by `moon-planner/scripts/process-dem.ts`
  (`npm run process-dem`).
- **Source:** LRO LOLA `LDEM_80S_80MPP_ADJ.TIF`, NASA GSFC Planetary Geodesy
  Data Archive product 90, https://pgda.gsfc.nasa.gov/products/90
  (download https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF).
- **Near field for custom sites from 80 S to the pole (fetched at run time):**
  `LRO_LOLA_DEM_SPole75_30mp_v04` from NASA Moon Trek,
  https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_SPole75_30mp_v04/ImageServer ,
  resampled to 80 m within 5 km of the point (`src/lib/horizonFromGrid.ts`).
- **Credit line:** Elevation: NASA/GSFC LRO LOLA (Planetary Geodesy Data
  Archive).

## LOLA illumination and Earth visibility maps (Checked against NASA)

- **Files:** `moon-planner/src/lib/validation.ts` (the values read at each
  region centre) and `moon-planner/public/data/validation.json`, built by
  `moon-planner/scripts/build-validation.ts` (`npm run build-validation`).
- **Source:** Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T.,
  Torrence, M. H. (2011), "Illumination conditions of the lunar polar regions
  using LOLA topography", Icarus 211, 1066-1081,
  doi:10.1016/j.icarus.2010.10.030. Maps: NASA GSFC Planetary Geodesy Data
  Archive product 69 (release 201608, 120 m),
  https://pgda.gsfc.nasa.gov/products/69
- **Credit line:** Illumination reference: Mazarico et al. (2011), NASA GSFC
  PGDA.

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
- **Detail tiles (fetched at run time, not stored in the repo):** NASA Moon
  Trek WMTS, https://trek.nasa.gov/moon/, loaded by
  `moon-planner/src/components/moon/tiles/` for the area in view when the
  globe is zoomed in, and printed in the same grey as the bundled maps. Tile
  grids read from each layer's `WMTSCapabilities.xml` on 2026-11-14; 256 px
  tiles, `Access-Control-Allow-Origin: *`. The selector and cache are checked
  by `moon-planner/scripts/check-moon-tiles.ts`
  (`npx tsx scripts/check-moon-tiles.ts`).
  - `LRO_WAC_Mosaic_Global_303ppd_v02` (LROC Wide Angle Camera global
    morphology mosaic, equirectangular, levels 0 to 8; levels 4 to 8 used,
    north of 67.5 S):
    `https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{row}/{col}.jpg`,
    capabilities at
    https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/WMTSCapabilities.xml
  - `LRO_WAC_Mosaic_SPole60_100m_v02` (LROC WAC south polar mosaic, polar
    stereographic, 100 m, levels 0 to 5; levels 3 to 5 used, south of
    67.5 S):
    `https://trek.nasa.gov/tiles/Moon/SP/LRO_WAC_Mosaic_SPole60_100m_v02/1.0.0/default/default028mm/{z}/{row}/{col}.png`,
    capabilities at
    https://trek.nasa.gov/tiles/Moon/SP/LRO_WAC_Mosaic_SPole60_100m_v02/1.0.0/WMTSCapabilities.xml
  - Credit: NASA/GSFC/Arizona State University (LROC), served by NASA Solar
    System Treks (NASA/JPL-Caltech).
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

## Site level for any point (terrain fetched at run time)

- **Files:** `moon-planner/src/lib/localTerrain.ts` (fetch, projection,
  horizon), checked by `moon-planner/scripts/check-global-site.ts`. Nothing
  is stored in the repo; one or two rasters (a few MB) are requested per
  point when its site level is opened.
- **Source:** NASA Solar System Treks (Moon Trek) ArcGIS image services,
  `exportImage` (float32 BSQ, metres above the 1737.4 km sphere, served with
  `Access-Control-Allow-Origin: *`), checked 2026-11-15:
  - `LRO_LOLA_DEM_Global_128ppd_v04`, equirectangular, 128 pixels per degree
    (237 m at the equator), used between 55 S and 55 N:
    https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_Global_128ppd_v04/ImageServer
  - `LRO_LOLA_DEM_NPole45_100mp_v04` and `LRO_LOLA_DEM_SPole45_100mp_v04`,
    polar stereographic, 100 m, 45 degrees to each pole, used poleward of
    55 degrees (the south one only as far as 80 S, where the existing
    80 m / 640 m grids take over):
    https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_NPole45_100mp_v04/ImageServer
    https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_SPole45_100mp_v04/ImageServer
- **Underlying data:** LRO Lunar Orbiter Laser Altimeter gridded data
  records (LDEM), NASA Planetary Data System Geosciences Node.
- **Use:** resampled in the browser, in an azimuthal equidistant projection
  centred on the point, to a grid reaching about 123 km each way: 240 m
  (1024 x 1024) from the global mosaic or 300 m (820 x 820) from the polar
  mosaics, plus a 120 m grid (512 x 512, about 30 km each way) for the near
  horizon with the polar mosaics.
- **Check (2026-11-15):** horizon from these grids against
  `public/data/horizon/<id>.json` at Malapert, Haworth, Nobile 1 and Mouton
  plateau: mean absolute difference 0.17 to 0.41 degrees, largest 1.79
  degrees. Global and polar mosaics agree to 2 m (55 N) and 18 m (55 S) mean
  on the 600 m grid.
- **Citation:** Smith, D. E., et al. (2010), "The Lunar Orbiter Laser
  Altimeter investigation on the Lunar Reconnaissance Orbiter mission",
  Space Science Reviews 150, 209-241, doi:10.1007/s11214-009-9512-y. Smith,
  D. E., et al. (2017), "Summary of the results from the Lunar Orbiter Laser
  Altimeter after seven years in lunar orbit", Icarus 283, 70-91,
  doi:10.1016/j.icarus.2016.06.006.
- **Credit line:** Elevation: NASA/GSFC LRO LOLA, served by NASA Solar System
  Treks (NASA/JPL-Caltech).

## Earth launch sites and the launch-window estimate

- **Files:**
  - `moon-planner/src/lib/launchSites.ts`: sixteen launch sites (United
    States, NASA partner agencies, other US partner countries) with
    coordinates, allowed launch azimuths and a source for each.
  - `moon-planner/src/lib/launchWindow.ts`: the estimate itself; its
    `LAUNCH_METHOD` text lists every simplification.
  - `moon-planner/scripts/check-launch-window.ts`: the checks below
    (`npx tsx scripts/check-launch-window.ts`).
- **Site coordinates:** Wikipedia articles for each site (linked per site in
  `launchSites.ts`), read 2026-11-15 for Kourou, Sriharikota, Alcântara,
  Kodiak, Wallops/MARS, Vandenberg and Mahia; the other nine are well-known
  pad coordinates not re-read that day. A 0.1 degree error moves a launch
  time by under half a minute in this model.
- **Allowed launch azimuths, published (2026-11-15; the Andøya page was read
  directly, the FAA and AIAA figures were read from search excerpts of the
  pages because the pages refused automated requests):**
  - Kodiak, 110-220 degrees: FAA, Spaceports by State,
    https://www.faa.gov/space/spaceports_by_state
  - Kourou, -10.5 to +91.5 degrees: AIAA launch vehicle guide (Ariane),
    https://aiaa.org/vehicle-guide/vehicles/ariane (the Ariane 5 user's manual
    figure often quoted is -10.5 to +93.5).
  - Andøya, -60 to +5 degrees: Andøya Space,
    https://andoyaspace.no/spaceport/efficient-way-to-space/
- **Allowed launch azimuths, approximate:** every other site. Either a
  commonly quoted figure whose primary source could not be read that day
  (Cape Canaveral/KSC 35-120, Vandenberg 158-201, Wallops 90-160,
  Sriharikota 102-140), a range derived from a quoted inclination range
  (Mahia, Alcântara), or a range reasoned from open-ocean sectors (Starbase,
  Tanegashima, Uchinoura, Naro, Arnhem, Esrange, SaxaVord). Cross-checks
  used: Eastern Range article (37-114 degrees),
  https://en.wikipedia.org/wiki/Eastern_Range ; Minotaur I user's guide
  (Vandenberg inclinations below 72 degrees need a dogleg; Wallops
  inclinations 37.8-55 degrees),
  https://www.manualsdir.com/manuals/569825/orbital-minotaur-i.html?page=26 ;
  NASA Wallops Range User's Handbook,
  https://www.nasa.gov/wp-content/uploads/2023/09/wallopsrangeusershandbook-2024.pdf ;
  NASA Launch Services Program launch sites,
  https://www.nasa.gov/launch-services-program-launch-sites/
  Each site's `azimuthNote` says which applies. These are not range safety
  limits and must not be used as such.
- **Method references:**
  - Earth Rotation Angle: IAU 2000 Resolution B1.8; Capitaine, N., Guinot,
    B., McCarthy, D. D. (2000), Astronomy and Astrophysics 355, 398-405.
    GMST (IAU 1982) for the check: Meeus, J. (1998), Astronomical Algorithms,
    2nd ed., eq. 12.4.
  - Launch azimuth and inclination (cos i = cos latitude x sin azimuth),
    two-body transfer time: Bate, R. R., Mueller, D. D., White, J. E. (1971),
    Fundamentals of Astrodynamics, Dover (launch azimuth; lunar
    trajectories); Vallado, D. A., Fundamentals of Astrodynamics and
    Applications (launch windows).
  - Apollo 11 figures used in the check (launch 1969-07-16 13:32:00 UTC,
    flight azimuth 72.058 degrees, window 72-108 degrees to 17:54 UTC,
    translunar injection 2 h 44 min after lift-off, lunar orbit insertion
    1969-07-19 17:22 UTC): NASA, Apollo 11 Mission Report (MSC-00171) and
    Orloff, R. W. (2000), Apollo by the Numbers, NASA SP-2000-4029,
    https://www.nasa.gov/history/SP-4029/
  - Moon positions: the 2027 JPL Horizons table already listed above
    (`public/data/system/2027.json`); the check fetches two geocentric Moon
    positions from https://ssd.jpl.nasa.gov/api/horizons.api (2027-11-14 and
    1969-07-19).
- **Check (2026-11-15):** GMST at J2000 280.46062 degrees; two GMST formulas
  agree to 0.00002 degrees in 2027. Moon right ascension and declination from
  `system.ts` against Horizons at 2027-11-14 00:00 UTC: 0.006 and 0.002
  degrees, 1 km. Apollo 11 with the 72-108 degree limits: the model window
  opens 13:25 and closes 17:46 UTC (real 13:32 and 17:54), and needs azimuth
  73.0 degrees at the real lift-off time (flown 72.058), inclination 32.49
  (flown 32.52). The model's coast to injection is 73 minutes; Apollo waited
  one more orbit (164 minutes). Moon declination over 2027: -27.69 to +27.70
  degrees.
- **Credit line:** Moon and Earth positions: NASA/JPL Horizons. Launch site
  data: operators and agencies as listed; azimuth ranges marked approximate
  are this project's estimates.

## Earth globe (System level)

- **Blue Marble Next Generation with Topography and Bathymetry, July 2004** (`world.topo.bathy.200407.3x5400x2700.jpg`). NASA Earth Observatory (Reto Stöckli); public domain. Source: https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/july/world.topo.bathy.200407.3x5400x2700.jpg. Resized to `moon-planner/public/textures/earth_color_2k.jpg` and `earth_color_4k.jpg`.
- Earth's orientation uses the Earth Rotation Angle (IAU 2000, UT1 taken as UTC) about the mean pole; see `moon-planner/src/lib/earthFrame.ts` and `npx tsx scripts/check-earth-frame.ts`.


## Landing page picture

- **File:** `moon-planner/public/landing/moon.jpg` (the Moon behind the
  landing page heading, `src/components/landing/MoonSky.tsx`).
- **Source:** not yet recorded. To be confirmed by the team before
  submission.

# Data sources

Every NASA and USGS dataset used by Moon Planner, where it lives in this repo,
and the credit line to show with it. NASA and USGS data are public domain in
the United States; Space Apps asks that each source is credited.

## NASA CGI Moon Kit (globe textures)

- **Files:** `moon-planner/public/textures/moon_color_2k.jpg`,
  `moon-planner/public/textures/moon_height_3ppd.jpg`
- **Source:** NASA Scientific Visualization Studio, CGI Moon Kit,
  https://svs.gsfc.nasa.gov/4720
- **Underlying data:** colour map from the Lunar Reconnaissance Orbiter Camera
  (LROC) Wide Angle Camera mosaic; height map from the Lunar Orbiter Laser
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

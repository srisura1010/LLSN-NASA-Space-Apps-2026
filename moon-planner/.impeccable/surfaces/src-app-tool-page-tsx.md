---
version: 1
slug: "src-app-tool-page-tsx"
primary_target: "src/app/tool/page.tsx"
related_targets: ["src/components"]
---

# Surface brief: /tool (the Navigator)

Mode: Operate. Audience: lunar mission planners first, educators second, Space Apps judges watching a 30 s demo. Task: pick a region and a mission window, see Sun and Earth against the real terrain horizon, get a ranked landing window with reasons, see what a slip or a neighbouring region changes. Constraints: public, no login, works from the committed 2027 cache, demo must read in a small video frame.

## Direction contract

THESIS: The Navigator is a NASA-style eclipse bulletin for the lunar south pole: light and shadow over time, plotted as paths with time ticks and contact times, then turned into a ranked decision. It refuses the category default of a black space dashboard with a glowing globe and neon accents.

OWN-WORLD: Bulletin paper ground (cool off-white #EEF1F0, never cream) with ink #121A22; umbra slate #3D5466 fills every shadowed or no-signal span; solar cadmium #F0B400 marks sunlight and the Sun's path; Earth cobalt #2453C2 marks direct-to-Earth visibility; limit red #C42B1C only for loss of power or comms. Hairline 1px ink rules, square corners, tabular figures. One workhorse family (Public Sans): weight and case carry rank, small tracked caps for labels.

STORY: The visitor sees nine regions ranked for a start date, opens one, reads its bulletin plot (terrain horizon with Sun and Earth paths ticked by hour, rise and set contacts marked), scrubs time and watches light move on the 3D terrain plate, then compares a two-week slip or the next region.

FIRST VIEWPORT: Top bar with name, date-and-duration control and tabs (Navigator, Compare, About & data). Left rail: the nine regions as a ranked table with sunlight %, Earth %, longest dark. Centre: 3D LOLA terrain plate in grey relief, lit by the real Sun, regions outlined, selected one flagged. Bottom band: the bulletin horizon panorama with ticked Sun and Earth paths and a scrub rail. Primary action: the date and mission-length control at top left of the rail, its result visible as the ranking.

FORM: Eclipse-bulletin path plates and circumstance tables, candidate 7 of 7 on my grounded list. seed: f66bb00d8bb0b00b07390b11741f1911 reference (roll key f66bb00d…1911). Signature move: time-ticked Sun and Earth paths with contact labels (rise, set, Earthrise, Earthset) drawn over the terrain horizon. Raises kept from declined challengers: the J-card's hard capacity (the mission length is a fixed span windows must fit), the plate section's registration discipline (every rule a 1px hairline on one grid), the timetable rack's single-size discipline (rank by weight and case, a tight 1.125 scale). Split-flap board was competitive (ranked rows with countdowns) and its row ranking with status restyling is adopted for the region table.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

Final product name with the team; whether the landing page gets its own Persuade pass after the tool ships.
